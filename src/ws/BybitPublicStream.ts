import { ReliableWebSocket } from '@solncebro/websocket-engine';

import type { ExchangeLogger, KlineInterval, TickerBySymbol } from '../types/common';
import type { KlineHandler } from '../types/exchange';
import { normalizeBybitKlineWebSocketMessage, normalizeBybitTickers } from '../normalizers/bybitNormalizer';
import type { BybitTickerRaw, BybitWebSocketKlineRaw } from '../normalizers/bybitNormalizer';
import { BYBIT_KLINE_INTERVAL } from '../constants/bybit';
import { BYBIT_HEARTBEAT_CONFIG, BYBIT_PING_INTERVAL } from './bybitWebSocketUtils';
import type { BybitWebSocketMessage } from './BybitPublicStream.types';
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
  private readonly onNotify?: (message: string) => void | Promise<void>;
  private readonly tickerHandlerSet: Set<(tickers: TickerBySymbol) => void> = new Set();
  private readonly klineHandlerByKey: Map<string, Set<KlineHandler>> = new Map();
  private readonly activeSubscriptionSet: Set<string> = new Set();

  constructor(url: string, logger: ExchangeLogger, onNotify?: (message: string) => void | Promise<void>) {
    this.url = url;
    this.logger = logger;
    this.onNotify = onNotify;
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

      const bybitInterval = BYBIT_KLINE_INTERVAL[interval];
      const topic = `kline.${bybitInterval}.${symbol}`;
      this.activeSubscriptionSet.delete(topic);

      if (this.webSocket !== null) {
        this.sendUnsubscribe([topic]);
      }
    }
  }

  close(): void {
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
      label: 'BybitPublicStream',
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
        this.logger.debug(`Bybit subscription successful: ${message.op}`);
      } else {
        this.logger.error(`Bybit subscription error: ${JSON.stringify(message)}`);
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

      if (topic.startsWith('kline.')) {
        this.handleKlineMessage(topic, message.data as BybitWebSocketKlineRaw[]);
      }
    } catch (error) {
      this.logger.error(`BybitPublicStream: error handling message for topic ${topic}: ${error instanceof Error ? error.message : String(error)}`);
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
