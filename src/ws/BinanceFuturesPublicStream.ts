import type { RawData } from 'ws';
import { ReliableWebSocket } from '@solncebro/websocket-engine';

import type { ExchangeLogger, Kline, KlineInterval, TickerBySymbol } from '../types/common';
import type { KlineHandler } from '../types/exchange';
import { normalizeBinanceKlineWsMessage, normalizeBinanceTickers } from '../normalizers/binanceNormalizer';
import type { BinanceRawTicker24hr, BinanceRawWsKline } from '../normalizers/binanceNormalizer';
import { BINANCE_KLINE_INTERVAL } from '../constants/binance';
import { resolveUnifiedBinanceInterval } from './binanceWsUtils';

const MAX_STREAMS_PER_CONNECTION = 200;

interface BinanceCombinedMessage {
  stream?: string;
  data?: unknown;
}

interface FuturesConnection {
  webSocket: ReliableWebSocket<BinanceCombinedMessage>;
  label: string;
  streams: string[];
}

function parseBinanceCombinedMessage(rawData: RawData): BinanceCombinedMessage {
  return JSON.parse(rawData.toString()) as BinanceCombinedMessage;
}

function buildKlineStreamList(klineHandlerByKey: Map<string, Set<KlineHandler>>): string[] {
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

class BinanceFuturesPublicStream {
  private readonly wsCombinedUrl: string;
  private readonly logger: ExchangeLogger;
  private readonly onNotify?: (message: string) => void | Promise<void>;
  private readonly tickerHandlerSet: Set<(tickers: TickerBySymbol) => void> = new Set();
  private readonly klineHandlerByKey: Map<string, Set<KlineHandler>> = new Map();
  private readonly connections: FuturesConnection[] = [];
  private connectScheduled = false;
  private subscriptionIdCounter = 1;

  constructor(wsCombinedUrl: string, logger: ExchangeLogger, onNotify?: (message: string) => void | Promise<void>) {
    this.wsCombinedUrl = wsCombinedUrl;
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

  subscribeKlines(symbol: string, interval: KlineInterval, handler: KlineHandler): void {
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

  unsubscribeKlines(symbol: string, interval: KlineInterval, handler: KlineHandler): void {
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
    for (const connection of this.connections) {
      connection.webSocket.close();
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
      this.createConnection(chunk, this.connections.length);
    }

    this.logger.info(
      `BinanceFuturesPublicStream: created ${this.connections.length} connection(s) for ${allStreams.length} streams`
    );
  }

  private createConnection(streams: string[], index: number): void {
    const label = `BinanceFuturesPublicStream-${index}`;
    const url = `${this.wsCombinedUrl}?streams=${streams.join('/')}`;
    const connection: FuturesConnection = { webSocket: null!, label, streams };

    connection.webSocket = new ReliableWebSocket<BinanceCombinedMessage>({
      label,
      url,
      logger: this.logger,
      parseMessage: parseBinanceCombinedMessage,
      onMessage: (message) => this.handleMessage(message),
      onNotify: this.onNotify,
      configuration: {
        pingInterval: 30000,
      },
    });

    this.connections.push(connection);
  }

  private addStreamToConnection(stream: string): void {
    let targetConnection = this.connections.find(
      (connection) => connection.streams.length < MAX_STREAMS_PER_CONNECTION
    );

    if (!targetConnection) {
      this.createConnection([stream], this.connections.length);
      return;
    }

    targetConnection.streams.push(stream);

    try {
      targetConnection.webSocket.sendToConnectedSocket({
        method: 'SUBSCRIBE',
        params: [stream],
        id: this.subscriptionIdCounter++,
      });
    } catch {
    }
  }

  private removeStreamFromConnection(stream: string): void {
    for (const connection of this.connections) {
      const index = connection.streams.indexOf(stream);

      if (index !== -1) {
        connection.streams.splice(index, 1);

        try {
          connection.webSocket.sendToConnectedSocket({
            method: 'UNSUBSCRIBE',
            params: [stream],
            id: this.subscriptionIdCounter++,
          });
        } catch {
        }

        break;
      }
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
      const unifiedInterval = resolveUnifiedBinanceInterval(binanceInterval);
      const key = `${symbol}_${unifiedInterval}`;
      const handlerSet = this.klineHandlerByKey.get(key);

      if (handlerSet) {
        for (const handler of handlerSet) {
          handler(symbol, kline);
        }
      }
    }
  }
}

export { BinanceFuturesPublicStream };
export type { BinanceCombinedMessage };
