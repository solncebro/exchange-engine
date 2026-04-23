import { ReliableWebSocket, WebSocketStatus } from '@solncebro/websocket-engine';

import type { ExchangeLogger, KlineInterval, MarkPriceHandler, MarkPriceUpdate, TickerBySymbol, WebSocketConnectionInfo } from '../types/common';
import { WebSocketConnectionTypeEnum } from '../types/common';
import type { KlineHandler } from '../types/exchange';
import { normalizeBybitKlineWebSocketMessage, normalizeBybitTickers } from '../normalizers/bybitNormalizer';
import type { BybitPublicTradeDataRaw, BybitTickerRaw, BybitWebSocketKlineRaw } from '../normalizers/bybitNormalizer';
import { BYBIT_KLINE_INTERVAL } from '../constants/bybit';
import { BYBIT_HEARTBEAT_CONFIG, BYBIT_PING_INTERVAL } from './bybitWebSocketUtils';
import type { BybitConnection, BybitPublicStreamArgs, BybitWebSocketMessage } from './BybitPublicStream.types';
import { TradeToKlineAggregator } from './TradeToKlineAggregator';
import { parseWebSocketMessage } from './parseWebSocketMessage';

const MAX_TOPICS_PER_CONNECTION = 200;
const MAX_TOPICS_PER_SUBSCRIBE = 10;

function resolveUnifiedInterval(bybitInterval: string): KlineInterval {
  for (const [unified, bybit] of Object.entries(BYBIT_KLINE_INTERVAL)) {
    if (bybit === bybitInterval) {
      return unified as KlineInterval;
    }
  }

  return '1m';
}

class BybitPublicStream {
  private readonly connectionList: BybitConnection[] = [];
  private readonly url: string;
  private readonly logger: ExchangeLogger;
  private readonly label: string;
  private readonly onNotify?: (message: string) => void | Promise<void>;
  private readonly tickerHandlerSet: Set<(tickers: TickerBySymbol) => void> = new Set();
  private readonly markPriceHandlerSet: Set<MarkPriceHandler> = new Set();
  private readonly klineHandlerByKey: Map<string, Set<KlineHandler>> = new Map();
  private readonly activeSubscriptionSet: Set<string> = new Set();
  private tradeAggregator: TradeToKlineAggregator | null = null;
  private readonly tradeSubscribedSymbolSet: Set<string> = new Set();
  private isConnectScheduled = false;

  constructor(args: BybitPublicStreamArgs) {
    this.url = args.url;
    this.logger = args.logger;
    this.onNotify = args.onNotify;
    this.label = args.label;
  }

  subscribeAllTickers(handler: (tickers: TickerBySymbol) => void): void {
    this.tickerHandlerSet.add(handler);
    const topic = this.resolveTickerTopic();
    this.activeSubscriptionSet.add(topic);
    this.scheduleConnect();
  }

  unsubscribeAllTickers(handler: (tickers: TickerBySymbol) => void): void {
    this.tickerHandlerSet.delete(handler);

    if (this.tickerHandlerSet.size === 0 && this.markPriceHandlerSet.size === 0) {
      const topic = this.resolveTickerTopic();
      this.activeSubscriptionSet.delete(topic);
    }
  }

  subscribeMarkPrices(handler: MarkPriceHandler): void {
    this.markPriceHandlerSet.add(handler);
    const topic = this.resolveTickerTopic();
    this.activeSubscriptionSet.add(topic);
    this.scheduleConnect();
  }

  unsubscribeMarkPrices(handler: MarkPriceHandler): void {
    this.markPriceHandlerSet.delete(handler);

    if (this.markPriceHandlerSet.size === 0 && this.tickerHandlerSet.size === 0) {
      const topic = this.resolveTickerTopic();
      this.activeSubscriptionSet.delete(topic);
    }
  }

  subscribeKlines(symbol: string, interval: KlineInterval, handler: KlineHandler): void {
    const key = `${symbol}_${interval}`;

    const handlerSet = this.klineHandlerByKey.get(key) ?? new Set<KlineHandler>();
    handlerSet.add(handler);
    this.klineHandlerByKey.set(key, handlerSet);

    if (interval === '1s') {
      const topic = `publicTrade.${symbol}`;
      this.activeSubscriptionSet.add(topic);
      this.tradeSubscribedSymbolSet.add(symbol);

      if (this.tradeAggregator === null) {
        this.tradeAggregator = new TradeToKlineAggregator(this.logger);
        this.tradeAggregator.setHandler((tradeSymbol, kline) => {
          const tradeKey = `${tradeSymbol}_1s`;
          const tradeHandlerSet = this.klineHandlerByKey.get(tradeKey);

          if (tradeHandlerSet) {
            for (const h of tradeHandlerSet) {
              h(tradeSymbol, kline);
            }
          }
        });
      }

      if (this.connectionList.length > 0) {
        this.addTopicToConnection(topic);
      } else {
        this.scheduleConnect();
      }

      return;
    }

    const bybitInterval = BYBIT_KLINE_INTERVAL[interval];
    const topic = `kline.${bybitInterval}.${symbol}`;
    this.activeSubscriptionSet.add(topic);

    if (this.connectionList.length > 0) {
      this.addTopicToConnection(topic);
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

      if (interval === '1s') {
        const topic = `publicTrade.${symbol}`;
        this.activeSubscriptionSet.delete(topic);
        this.tradeSubscribedSymbolSet.delete(symbol);

        if (this.tradeAggregator !== null) {
          this.tradeAggregator.clearSymbol(symbol);

          if (this.tradeSubscribedSymbolSet.size === 0) {
            this.tradeAggregator.forceEmitPendingKlineList();
            this.tradeAggregator = null;
          }
        }

        this.removeTopicFromConnection(topic);

        return;
      }

      const bybitInterval = BYBIT_KLINE_INTERVAL[interval];
      const topic = `kline.${bybitInterval}.${symbol}`;
      this.activeSubscriptionSet.delete(topic);

      this.removeTopicFromConnection(topic);
    }
  }

  resubscribeStream(symbol: string, interval: string): void {
    const bybitInterval = BYBIT_KLINE_INTERVAL[interval];
    const topic = `kline.${bybitInterval}.${symbol}`;

    for (const connection of this.connectionList) {
      if (connection.topicList.includes(topic)) {
        try {
          connection.webSocket.sendToConnectedSocket({ op: 'subscribe', args: [topic] });

          this.logger.info(`BybitPublicStream: resubscribed topic ${topic}`);
        } catch {
          this.logger.warn(`BybitPublicStream: failed to resubscribe ${topic}`);
        }

        return;
      }
    }

    this.logger.warn(`BybitPublicStream: topic ${topic} not found in any connection`);
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
    if (this.tradeAggregator !== null) {
      this.tradeAggregator.forceEmitPendingKlineList();
      this.tradeAggregator = null;
    }

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
    const allTopicList = Array.from(this.activeSubscriptionSet);

    if (allTopicList.length === 0) {
      return;
    }

    for (let i = 0; i < allTopicList.length; i += MAX_TOPICS_PER_CONNECTION) {
      const topicChunk = allTopicList.slice(i, i + MAX_TOPICS_PER_CONNECTION);
      this.createConnection(topicChunk, this.connectionList.length);
    }

    this.logger.info(
      `BybitPublicStream: created ${this.connectionList.length} connection(s) for ${allTopicList.length} topics`,
    );
  }

  private createConnection(topicList: string[], index: number): void {
    const connectionLabel = this.connectionList.length > 0 || topicList.length >= MAX_TOPICS_PER_CONNECTION
      ? `${this.label} #${index + 1}`
      : this.label;
    const connectionIndex = this.connectionList.length;
    const webSocket = new ReliableWebSocket<BybitWebSocketMessage>({
      label: connectionLabel,
      url: this.url,
      logger: this.logger,
      parseMessage: (rawData) => parseWebSocketMessage<BybitWebSocketMessage>(rawData),
      onMessage: (message) => this.handleMessage(message),
      onOpen: async (context) => {
        const connection = this.connectionList[connectionIndex];

        if (connection && connection.topicList.length > 0) {
          this.sendSubscribeInBatches(connection.topicList, (data) => context.send(data), connection.label);
        }
      },
      onReconnectSuccess: () => this.resubscribeConnection(connectionIndex),
      onNotify: this.onNotify,
      heartbeat: BYBIT_HEARTBEAT_CONFIG,
      configuration: {
        pingInterval: BYBIT_PING_INTERVAL,
      },
    });

    this.connectionList.push({ webSocket, label: connectionLabel, topicList, dynamicTopicList: [], url: this.url });
  }

  private resubscribeConnection(connectionIndex: number): void {
    const connection = this.connectionList[connectionIndex];

    if (!connection || connection.topicList.length === 0) {
      return;
    }

    if (this.tradeAggregator !== null) {
      for (const topic of connection.topicList) {
        if (topic.startsWith('publicTrade.')) {
          const symbol = topic.slice('publicTrade.'.length);
          this.tradeAggregator.clearSymbol(symbol);
        }
      }
    }

    this.sendSubscribeInBatches(
      connection.topicList,
      (data) => connection.webSocket.sendToConnectedSocket(data),
      connection.label,
    );
  }

  private addTopicToConnection(topic: string): void {
    let targetConnection = this.connectionList.find(
      (connection) => connection.topicList.length < MAX_TOPICS_PER_CONNECTION,
    );

    if (!targetConnection) {
      this.createConnection([topic], this.connectionList.length);

      return;
    }

    targetConnection.topicList.push(topic);
    targetConnection.dynamicTopicList.push(topic);

    if (targetConnection.webSocket.getStatus() === WebSocketStatus.CONNECTED) {
      try {
        targetConnection.webSocket.sendToConnectedSocket({ op: 'subscribe', args: [topic] });
      } catch {
        this.logger.warn('BybitPublicStream: failed to subscribe, socket not connected');
      }
    }
  }

  private removeTopicFromConnection(topic: string): void {
    for (const connection of this.connectionList) {
      const index = connection.topicList.indexOf(topic);

      if (index !== -1) {
        connection.topicList.splice(index, 1);

        const dynamicIndex = connection.dynamicTopicList.indexOf(topic);

        if (dynamicIndex !== -1) {
          connection.dynamicTopicList.splice(dynamicIndex, 1);
        }

        try {
          connection.webSocket.sendToConnectedSocket({ op: 'unsubscribe', args: [topic] });
        } catch {
          this.logger.warn('BybitPublicStream: failed to unsubscribe, socket not connected');
        }

        break;
      }
    }
  }

  private buildSubscriptionList(connection: BybitConnection): string[] {
    const result: string[] = [];

    for (const topic of connection.topicList) {
      if (topic.startsWith('tickers.')) {
        result.push('Tickers');

        continue;
      }

      if (topic.startsWith('publicTrade.')) {
        const symbol = topic.slice('publicTrade.'.length);
        result.push(`Trades ${symbol}`);

        continue;
      }

      if (topic.startsWith('kline.')) {
        const partList = topic.split('.');

        if (partList.length >= 3) {
          const bybitInterval = partList[1];
          const symbol = partList.slice(2).join('.');
          const interval = resolveUnifiedInterval(bybitInterval);
          result.push(`Klines ${symbol} ${interval}`);
        }
      }
    }

    return result;
  }

  private handleMessage(message: BybitWebSocketMessage): void {
    if (message.op === 'subscribe' || message.op === 'unsubscribe') {
      if (!message.success) {
        this.logger.error({ subscriptionMessage: message }, 'Bybit subscription error');
      }

      return;
    }

    if (!message.topic || !Array.isArray(message.data)) {
      return;
    }

    const topic = message.topic;

    try {
      if (topic.startsWith('tickers.')) {
        const rawTickerList = message.data as BybitTickerRaw[];
        const tickerBySymbol = normalizeBybitTickers(rawTickerList);

        for (const handler of this.tickerHandlerSet) {
          handler(tickerBySymbol);
        }

        if (this.markPriceHandlerSet.size > 0) {
          const markPriceList = this.extractMarkPriceUpdates(rawTickerList, message.ts);

          if (markPriceList.length > 0) {
            for (const handler of this.markPriceHandlerSet) {
              handler(markPriceList);
            }
          }
        }

        return;
      }

      if (topic.startsWith('publicTrade.')) {
        this.handleTradeMessage(message.data as BybitPublicTradeDataRaw[]);

        return;
      }

      if (topic.startsWith('kline.')) {
        this.handleKlineMessage(topic, message.data as BybitWebSocketKlineRaw[]);
      }
    } catch (error) {
      this.logger.error({ topic, error }, 'BybitPublicStream: error handling message');
    }
  }

  private handleTradeMessage(dataList: BybitPublicTradeDataRaw[]): void {
    if (this.tradeAggregator === null) {
      return;
    }

    for (const tradeData of dataList) {
      this.tradeAggregator.processTrade(tradeData);
    }
  }

  private handleKlineMessage(topic: string, dataList: BybitWebSocketKlineRaw[]): void {
    const partList = topic.split('.');

    if (partList.length < 3) {
      return;
    }

    const bybitInterval = partList[1];
    const symbol = partList.slice(2).join('.');
    const unifiedInterval = resolveUnifiedInterval(bybitInterval);
    const key = `${symbol}_${unifiedInterval}`;
    const handlerSet = this.klineHandlerByKey.get(key);

    if (!handlerSet || dataList.length === 0) {
      return;
    }

    const kline = normalizeBybitKlineWebSocketMessage(dataList[0]);

    for (const handler of handlerSet) {
      handler(symbol, kline);
    }
  }

  private sendSubscribeInBatches(topicList: string[], send: (data: unknown) => void, label: string): void {
    let sentCount = 0;

    for (let i = 0; i < topicList.length; i += MAX_TOPICS_PER_SUBSCRIBE) {
      const batch = topicList.slice(i, i + MAX_TOPICS_PER_SUBSCRIBE);

      try {
        send({ op: 'subscribe', args: batch });
        sentCount += batch.length;
      } catch {
        this.logger.warn(`BybitPublicStream: failed to subscribe batch for ${label}, sent ${sentCount}/${topicList.length}`);

        return;
      }
    }

    this.logger.info(`BybitPublicStream: subscribed ${sentCount} topics for ${label}`);
  }

  private resolveTickerTopic(): string {
    return this.url.includes('linear') ? 'tickers.linear' : 'tickers.spot';
  }

  private extractMarkPriceUpdates(
    rawList: BybitTickerRaw[],
    messageTs: number | undefined,
  ): MarkPriceUpdate[] {
    const result: MarkPriceUpdate[] = [];

    for (const raw of rawList) {
      if (raw.markPrice === undefined) {
        continue;
      }

      const markPrice = parseFloat(raw.markPrice);

      if (!Number.isFinite(markPrice) || markPrice <= 0) {
        continue;
      }

      result.push({
        symbol: raw.symbol,
        markPrice,
        indexPrice: raw.indexPrice !== undefined ? parseFloat(raw.indexPrice) : 0,
        timestamp: raw.time ?? messageTs ?? Date.now(),
      });
    }

    return result;
  }
}

export { BybitPublicStream };
