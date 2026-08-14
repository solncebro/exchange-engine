import { ReliableWebSocket, WebSocketStatus } from '@solncebro/websocket-engine';
import type { RawData, WebSocketCloseContext } from '@solncebro/websocket-engine';

import type { BybitPublicTopicType, ExchangeLogger, KlineInterval, MarkPriceHandler, MarkPriceUpdate, OrderBookHandler, OrderBookUpdateType, PublicTradeHandler, RawOrderbookFrame, RawOrderbookHandler, TickerBySymbol, WebSocketConnectionInfo } from '../types/common';
import { WebSocketConnectionTypeEnum } from '../types/common';
import type { KlineHandler } from '../types/exchange';
import { normalizeBybitKlineWebSocketMessage, normalizeBybitOrderBookUpdate, normalizeBybitPublicTradeFromStream, normalizeBybitTickers } from '../normalizers/bybitNormalizer';
import type { BybitOrderBookRaw, BybitPublicTradeDataRaw, BybitTickerRaw, BybitWebSocketKlineRaw } from '../normalizers/bybitNormalizer';
import { BYBIT_KLINE_INTERVAL } from '../constants/bybit';
import { BYBIT_WS_CASCADE_RECREATE_TOPIC_COUNT } from './streamCommandRateLimit';
import { BYBIT_HEARTBEAT_CONFIG, BYBIT_PING_INTERVAL } from './bybitWebSocketUtils';
import type { BybitConnection, BybitPublicStreamArgs, BybitWebSocketMessage } from './BybitPublicStream.types';
import { TradeToKlineAggregator } from './TradeToKlineAggregator';
import { parseWebSocketMessage } from './parseWebSocketMessage';

const MAX_TOPICS_PER_CONNECTION = 200;
const MAX_TOPICS_PER_SUBSCRIBE = 10;
const RECREATE_DEDUP_WINDOW_MS = 2000;

const ORDERBOOK_TOPIC_HEAD_REGEX = /"topic"\s*:\s*"(orderbook\.\d+\.([A-Z0-9]+))"/;
const FRAME_HEAD_SCAN_LENGTH = 200;

// Human-readable suffix used in the connection label when topics are separated by
// type — matches the Diagnostic composition wording (tickers/klines/orderbook/trades).
const TOPIC_TYPE_LABEL: Record<BybitPublicTopicType, string> = {
  tickers: 'tickers',
  kline: 'klines',
  orderbook: 'orderbook',
  publicTrade: 'trades',
};

// Deterministic order in which per-type connection pools are created — keeps the
// global connection numbering stable across restarts.
const TOPIC_TYPE_ORDER: BybitPublicTopicType[] = ['tickers', 'kline', 'orderbook', 'publicTrade'];

function classifyTopicType(topic: string): BybitPublicTopicType {
  if (topic.startsWith('kline.')) {
    return 'kline';
  }

  if (topic.startsWith('orderbook.')) {
    return 'orderbook';
  }

  if (topic.startsWith('publicTrade.')) {
    return 'publicTrade';
  }

  return 'tickers';
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
  private readonly connectionList: BybitConnection[] = [];
  private readonly resolveReadyByConnectionIndex: Array<(() => void) | undefined> = [];
  private readonly url: string;
  private readonly logger: ExchangeLogger;
  private readonly label: string;
  private readonly onNotify?: (message: string) => void | Promise<void>;
  private readonly tickerHandlerSet: Set<(tickers: TickerBySymbol) => void> = new Set();
  private readonly markPriceHandlerSet: Set<MarkPriceHandler> = new Set();
  /**
   * Last known index price per symbol. Bybit ticker deltas carry only the CHANGED
   * fields, so a frame with markPrice but no indexPrice must NOT reset the index to 0 —
   * doing so broke the price-limit boundary math downstream (OPGUSDT 2026-07-07).
   */
  private readonly lastIndexPriceBySymbol: Map<string, number> = new Map();
  private readonly klineHandlerByKey: Map<string, Set<KlineHandler>> = new Map();
  private readonly orderBookHandlerByTopic: Map<string, Set<OrderBookHandler>> = new Map();
  private readonly publicTradeHandlerBySymbol: Map<string, Set<PublicTradeHandler>> = new Map();
  private readonly activeSubscriptionSet: Set<string> = new Set();
  private tradeAggregator: TradeToKlineAggregator | null = null;
  private readonly tradeSubscribedSymbolSet: Set<string> = new Set();
  private readonly tickerSubscribedSymbolSet: Set<string> = new Set();
  private isConnectScheduled = false;
  private readonly separateByTopicType: boolean;
  private readonly maxTopicsPerConnection: number;
  private readonly maxTopicsByType: Partial<Record<BybitPublicTopicType, number>>;
  private readonly lazyOrderbookParse: boolean;
  private readonly liveOrderbookSymbolSet: Set<string> = new Set();
  private readonly rawOrderbookHandlerSet: Set<RawOrderbookHandler> = new Set();

  constructor(args: BybitPublicStreamArgs) {
    this.url = args.url;
    this.logger = args.logger;
    this.onNotify = args.onNotify;
    this.label = args.label;
    this.lazyOrderbookParse = args.lazyOrderbookParse === true;

    const packing = args.connectionPacking;
    this.separateByTopicType = packing?.separateByTopicType === true;
    this.maxTopicsPerConnection = packing?.maxTopicsPerConnection ?? MAX_TOPICS_PER_CONNECTION;
    this.maxTopicsByType = packing?.maxTopicsPerConnectionByType ?? {};
  }

  private maxTopicsForType(topicType: BybitPublicTopicType): number {
    return this.maxTopicsByType[topicType] ?? this.maxTopicsPerConnection;
  }

  // Connection identity, single source of truth. Always includes a stable `#N`
  // (N = position in connectionList); when topics are type-separated the label also
  // names the type, so the SAME string surfaces in logs, watchdog alerts and the
  // Diagnostic report — e.g. `Bybit Linear Public WebSocket orderbook #11`.
  private buildConnectionLabel(index: number, topicType: BybitPublicTopicType | undefined): string {
    return `${this.label} ${this.buildConnectionShortLabel(index, topicType)}`;
  }

  // Compact identifier without the repeated stream prefix — `${type} #N` when topics
  // are type-separated, otherwise just `#N`. Used by grouped UI listings (Diagnostic)
  // where the surrounding header already names the exchange/market/stream.
  private buildConnectionShortLabel(index: number, topicType: BybitPublicTopicType | undefined): string {
    const typePart = this.separateByTopicType && topicType !== undefined
      ? `${TOPIC_TYPE_LABEL[topicType]} `
      : '';

    return `${typePart}#${index + 1}`;
  }

  private groupTopicsByType(topicList: string[]): Map<BybitPublicTopicType, string[]> {
    const topicListByType = new Map<BybitPublicTopicType, string[]>();

    for (const topicType of TOPIC_TYPE_ORDER) {
      topicListByType.set(topicType, []);
    }

    for (const topic of topicList) {
      const bucket = topicListByType.get(classifyTopicType(topic));

      if (bucket !== undefined) {
        bucket.push(topic);
      }
    }

    for (const [topicType, bucket] of topicListByType) {
      if (bucket.length === 0) {
        topicListByType.delete(topicType);
      }
    }

    return topicListByType;
  }

  subscribeAllTickers(handler: (tickers: TickerBySymbol) => void, symbolList: string[]): void {
    this.tickerHandlerSet.add(handler);
    this.subscribeTickerSymbols(symbolList);
  }

  unsubscribeAllTickers(handler: (tickers: TickerBySymbol) => void): void {
    this.tickerHandlerSet.delete(handler);
    this.releaseTickerSymbolsIfUnused();
  }

  subscribeMarkPrices(handler: MarkPriceHandler, symbolList: string[]): void {
    this.markPriceHandlerSet.add(handler);
    this.subscribeTickerSymbols(symbolList);
  }

  unsubscribeMarkPrices(handler: MarkPriceHandler): void {
    this.markPriceHandlerSet.delete(handler);
    this.releaseTickerSymbolsIfUnused();
  }

  // Bybit V5 has no aggregate ticker topic — tickers are per-symbol (tickers.{symbol}).
  // The same tickers.{symbol} topic feeds both ticker and mark-price consumers, so a
  // symbol stays subscribed while either handler set is non-empty.
  private subscribeTickerSymbols(symbolList: string[]): void {
    for (const symbol of symbolList) {
      if (this.tickerSubscribedSymbolSet.has(symbol)) {
        continue;
      }

      this.tickerSubscribedSymbolSet.add(symbol);
      const topic = `tickers.${symbol}`;
      this.activeSubscriptionSet.add(topic);

      if (this.connectionList.length > 0) {
        this.addTopicToConnection(topic);
      } else {
        this.scheduleConnect();
      }
    }
  }

  private releaseTickerSymbolsIfUnused(): void {
    if (this.markPriceHandlerSet.size > 0 || this.tickerHandlerSet.size > 0) {
      return;
    }

    for (const symbol of this.tickerSubscribedSymbolSet) {
      const topic = `tickers.${symbol}`;
      this.activeSubscriptionSet.delete(topic);
      this.removeTopicFromConnection(topic);
    }

    this.tickerSubscribedSymbolSet.clear();
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
        this.tradeSubscribedSymbolSet.delete(symbol);

        if (this.tradeAggregator !== null) {
          this.tradeAggregator.clearSymbol(symbol);

          if (this.tradeSubscribedSymbolSet.size === 0) {
            this.tradeAggregator.forceEmitPendingKlineList();
            this.tradeAggregator = null;
          }
        }

        if (!this.hasPublicTradeConsumer(symbol)) {
          const topic = `publicTrade.${symbol}`;
          this.activeSubscriptionSet.delete(topic);

          this.removeTopicFromConnection(topic);
        }

        return;
      }

      const bybitInterval = BYBIT_KLINE_INTERVAL[interval];
      const topic = `kline.${bybitInterval}.${symbol}`;
      this.activeSubscriptionSet.delete(topic);

      this.removeTopicFromConnection(topic);
    }
  }

  subscribeOrderbook(symbol: string, depth: number, handler: OrderBookHandler): void {
    const topic = `orderbook.${depth}.${symbol}`;
    const handlerSet = this.orderBookHandlerByTopic.get(topic) ?? new Set<OrderBookHandler>();
    handlerSet.add(handler);
    this.orderBookHandlerByTopic.set(topic, handlerSet);

    const isAlreadySubscribed = this.activeSubscriptionSet.has(topic);
    this.activeSubscriptionSet.add(topic);

    if (isAlreadySubscribed) {
      return;
    }

    if (this.connectionList.length > 0) {
      this.addTopicToConnection(topic);
    } else {
      this.scheduleConnect();
    }
  }

  unsubscribeOrderbook(symbol: string, depth: number, handler: OrderBookHandler): void {
    const topic = `orderbook.${depth}.${symbol}`;
    const handlerSet = this.orderBookHandlerByTopic.get(topic);

    if (handlerSet === undefined) {
      return;
    }

    handlerSet.delete(handler);

    if (handlerSet.size > 0) {
      return;
    }

    this.orderBookHandlerByTopic.delete(topic);
    this.activeSubscriptionSet.delete(topic);

    this.removeTopicFromConnection(topic);
  }

  subscribePublicTrades(symbol: string, handler: PublicTradeHandler): void {
    const handlerSet = this.publicTradeHandlerBySymbol.get(symbol) ?? new Set<PublicTradeHandler>();
    handlerSet.add(handler);
    this.publicTradeHandlerBySymbol.set(symbol, handlerSet);

    const topic = `publicTrade.${symbol}`;
    const isAlreadySubscribed = this.activeSubscriptionSet.has(topic);
    this.activeSubscriptionSet.add(topic);

    if (isAlreadySubscribed) {
      return;
    }

    if (this.connectionList.length > 0) {
      this.addTopicToConnection(topic);
    } else {
      this.scheduleConnect();
    }
  }

  unsubscribePublicTrades(symbol: string, handler: PublicTradeHandler): void {
    const handlerSet = this.publicTradeHandlerBySymbol.get(symbol);

    if (handlerSet === undefined) {
      return;
    }

    handlerSet.delete(handler);

    if (handlerSet.size > 0) {
      return;
    }

    this.publicTradeHandlerBySymbol.delete(symbol);

    if (this.tradeSubscribedSymbolSet.has(symbol)) {
      return;
    }

    const topic = `publicTrade.${symbol}`;
    this.activeSubscriptionSet.delete(topic);

    this.removeTopicFromConnection(topic);
  }

  private hasPublicTradeConsumer(symbol: string): boolean {
    const handlerSet = this.publicTradeHandlerBySymbol.get(symbol);

    return handlerSet !== undefined && handlerSet.size > 0;
  }

  resubscribeStream(symbol: string, interval: string): void {
    const bybitInterval = BYBIT_KLINE_INTERVAL[interval];
    this.resubscribeTopic(`kline.${bybitInterval}.${symbol}`);
  }

  resubscribeOrderbook(symbol: string, depth: number): void {
    this.resubscribeTopic(`orderbook.${depth}.${symbol}`);
  }

  resubscribePublicTrades(symbol: string): void {
    this.resubscribeTopic(`publicTrade.${symbol}`);
  }

  // tickers.{symbol} is the shared topic-set feeding mark-price (Bybit V5 has no
  // aggregate ticker topic). Mark-price recovery is therefore connection-granular:
  // light-resubscribe every currently-subscribed tickers.{symbol} topic in batches
  // (no socket drop), so sibling orderbook/publicTrade topics on the same connection
  // are not disturbed.
  resubscribeMarkPrices(): void {
    const tickerTopicList = Array.from(
      this.tickerSubscribedSymbolSet,
      (symbol) => `tickers.${symbol}`,
    );

    if (tickerTopicList.length === 0) {
      return;
    }

    this.resubscribeTopicList(tickerTopicList);
  }

  private resubscribeTopic(topic: string): void {
    this.resubscribeTopicList([topic]);
  }

  // Light resubscribe (unsubscribe + subscribe on the live socket, no reconnect) of a
  // set of topics, grouped per connection and sent in batches. Falls back to recreating
  // a connection if its socket is disconnected or a send fails. Used both for single-topic
  // recovery (kline/orderbook/publicTrade) and the connection-granular mark-price recovery.
  private resubscribeTopicList(topicList: string[]): void {
    const topicSet = new Set(topicList);
    let matchedAny = false;

    for (let index = 0; index < this.connectionList.length; index++) {
      const connection = this.connectionList[index];
      const connectionTopicList = connection.topicList.filter((topic) => topicSet.has(topic));

      if (connectionTopicList.length === 0) {
        continue;
      }

      matchedAny = true;

      if (connection.webSocket.getStatus() !== WebSocketStatus.CONNECTED) {
        this.recreateConnection(index, `manual resubscribe of ${connectionTopicList.length} topic(s) (ws disconnected)`);

        continue;
      }

      if (connectionTopicList.length >= BYBIT_WS_CASCADE_RECREATE_TOPIC_COUNT) {
        this.logger.warn(
          `BybitPublicStream: cascade resubscribe of ${connectionTopicList.length} topic(s) on ${connection.label} — recreating connection instead of per-topic repair`,
        );
        this.recreateConnection(index, `cascade resubscribe of ${connectionTopicList.length} topic(s)`);

        continue;
      }

      try {
        this.sendUnsubscribeInBatches(connectionTopicList, (data) => connection.webSocket.sendToConnectedSocket(data), connection.label);
        this.sendSubscribeInBatches(connectionTopicList, (data) => connection.webSocket.sendToConnectedSocket(data), connection.label);
        this.logger.info(`BybitPublicStream: light resubscribe ${connectionTopicList.length} topic(s) on ${connection.label}`);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.logger.warn(`BybitPublicStream: light resubscribe failed for ${connectionTopicList.length} topic(s) on ${connection.label}, falling back to recreate (${errorMessage})`);
        this.recreateConnection(index, 'manual resubscribe (light failed)');
      }
    }

    if (!matchedAny) {
      this.logger.warn(`BybitPublicStream: resubscribe — no matching topic found in any connection (${topicList.length} requested)`);
    }
  }

  getConnectionInfoList(): WebSocketConnectionInfo[] {
    return this.connectionList.map((connection) => ({
      label: connection.label,
      shortLabel: connection.shortLabel,
      url: connection.url,
      isConnected: connection.webSocket.getStatus() === WebSocketStatus.CONNECTED,
      type: WebSocketConnectionTypeEnum.Public,
      subscriptionList: this.buildSubscriptionList(connection),
      messageCount: connection.messageCount,
      lastMessageTimestamp: connection.lastMessageTimestamp > 0 ? connection.lastMessageTimestamp : undefined,
      reconnectCount: connection.reconnectCount,
    }));
  }

  // Diagnostic: on EVERY connection close, emit a single greppable line snapshotting
  // ALL connections at that instant — so a timeline of close events reveals whether
  // drops are host/network-wide (many connections '-' / stale at once) or isolated
  // per-connection (only the closer is '-'). Token format per conn:
  // `#<idx><+|-conn>t<topics>/<ageMs>ms/↻<reconnects>`. Pure logging, no recovery here.
  private handleConnectionClose(connectionIndex: number, closeContext: WebSocketCloseContext): void {
    const now = Date.now();
    const snapshotTokenList = this.connectionList.map((connection, index) => {
      const connectedMark = connection.webSocket.getStatus() === WebSocketStatus.CONNECTED ? '+' : '-';
      const ageMs = connection.lastMessageTimestamp > 0 ? now - connection.lastMessageTimestamp : -1;

      return `#${index + 1}${connectedMark}t${connection.topicList.length}/${ageMs}ms/↻${connection.reconnectCount}`;
    });

    const closingConnection = this.connectionList[connectionIndex];
    const closingLabel = closingConnection !== undefined ? closingConnection.label : `${this.label} #${connectionIndex + 1}`;

    this.logger.warn(
      `${closingLabel} closed (code=${closeContext.closeCode ?? 'na'} pong=${closeContext.isPongTimeout} fails=${closeContext.consecutiveFailures}) | ${snapshotTokenList.join(' ')}`,
    );
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

    if (this.separateByTopicType) {
      for (const [topicType, topicListForType] of this.groupTopicsByType(allTopicList)) {
        const limit = this.maxTopicsForType(topicType);

        for (let i = 0; i < topicListForType.length; i += limit) {
          this.createConnection(topicListForType.slice(i, i + limit), topicType);
        }
      }
    } else {
      for (let i = 0; i < allTopicList.length; i += this.maxTopicsPerConnection) {
        this.createConnection(allTopicList.slice(i, i + this.maxTopicsPerConnection), undefined);
      }
    }

    this.logger.info(
      `BybitPublicStream: created ${this.connectionList.length} connection(s) for ${allTopicList.length} topics`,
    );
  }

  private createConnection(topicList: string[], topicType: BybitPublicTopicType | undefined): void {
    const connectionIndex = this.connectionList.length;
    const connectionLabel = this.buildConnectionLabel(connectionIndex, topicType);
    const connectionShortLabel = this.buildConnectionShortLabel(connectionIndex, topicType);
    // Обещание готовности заводим ДО создания сокета: он может открыться сразу, и тогда
    // разрешать было бы нечего.
    let resolveReady: () => void = () => undefined;
    const readyPromise = new Promise<void>((resolve) => {
      resolveReady = resolve;
    });
    this.resolveReadyByConnectionIndex[connectionIndex] = resolveReady;
    const webSocket = this.buildWebSocket(connectionIndex, connectionLabel);

    this.connectionList.push({ webSocket, label: connectionLabel, shortLabel: connectionShortLabel, topicType, topicList, dynamicTopicList: [], url: this.url, readyPromise, lastRecreateTimestamp: 0, lastMessageTimestamp: 0, messageCount: 0, reconnectCount: 0 });
  }

  /**
   * Раньше этого метода тут не было вовсе, и базовый класс отдавал уже решённое обещание:
   * бот считал потоки готовыми и начинал торговать на пустом кэше. У соседней биржи
   * ожидание настоящее — теперь и здесь.
   */
  async awaitConnectionsReady(): Promise<void> {
    await Promise.all(this.connectionList.map((connection) => connection.readyPromise));
  }

  private buildWebSocket(connectionIndex: number, connectionLabel: string): ReliableWebSocket<BybitWebSocketMessage> {
    return new ReliableWebSocket<BybitWebSocketMessage>({
      label: connectionLabel,
      url: this.url,
      logger: this.logger,
      parseMessage: (rawData) => this.resolveBybitMessage(rawData),
      onMessage: (message) => this.handleMessage(message, connectionIndex),
      onOpen: async (context) => {
        const connection = this.connectionList[connectionIndex];

        if (connection && connection.topicList.length > 0) {
          this.sendSubscribeInBatches(connection.topicList, (data) => context.send(data), connection.label);
        }

        this.resolveReadyByConnectionIndex[connectionIndex]?.();
      },
      onReconnectSuccess: () => this.resubscribeConnection(connectionIndex),
      onClose: (closeContext) => this.handleConnectionClose(connectionIndex, closeContext),
      onNotify: this.onNotify,
      heartbeat: BYBIT_HEARTBEAT_CONFIG,
      configuration: {
        pingInterval: BYBIT_PING_INTERVAL,
      },
    });
  }

  private recreateConnection(connectionIndex: number, reason: string): void {
    const connection = this.connectionList[connectionIndex];

    if (!connection) {
      return;
    }

    const nowTimestamp = Date.now();
    const recentRecreateAgeMs = nowTimestamp - connection.lastRecreateTimestamp;

    if (connection.lastRecreateTimestamp > 0 && recentRecreateAgeMs < RECREATE_DEDUP_WINDOW_MS) {
      this.logger.info(`BybitPublicStream: skip recreate ${connection.label} (recent recreate ${recentRecreateAgeMs}ms ago, reason: ${reason})`);

      return;
    }

    const topicCount = connection.topicList.length;
    this.logger.warn(`BybitPublicStream: recreating ${connection.label} (reason: ${reason}, topics: ${topicCount})`);

    if (this.tradeAggregator !== null) {
      for (const topic of connection.topicList) {
        if (topic.startsWith('publicTrade.')) {
          const symbol = topic.slice('publicTrade.'.length);
          this.tradeAggregator.clearSymbol(symbol);
        }
      }
    }

    try {
      connection.webSocket.close();
    } catch (error) {
      this.logger.warn(`BybitPublicStream: failed to close ${connection.label}: ${error instanceof Error ? error.message : String(error)}`);
    }

    const newWebSocket = this.buildWebSocket(connectionIndex, connection.label);

    this.connectionList[connectionIndex] = {
      ...connection,
      webSocket: newWebSocket,
      lastRecreateTimestamp: nowTimestamp,
    };
  }

  private resubscribeConnection(connectionIndex: number): void {
    const connection = this.connectionList[connectionIndex];

    if (!connection || connection.topicList.length === 0) {
      return;
    }

    connection.reconnectCount += 1;

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
    if (this.connectionList.some((connection) => connection.topicList.includes(topic))) {
      return;
    }

    const topicType = classifyTopicType(topic);
    const limit = this.separateByTopicType ? this.maxTopicsForType(topicType) : this.maxTopicsPerConnection;

    // When separating by type, a topic may only join a connection of its OWN type —
    // never back-fill another pool — so a churning orderbook socket never carries klines.
    const targetConnection = this.connectionList.find(
      (connection) =>
        connection.topicList.length < limit &&
        (!this.separateByTopicType || connection.topicType === topicType),
    );

    if (!targetConnection) {
      this.createConnection([topic], this.separateByTopicType ? topicType : undefined);

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

      if (topic.startsWith('orderbook.')) {
        const partList = topic.split('.');

        if (partList.length >= 3) {
          const depth = partList[1];
          const symbol = partList.slice(2).join('.');
          result.push(`Orderbook ${symbol} depth=${depth}`);
        }

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

  private resolveBybitMessage(rawData: RawData): BybitWebSocketMessage {
    if (!this.lazyOrderbookParse) {
      return parseWebSocketMessage<BybitWebSocketMessage>(rawData);
    }

    const text = rawData.toString();
    const head = text.length > FRAME_HEAD_SCAN_LENGTH ? text.slice(0, FRAME_HEAD_SCAN_LENGTH) : text;
    const match = ORDERBOOK_TOPIC_HEAD_REGEX.exec(head);

    if (match === null) {
      return this.parseTextMessage(text);
    }

    return {
      topic: match[1],
      __rawOrderbook: {
        symbol: match[2],
        raw: text,
        receivedTimestamp: Date.now(),
      },
    };
  }

  private parseTextMessage(text: string): BybitWebSocketMessage {
    try {
      return JSON.parse(text) as BybitWebSocketMessage;
    } catch {
      throw new Error(`Failed to parse WebSocket message: ${text.slice(0, 200)}`);
    }
  }

  setOrderbookLiveSymbol(symbol: string, isLive: boolean): void {
    if (isLive) {
      this.liveOrderbookSymbolSet.add(symbol);
    } else {
      this.liveOrderbookSymbolSet.delete(symbol);
    }
  }

  subscribeRawOrderbook(handler: RawOrderbookHandler): void {
    this.rawOrderbookHandlerSet.add(handler);
  }

  unsubscribeRawOrderbook(handler: RawOrderbookHandler): void {
    this.rawOrderbookHandlerSet.delete(handler);
  }

  private dispatchRawOrderbook(frame: RawOrderbookFrame): void {
    for (const handler of this.rawOrderbookHandlerSet) {
      handler(frame);
    }

    if (!this.liveOrderbookSymbolSet.has(frame.symbol)) {
      return;
    }

    const message = this.parseTextMessage(frame.raw);

    if (message.topic !== undefined && message.data !== undefined && !Array.isArray(message.data)) {
      this.handleOrderBookMessage(message.topic, message);
    }
  }

  private handleMessage(message: BybitWebSocketMessage, connectionIndex?: number): void {
    if (connectionIndex !== undefined) {
      const connection = this.connectionList[connectionIndex];

      if (connection) {
        connection.lastMessageTimestamp = Date.now();
        connection.messageCount += 1;
      }
    }

    if (message.__rawOrderbook !== undefined) {
      this.dispatchRawOrderbook(message.__rawOrderbook);

      return;
    }

    if (message.op === 'subscribe' || message.op === 'unsubscribe') {
      if (!message.success) {
        const retMsg = message.ret_msg ?? '';
        // "already subscribed" is benign idempotency noise — Bybit keeps the topic
        // server-side across an abnormal (1006) close, so resubscribe on reconnect
        // re-asks for topics that are still registered. Log it quietly (single line)
        // to avoid drowning real subscription failures in tens of thousands of lines.
        if (retMsg.includes('already subscribed')) {
          this.logger.debug(`BybitPublicStream: ${message.op} skipped (${retMsg})`);
        } else {
          this.logger.error(`BybitPublicStream: ${message.op} error (${retMsg}, reqId=${String(message.req_id ?? '')})`);
        }
      }

      return;
    }

    if (!message.topic) {
      return;
    }

    const topic = message.topic;

    try {
      if (topic.startsWith('orderbook.')) {
        if (message.data !== undefined && !Array.isArray(message.data)) {
          this.handleOrderBookMessage(topic, message);
        }

        return;
      }

      // Bybit V5 has no aggregate ticker topic — per-symbol tickers.{symbol} deliver
      // `data` as a single object (not an array), so this must run before the array
      // guard below and coerce the object into a one-element list.
      if (topic.startsWith('tickers.')) {
        if (message.data === undefined) {
          return;
        }

        const rawTickerList = (
          Array.isArray(message.data) ? message.data : [message.data]
        ) as BybitTickerRaw[];

        if (this.markPriceHandlerSet.size > 0) {
          const markPriceList = this.extractMarkPriceUpdates(rawTickerList, message.ts);

          if (markPriceList.length > 0) {
            for (const handler of this.markPriceHandlerSet) {
              handler(markPriceList);
            }
          }
        }

        if (this.tickerHandlerSet.size > 0) {
          const tickerBySymbol = normalizeBybitTickers(rawTickerList);

          for (const handler of this.tickerHandlerSet) {
            handler(tickerBySymbol);
          }
        }

        return;
      }

      if (!Array.isArray(message.data)) {
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
    if (dataList.length === 0) {
      return;
    }

    const symbol = dataList[0].s;
    const customHandlerSet = this.publicTradeHandlerBySymbol.get(symbol);

    if (customHandlerSet !== undefined && customHandlerSet.size > 0) {
      const tradeList = normalizeBybitPublicTradeFromStream(dataList);

      for (const handler of customHandlerSet) {
        handler(symbol, tradeList);
      }
    }

    if (this.tradeAggregator !== null) {
      for (const tradeData of dataList) {
        this.tradeAggregator.processTrade(tradeData);
      }
    }
  }

  private handleOrderBookMessage(topic: string, message: BybitWebSocketMessage): void {
    const handlerSet = this.orderBookHandlerByTopic.get(topic);

    if (handlerSet === undefined || handlerSet.size === 0) {
      return;
    }

    const dataRaw = message.data as BybitOrderBookRaw;
    const rawType = typeof message.type === 'string' ? message.type : 'delta';
    const updateType: OrderBookUpdateType = rawType === 'snapshot' ? 'snapshot' : 'delta';
    const symbol = dataRaw.s ?? this.extractSymbolFromOrderbookTopic(topic);

    if (symbol === '') {
      return;
    }

    const receivedTimestamp = Date.now();
    const update = normalizeBybitOrderBookUpdate(
      dataRaw,
      symbol,
      updateType,
      receivedTimestamp,
      message.ts,
    );

    for (const handler of handlerSet) {
      handler(symbol, update);
    }
  }

  private extractSymbolFromOrderbookTopic(topic: string): string {
    const partList = topic.split('.');

    if (partList.length < 3) {
      return '';
    }

    return partList.slice(2).join('.');
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

  private sendUnsubscribeInBatches(topicList: string[], send: (data: unknown) => void, label: string): void {
    for (let i = 0; i < topicList.length; i += MAX_TOPICS_PER_SUBSCRIBE) {
      const batch = topicList.slice(i, i + MAX_TOPICS_PER_SUBSCRIBE);
      send({ op: 'unsubscribe', args: batch });
    }

    this.logger.info(`BybitPublicStream: unsubscribed ${topicList.length} topics for ${label}`);
  }

  private extractMarkPriceUpdates(
    rawList: BybitTickerRaw[],
    messageTs: number | undefined,
  ): MarkPriceUpdate[] {
    const result: MarkPriceUpdate[] = [];

    for (const raw of rawList) {
      // Remember the index FIRST — even index-only deltas (no markPrice) must update it.
      if (raw.indexPrice !== undefined) {
        const parsedIndexPrice = parseFloat(raw.indexPrice);

        if (Number.isFinite(parsedIndexPrice) && parsedIndexPrice > 0) {
          this.lastIndexPriceBySymbol.set(raw.symbol, parsedIndexPrice);
        }
      }

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
        indexPrice: this.lastIndexPriceBySymbol.get(raw.symbol),
        timestamp: raw.time ?? messageTs ?? Date.now(),
      });
    }

    return result;
  }
}

export { BybitPublicStream };
