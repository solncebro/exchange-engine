import { ReliableWebSocket, WebSocketStatus } from '@solncebro/websocket-engine';

import type { ExchangeLogger, KlineInterval, MarkPriceHandler, TickerBySymbol, TradeSymbolBySymbol, WebSocketConnectionInfo } from '../types/common';
import { WebSocketConnectionTypeEnum } from '../types/common';
import type { KlineHandler } from '../types/exchange';
import {
  normalizeBinanceKlineWebSocketMessage,
  normalizeBinanceMarkPriceWebSocketList,
  normalizeBinanceTickers,
} from '../normalizers/binanceNormalizer';
import type {
  BinanceMarkPriceWebSocketRaw,
  BinanceTicker24hrRaw,
  BinanceWebSocketKlineRaw,
} from '../normalizers/binanceNormalizer';
import { resolveUnifiedBinanceInterval } from './binanceWebSocketUtils';
import type { BinanceCombinedMessage, BinanceFuturesPublicStreamArgs, FuturesConnection } from './BinanceFuturesPublicStream.types';
import { parseWebSocketMessage } from './parseWebSocketMessage';

const MAX_STREAMS_PER_CONNECTION = 200;
const TRADIFI_CONTRACT_TYPE = 'TRADIFI_PERPETUAL';

function buildStreamName(symbol: string, interval: string, tradeSymbols: TradeSymbolBySymbol): string {
  const tradeSymbol = tradeSymbols.get(symbol.toUpperCase());
  const isTradifi = tradeSymbol?.contractType === TRADIFI_CONTRACT_TYPE;

  return isTradifi
    ? `${symbol.toLowerCase()}@kline_${interval}`
    : `${symbol.toLowerCase()}_perpetual@continuousKline_${interval}`;
}

class BinanceFuturesPublicStream {
  private readonly webSocketCombinedUrl: string;
  private readonly logger: ExchangeLogger;
  private readonly label: string;
  private readonly onNotify?: (message: string) => void | Promise<void>;
  private tradeSymbols: TradeSymbolBySymbol = new Map();
  private readonly tickerHandlerSet: Set<(tickers: TickerBySymbol) => void> = new Set();
  private readonly markPriceHandlerSet: Set<MarkPriceHandler> = new Set();
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

  setTradeSymbols(tradeSymbols: TradeSymbolBySymbol): void {
    this.tradeSymbols = tradeSymbols;
  }

  subscribeAllTickers(handler: (tickers: TickerBySymbol) => void): void {
    this.tickerHandlerSet.add(handler);
    this.scheduleConnect();
  }

  unsubscribeAllTickers(handler: (tickers: TickerBySymbol) => void): void {
    this.tickerHandlerSet.delete(handler);
  }

  subscribeMarkPrices(handler: MarkPriceHandler): void {
    this.markPriceHandlerSet.add(handler);
    this.scheduleConnect();
  }

  unsubscribeMarkPrices(handler: MarkPriceHandler): void {
    this.markPriceHandlerSet.delete(handler);
  }

  subscribeKlines(symbol: string, interval: KlineInterval, handler: KlineHandler): void {
    const key = `${symbol}_${interval}`;

    const handlerSet = this.klineHandlerByKey.get(key) ?? new Set<KlineHandler>();
    handlerSet.add(handler);
    this.klineHandlerByKey.set(key, handlerSet);

    if (this.connectionList.length > 0) {
      const stream = buildStreamName(symbol, interval, this.tradeSymbols);
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

      const stream = buildStreamName(symbol, interval, this.tradeSymbols);
      this.removeStreamFromConnection(stream);
    }
  }

  resubscribeStream(symbol: string, interval: string): void {
    const stream = buildStreamName(symbol, interval, this.tradeSymbols);

    for (const connection of this.connectionList) {
      if (connection.streamList.includes(stream)) {
        try {
          connection.webSocket.sendToConnectedSocket({
            method: 'SUBSCRIBE',
            params: [stream],
            id: this.subscriptionIdCounter++,
          });

          this.logger.info(`BinanceFuturesPublicStream: resubscribed stream ${stream}`);
        } catch {
          this.logger.warn(`BinanceFuturesPublicStream: failed to resubscribe ${stream}`);
        }

        return;
      }
    }

    this.logger.warn(`BinanceFuturesPublicStream: stream ${stream} not found in any connection`);
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

  private buildStreamList(): string[] {
    const tickerStreamList = this.tickerHandlerSet.size > 0 ? ['!miniTicker@arr'] : [];
    const markPriceStreamList = this.markPriceHandlerSet.size > 0 ? ['!markPrice@arr@1s'] : [];
    const klineStreamList = this.buildKlineStreamList();

    return [...tickerStreamList, ...markPriceStreamList, ...klineStreamList];
  }

  private createConnections(): void {
    const allStreamList = this.buildStreamList();

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
    const connectionIndex = this.connectionList.length;
    const webSocket = new ReliableWebSocket<BinanceCombinedMessage>({
      label: connectionLabel,
      url,
      logger: this.logger,
      parseMessage: (rawData) => parseWebSocketMessage<BinanceCombinedMessage>(rawData),
      onMessage: (message) => this.handleMessage(message),
      onOpen: async (context) => {
        const connection = this.connectionList[connectionIndex];

        if (connection && connection.dynamicStreamList.length > 0) {
          context.send({
            method: 'SUBSCRIBE',
            params: [...connection.dynamicStreamList],
            id: this.subscriptionIdCounter++,
          });

          this.logger.info(
            `BinanceFuturesPublicStream: subscribed ${connection.dynamicStreamList.length} dynamic streams for ${connection.label}`,
          );
        }
      },
      onReconnectSuccess: () => this.resubscribeConnection(connectionIndex),
      onNotify: this.onNotify,
      configuration: {
        pingInterval: 30000,
      },
    });

    this.connectionList.push({ webSocket, label: connectionLabel, streamList, dynamicStreamList: [], url });
  }

  private resubscribeConnection(connectionIndex: number): void {
    const connection = this.connectionList[connectionIndex];

    if (!connection || connection.dynamicStreamList.length === 0) {
      return;
    }

    try {
      connection.webSocket.sendToConnectedSocket({
        method: 'SUBSCRIBE',
        params: [...connection.dynamicStreamList],
        id: this.subscriptionIdCounter++,
      });

      this.logger.info(
        `BinanceFuturesPublicStream: resubscribed ${connection.dynamicStreamList.length} dynamic streams for ${connection.label}`,
      );
    } catch {
      this.logger.warn(
        `BinanceFuturesPublicStream: failed to resubscribe dynamic streams for ${connection.label}`,
      );
    }
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
    targetConnection.dynamicStreamList.push(stream);

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

        const dynamicIndex = connection.dynamicStreamList.indexOf(stream);

        if (dynamicIndex !== -1) {
          connection.dynamicStreamList.splice(dynamicIndex, 1);
        }

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
      if (stream === '!markPrice@arr@1s') {
        result.push('MarkPrices');

        continue;
      }

      if (stream === '!miniTicker@arr') {
        result.push('Tickers');

        continue;
      }

      const continuousMatch = stream.match(/^(.+)_perpetual@continuousKline_(.+)$/);

      if (continuousMatch) {
        const symbol = continuousMatch[1].toUpperCase();
        const interval = resolveUnifiedBinanceInterval(continuousMatch[2]);
        result.push(`Klines ${symbol} ${interval}`);

        continue;
      }

      const klineMatch = stream.match(/^(.+)@kline_(.+)$/);

      if (klineMatch) {
        const symbol = klineMatch[1].toUpperCase();
        const interval = resolveUnifiedBinanceInterval(klineMatch[2]);
        result.push(`Klines ${symbol} ${interval}`);
      }
    }

    return result;
  }

  private buildKlineStreamList(): string[] {
    const streamList: string[] = [];

    for (const key of this.klineHandlerByKey.keys()) {
      const separatorIndex = key.lastIndexOf('_');
      const symbol = key.slice(0, separatorIndex);
      const interval = key.slice(separatorIndex + 1);
      streamList.push(buildStreamName(symbol, interval, this.tradeSymbols));
    }

    return streamList;
  }

  private handleKlineStream(message: BinanceCombinedMessage, delimiter: string, isContinuous: boolean): void {
    const klineRaw = (message.data as Record<string, unknown>)['k'] as BinanceWebSocketKlineRaw;

    if (!klineRaw || !message.stream) {
      return;
    }

    const kline = normalizeBinanceKlineWebSocketMessage(klineRaw);
    const delimiterIndex = message.stream.indexOf(delimiter);
    const symbolPart = message.stream.slice(0, delimiterIndex);
    const symbolLower = isContinuous ? symbolPart.replace(/_perpetual$/, '') : symbolPart;
    const symbol = symbolLower.toUpperCase();
    const binanceInterval = message.stream.slice(delimiterIndex + delimiter.length);
    const unifiedInterval = resolveUnifiedBinanceInterval(binanceInterval);
    const key = `${symbol}_${unifiedInterval}`;
    const handlerSet = this.klineHandlerByKey.get(key);

    if (handlerSet) {
      for (const handler of handlerSet) {
        handler(symbol, kline);
      }
    }
  }

  private handleMessage(message: BinanceCombinedMessage): void {
    if (message.data === undefined) {
      return;
    }

    try {
      if (message.stream === '!markPrice@arr@1s' && Array.isArray(message.data)) {
        const markPriceList = normalizeBinanceMarkPriceWebSocketList(
          message.data as BinanceMarkPriceWebSocketRaw[],
        );

        for (const handler of this.markPriceHandlerSet) {
          handler(markPriceList);
        }

        return;
      }

      if (Array.isArray(message.data)) {
        const tickerBySymbol = normalizeBinanceTickers(message.data as BinanceTicker24hrRaw[]);

        for (const handler of this.tickerHandlerSet) {
          handler(tickerBySymbol);
        }

        return;
      }

      if (message.stream && message.stream.includes('@continuousKline_')) {
        this.handleKlineStream(message, '@continuousKline_', true);
      } else if (message.stream && message.stream.includes('@kline_')) {
        this.handleKlineStream(message, '@kline_', false);
      }
    } catch (error) {
      this.logger.error(`BinanceFuturesPublicStream: error handling message: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

export { BinanceFuturesPublicStream };
