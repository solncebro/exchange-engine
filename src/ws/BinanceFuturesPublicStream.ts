import { ReliableWebSocket, WebSocketStatus } from '@solncebro/websocket-engine';

import type { ExchangeLogger, KlineInterval, TickerBySymbol, WebSocketConnectionInfo } from '../types/common';
import { WebSocketConnectionTypeEnum } from '../types/common';
import type { KlineHandler } from '../types/exchange';
import { normalizeBinanceKlineWebSocketMessage, normalizeBinanceTickers } from '../normalizers/binanceNormalizer';
import type { BinanceTicker24hrRaw, BinanceWebSocketKlineRaw } from '../normalizers/binanceNormalizer';
import { resolveUnifiedBinanceInterval } from './binanceWebSocketUtils';
import type { BinanceCombinedMessage, BinanceFuturesPublicStreamArgs, FuturesConnection } from './BinanceFuturesPublicStream.types';
import { parseWebSocketMessage } from './parseWebSocketMessage';

const MAX_STREAMS_PER_CONNECTION = 200;

function buildKlineStreamList(klineHandlerByKey: Map<string, Set<KlineHandler>>): string[] {
  const streamList: string[] = [];

  for (const key of klineHandlerByKey.keys()) {
    const separatorIndex = key.lastIndexOf('_');
    const symbol = key.slice(0, separatorIndex);
    const interval = key.slice(separatorIndex + 1);
    const binanceInterval = interval;
    streamList.push(`${symbol.toLowerCase()}_perpetual@continuousKline_${binanceInterval}`);
  }

  return streamList;
}

class BinanceFuturesPublicStream {
  private readonly webSocketCombinedUrl: string;
  private readonly logger: ExchangeLogger;
  private readonly label: string;
  private readonly onNotify?: (message: string) => void | Promise<void>;
  private readonly tickerHandlerSet: Set<(tickers: TickerBySymbol) => void> = new Set();
  private readonly klineHandlerByKey: Map<string, Set<KlineHandler>> = new Map();
  private readonly connectionList: FuturesConnection[] = [];
  private isConnectScheduled = false;
  private subscriptionIdCounter = 1;

  constructor(args: BinanceFuturesPublicStreamArgs) {
    this.webSocketCombinedUrl = args.webSocketCombinedUrl;
    this.logger = args.logger;
    this.onNotify = args.onNotify;
    this.label = args.label;
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

    const handlerSet = this.klineHandlerByKey.get(key) ?? new Set<KlineHandler>();
    handlerSet.add(handler);
    this.klineHandlerByKey.set(key, handlerSet);

    if (this.connectionList.length > 0) {
      const binanceInterval = interval;
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

      const binanceInterval = interval;
      const stream = `${symbol.toLowerCase()}_perpetual@continuousKline_${binanceInterval}`;
      this.removeStreamFromConnection(stream);
    }
  }

  getConnectionInfoList(): WebSocketConnectionInfo[] {
    return this.connectionList.map((connection, index) => ({
      label: this.connectionList.length > 1
        ? `${this.label} #${index + 1}`
        : this.label,
      url: connection.url,
      isConnected: connection.webSocket.getStatus() === WebSocketStatus.CONNECTED,
      type: WebSocketConnectionTypeEnum.Public,
      subscriptionList: this.buildSubscriptionList(connection),
    }));
  }

  close(): void {
    for (const connection of this.connectionList) {
      connection.webSocket.close();
    }

    this.connectionList.length = 0;
  }

  private scheduleConnect(): void {
    if (this.isConnectScheduled || this.connectionList.length > 0) {
      return;
    }

    this.isConnectScheduled = true;

    queueMicrotask(() => {
      this.isConnectScheduled = false;
      this.createConnections();
    });
  }

  private createConnections(): void {
    const tickerStreamList = this.tickerHandlerSet.size > 0 ? ['!miniTicker@arr'] : [];
    const klineStreamList = buildKlineStreamList(this.klineHandlerByKey);
    const allStreamList = [...tickerStreamList, ...klineStreamList];

    if (allStreamList.length === 0) {
      return;
    }

    for (let i = 0; i < allStreamList.length; i += MAX_STREAMS_PER_CONNECTION) {
      const streamChunk = allStreamList.slice(i, i + MAX_STREAMS_PER_CONNECTION);
      this.createConnection(streamChunk, this.connectionList.length);
    }

    this.logger.info(
      `BinanceFuturesPublicStream: created ${this.connectionList.length} connection(s) for ${allStreamList.length} streams`
    );
  }

  private createConnection(streamList: string[], index: number): void {
    const connectionLabel = this.connectionList.length > 0 || streamList.length >= MAX_STREAMS_PER_CONNECTION
      ? `${this.label} #${index + 1}`
      : this.label;
    const url = `${this.webSocketCombinedUrl}?streams=${streamList.join('/')}`;
    const webSocket = new ReliableWebSocket<BinanceCombinedMessage>({
      label: connectionLabel,
      url,
      logger: this.logger,
      parseMessage: (rawData) => parseWebSocketMessage<BinanceCombinedMessage>(rawData),
      onMessage: (message) => this.handleMessage(message),
      onNotify: this.onNotify,
      configuration: {
        pingInterval: 30000,
      },
    });

    this.connectionList.push({ webSocket, label: connectionLabel, streamList, url });
  }

  private addStreamToConnection(stream: string): void {
    let targetConnection = this.connectionList.find(
      (connection) => connection.streamList.length < MAX_STREAMS_PER_CONNECTION
    );

    if (!targetConnection) {
      this.createConnection([stream], this.connectionList.length);
      return;
    }

    targetConnection.streamList.push(stream);

    try {
      targetConnection.webSocket.sendToConnectedSocket({
        method: 'SUBSCRIBE',
        params: [stream],
        id: this.subscriptionIdCounter++,
      });
    } catch {
      this.logger.warn('BinanceFuturesPublicStream: failed to subscribe, socket not connected');
    }
  }

  private removeStreamFromConnection(stream: string): void {
    for (const connection of this.connectionList) {
      const index = connection.streamList.indexOf(stream);

      if (index !== -1) {
        connection.streamList.splice(index, 1);

        try {
          connection.webSocket.sendToConnectedSocket({
            method: 'UNSUBSCRIBE',
            params: [stream],
            id: this.subscriptionIdCounter++,
          });
        } catch {
          this.logger.warn('BinanceFuturesPublicStream: failed to unsubscribe, socket not connected');
        }

        break;
      }
    }
  }

  private buildSubscriptionList(connection: FuturesConnection): string[] {
    const result: string[] = [];

    for (const stream of connection.streamList) {
      if (stream === '!miniTicker@arr') {
        result.push('Tickers');

        continue;
      }

      const match = stream.match(/^(.+)_perpetual@continuousKline_(.+)$/);

      if (match) {
        const symbol = match[1].toUpperCase();
        const interval = resolveUnifiedBinanceInterval(match[2]);
        result.push(`Klines ${symbol} ${interval}`);
      }
    }

    return result;
  }

  private handleMessage(message: BinanceCombinedMessage): void {
    if (message.data === undefined) {
      return;
    }

    try {
      if (Array.isArray(message.data)) {
        const tickerBySymbol = normalizeBinanceTickers(message.data as BinanceTicker24hrRaw[]);

        for (const handler of this.tickerHandlerSet) {
          handler(tickerBySymbol);
        }

        return;
      }

      if (message.stream && message.stream.includes('@continuousKline_')) {
        const klineRaw = (message.data as Record<string, unknown>)['k'] as BinanceWebSocketKlineRaw;

        if (!klineRaw) {
          return;
        }

        const kline = normalizeBinanceKlineWebSocketMessage(klineRaw);
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
    } catch (error) {
      this.logger.error(`BinanceFuturesPublicStream: error handling message: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

export { BinanceFuturesPublicStream };
