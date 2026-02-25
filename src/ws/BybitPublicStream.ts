import type { RawData } from 'ws';
import { ReliableWebSocket } from '@solncebro/websocket-engine';

import type { ExchangeLogger, Kline, KlineInterval, TickerBySymbol } from '../types/common';
import { normalizeBybitKlineWsMessage, normalizeBybitTickers } from '../normalizers/bybitNormalizer';
import type { BybitRawTicker, BybitRawWsKline } from '../normalizers/bybitNormalizer';
import { BYBIT_KLINE_INTERVAL } from '../constants/bybit';

interface BybitWsMessage {
  op?: string;
  topic?: string;
  data?: unknown;
  ret_code?: number;
  success?: boolean;
  ret_msg?: string;
  [key: string]: unknown;
}

function parseBybitMessage(rawData: RawData): BybitWsMessage {
  return JSON.parse(rawData.toString()) as BybitWsMessage;
}

function isBybitPongResponse(message: BybitWsMessage): boolean {
  return message.op === 'pong' || message.ret_msg === 'pong';
}

function resolveUnifiedInterval(bybitInterval: string): KlineInterval {
  for (const [unified, bybit] of Object.entries(BYBIT_KLINE_INTERVAL)) {
    if (bybit === bybitInterval) {
      return unified as KlineInterval;
    }
  }

  return '1m';
}

class BybitPublicStream {
  private ws: ReliableWebSocket<BybitWsMessage> | null = null;
  private readonly url: string;
  private readonly logger: ExchangeLogger;
  private readonly onNotify?: (message: string) => void | Promise<void>;
  private readonly tickerHandlerSet: Set<(tickers: TickerBySymbol) => void> = new Set();
  private readonly klineHandlerByKey: Map<string, Set<(kline: Kline) => void>> = new Map();
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

  subscribeKlines(symbol: string, interval: KlineInterval, handler: (kline: Kline) => void): void {
    const key = `${symbol}_${interval}`;

    if (!this.klineHandlerByKey.has(key)) {
      this.klineHandlerByKey.set(key, new Set());
    }

    this.klineHandlerByKey.get(key)!.add(handler);

    const bybitInterval = BYBIT_KLINE_INTERVAL[interval];
    const topic = `kline.${bybitInterval}.${symbol}`;
    this.activeSubscriptionSet.add(topic);

    if (this.ws !== null) {
      this.sendSubscribe([topic]);
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

      const bybitInterval = BYBIT_KLINE_INTERVAL[interval];
      const topic = `kline.${bybitInterval}.${symbol}`;
      this.activeSubscriptionSet.delete(topic);

      if (this.ws !== null) {
        this.sendUnsubscribe([topic]);
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

    this.ws = new ReliableWebSocket<BybitWsMessage>({
      label: 'BybitPublicStream',
      url: this.url,
      logger: this.logger,
      parseMessage: parseBybitMessage,
      onMessage: (message) => this.handleMessage(message),
      onReconnectSuccess: () => this.resubscribeAll(),
      onNotify: this.onNotify,
      heartbeat: {
        buildPayload: () => ({ op: 'ping' }),
        isResponse: isBybitPongResponse,
      },
      configuration: {
        pingInterval: 20000,
      },
    });

    this.resubscribeAll();
  }

  private handleMessage(message: BybitWsMessage): void {
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

    if (topic.startsWith('tickers.')) {
      const tickers = normalizeBybitTickers(message.data as BybitRawTicker[]);

      for (const handler of this.tickerHandlerSet) {
        handler(tickers);
      }

      return;
    }

    if (topic.startsWith('kline.')) {
      this.handleKlineMessage(topic, message.data as BybitRawWsKline[]);
    }
  }

  private handleKlineMessage(topic: string, dataList: BybitRawWsKline[]): void {
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

    const kline = normalizeBybitKlineWsMessage(dataList[0]);

    for (const handler of handlerSet) {
      handler(kline);
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
      this.ws!.sendToConnectedSocket({ op: 'subscribe', args: topicList });
    } catch {
      this.logger.warn('BybitPublicStream: failed to subscribe, socket not connected');
    }
  }

  private sendUnsubscribe(topicList: string[]): void {
    try {
      this.ws!.sendToConnectedSocket({ op: 'unsubscribe', args: topicList });
    } catch {
      this.logger.warn('BybitPublicStream: failed to unsubscribe, socket not connected');
    }
  }

  private resolveTickerTopic(): string {
    return this.url.includes('linear') ? 'tickers.linear' : 'tickers.spot';
  }
}

export { BybitPublicStream };
