import { ReliableWebSocket, WebSocketStatus } from '@solncebro/websocket-engine';

import type { ExchangeLogger, KlineInterval, TickerBySymbol, WebSocketConnectionInfo } from '../types/common';
import { WebSocketConnectionTypeEnum } from '../types/common';
import type { KlineHandler } from '../types/exchange';
import { normalizeBybitKlineWebSocketMessage, normalizeBybitTickers } from '../normalizers/bybitNormalizer';
import type { BybitPublicTradeDataRaw, BybitTickerRaw, BybitWebSocketKlineRaw } from '../normalizers/bybitNormalizer';
import { BYBIT_KLINE_INTERVAL } from '../constants/bybit';
import { BYBIT_HEARTBEAT_CONFIG, BYBIT_PING_INTERVAL } from './bybitWebSocketUtils';
import type { BybitPublicStreamArgs, BybitWebSocketMessage } from './BybitPublicStream.types';
import { TradeToKlineAggregator } from './TradeToKlineAggregator';
import { parseWebSocketMessage } from './parseWebSocketMessage';

function resolveUnifiedInterval(bybitInterval: string): KlineInterval {
  for (const [unified, bybit] of Object.entries(BYBIT_KLINE_INTERVAL)) {
    if (bybit === bybitInterval) {
      return unified as KlineInterval;
    }
  }

  return '1m';
}

class BybitPublicStream {
  private webSocket: ReliableWebSocket<BybitWebSocketMessage> | null = null;
  private readonly url: string;
  private readonly logger: ExchangeLogger;
  private readonly label: string;
  private readonly onNotify?: (message: string) => void | Promise<void>;
  private readonly tickerHandlerSet: Set<(tickers: TickerBySymbol) => void> = new Set();
  private readonly klineHandlerByKey: Map<string, Set<KlineHandler>> = new Map();
  private readonly activeSubscriptionSet: Set<string> = new Set();
  private tradeAggregator: TradeToKlineAggregator | null = null;
  private readonly tradeSubscribedSymbolSet: Set<string> = new Set();

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
    this.ensureConnected();
  }

  unsubscribeAllTickers(handler: (tickers: TickerBySymbol) => void): void {
    this.tickerHandlerSet.delete(handler);

    if (this.tickerHandlerSet.size === 0) {
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

      if (this.webSocket !== null) {
        this.sendSubscribe([topic]);
      } else {
        this.ensureConnected();
      }

      return;
    }

    const bybitInterval = BYBIT_KLINE_INTERVAL[interval];
    const topic = `kline.${bybitInterval}.${symbol}`;
    this.activeSubscriptionSet.add(topic);

    if (this.webSocket !== null) {
      this.sendSubscribe([topic]);
    } else {
      this.ensureConnected();
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

        if (this.webSocket !== null) {
          this.sendUnsubscribe([topic]);
        }

        return;
      }

      const bybitInterval = BYBIT_KLINE_INTERVAL[interval];
      const topic = `kline.${bybitInterval}.${symbol}`;
      this.activeSubscriptionSet.delete(topic);

      if (this.webSocket !== null) {
        this.sendUnsubscribe([topic]);
      }
    }
  }

  getConnectionInfoList(): WebSocketConnectionInfo[] {
    if (this.webSocket === null) {
      return [];
    }

    const subscriptionList: string[] = [];

    if (this.tickerHandlerSet.size > 0) {
      subscriptionList.push('Tickers');
    }

    for (const key of this.klineHandlerByKey.keys()) {
      const separatorIndex = key.lastIndexOf('_');
      const symbol = key.slice(0, separatorIndex);
      const interval = key.slice(separatorIndex + 1);

      if (interval === '1s') {
        subscriptionList.push(`Trades ${symbol}`);
      } else {
        subscriptionList.push(`Klines ${symbol} ${interval}`);
      }
    }

    return [{
      label: this.label,
      url: this.url,
      isConnected: this.webSocket.getStatus() === WebSocketStatus.CONNECTED,
      type: WebSocketConnectionTypeEnum.Public,
      subscriptionList,
    }];
  }

  close(): void {
    if (this.tradeAggregator !== null) {
      this.tradeAggregator.forceEmitPendingKlineList();
      this.tradeAggregator = null;
    }

    if (this.webSocket !== null) {
      this.webSocket.close();

      this.webSocket = null;
    }
  }

  private ensureConnected(): void {
    if (this.webSocket !== null) {
      return;
    }

    this.webSocket = new ReliableWebSocket<BybitWebSocketMessage>({
      label: this.label,
      url: this.url,
      logger: this.logger,
      parseMessage: (rawData) => parseWebSocketMessage<BybitWebSocketMessage>(rawData),
      onMessage: (message) => this.handleMessage(message),
      onReconnectSuccess: () => this.resubscribeAll(),
      onNotify: this.onNotify,
      heartbeat: BYBIT_HEARTBEAT_CONFIG,
      configuration: {
        pingInterval: BYBIT_PING_INTERVAL,
      },
    });

    this.resubscribeAll();
  }

  private handleMessage(message: BybitWebSocketMessage): void {
    if (message.op === 'subscribe' || message.op === 'unsubscribe') {
      if (message.success) {
        this.logger.debug({ operation: message.op }, 'Bybit subscription successful');
      } else {
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
        const tickerBySymbol = normalizeBybitTickers(message.data as BybitTickerRaw[]);

        for (const handler of this.tickerHandlerSet) {
          handler(tickerBySymbol);
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

  private resubscribeAll(): void {
    if (this.tradeAggregator !== null) {
      for (const symbol of this.tradeSubscribedSymbolSet) {
        this.tradeAggregator.clearSymbol(symbol);
      }
    }

    const topicList = Array.from(this.activeSubscriptionSet);

    if (topicList.length > 0) {
      this.sendSubscribe(topicList);
    }
  }

  private sendSubscribe(topicList: string[]): void {
    try {
      this.webSocket?.sendToConnectedSocket({ op: 'subscribe', args: topicList });
    } catch {
      this.logger.warn('BybitPublicStream: failed to subscribe, socket not connected');
    }
  }

  private sendUnsubscribe(topicList: string[]): void {
    try {
      this.webSocket?.sendToConnectedSocket({ op: 'unsubscribe', args: topicList });
    } catch {
      this.logger.warn('BybitPublicStream: failed to unsubscribe, socket not connected');
    }
  }

  private resolveTickerTopic(): string {
    return this.url.includes('linear') ? 'tickers.linear' : 'tickers.spot';
  }
}

export { BybitPublicStream };
