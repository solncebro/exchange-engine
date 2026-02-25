import type { RawData } from 'ws';
import { ReliableWebSocket } from '@solncebro/websocket-engine';

import type { ExchangeLogger, Kline, KlineInterval, TickerBySymbol } from '../types/common';
import { normalizeBinanceKlineWsMessage, normalizeBinanceTickers } from '../normalizers/binanceNormalizer';
import type { BinanceRawTicker24hr, BinanceRawWsKline } from '../normalizers/binanceNormalizer';
import { BINANCE_KLINE_INTERVAL, BINANCE_FUTURES_WS_COMBINED_URL } from '../constants/binance';

const MAX_STREAMS_PER_CONNECTION = 200;

interface BinanceCombinedMessage {
  stream?: string;
  data?: unknown;
}

interface FuturesConnection {
  ws: ReliableWebSocket<BinanceCombinedMessage>;
  streams: string[];
}

function parseBinanceCombinedMessage(rawData: RawData): BinanceCombinedMessage {
  return JSON.parse(rawData.toString()) as BinanceCombinedMessage;
}

function buildKlineStreamList(klineHandlerByKey: Map<string, Set<(kline: Kline) => void>>): string[] {
  const streamList: string[] = [];

  for (const key of klineHandlerByKey.keys()) {
    const separatorIndex = key.lastIndexOf('_');
    const symbol = key.slice(0, separatorIndex);
    const interval = key.slice(separatorIndex + 1);
    const binanceInterval = BINANCE_KLINE_INTERVAL[interval];
    streamList.push(`${symbol.toLowerCase()}_perpetual@continuousKline_${binanceInterval}`);
  }

  return streamList;
}

function resolveUnifiedInterval(binanceInterval: string): KlineInterval {
  for (const [unified, binance] of Object.entries(BINANCE_KLINE_INTERVAL)) {
    if (binance === binanceInterval) {
      return unified as KlineInterval;
    }
  }

  return '1m';
}

class BinanceFuturesPublicStream {
  private readonly logger: ExchangeLogger;
  private readonly onNotify?: (message: string) => void | Promise<void>;
  private readonly tickerHandlerSet: Set<(tickers: TickerBySymbol) => void> = new Set();
  private readonly klineHandlerByKey: Map<string, Set<(kline: Kline) => void>> = new Map();
  private readonly connections: FuturesConnection[] = [];
  private connectScheduled = false;
  private subscriptionIdCounter = 1;

  constructor(logger: ExchangeLogger, onNotify?: (message: string) => void | Promise<void>) {
    this.logger = logger;
    this.onNotify = onNotify;
  }

  subscribeAllTickers(handler: (tickers: TickerBySymbol) => void): void {
    this.tickerHandlerSet.add(handler);
    this.scheduleConnect();
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

    if (this.connections.length > 0) {
      const binanceInterval = BINANCE_KLINE_INTERVAL[interval];
      const stream = `${symbol.toLowerCase()}_perpetual@continuousKline_${binanceInterval}`;
      this.addStreamToConnection(stream);
    } else {
      this.scheduleConnect();
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

      const binanceInterval = BINANCE_KLINE_INTERVAL[interval];
      const stream = `${symbol.toLowerCase()}_perpetual@continuousKline_${binanceInterval}`;
      this.removeStreamFromConnection(stream);
    }
  }

  close(): void {
    for (const conn of this.connections) {
      conn.ws.close();
    }

    this.connections.length = 0;
  }

  private scheduleConnect(): void {
    if (this.connectScheduled || this.connections.length > 0) {
      return;
    }

    this.connectScheduled = true;

    queueMicrotask(() => {
      this.connectScheduled = false;
      this.createConnections();
    });
  }

  private createConnections(): void {
    const tickerStreams = this.tickerHandlerSet.size > 0 ? ['!miniTicker@arr'] : [];
    const klineStreams = buildKlineStreamList(this.klineHandlerByKey);
    const allStreams = [...tickerStreams, ...klineStreams];

    if (allStreams.length === 0) {
      return;
    }

    for (let i = 0; i < allStreams.length; i += MAX_STREAMS_PER_CONNECTION) {
      const chunk = allStreams.slice(i, i + MAX_STREAMS_PER_CONNECTION);
      this.createConnection(chunk);
    }

    this.logger.info(
      `BinanceFuturesPublicStream: created ${this.connections.length} connection(s) for ${allStreams.length} streams`
    );
  }

  private createConnection(streams: string[]): void {
    const conn: FuturesConnection = { ws: null!, streams };

    conn.ws = new ReliableWebSocket<BinanceCombinedMessage>({
      label: 'BinanceFuturesPublicStream',
      url: BINANCE_FUTURES_WS_COMBINED_URL,
      logger: this.logger,
      parseMessage: parseBinanceCombinedMessage,
      onMessage: (message) => this.handleMessage(message),
      onOpen: async () => {
        this.logger.info(`BinanceFuturesPublicStream connected (${conn.streams.length} streams)`);
        this.sendSubscribe(conn);
      },
      onReconnectSuccess: () => this.sendSubscribe(conn),
      onNotify: this.onNotify,
      heartbeat: {
        buildPayload: () => ({ method: 'PING' }),
        isResponse: (message) => {
          const raw = message as Record<string, unknown>;
          return raw['id'] !== undefined && raw['result'] === null;
        },
      },
      configuration: {
        pingInterval: 30000,
      },
    });

    this.connections.push(conn);
  }

  private addStreamToConnection(stream: string): void {
    let targetConn = this.connections.find(
      (c) => c.streams.length < MAX_STREAMS_PER_CONNECTION
    );

    if (!targetConn) {
      this.createConnection([stream]);
      return;
    }

    targetConn.streams.push(stream);

    try {
      targetConn.ws.sendToConnectedSocket({
        method: 'SUBSCRIBE',
        params: [stream],
        id: this.subscriptionIdCounter++,
      });
    } catch {
      // Will be subscribed on reconnect
    }
  }

  private removeStreamFromConnection(stream: string): void {
    for (const conn of this.connections) {
      const idx = conn.streams.indexOf(stream);

      if (idx !== -1) {
        conn.streams.splice(idx, 1);

        try {
          conn.ws.sendToConnectedSocket({
            method: 'UNSUBSCRIBE',
            params: [stream],
            id: this.subscriptionIdCounter++,
          });
        } catch {
          // Will be reflected on reconnect
        }

        break;
      }
    }
  }

  private sendSubscribe(conn: FuturesConnection): void {
    try {
      conn.ws.sendToConnectedSocket({
        method: 'SUBSCRIBE',
        params: conn.streams,
        id: this.subscriptionIdCounter++,
      });
    } catch {
      this.logger.warn('BinanceFuturesPublicStream: failed to subscribe, socket not connected');
    }
  }

  private handleMessage(message: BinanceCombinedMessage): void {
    if (message.data === undefined) {
      return;
    }

    if (Array.isArray(message.data)) {
      const tickers = normalizeBinanceTickers(message.data as BinanceRawTicker24hr[]);

      for (const handler of this.tickerHandlerSet) {
        handler(tickers);
      }

      return;
    }

    if (message.stream && message.stream.includes('@continuousKline_')) {
      const klineRaw = (message.data as Record<string, unknown>)['k'] as BinanceRawWsKline;

      if (!klineRaw) {
        return;
      }

      const kline = normalizeBinanceKlineWsMessage(klineRaw);
      const continuousKlineIndex = message.stream.indexOf('@continuousKline_');
      const symbolLower = message.stream.slice(0, continuousKlineIndex).replace(/_perpetual$/, '');
      const symbol = symbolLower.toUpperCase();
      const binanceInterval = message.stream.slice(continuousKlineIndex + '@continuousKline_'.length);
      const unifiedInterval = resolveUnifiedInterval(binanceInterval);
      const key = `${symbol}_${unifiedInterval}`;
      const handlerSet = this.klineHandlerByKey.get(key);

      if (handlerSet) {
        for (const handler of handlerSet) {
          handler(kline);
        }
      }
    }
  }
}

export { BinanceFuturesPublicStream };
export type { BinanceCombinedMessage };
