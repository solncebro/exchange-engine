import type { RawData } from 'ws';
import { ReliableWebSocket } from '@solncebro/websocket-engine';
import type { WebSocketOpenContext } from '@solncebro/websocket-engine';

import type { ExchangeLogger, Kline, KlineInterval, TickerBySymbol } from '../types/common';
import { normalizeBinanceKlineWsMessage, normalizeBinanceTickers } from '../normalizers/binanceNormalizer';
import type { BinanceRawTicker24hr, BinanceRawWsKline } from '../normalizers/binanceNormalizer';
import { BINANCE_KLINE_INTERVAL, BINANCE_SPOT_WS_STREAM_URL } from '../constants/binance';

interface BinanceSpotWsEnvelope {
  stream?: string;
  data?: unknown;
  e?: string;
  [key: string]: unknown;
}

function parseBinanceSpotMessage(rawData: RawData): BinanceSpotWsEnvelope {
  return JSON.parse(rawData.toString()) as BinanceSpotWsEnvelope;
}

function resolveUnifiedInterval(binanceInterval: string): KlineInterval {
  for (const [unified, binance] of Object.entries(BINANCE_KLINE_INTERVAL)) {
    if (binance === binanceInterval) {
      return unified as KlineInterval;
    }
  }

  return '1m';
}

class BinanceSpotPublicStream {
  private ws: ReliableWebSocket<BinanceSpotWsEnvelope> | null = null;
  private readonly logger: ExchangeLogger;
  private readonly onNotify?: (message: string) => void | Promise<void>;
  private readonly tickerHandlerSet: Set<(tickers: TickerBySymbol) => void> = new Set();
  private readonly klineHandlerByKey: Map<string, Set<(kline: Kline) => void>> = new Map();
  private subscriptionIdCounter = 1;

  constructor(logger: ExchangeLogger, onNotify?: (message: string) => void | Promise<void>) {
    this.logger = logger;
    this.onNotify = onNotify;
  }

  subscribeAllTickers(handler: (tickers: TickerBySymbol) => void): void {
    this.tickerHandlerSet.add(handler);
    this.ensureConnected();
  }

  unsubscribeAllTickers(handler: (tickers: TickerBySymbol) => void): void {
    this.tickerHandlerSet.delete(handler);
  }

  subscribeKlines(symbol: string, interval: KlineInterval, handler: (kline: Kline) => void): void {
    const key = `${symbol}_${interval}`;

    if (!this.klineHandlerByKey.has(key)) {
      this.klineHandlerByKey.set(key, new Set());
    }

    this.klineHandlerByKey.get(key)!.add(handler);

    if (this.ws !== null) {
      const binanceInterval = BINANCE_KLINE_INTERVAL[interval];
      const stream = `${symbol.toLowerCase()}@kline_${binanceInterval}`;
      this.sendSubscribe([stream]);
    } else {
      this.ensureConnected();
    }
  }

  unsubscribeKlines(symbol: string, interval: KlineInterval, handler: (kline: Kline) => void): void {
    const key = `${symbol}_${interval}`;
    const handlerSet = this.klineHandlerByKey.get(key);

    if (!handlerSet) {
      return;
    }

    handlerSet.delete(handler);

    if (handlerSet.size === 0) {
      this.klineHandlerByKey.delete(key);

      if (this.ws !== null) {
        const binanceInterval = BINANCE_KLINE_INTERVAL[interval];
        const stream = `${symbol.toLowerCase()}@kline_${binanceInterval}`;
        this.sendUnsubscribe([stream]);
      }
    }
  }

  close(): void {
    if (this.ws !== null) {
      this.ws.close();

      this.ws = null;
    }
  }

  private ensureConnected(): void {
    if (this.ws !== null) {
      return;
    }

    this.ws = new ReliableWebSocket<BinanceSpotWsEnvelope>({
      label: 'BinanceSpotPublicStream',
      url: BINANCE_SPOT_WS_STREAM_URL,
      logger: this.logger,
      parseMessage: parseBinanceSpotMessage,
      onMessage: (message) => this.handleMessage(message),
      onOpen: (context) => this.handleOpen(context),
      onReconnectSuccess: () => this.resubscribeAll(),
      onNotify: this.onNotify,
      heartbeat: {
        buildPayload: () => ({ method: 'PING' }),
        isResponse: (message) => message['id'] !== undefined && message['result'] === null,
      },
      configuration: {
        pingInterval: 30000,
      },
    });
  }

  private async handleOpen(_context: WebSocketOpenContext<BinanceSpotWsEnvelope>): Promise<void> {
    this.logger.info('BinanceSpotPublicStream connected');
    this.resubscribeAll();
  }

  private handleMessage(message: BinanceSpotWsEnvelope): void {
    if (message.e === '24hrMiniTicker' && Array.isArray(message.data)) {
      const tickers = normalizeBinanceTickers(message.data as BinanceRawTicker24hr[]);

      for (const handler of this.tickerHandlerSet) {
        handler(tickers);
      }

      return;
    }

    if (!message.stream) {
      return;
    }

    if (message.stream === '!miniTicker@arr' && Array.isArray(message.data)) {
      const tickers = normalizeBinanceTickers(message.data as BinanceRawTicker24hr[]);

      for (const handler of this.tickerHandlerSet) {
        handler(tickers);
      }

      return;
    }

    if (message.stream.includes('@kline_')) {
      this.handleKlineFromStream(message.stream, message.data);
    }
  }

  private handleKlineFromStream(stream: string, data: unknown): void {
    if (data === undefined || data === null) {
      return;
    }

    const klineWrapper = data as BinanceSpotWsEnvelope;
    const klineRaw = klineWrapper['k'] as BinanceRawWsKline | undefined;

    if (!klineRaw) {
      return;
    }

    const kline = normalizeBinanceKlineWsMessage(klineRaw);
    const atIndex = stream.indexOf('@kline_');
    const symbolLower = stream.slice(0, atIndex);
    const binanceInterval = stream.slice(atIndex + '@kline_'.length);
    const symbol = symbolLower.toUpperCase();
    const unifiedInterval = resolveUnifiedInterval(binanceInterval);
    const key = `${symbol}_${unifiedInterval}`;
    const handlerSet = this.klineHandlerByKey.get(key);

    if (handlerSet) {
      for (const handler of handlerSet) {
        handler(kline);
      }
    }
  }

  private resubscribeAll(): void {
    const streamList: string[] = [];

    if (this.tickerHandlerSet.size > 0) {
      streamList.push('!miniTicker@arr');
    }

    for (const key of this.klineHandlerByKey.keys()) {
      const separatorIndex = key.lastIndexOf('_');
      const symbol = key.slice(0, separatorIndex);
      const interval = key.slice(separatorIndex + 1);
      const binanceInterval = BINANCE_KLINE_INTERVAL[interval];
      streamList.push(`${symbol.toLowerCase()}@kline_${binanceInterval}`);
    }

    if (streamList.length > 0) {
      this.sendSubscribe(streamList);
    }
  }

  private sendSubscribe(streamList: string[]): void {
    try {
      this.ws!.sendToConnectedSocket({
        method: 'SUBSCRIBE',
        params: streamList,
        id: this.subscriptionIdCounter++,
      });
    } catch {
      this.logger.warn('BinanceSpotPublicStream: failed to subscribe, socket not connected');
    }
  }

  private sendUnsubscribe(streamList: string[]): void {
    try {
      this.ws!.sendToConnectedSocket({
        method: 'UNSUBSCRIBE',
        params: streamList,
        id: this.subscriptionIdCounter++,
      });
    } catch {
      this.logger.warn('BinanceSpotPublicStream: failed to unsubscribe, socket not connected');
    }
  }
}

export { BinanceSpotPublicStream };
