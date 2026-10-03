import { ReliableWebSocket, WebSocketStatus } from '@solncebro/websocket-engine';
import type { RawData, WebSocketCloseContext } from '@solncebro/websocket-engine';

import type { ExchangeLogger, KlineInterval, MarkPriceHandler, MarkPriceUpdate, OrderBookHandler, OrderBookUpdateType, PublicTradeHandler, RawOrderbookFrame, RawOrderbookHandler, TickerBySymbol, WebSocketConnectionInfo } from '../types/common';
import type { KlineHandler, ResubscribeKlinesArgs } from '../types/exchange';
import type { PublicStreamLike } from '../types/stream';
import {
  normalizeOkxKlineWebSocketMessage,
  normalizeOkxMarkPriceWebSocketList,
  normalizeOkxOrderBookUpdate,
  normalizeOkxPublicTradeList,
  normalizeOkxTickers,
  toOkxIndexInstId,
} from '../normalizers/okxNormalizer';
import type { OkxIndexTickerRaw, OkxMarkPriceRaw, OkxOrderBookWebSocketDataRaw, OkxPublicTradeRaw, OkxTickerRaw } from '../normalizers/okxNormalizer';
import type { OkxSymbolMap } from '../exchanges/okxSymbol';
import { ExchangeError } from '../errors/ExchangeError';
import {
  OKX_CONNECTION_CREATE_ATTEMPT_LIMIT,
  OKX_CONNECTION_OPERATION_LIMIT_PER_HOUR,
  OKX_CONNECTION_OPERATION_WARN_RATIO,
  OKX_CONNECTION_OPERATION_WINDOW_MS,
  OKX_KLINE_INTERVAL,
  OKX_KLINE_INTERVAL_MS,
  OKX_KLINE_INTERVAL_REVERSE,
  OKX_MAX_ORDERBOOK_TOPICS_PER_CONNECTION,
  OKX_MAX_TOPICS_PER_CONNECTION,
  OKX_MAX_TOPICS_PER_SUBSCRIBE,
  OKX_ORDERBOOK_GAP_RECREATE_THRESHOLD,
  OKX_ORDERBOOK_RESYNC_MIN_INTERVAL_MS,
  OKX_ORDER_BOOK_MAX_DEPTH,
  OKX_PAUSE_BETWEEN_CONNECTIONS_MS,
  OKX_SERVICE_UPGRADE_NOTICE_CODE,
  OKX_SILENT_THRESHOLD_MS,
} from '../constants/okx';
import { sleep } from '../utils/sleep';
import { buildPublicConnectionCloseLine, buildPublicConnectionInfo } from './publicConnectionDiagnostics';
import { OKX_WS_CASCADE_RECREATE_TOPIC_COUNT, WS_FRAME_HEAD_SCAN_LENGTH, WS_RECREATE_DEDUP_WINDOW_MS } from './streamCommandRateLimit';
import {
  OKX_HEARTBEAT_CONFIG,
  OKX_WEBSOCKET_CONFIGURATION,
  buildOkxTopicKey,
  isOkxPongMessage,
  parseOkxTopicKey,
  parseOkxWebSocketMessage,
} from './okxWebSocketUtils';
import type { OkxWebSocketMessage } from './okxWebSocketUtils.types';
import { OkxConnectionOperationBudget } from './OkxConnectionOperationBudget';
import { OkxSilenceWatchdog } from './OkxSilenceWatchdog';
import type {
  OkxConnection,
  OkxConnectionPoolType,
  OkxOrderbookResyncTrigger,
  OkxPublicStreamArgs,
  OkxTopicBatchSendArgs,
  OkxTopicMutationKind,
} from './OkxPublicStream.types';

const DEEP_ORDERBOOK_CHANNEL = 'books';

/**
 * Индексная цена живёт СВОИМ каналом («Index tickers channel», вход `/ws/v5/public`), и обозначение
 * в нём — сам ИНДЕКС, а не контракт: «instId … Index with USD, USDT, BTC, USDC as the quote
 * currency, e.g. BTC-USDT. Same as uly», то есть `BTC-USDT-SWAP` без хвоста `-SWAP`. Канал
 * `mark-price` индекса не несёт вовсе, поэтому подписываются оба и сшиваются по инструменту.
 */
const INDEX_TICKER_CHANNEL = 'index-tickers';
const MARK_PRICE_CHANNEL = 'mark-price';

const OKX_ORDERBOOK_CHANNEL_HEAD_REGEX = /"channel"\s*:\s*"(books|books5|bbo-tbt)"/;
const OKX_INSTID_HEAD_REGEX = /"instId"\s*:\s*"([^"]+)"/;
const OKX_EVENT_HEAD_REGEX = /"event"\s*:/;
const OKX_DATA_HEAD_REGEX = /"data"\s*:/;

function depthToOrderbookChannel(depth: number): string {
  if (depth <= 1) {
    return 'bbo-tbt';
  }

  if (depth <= 5) {
    return 'books5';
  }

  return DEEP_ORDERBOOK_CHANNEL;
}

function orderbookChannelDepthLabel(channel: string): number {
  if (channel === 'bbo-tbt') {
    return 1;
  }

  if (channel === 'books5') {
    return 5;
  }

  return OKX_ORDER_BOOK_MAX_DEPTH;
}

function resolveUnifiedOkxInterval(okxInterval: string): KlineInterval | undefined {
  return OKX_KLINE_INTERVAL_REVERSE[okxInterval] as KlineInterval | undefined;
}

class OkxPublicStream implements PublicStreamLike {
  private readonly connectionList: OkxConnection[] = [];
  private readonly resolveReadyById: Map<number, () => void> = new Map();
  private readonly readyPromiseByConnectionId: Map<number, Promise<void>> = new Map();
  private readonly pendingTopicListByPool: Map<OkxConnectionPoolType, string[]> = new Map();
  private readonly connectionCreationScheduledByPool: Set<OkxConnectionPoolType> = new Set();
  private readonly batchFlushScheduledConnectionIdSet: Set<number> = new Set();
  private readonly connectionCreateFailureCountByPool: Map<OkxConnectionPoolType, number> = new Map();
  private readonly rebuildScheduledConnectionIdSet: Set<number> = new Set();
  private readonly publicUrl: string;
  private readonly businessUrl: string;
  private readonly logger: ExchangeLogger;
  private readonly label: string;
  private readonly onNotify?: (message: string) => void | Promise<void>;
  private readonly isSwap: boolean;
  private readonly symbolMap: OkxSymbolMap;
  private readonly contractValueBySymbol: Map<string, string>;
  private readonly maxTopicsPerConnection: number;
  private readonly pauseBetweenConnectionsMs: number;
  private readonly lazyOrderbookParse: boolean;

  private readonly tickerHandlerSet: Set<(tickers: TickerBySymbol) => void> = new Set();
  private readonly markPriceHandlerSet: Set<MarkPriceHandler> = new Set();
  private readonly klineHandlerByKey: Map<string, Set<KlineHandler>> = new Map();
  private readonly orderBookHandlerByTopic: Map<string, Set<OrderBookHandler>> = new Map();
  private readonly publicTradeHandlerBySymbol: Map<string, Set<PublicTradeHandler>> = new Map();
  private readonly activeSubscriptionSet: Set<string> = new Set();
  private readonly tickerSubscribedSymbolSet: Set<string> = new Set();
  private readonly markPriceSubscribedSymbolSet: Set<string> = new Set();
  private readonly indexSubscribedSymbolSet: Set<string> = new Set();
  private readonly markPriceSymbolByIndexInstId: Map<string, string> = new Map();
  private readonly lastIndexPriceBySymbol: Map<string, number> = new Map();
  private readonly lastSeqIdByTopic: Map<string, number> = new Map();
  private readonly gapCountByTopic: Map<string, number> = new Map();
  private readonly lastResyncTimestampByTopic: Map<string, number> = new Map();
  private readonly lastGapTimestampByTopic: Map<string, number> = new Map();
  private readonly awaitingSnapshotTopicSet: Set<string> = new Set();
  private readonly liveOrderbookSymbolSet: Set<string> = new Set();
  private readonly rawOrderbookHandlerSet: Set<RawOrderbookHandler> = new Set();

  private hasCreatedAnyConnection = false;
  private isClosed = false;
  private nextConnectionId = 1;
  private connectionCreationChain: Promise<void> = Promise.resolve();

  constructor(args: OkxPublicStreamArgs) {
    this.publicUrl = args.publicUrl;
    this.businessUrl = args.businessUrl;
    this.logger = args.logger;
    this.onNotify = args.onNotify;
    this.label = args.label;
    this.isSwap = args.isSwap;
    this.symbolMap = args.symbolMap;
    this.contractValueBySymbol = args.contractValueBySymbol;
    this.lazyOrderbookParse = args.lazyOrderbookParse === true;
    this.maxTopicsPerConnection = args.connectionPacking?.maxTopicsPerConnection ?? OKX_MAX_TOPICS_PER_CONNECTION;
    this.pauseBetweenConnectionsMs = args.pauseBetweenConnectionsMs ?? OKX_PAUSE_BETWEEN_CONNECTIONS_MS;
  }

  subscribeAllTickers(handler: (tickers: TickerBySymbol) => void, symbolList: string[]): void {
    if (this.rejectIfClosed('subscribeAllTickers')) {
      return;
    }

    this.tickerHandlerSet.add(handler);
    this.subscribeTickerSymbols(symbolList);
  }

  unsubscribeAllTickers(handler: (tickers: TickerBySymbol) => void): void {
    this.tickerHandlerSet.delete(handler);
    this.releaseTickerSymbolsIfUnused();
  }

  subscribeMarkPrices(handler: MarkPriceHandler, symbolList: string[]): void {
    if (this.rejectIfClosed('subscribeMarkPrices')) {
      return;
    }

    if (!this.isSwap) {
      this.logger.warn('OkxPublicStream: OKX spot has no mark-price channel');

      return;
    }

    this.markPriceHandlerSet.add(handler);
    this.subscribeMarkPriceSymbols(symbolList);
  }

  unsubscribeMarkPrices(handler: MarkPriceHandler): void {
    this.markPriceHandlerSet.delete(handler);
    this.releaseMarkPriceSymbolsIfUnused();
  }

  private subscribeTickerSymbols(symbolList: string[]): void {
    for (const symbol of symbolList) {
      if (this.tickerSubscribedSymbolSet.has(symbol)) {
        continue;
      }

      this.tickerSubscribedSymbolSet.add(symbol);
      this.subscribeTopicForSymbol('tickers', symbol);
    }
  }

  private releaseTickerSymbolsIfUnused(): void {
    if (this.tickerHandlerSet.size > 0) {
      return;
    }

    for (const symbol of this.tickerSubscribedSymbolSet) {
      this.unsubscribeTopicForSymbol('tickers', symbol);
    }

    this.tickerSubscribedSymbolSet.clear();
  }

  /**
   * Признак «уже подписан» у каждого из двух каналов СВОЙ: цена маркировки и индекс живут разными
   * каналами, и биржа вольна отвергнуть один, приняв другой. Пока признак был общий, отказ по любому
   * из них закрывал символ целиком — повторная подписка видела символ в наборе и не отправляла
   * ничего ни по одному каналу.
   */
  private subscribeMarkPriceSymbols(symbolList: string[]): void {
    for (const symbol of symbolList) {
      if (!this.markPriceSubscribedSymbolSet.has(symbol)) {
        this.markPriceSubscribedSymbolSet.add(symbol);
        this.subscribeTopicForSymbol(MARK_PRICE_CHANNEL, symbol);
      }

      if (!this.indexSubscribedSymbolSet.has(symbol)) {
        this.indexSubscribedSymbolSet.add(symbol);
        this.subscribeIndexTopicForSymbol(symbol);
      }
    }
  }

  private releaseMarkPriceSymbolsIfUnused(): void {
    if (this.markPriceHandlerSet.size > 0) {
      return;
    }

    for (const symbol of this.markPriceSubscribedSymbolSet) {
      this.unsubscribeTopicForSymbol(MARK_PRICE_CHANNEL, symbol);
    }

    for (const symbol of this.indexSubscribedSymbolSet) {
      this.unsubscribeIndexTopicForSymbol(symbol);
    }

    this.markPriceSubscribedSymbolSet.clear();
    this.indexSubscribedSymbolSet.clear();
  }

  private resolveIndexInstId(symbol: string): string {
    return toOkxIndexInstId(this.symbolMap.resolveInstId(symbol));
  }

  private buildIndexTopicKey(symbol: string): string {
    return buildOkxTopicKey(INDEX_TICKER_CHANNEL, this.resolveIndexInstId(symbol));
  }

  private subscribeIndexTopicForSymbol(symbol: string): void {
    const indexInstId = this.resolveIndexInstId(symbol);
    this.markPriceSymbolByIndexInstId.set(indexInstId, symbol);

    const topicKey = buildOkxTopicKey(INDEX_TICKER_CHANNEL, indexInstId);
    this.activeSubscriptionSet.add(topicKey);
    this.addTopicToConnection(topicKey);
  }

  private unsubscribeIndexTopicForSymbol(symbol: string): void {
    const indexInstId = this.resolveIndexInstId(symbol);
    const topicKey = buildOkxTopicKey(INDEX_TICKER_CHANNEL, indexInstId);

    this.activeSubscriptionSet.delete(topicKey);
    this.markPriceSymbolByIndexInstId.delete(indexInstId);
    this.lastIndexPriceBySymbol.delete(symbol);
    this.removeTopicFromConnection(topicKey);
  }

  subscribeKlines(symbol: string, interval: KlineInterval, handler: KlineHandler): void {
    if (this.rejectIfClosed('subscribeKlines')) {
      return;
    }

    const okxInterval = OKX_KLINE_INTERVAL[interval];

    if (okxInterval === undefined) {
      throw new Error(`Kline interval '${interval}' is not supported by OKX`);
    }

    const key = `${symbol}_${interval}`;
    const handlerSet = this.klineHandlerByKey.get(key) ?? new Set<KlineHandler>();
    handlerSet.add(handler);
    this.klineHandlerByKey.set(key, handlerSet);

    this.subscribeTopicForSymbol(`candle${okxInterval}`, symbol);
  }

  unsubscribeKlines(symbol: string, interval: KlineInterval, handler: KlineHandler): void {
    const key = `${symbol}_${interval}`;
    const handlerSet = this.klineHandlerByKey.get(key);

    if (handlerSet === undefined) {
      return;
    }

    handlerSet.delete(handler);

    if (handlerSet.size === 0) {
      this.klineHandlerByKey.delete(key);

      const okxInterval = OKX_KLINE_INTERVAL[interval];

      if (okxInterval !== undefined) {
        this.unsubscribeTopicForSymbol(`candle${okxInterval}`, symbol);
      }
    }
  }

  subscribeOrderbook(symbol: string, depth: number, handler: OrderBookHandler): void {
    if (this.rejectIfClosed('subscribeOrderbook')) {
      return;
    }

    // Глубина бессрочного контракта приходит в контрактах — без множителя инструмента она ушла бы
    // наружу под видом монет и разошлась бы с истиной во столько раз, сколько монет в контракте.
    this.assertOkxContractValueKnown(symbol);

    const channel = depthToOrderbookChannel(depth);

    if (channel === 'books' && depth !== OKX_ORDER_BOOK_MAX_DEPTH) {
      this.logger.warn(`OkxPublicStream: OKX 'books' channel always delivers ${OKX_ORDER_BOOK_MAX_DEPTH} levels, requested depth=${depth} is ignored`);
    }

    const topicKey = this.buildTopicKeyForSymbol(channel, symbol);
    const handlerSet = this.orderBookHandlerByTopic.get(topicKey) ?? new Set<OrderBookHandler>();
    handlerSet.add(handler);
    this.orderBookHandlerByTopic.set(topicKey, handlerSet);

    this.subscribeTopicForSymbol(channel, symbol);
  }

  unsubscribeOrderbook(symbol: string, depth: number, handler: OrderBookHandler): void {
    const channel = depthToOrderbookChannel(depth);
    const topicKey = this.buildTopicKeyForSymbol(channel, symbol);
    const handlerSet = this.orderBookHandlerByTopic.get(topicKey);

    if (handlerSet === undefined) {
      return;
    }

    handlerSet.delete(handler);

    if (handlerSet.size > 0) {
      return;
    }

    this.orderBookHandlerByTopic.delete(topicKey);
    this.activeSubscriptionSet.delete(topicKey);
    this.forgetOrderbookSequenceState(topicKey);

    this.removeTopicFromConnection(topicKey);
  }

  subscribePublicTrades(symbol: string, handler: PublicTradeHandler): void {
    if (this.rejectIfClosed('subscribePublicTrades')) {
      return;
    }

    this.assertOkxContractValueKnown(symbol);

    const handlerSet = this.publicTradeHandlerBySymbol.get(symbol) ?? new Set<PublicTradeHandler>();
    handlerSet.add(handler);
    this.publicTradeHandlerBySymbol.set(symbol, handlerSet);

    this.subscribeTopicForSymbol('trades', symbol);
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
    this.unsubscribeTopicForSymbol('trades', symbol);
  }

  resubscribeStream(symbol: string, interval: string): void {
    const okxInterval = OKX_KLINE_INTERVAL[interval];

    if (okxInterval === undefined) {
      return;
    }

    this.resubscribeTopic(this.buildTopicKeyForSymbol(`candle${okxInterval}`, symbol));
  }

  resubscribeStreamList(subscriptionList: ResubscribeKlinesArgs[]): void {
    const topicKeyList: string[] = [];

    for (const subscription of subscriptionList) {
      const okxInterval = OKX_KLINE_INTERVAL[subscription.interval];

      if (okxInterval === undefined) {
        continue;
      }

      topicKeyList.push(this.buildTopicKeyForSymbol(`candle${okxInterval}`, subscription.symbol));
    }

    if (topicKeyList.length === 0) {
      return;
    }

    this.resubscribeTopicList(topicKeyList);
  }

  resubscribeOrderbook(symbol: string, depth: number): void {
    this.resubscribeTopic(this.buildTopicKeyForSymbol(depthToOrderbookChannel(depth), symbol));
  }

  resubscribePublicTrades(symbol: string): void {
    this.resubscribeTopic(this.buildTopicKeyForSymbol('trades', symbol));
  }

  resubscribeMarkPrices(): void {
    const topicKeyList: string[] = [];

    for (const symbol of this.markPriceSubscribedSymbolSet) {
      topicKeyList.push(this.buildTopicKeyForSymbol(MARK_PRICE_CHANNEL, symbol));
    }

    for (const symbol of this.indexSubscribedSymbolSet) {
      topicKeyList.push(this.buildIndexTopicKey(symbol));
    }

    if (topicKeyList.length === 0) {
      return;
    }

    this.resubscribeTopicList(topicKeyList);
  }

  setOrderbookLiveSymbol(symbol: string, isLive: boolean): void {
    if (this.rejectIfClosed('setOrderbookLiveSymbol')) {
      return;
    }

    if (isLive) {
      this.liveOrderbookSymbolSet.add(symbol);
    } else {
      this.liveOrderbookSymbolSet.delete(symbol);
    }
  }

  subscribeRawOrderbook(handler: RawOrderbookHandler): void {
    if (this.rejectIfClosed('subscribeRawOrderbook')) {
      return;
    }

    this.rawOrderbookHandlerSet.add(handler);
  }

  unsubscribeRawOrderbook(handler: RawOrderbookHandler): void {
    this.rawOrderbookHandlerSet.delete(handler);
  }

  private assertOkxContractValueKnown(symbol: string): void {
    if (!this.isSwap || this.contractValueBySymbol.get(symbol) !== undefined) {
      return;
    }

    throw new ExchangeError(
      `OKX contract value for ${symbol} is unknown — call loadTradeSymbols() first`,
      'OKX_INSTRUMENTS_NOT_LOADED',
      'OKX',
    );
  }

  private rejectIfClosed(methodName: string): boolean {
    if (!this.isClosed) {
      return false;
    }

    this.logger.warn(`OkxPublicStream: ${methodName} called after close(), ignored`);

    return true;
  }

  private buildTopicKeyForSymbol(channel: string, symbol: string): string {
    return buildOkxTopicKey(channel, this.symbolMap.resolveInstId(symbol));
  }

  private subscribeTopicForSymbol(channel: string, symbol: string): void {
    const topicKey = this.buildTopicKeyForSymbol(channel, symbol);
    this.activeSubscriptionSet.add(topicKey);
    this.addTopicToConnection(topicKey);
  }

  private unsubscribeTopicForSymbol(channel: string, symbol: string): void {
    const topicKey = this.buildTopicKeyForSymbol(channel, symbol);
    this.activeSubscriptionSet.delete(topicKey);

    this.removeTopicFromConnection(topicKey);
  }

  private resubscribeTopic(topicKey: string): void {
    this.resubscribeTopicList([topicKey]);
  }

  private resubscribeTopicList(topicKeyList: string[]): void {
    const topicSet = new Set(topicKeyList);
    let matchedAny = false;

    for (const connection of this.connectionList) {
      const connectionTopicList = connection.topicList.filter((topic) => topicSet.has(topic));

      if (connectionTopicList.length === 0) {
        continue;
      }

      matchedAny = true;

      if (connection.webSocket.getStatus() !== WebSocketStatus.CONNECTED) {
        this.recreateConnection(connection.id, `manual resubscribe of ${connectionTopicList.length} topic(s) (ws disconnected)`);

        continue;
      }

      if (connectionTopicList.length >= OKX_WS_CASCADE_RECREATE_TOPIC_COUNT) {
        this.logger.warn(
          `OkxPublicStream: cascade resubscribe of ${connectionTopicList.length} topic(s) on ${connection.label} — recreating connection instead of per-topic repair`,
        );
        this.recreateConnection(connection.id, `cascade resubscribe of ${connectionTopicList.length} topic(s)`);

        continue;
      }

      try {
        if (!this.sendLightResubscribe(connection, connectionTopicList)) {
          this.recreateConnection(connection.id, 'manual resubscribe (light send refused)');

          continue;
        }

        this.logger.info(`OkxPublicStream: light resubscribe ${connectionTopicList.length} topic(s) on ${connection.label}`);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.logger.warn(`OkxPublicStream: light resubscribe failed for ${connectionTopicList.length} topic(s) on ${connection.label}, falling back to recreate (${errorMessage})`);
        this.recreateConnection(connection.id, 'manual resubscribe (light failed)');
      }
    }

    if (!matchedAny) {
      this.restoreLostTopicList(topicKeyList);
    }
  }

  /**
   * Тема, которой нет ни в одном соединении, — это не повод для одной строки в журнале: внешний
   * сторож подписок зовёт переподписку именно тогда, когда данных нет, получает предупреждение и
   * считает работу сделанной. Пока подписка числится нужной (`activeSubscriptionSet`), её место —
   * в соединении; если тема уже стоит в очереди пула, `addTopicToConnection` ничего не сделает.
   */
  private restoreLostTopicList(topicKeyList: string[]): void {
    const lostTopicList = topicKeyList.filter((topicKey) => this.activeSubscriptionSet.has(topicKey));

    if (lostTopicList.length === 0) {
      this.logger.warn(`OkxPublicStream: resubscribe — no matching topic found in any connection (${topicKeyList.length} requested)`);

      return;
    }

    this.logger.warn(`OkxPublicStream: resubscribe — ${lostTopicList.length} topic(s) of ${topicKeyList.length} are subscribed but live in no connection, putting them back`);

    for (const topicKey of lostTopicList) {
      this.addTopicToConnection(topicKey);
    }
  }

  getConnectionInfoList(): WebSocketConnectionInfo[] {
    return this.connectionList.map((connection) => ({
      ...buildPublicConnectionInfo(connection, this.buildSubscriptionList(connection)),
      pendingCommandCount: connection.pendingSubscribeTopicList.length + connection.pendingUnsubscribeTopicList.length,
    }));
  }

  private buildSubscriptionList(connection: OkxConnection): string[] {
    const subscriptionList: string[] = [];

    for (const topicKey of connection.topicList) {
      const { channel, instId } = parseOkxTopicKey(topicKey);
      const symbol = this.resolveSymbolForDisplay(instId ?? '');

      if (channel === 'tickers') {
        subscriptionList.push(`Tickers ${symbol}`);

        continue;
      }

      if (channel === MARK_PRICE_CHANNEL) {
        subscriptionList.push(`MarkPrices ${symbol}`);

        continue;
      }

      if (channel === INDEX_TICKER_CHANNEL) {
        subscriptionList.push(`IndexPrices ${this.markPriceSymbolByIndexInstId.get(instId ?? '') ?? symbol}`);

        continue;
      }

      if (channel === 'trades') {
        subscriptionList.push(`Trades ${symbol}`);

        continue;
      }

      if (channel.startsWith('candle')) {
        const interval = resolveUnifiedOkxInterval(channel.slice('candle'.length));
        subscriptionList.push(interval === undefined ? `Klines ${symbol} ${channel}` : `Klines ${symbol} ${interval}`);

        continue;
      }

      if (channel === 'books' || channel === 'books5' || channel === 'bbo-tbt') {
        subscriptionList.push(`Orderbook ${symbol} depth=${orderbookChannelDepthLabel(channel)}`);
      }
    }

    return subscriptionList;
  }

  private resolveSymbolForDisplay(instId: string): string {
    try {
      return this.symbolMap.resolveSymbol(instId);
    } catch {
      return instId;
    }
  }

  private findConnectionById(connectionId: number): OkxConnection | undefined {
    return this.connectionList.find((connection) => connection.id === connectionId);
  }

  private handleConnectionClose(connectionId: number, closeContext: WebSocketCloseContext): void {
    const closingConnection = this.findConnectionById(connectionId);
    const closingLabel = closingConnection !== undefined ? closingConnection.label : `${this.label} #${connectionId}`;

    closingConnection?.silenceWatchdog.stop();

    this.logger.warn(buildPublicConnectionCloseLine({
      closingLabel,
      closeContext,
      connectionList: this.connectionList,
    }));
  }

  close(): void {
    this.isClosed = true;
    this.pendingTopicListByPool.clear();
    this.connectionCreationScheduledByPool.clear();
    this.batchFlushScheduledConnectionIdSet.clear();
    this.connectionCreateFailureCountByPool.clear();
    this.rebuildScheduledConnectionIdSet.clear();
    this.connectionCreationChain = Promise.resolve();

    for (const connection of this.connectionList) {
      connection.silenceWatchdog.stop();
      connection.webSocket.close();
    }

    for (const connectionId of Array.from(this.resolveReadyById.keys())) {
      this.settleReadyPromise(connectionId);
    }

    this.connectionList.length = 0;
    this.resolveReadyById.clear();
    this.readyPromiseByConnectionId.clear();
    this.activeSubscriptionSet.clear();
    this.tickerSubscribedSymbolSet.clear();
    this.markPriceSubscribedSymbolSet.clear();
    this.indexSubscribedSymbolSet.clear();
    this.markPriceSymbolByIndexInstId.clear();
    this.lastIndexPriceBySymbol.clear();
    this.tickerHandlerSet.clear();
    this.markPriceHandlerSet.clear();
    this.klineHandlerByKey.clear();
    this.orderBookHandlerByTopic.clear();
    this.publicTradeHandlerBySymbol.clear();
    this.lastSeqIdByTopic.clear();
    this.gapCountByTopic.clear();
    this.lastResyncTimestampByTopic.clear();
    this.lastGapTimestampByTopic.clear();
    this.awaitingSnapshotTopicSet.clear();
    this.liveOrderbookSymbolSet.clear();
    this.rawOrderbookHandlerSet.clear();
  }

  /**
   * Три набора соединений вместо двух. Свечи живут на деловом входе — это требование биржи.
   * Глубокий стакан выделен отдельно по её же рекомендации («…each of less than 30 channels» для
   * каналов на 50 и 400 уровней) и потому, что чинить его дороже всех: разрыв нумерации сначала
   * переподписывает тему, а потом пересоздаёт соединение — и до этой правки вместе с одним стаканом
   * рвались лежавшие рядом сто тикеров и цен маркировки, которые ни в чём не виноваты. Пятиуровневый
   * `books5` и `bbo-tbt` в рекомендации не названы и остаются с лёгкими темами.
   */
  private classifyPoolType(channel: string): OkxConnectionPoolType {
    if (channel.startsWith('candle')) {
      return 'business';
    }

    return channel === DEEP_ORDERBOOK_CHANNEL ? 'orderbook' : 'public';
  }

  private maxTopicsForPool(poolType: OkxConnectionPoolType): number {
    if (poolType !== 'orderbook') {
      return this.maxTopicsPerConnection;
    }

    return Math.min(this.maxTopicsPerConnection, OKX_MAX_ORDERBOOK_TOPICS_PER_CONNECTION);
  }

  private enqueuePendingTopics(poolType: OkxConnectionPoolType, topicList: string[]): void {
    const pending = this.pendingTopicListByPool.get(poolType) ?? [];
    pending.push(...topicList);
    this.pendingTopicListByPool.set(poolType, pending);

    this.scheduleConnectionCreationForPool(poolType);
  }

  private scheduleConnectionCreationForPool(poolType: OkxConnectionPoolType): void {
    if (this.connectionCreationScheduledByPool.has(poolType)) {
      return;
    }

    this.connectionCreationScheduledByPool.add(poolType);

    this.connectionCreationChain = this.connectionCreationChain
      .then(() => this.processPendingTopicsForPool(poolType))
      .catch((error) => {
        this.connectionCreationScheduledByPool.delete(poolType);
        this.logger.error(`OkxPublicStream: failed to create connection: ${error instanceof Error ? error.message : String(error)}`);
      });
  }

  private async processPendingTopicsForPool(poolType: OkxConnectionPoolType): Promise<void> {
    if (this.isClosed) {
      this.connectionCreationScheduledByPool.delete(poolType);
      this.pendingTopicListByPool.delete(poolType);

      return;
    }

    if (this.hasCreatedAnyConnection && this.pauseBetweenConnectionsMs > 0) {
      await sleep(this.pauseBetweenConnectionsMs);
    }

    this.connectionCreationScheduledByPool.delete(poolType);

    if (this.isClosed) {
      this.pendingTopicListByPool.delete(poolType);

      return;
    }

    const pending = this.pendingTopicListByPool.get(poolType);

    if (pending === undefined || pending.length === 0) {
      return;
    }

    const rawTopicList = pending.splice(0, this.maxTopicsForPool(poolType));
    const topicList = rawTopicList.filter((topic) => this.activeSubscriptionSet.has(topic));

    if (pending.length === 0) {
      this.pendingTopicListByPool.delete(poolType);
    } else {
      this.scheduleConnectionCreationForPool(poolType);
    }

    if (topicList.length === 0) {
      return;
    }

    this.hasCreatedAnyConnection = true;

    try {
      this.createConnection(topicList, poolType);
      this.connectionCreateFailureCountByPool.delete(poolType);
    } catch (error) {
      this.requeuePendingTopics(poolType, topicList, error);
    }
  }

  /**
   * Возврат тем в очередь без пробуждения планировщика был словом без дела: запись пула к этому
   * моменту уже удалена, и о возвращённых темах не узнавал никто — рыночный поток пропадал целиком,
   * а в журнале стояло «requeued». Круг попыток ограничен: стойкий отказ создания обязан кончиться
   * честной записью «темы потеряны», а не бесконечным перебором.
   */
  private requeuePendingTopics(poolType: OkxConnectionPoolType, topicList: string[], error: unknown): void {
    const errorText = error instanceof Error ? error.message : String(error);
    const failureCount = (this.connectionCreateFailureCountByPool.get(poolType) ?? 0) + 1;

    if (failureCount >= OKX_CONNECTION_CREATE_ATTEMPT_LIMIT) {
      this.connectionCreateFailureCountByPool.delete(poolType);
      this.logger.error(
        `OkxPublicStream: pool '${poolType}' failed to create a connection ${failureCount} times — ${topicList.length} topic(s) dropped: ${errorText}`,
      );

      return;
    }

    this.connectionCreateFailureCountByPool.set(poolType, failureCount);

    const pending = this.pendingTopicListByPool.get(poolType) ?? [];
    this.pendingTopicListByPool.set(poolType, [...topicList, ...pending]);

    this.logger.error(
      `OkxPublicStream: failed to create connection for pool '${poolType}' (attempt ${failureCount}/${OKX_CONNECTION_CREATE_ATTEMPT_LIMIT}, ${topicList.length} topic(s) requeued): ${errorText}`,
    );

    this.scheduleConnectionCreationForPool(poolType);
  }

  private createConnection(topicList: string[], poolType: OkxConnectionPoolType): void {
    const connectionId = this.nextConnectionId++;
    const connectionIndex = this.connectionList.length;
    const connectionShortLabel = this.buildConnectionShortLabel(connectionIndex, poolType);
    const connectionLabel = `${this.label} ${connectionShortLabel}`;

    this.registerReadyPromise(connectionId);

    const url = poolType === 'business' ? this.businessUrl : this.publicUrl;

    let webSocket: ReliableWebSocket<OkxWebSocketMessage>;
    let silenceWatchdog: OkxSilenceWatchdog;

    try {
      webSocket = this.buildWebSocket(connectionId, connectionLabel, url);
      silenceWatchdog = this.buildSilenceWatchdog(connectionId);
    } catch (error) {
      this.settleReadyPromise(connectionId);
      this.readyPromiseByConnectionId.delete(connectionId);

      throw error;
    }

    this.connectionList.push({
      id: connectionId,
      webSocket,
      poolType,
      label: connectionLabel,
      shortLabel: connectionShortLabel,
      url,
      topicList,
      pendingSubscribeTopicList: [],
      pendingUnsubscribeTopicList: [],
      readyPromise: this.readyPromiseById(connectionId),
      lastRecreateTimestamp: 0,
      lastMessageTimestamp: 0,
      messageCount: 0,
      reconnectCount: 0,
      silenceWatchdog,
      operationBudget: this.buildOperationBudget(connectionLabel),
    });

    this.logger.info(`OkxPublicStream: created connection ${connectionLabel} (${topicList.length} topic(s))`);
  }

  /**
   * Ожидание готовности соединения обязано ЗАВЕРШИТЬСЯ при любом исходе. Пересоздание регистрирует
   * новое обещание под тем же номером соединения, и прежнее — то самое, которое уже держит
   * `awaitConnectionsReady` — оставалось бы без разрешителя навсегда: потребитель, ждущий запуска,
   * висел бы молча, без исключения и без записи в журнал.
   */
  private settleReadyPromise(connectionId: number): void {
    this.resolveReadyById.get(connectionId)?.();
    this.resolveReadyById.delete(connectionId);
  }

  private registerReadyPromise(connectionId: number): void {
    this.settleReadyPromise(connectionId);

    let resolveReady: () => void = () => undefined;
    const readyPromise = new Promise<void>((resolve) => {
      resolveReady = resolve;
    });
    this.resolveReadyById.set(connectionId, resolveReady);
    this.readyPromiseByConnectionId.set(connectionId, readyPromise);
  }

  private readyPromiseById(connectionId: number): Promise<void> {
    return this.readyPromiseByConnectionId.get(connectionId) ?? Promise.resolve();
  }

  private buildConnectionShortLabel(index: number, poolType: OkxConnectionPoolType): string {
    return `${poolType} #${index + 1}`;
  }

  async awaitConnectionsReady(): Promise<void> {
    let previousChain: Promise<void> | undefined;

    while (previousChain !== this.connectionCreationChain) {
      previousChain = this.connectionCreationChain;
      await previousChain;
    }

    await Promise.all(this.connectionList.map((connection) => connection.readyPromise));
  }

  private buildSilenceWatchdog(connectionId: number): OkxSilenceWatchdog {
    return new OkxSilenceWatchdog({
      silentThresholdMs: OKX_SILENT_THRESHOLD_MS,
      onSilent: () => this.handleConnectionSilent(connectionId),
    });
  }

  private buildOperationBudget(label: string): OkxConnectionOperationBudget {
    return new OkxConnectionOperationBudget({
      label,
      logger: this.logger,
      limitPerWindow: OKX_CONNECTION_OPERATION_LIMIT_PER_HOUR,
      windowMs: OKX_CONNECTION_OPERATION_WINDOW_MS,
      warnRatio: OKX_CONNECTION_OPERATION_WARN_RATIO,
    });
  }

  /**
   * Сокет отвечает на проверку живости, но по подпискам не пришло ни кадра: рвать его не за что —
   * рвут только молчащий сокет. Лечим тем же лёгким способом, что и ручную переподписку: снять и
   * поставить темы заново на живом соединении. Соединение без тем немым не считается — молчать ему
   * положено.
   *
   * Неполная отправка обязана кончиться пересозданием — ровно как в ручной переподписке. Лечение
   * состоит из двух половин, и между ними может кончиться часовой бюджет операций: снимающая
   * команда ушла, ставящая отвергнута, тема снята НА БИРЖЕ, сокет цел, а реестр по-прежнему
   * уверяет, что тема подписана. Следующие окна немоты не чинят — там уже снимающая половина
   * упирается в тот же исчерпанный бюджет, — и данных по теме не будет до часа. У нового сокета
   * бюджет свой, поэтому пересоздание восстанавливает поток.
   */
  private handleConnectionSilent(connectionId: number): void {
    const connection = this.findConnectionById(connectionId);

    if (connection === undefined || connection.topicList.length === 0) {
      return;
    }

    if (connection.webSocket.getStatus() !== WebSocketStatus.CONNECTED) {
      return;
    }

    const topicKeyList = [...connection.topicList];
    this.logger.warn(
      `OkxPublicStream: ${connection.label} answers the liveness check but delivered no data — resubscribing ${topicKeyList.length} topic(s)`,
    );

    try {
      if (!this.sendLightResubscribe(connection, topicKeyList)) {
        this.recreateConnection(connection.id, 'silent resubscribe refused');
      }
    } catch (error) {
      this.logger.warn(`OkxPublicStream: silent-connection resubscribe failed on ${connection.label}: ${error instanceof Error ? error.message : String(error)}`);
      this.recreateConnection(connection.id, 'silent resubscribe failed');
    }
  }

  private sendLightResubscribe(connection: OkxConnection, topicKeyList: string[]): boolean {
    const send = (data: unknown): void => connection.webSocket.sendToConnectedSocket(data);
    const isUnsubscribed = this.sendUnsubscribeInBatches({ connection, topicKeyList, send });

    if (!isUnsubscribed) {
      return false;
    }

    return this.sendSubscribeInBatches({ connection, topicKeyList, send });
  }

  private isCurrentConnectionSocket(connectionId: number, webSocket: ReliableWebSocket<OkxWebSocketMessage> | undefined): boolean {
    const connection = this.findConnectionById(connectionId);

    return webSocket !== undefined && connection !== undefined && connection.webSocket === webSocket;
  }

  private buildWebSocket(connectionId: number, connectionLabel: string, url: string): ReliableWebSocket<OkxWebSocketMessage> {
    let ownWebSocket: ReliableWebSocket<OkxWebSocketMessage> | undefined;

    ownWebSocket = new ReliableWebSocket<OkxWebSocketMessage>({
      label: connectionLabel,
      url,
      logger: this.logger,
      parseMessage: (rawData) => this.resolveMessage(rawData),
      onMessage: (message) => {
        if (!this.isCurrentConnectionSocket(connectionId, ownWebSocket)) {
          return;
        }

        this.handleMessage(message, connectionId);
      },
      onOpen: async (context) => {
        if (!this.isCurrentConnectionSocket(connectionId, ownWebSocket)) {
          return;
        }

        const connection = this.findConnectionById(connectionId);
        let isSubscribeRefused = false;

        if (connection !== undefined && connection.topicList.length > 0) {
          isSubscribeRefused = !this.sendSubscribeInBatches({
            connection,
            topicKeyList: connection.topicList,
            send: (data) => context.send(data),
          });
        }

        connection?.silenceWatchdog.start();
        this.settleReadyPromise(connectionId);

        if (isSubscribeRefused) {
          this.recreateConnection(connectionId, 'open subscribe refused');
        }
      },
      onReconnectSuccess: () => {
        if (!this.isCurrentConnectionSocket(connectionId, ownWebSocket)) {
          return;
        }

        this.handleReconnectSuccess(connectionId);
      },
      onClose: (closeContext) => {
        if (!this.isCurrentConnectionSocket(connectionId, ownWebSocket)) {
          return;
        }

        this.handleConnectionClose(connectionId, closeContext);
      },
      onNotify: this.onNotify,
      heartbeat: OKX_HEARTBEAT_CONFIG,
      configuration: OKX_WEBSOCKET_CONFIGURATION,
    });

    return ownWebSocket;
  }

  /**
   * Новый сокет ставится в ТУ ЖЕ очередь с паузой, что и первичное создание: биржа принимает
   * «3 requests per second (based on IP)», а один вызов переподписки поднимал шесть рукопожатий
   * в одном такте — ровно тогда, когда связь и так плоха, и отказ рукопожатия движок принимал
   * за разрыв. Окно подавления повторов защищает одно соединение, между соединениями защиты не было.
   */
  private recreateConnection(connectionId: number, reason: string): void {
    const connection = this.findConnectionById(connectionId);

    if (connection === undefined) {
      return;
    }

    if (this.rebuildScheduledConnectionIdSet.has(connectionId)) {
      this.logger.info(`OkxPublicStream: skip recreate ${connection.label} (rebuild already queued, reason: ${reason})`);

      return;
    }

    const nowTimestamp = Date.now();
    const recentRecreateAgeMs = nowTimestamp - connection.lastRecreateTimestamp;

    if (connection.lastRecreateTimestamp > 0 && recentRecreateAgeMs < WS_RECREATE_DEDUP_WINDOW_MS) {
      this.logger.info(`OkxPublicStream: skip recreate ${connection.label} (recent recreate ${recentRecreateAgeMs}ms ago, reason: ${reason})`);

      return;
    }

    const topicCount = connection.topicList.length;
    this.logger.warn(`OkxPublicStream: recreating ${connection.label} (reason: ${reason}, topics: ${topicCount})`);

    connection.silenceWatchdog.stop();

    try {
      connection.webSocket.close();
    } catch (error) {
      this.logger.warn(`OkxPublicStream: failed to close ${connection.label}: ${error instanceof Error ? error.message : String(error)}`);
    }

    connection.lastRecreateTimestamp = nowTimestamp;
    this.registerReadyPromise(connectionId);
    this.rebuildScheduledConnectionIdSet.add(connectionId);

    this.connectionCreationChain = this.connectionCreationChain
      .then(() => this.rebuildConnectionSocket(connectionId))
      .catch((error) => {
        this.rebuildScheduledConnectionIdSet.delete(connectionId);
        this.settleReadyPromise(connectionId);
        this.logger.error(`OkxPublicStream: failed to recreate ${connection.label}: ${error instanceof Error ? error.message : String(error)}`);
      });
  }

  private async rebuildConnectionSocket(connectionId: number): Promise<void> {
    if (this.pauseBetweenConnectionsMs > 0) {
      await sleep(this.pauseBetweenConnectionsMs);
    }

    this.rebuildScheduledConnectionIdSet.delete(connectionId);

    const connectionIndex = this.connectionList.findIndex((connection) => connection.id === connectionId);

    if (this.isClosed || connectionIndex === -1) {
      this.settleReadyPromise(connectionId);

      return;
    }

    const connection = this.connectionList[connectionIndex];

    this.connectionList[connectionIndex] = {
      ...connection,
      webSocket: this.buildWebSocket(connectionId, connection.label, connection.url),
      silenceWatchdog: this.buildSilenceWatchdog(connectionId),
      operationBudget: this.buildOperationBudget(connection.label),
      pendingSubscribeTopicList: [],
      pendingUnsubscribeTopicList: [],
      readyPromise: this.readyPromiseById(connectionId),
    };
  }

  private handleReconnectSuccess(connectionId: number): void {
    const connection = this.findConnectionById(connectionId);

    if (!connection) {
      return;
    }

    connection.reconnectCount += 1;

    for (const topic of connection.topicList) {
      this.forgetOrderbookSequenceState(topic);
    }

    this.logger.info(`OkxPublicStream: ${connection.label} reconnected (${connection.topicList.length} topic(s), engine already resubscribed via onOpen)`);
  }

  private addTopicToConnection(topicKey: string): void {
    const { channel } = parseOkxTopicKey(topicKey);
    const poolType = this.classifyPoolType(channel);

    if (this.isTopicKnown(topicKey, poolType)) {
      return;
    }

    const targetConnection = this.connectionList.find(
      (connection) => connection.poolType === poolType && connection.topicList.length < this.maxTopicsForPool(poolType),
    );

    if (targetConnection) {
      targetConnection.topicList.push(topicKey);
      this.enqueueTopicMutation(targetConnection, topicKey, 'subscribe');

      return;
    }

    this.enqueuePendingTopics(poolType, [topicKey]);
  }

  private isTopicKnown(topicKey: string, poolType: OkxConnectionPoolType): boolean {
    if (this.connectionList.some((connection) => connection.topicList.includes(topicKey))) {
      return true;
    }

    return (this.pendingTopicListByPool.get(poolType) ?? []).includes(topicKey);
  }

  private removeTopicFromConnection(topicKey: string): void {
    for (const connection of this.connectionList) {
      const index = connection.topicList.indexOf(topicKey);

      if (index === -1) {
        continue;
      }

      connection.topicList.splice(index, 1);

      if (!this.dropConnectionWithoutTopics(connection)) {
        this.enqueueTopicMutation(connection, topicKey, 'unsubscribe');
      }

      return;
    }
  }

  /**
   * Соединение, оставшееся без единой темы, держать не за что: данных по нему не будет никогда, а
   * сторож живости всё равно слал в него проверки и пересоздавал его каждые 45 секунд — двенадцать
   * рукопожатий за десять минут на каждый такой обломок при пределе биржи «3 подключения в секунду
   * на адрес». Обломки эти появляются сами собой: достаточно подписаться и передумать до того, как
   * сокет открылся. Снимающий запрос закрытому соединению не нужен — разрыв снимает подписки сам, а
   * бюджет в 480 операций в час тратить незачем.
   */
  private dropConnectionWithoutTopics(connection: OkxConnection): boolean {
    if (connection.topicList.length > 0) {
      return false;
    }

    const connectionIndex = this.connectionList.indexOf(connection);

    if (connectionIndex === -1) {
      return false;
    }

    this.connectionList.splice(connectionIndex, 1);
    connection.pendingSubscribeTopicList.length = 0;
    connection.pendingUnsubscribeTopicList.length = 0;
    connection.silenceWatchdog.stop();

    try {
      connection.webSocket.close();
    } catch (error) {
      this.logger.warn(`OkxPublicStream: failed to close empty ${connection.label}: ${error instanceof Error ? error.message : String(error)}`);
    }

    this.batchFlushScheduledConnectionIdSet.delete(connection.id);
    this.rebuildScheduledConnectionIdSet.delete(connection.id);
    this.settleReadyPromise(connection.id);
    this.readyPromiseByConnectionId.delete(connection.id);

    this.logger.info(`OkxPublicStream: closed ${connection.label} — no topics left on it`);

    return true;
  }

  private enqueueTopicMutation(connection: OkxConnection, topicKey: string, kind: OkxTopicMutationKind): void {
    const oppositeList = kind === 'subscribe' ? connection.pendingUnsubscribeTopicList : connection.pendingSubscribeTopicList;
    const oppositeIndex = oppositeList.indexOf(topicKey);

    if (oppositeIndex !== -1) {
      oppositeList.splice(oppositeIndex, 1);

      return;
    }

    const targetList = kind === 'subscribe' ? connection.pendingSubscribeTopicList : connection.pendingUnsubscribeTopicList;
    targetList.push(topicKey);

    this.scheduleBatchFlush(connection.id);
  }

  private scheduleBatchFlush(connectionId: number): void {
    if (this.batchFlushScheduledConnectionIdSet.has(connectionId)) {
      return;
    }

    this.batchFlushScheduledConnectionIdSet.add(connectionId);

    queueMicrotask(() => {
      this.batchFlushScheduledConnectionIdSet.delete(connectionId);
      this.flushPendingTopicMutations(connectionId);
    });
  }

  /**
   * Состояние сокета проверяется ДО того, как очереди вычерпаны: пока соединение не подключено,
   * отложенные изменения тем отправлять некуда, и они снимаются осознанно — реестр тем соединения
   * уже приведён в порядок, а `onOpen` подпишет его целиком. Раньше очереди опустошались первыми, и
   * правильность держалась на этой страховке молча, не будучи выражена в самом коде.
   */
  private flushPendingTopicMutations(connectionId: number): void {
    const connection = this.findConnectionById(connectionId);

    if (connection === undefined) {
      return;
    }

    if (connection.webSocket.getStatus() !== WebSocketStatus.CONNECTED) {
      connection.pendingUnsubscribeTopicList.length = 0;
      connection.pendingSubscribeTopicList.length = 0;
      this.logger.debug(`OkxPublicStream: ${connection.label} is not connected — pending topic changes dropped, onOpen will subscribe the full topic list`);

      return;
    }

    const unsubscribeTopicList = connection.pendingUnsubscribeTopicList.splice(0);
    const subscribeTopicList = connection.pendingSubscribeTopicList.splice(0);
    const send = (data: unknown): void => connection.webSocket.sendToConnectedSocket(data);

    if (unsubscribeTopicList.length > 0) {
      this.sendUnsubscribeInBatches({ connection, topicKeyList: unsubscribeTopicList, send });
    }

    if (subscribeTopicList.length === 0) {
      return;
    }

    if (!this.sendSubscribeInBatches({ connection, topicKeyList: subscribeTopicList, send })) {
      this.recreateConnection(connection.id, 'subscribe send refused');
    }
  }

  private sendSubscribeInBatches(args: OkxTopicBatchSendArgs): boolean {
    const { connection, topicKeyList, send } = args;
    let sentCount = 0;

    for (let i = 0; i < topicKeyList.length; i += OKX_MAX_TOPICS_PER_SUBSCRIBE) {
      const batch = topicKeyList.slice(i, i + OKX_MAX_TOPICS_PER_SUBSCRIBE).map(parseOkxTopicKey);

      if (!connection.operationBudget.registerOperation('subscribe')) {
        return false;
      }

      try {
        send({ op: 'subscribe', args: batch });
        sentCount += batch.length;
      } catch {
        this.logger.warn(`OkxPublicStream: failed to subscribe batch for ${connection.label}, sent ${sentCount}/${topicKeyList.length}`);

        return false;
      }
    }

    this.logger.info(`OkxPublicStream: subscribed ${sentCount} topics for ${connection.label}`);

    return true;
  }

  /**
   * Снимающий запрос защищён так же, как ставящий: единственный второй вызов идёт из микрозадачи,
   * а исключение из микрозадачи в Node — это падение процесса. Тема к этому моменту уже вычеркнута
   * из реестра соединения и считается снятой: соединение либо закрывается, либо пересоздаётся
   * без неё.
   */
  private sendUnsubscribeInBatches(args: OkxTopicBatchSendArgs): boolean {
    const { connection, topicKeyList, send } = args;
    let sentCount = 0;

    for (let i = 0; i < topicKeyList.length; i += OKX_MAX_TOPICS_PER_SUBSCRIBE) {
      const batch = topicKeyList.slice(i, i + OKX_MAX_TOPICS_PER_SUBSCRIBE).map(parseOkxTopicKey);

      if (!connection.operationBudget.registerOperation('unsubscribe')) {
        return false;
      }

      try {
        send({ op: 'unsubscribe', args: batch });
        sentCount += batch.length;
      } catch {
        this.logger.warn(`OkxPublicStream: failed to unsubscribe batch for ${connection.label}, sent ${sentCount}/${topicKeyList.length}`);

        return false;
      }
    }

    this.logger.info(`OkxPublicStream: unsubscribed ${sentCount} topics for ${connection.label}`);

    return true;
  }

  private resolveMessage(rawData: RawData): OkxWebSocketMessage {
    if (!this.lazyOrderbookParse) {
      return parseOkxWebSocketMessage(rawData);
    }

    const text = rawData.toString();
    const head = text.length > WS_FRAME_HEAD_SCAN_LENGTH ? text.slice(0, WS_FRAME_HEAD_SCAN_LENGTH) : text;

    const channelMatch = OKX_ORDERBOOK_CHANNEL_HEAD_REGEX.exec(head);
    const instIdMatch = OKX_INSTID_HEAD_REGEX.exec(head);

    if (channelMatch === null || instIdMatch === null) {
      return parseOkxWebSocketMessage(rawData);
    }

    if (OKX_EVENT_HEAD_REGEX.test(head) || !OKX_DATA_HEAD_REGEX.test(head)) {
      return parseOkxWebSocketMessage(rawData);
    }

    try {
      const symbol = this.symbolMap.resolveSymbol(instIdMatch[1]);

      return {
        __rawOrderbook: {
          symbol,
          raw: text,
          receivedTimestamp: Date.now(),
        },
      };
    } catch {
      return parseOkxWebSocketMessage(rawData);
    }
  }

  private dispatchRawOrderbook(frame: RawOrderbookFrame): void {
    for (const handler of this.rawOrderbookHandlerSet) {
      handler(frame);
    }

    if (!this.liveOrderbookSymbolSet.has(frame.symbol)) {
      return;
    }

    const message = parseOkxWebSocketMessage(frame.raw);

    if (message.arg !== undefined && message.data !== undefined) {
      this.handleOrderBookMessage(buildOkxTopicKey(message.arg.channel, message.arg.instId ?? ''), message);
    }
  }

  /**
   * Содержательным считается только кадр с данными подписки: служебные кадры (подтверждение
   * подписки, уведомление, отказ) доказывают, что сокет отвечает, но не то, что рыночный поток
   * идёт. Живость сокета считает движок по своей отметке — здесь ведётся только отметка данных,
   * и переподписка идёт по ней одной.
   */
  private noteContentMessage(connectionId: number): void {
    const connection = this.findConnectionById(connectionId);

    if (connection === undefined) {
      return;
    }

    connection.lastMessageTimestamp = Date.now();
    connection.messageCount += 1;
    connection.silenceWatchdog.noteContentMessage();
  }

  private handleMessage(message: OkxWebSocketMessage, connectionId: number): void {
    try {
      if (message.__rawOrderbook !== undefined) {
        this.noteContentMessage(connectionId);
        this.dispatchRawOrderbook(message.__rawOrderbook);

        return;
      }

      if (isOkxPongMessage(message)) {
        return;
      }

      if (message.event === 'subscribe' || message.event === 'unsubscribe') {
        this.logger.debug(`OkxPublicStream: ${message.event} (${message.arg?.channel ?? ''}|${message.arg?.instId ?? ''})`);

        return;
      }

      if (message.event === 'error') {
        this.handleSubscriptionError(message, connectionId);

        return;
      }

      if (message.event === 'notice') {
        this.handleServerNotice(message, connectionId);

        return;
      }

      if (message.event !== undefined) {
        this.logger.warn({ frame: message }, 'OkxPublicStream: unhandled service frame');

        return;
      }

      if (message.arg === undefined || message.data === undefined) {
        return;
      }

      this.noteContentMessage(connectionId);

      const { channel } = message.arg;
      const instId = message.arg.instId ?? '';

      if (channel === 'tickers') {
        this.handleTickerMessage(message.data as OkxTickerRaw[]);

        return;
      }

      if (channel === MARK_PRICE_CHANNEL) {
        this.handleMarkPriceMessage(message.data as OkxMarkPriceRaw[]);

        return;
      }

      if (channel === INDEX_TICKER_CHANNEL) {
        this.rememberIndexPriceList(message.data as OkxIndexTickerRaw[]);

        return;
      }

      if (channel.startsWith('candle')) {
        this.handleKlineMessage(channel, instId, message.data as string[][]);

        return;
      }

      if (channel === 'trades') {
        this.handleTradeMessage(instId, message.data as OkxPublicTradeRaw[]);

        return;
      }

      if (channel === 'books' || channel === 'books5' || channel === 'bbo-tbt') {
        this.handleOrderBookMessage(buildOkxTopicKey(channel, instId), message);
      }
    } catch (error) {
      this.logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        'OkxPublicStream: error handling message',
      );
    }
  }

  /**
   * Биржа за минуту предупреждает о плановом разрыве («60 seconds prior to the upgrade of the
   * WebSocket service…», код 64008) и прямо просит переподключиться. Раньше предупреждение просто
   * ложилось в журнал, и мы дожидались жёсткого обрыва: в окне разрыва теряются кадры, а лечение
   * начинается уже задним числом. Теперь соединение переоткрывается заранее — через ту же очередь
   * с паузой, что и любое другое пересоздание, поэтому залпа рукопожатий не будет. Прочие
   * уведомления остаются предупреждением: что с ними делать, биржа не говорит.
   */
  private handleServerNotice(message: OkxWebSocketMessage, connectionId: number): void {
    if (message.code !== OKX_SERVICE_UPGRADE_NOTICE_CODE) {
      this.logger.warn(`OkxPublicStream: server notice (${message.code ?? ''}) ${message.msg ?? ''}`);

      return;
    }

    this.logger.info(`OkxPublicStream: server notice (${message.code}) ${message.msg ?? ''} — reopening the connection ahead of the planned disconnect`);
    this.recreateConnection(connectionId, `service upgrade notice ${OKX_SERVICE_UPGRADE_NOTICE_CODE}`);
  }

  /**
   * Отказ подписки — это не просто строка в журнале: тема, которую биржа не приняла, обязана
   * исчезнуть из реестра соединений. Пока она там оставалась, наблюдатель видел «соединение
   * подключено, тема подписана» и считал поток здоровым, хотя по этой теме не придёт ни кадра.
   * Снимающего запроса на биржу не шлём — снимать нечего, подписки не случилось.
   *
   * Вместе с реестром чистится и признак «символ уже подписан»: у тикеров, mark-цены и индекса
   * решение о повторной подписке принимается по нему, и разовый отказ биржи оставлял символ без
   * потока до конца жизни процесса — повторная подписка отправляла ноль кадров и молчала. Свечи,
   * сделки и стакан решают по реестру тем, поэтому им довольно вычеркнутой темы.
   */
  private handleSubscriptionError(message: OkxWebSocketMessage, connectionId: number): void {
    const channel = message.arg?.channel;

    if (channel === undefined) {
      this.handleUnattributedSubscriptionError(message, connectionId);

      return;
    }

    const instId = message.arg?.instId ?? '';
    const topicKey = buildOkxTopicKey(channel, instId);
    const connection = this.findConnectionById(connectionId);
    const topicIndex = connection?.topicList.indexOf(topicKey) ?? -1;

    if (connection !== undefined && topicIndex !== -1) {
      connection.topicList.splice(topicIndex, 1);
      this.dropConnectionWithoutTopics(connection);
    }

    this.activeSubscriptionSet.delete(topicKey);
    this.forgetSubscribedSymbol(channel, instId);

    this.logger.error(
      { code: message.code, msg: message.msg, arg: message.arg, topicKey },
      `OkxPublicStream: subscription error — topic ${topicKey} dropped from ${connection?.label ?? `connection #${connectionId}`}`,
    );
  }

  /**
   * Отказ БЕЗ поля `arg` — форма, которую биржа документирует собственным примером: в ответе
   * «Failure Response Example» есть `code` и `msg`, а `arg` помечен как необязательный. Опознать по
   * такому кадру конкретную тему нечем: наш запрос лежит внутри текста `msg`. Пока это была одна
   * строка в журнале, отвергнутая тема оставалась и в реестре соединения, и в списке подписок —
   * наблюдатель считал поток здоровым, хотя по ней не придёт ни кадра, и так до конца жизни
   * процесса.
   *
   * Поэтому сомнительными считаются ВСЕ темы соединения: оно пересоздаётся, и подписка на открытии
   * вернёт то, что биржа примет, — а то, что она не примет, придёт отказом уже с указанием темы и
   * будет вычеркнуто обычным путём.
   */
  private handleUnattributedSubscriptionError(message: OkxWebSocketMessage, connectionId: number): void {
    const connection = this.findConnectionById(connectionId);

    this.logger.error(
      { code: message.code, msg: message.msg, topicCount: connection?.topicList.length ?? 0 },
      `OkxPublicStream: subscription error without a topic on ${connection?.label ?? `connection #${connectionId}`} — every topic of that connection is now in doubt`,
    );

    this.recreateConnection(connectionId, 'subscription error without a topic');
  }

  private forgetSubscribedSymbol(channel: string, instId: string): void {
    if (channel === INDEX_TICKER_CHANNEL) {
      this.forgetSubscribedIndexSymbol(instId);

      return;
    }

    if (channel !== 'tickers' && channel !== MARK_PRICE_CHANNEL) {
      return;
    }

    const symbol = this.resolveSymbolForDisplay(instId);

    if (channel === 'tickers') {
      this.tickerSubscribedSymbolSet.delete(symbol);

      return;
    }

    this.markPriceSubscribedSymbolSet.delete(symbol);
  }

  /**
   * Обозначение в отказе — сам ИНДЕКС (`BTC-USDT`), а карта имён на контракте его не знает: имя
   * берётся из карты, заполненной при подписке. Вместе с признаком забывается и последний
   * известный индекс: канала больше нет, а замороженное число продолжало бы уезжать наружу с
   * каждым кадром цены маркировки как текущее.
   */
  private forgetSubscribedIndexSymbol(instId: string): void {
    const symbol = this.markPriceSymbolByIndexInstId.get(instId);

    if (symbol === undefined) {
      return;
    }

    this.indexSubscribedSymbolSet.delete(symbol);
    this.markPriceSymbolByIndexInstId.delete(instId);
    this.lastIndexPriceBySymbol.delete(symbol);
  }

  private handleTickerMessage(rawList: OkxTickerRaw[]): void {
    if (this.tickerHandlerSet.size === 0) {
      return;
    }

    const tickerBySymbol = normalizeOkxTickers(rawList, this.isSwap, this.contractValueBySymbol);

    for (const handler of this.tickerHandlerSet) {
      handler(tickerBySymbol);
    }
  }

  /**
   * Кадр индекса СОБЫТИЯ не порождает: у индекса свой темп («Push data every 100ms if there are any
   * changes, otherwise push once a minute»), и отдавать наружу цену маркировки, которой в этом кадре
   * нет, было бы выдумкой. Запоминаем последнее известное значение по инструменту и прикладываем его
   * к ближайшему кадру цены маркировки — как это сделано у Bybit (`lastIndexPriceBySymbol`).
   */
  private rememberIndexPriceList(rawList: OkxIndexTickerRaw[]): void {
    for (const raw of rawList) {
      const symbol = this.markPriceSymbolByIndexInstId.get(raw.instId);

      if (symbol === undefined) {
        continue;
      }

      const indexPrice = Number.parseFloat(raw.idxPx);

      if (!Number.isFinite(indexPrice) || indexPrice <= 0) {
        continue;
      }

      this.lastIndexPriceBySymbol.set(symbol, indexPrice);
    }
  }

  /**
   * Индекс, которого ещё не было, оставляет поле ПУСТЫМ, а не нулём: поддельный ноль молча отключал
   * бы у потребителя составляющую `Max(Индекс, …)` в расчёте границы цены (случай OPGUSDT
   * 07.07.2026 на соседней бирже).
   */
  private attachIndexPrice(markPrice: MarkPriceUpdate): MarkPriceUpdate {
    const indexPrice = this.lastIndexPriceBySymbol.get(markPrice.symbol);

    return indexPrice === undefined ? markPrice : { ...markPrice, indexPrice };
  }

  private handleMarkPriceMessage(rawList: OkxMarkPriceRaw[]): void {
    if (this.markPriceHandlerSet.size === 0) {
      return;
    }

    const markPriceList = normalizeOkxMarkPriceWebSocketList(rawList).map((markPrice) => this.attachIndexPrice(markPrice));

    if (markPriceList.length === 0) {
      return;
    }

    for (const handler of this.markPriceHandlerSet) {
      handler(markPriceList);
    }
  }

  private handleTradeMessage(instId: string, dataList: OkxPublicTradeRaw[]): void {
    if (dataList.length === 0) {
      return;
    }

    const symbol = this.symbolMap.resolveSymbol(instId);
    const handlerSet = this.publicTradeHandlerBySymbol.get(symbol);

    if (handlerSet === undefined || handlerSet.size === 0) {
      return;
    }

    const contractValue = this.contractValueBySymbol.get(symbol) ?? '';
    const tradeList = normalizeOkxPublicTradeList(dataList, contractValue);

    for (const handler of handlerSet) {
      handler(symbol, tradeList);
    }
  }

  private handleKlineMessage(channel: string, instId: string, dataList: string[][]): void {
    if (dataList.length === 0) {
      return;
    }

    const interval = resolveUnifiedOkxInterval(channel.slice('candle'.length));

    if (interval === undefined) {
      this.logger.warn(`OkxPublicStream: unknown candle channel '${channel}', frame skipped`);

      return;
    }

    const symbol = this.symbolMap.resolveSymbol(instId);
    const key = `${symbol}_${interval}`;
    const handlerSet = this.klineHandlerByKey.get(key);

    if (handlerSet === undefined || handlerSet.size === 0) {
      return;
    }

    const intervalMs = OKX_KLINE_INTERVAL_MS[interval];
    // Rows are handed out oldest first by their open time, whatever order the frame carries them in.
    // The order of rows inside a multi-row candle frame is not confirmed live (okx-live-probe claim 7:
    // no multi-row frame arrived in 60 s on 17.09.2026), and a newer candle handed out before an older
    // one would let the older overwrite it in the consumer's buffer.
    const orderedRowList = [...dataList].sort((left, right) => Number(left[0]) - Number(right[0]));

    for (const row of orderedRowList) {
      const kline = normalizeOkxKlineWebSocketMessage(row, this.isSwap, intervalMs);

      for (const handler of handlerSet) {
        handler(symbol, kline);
      }
    }
  }

  private handleOrderBookMessage(topicKey: string, message: OkxWebSocketMessage): void {
    const handlerSet = this.orderBookHandlerByTopic.get(topicKey);

    if (handlerSet === undefined || handlerSet.size === 0) {
      return;
    }

    const dataList = message.data;

    if (dataList === undefined || dataList.length === 0 || message.arg === undefined) {
      return;
    }

    const raw = dataList[0] as OkxOrderBookWebSocketDataRaw;
    const updateType: OrderBookUpdateType = message.action === 'update' ? 'delta' : 'snapshot';
    const symbol = this.symbolMap.resolveSymbol(message.arg.instId ?? '');

    if (!this.acceptOrderbookSequence(topicKey, raw, updateType)) {
      return;
    }

    const receivedTimestamp = Date.now();
    const contractValue = this.contractValueBySymbol.get(symbol) ?? '';
    const update = normalizeOkxOrderBookUpdate(raw, { symbol, updateType, receivedTimestamp, contractValue });

    for (const handler of handlerSet) {
      handler(symbol, update);
    }
  }

  /**
   * Приращение с дырой в нумерации накладывать не на что: примени его потребитель — и книга у него
   * молча разойдётся с биржей навсегда, потому что ни признака в обновлении, ни исключения он не
   * получает. Поэтому кадр с разрывом наружу НЕ отдаётся, и следом не отдаются приращения до самого
   * свежего снимка: пропущенное обновление делает неверными и все последующие. Тема помечается как
   * ждущая снимка, и снимок эту пометку снимает.
   *
   * Возвращает признак «кадр можно отдавать потребителю».
   */
  private acceptOrderbookSequence(topicKey: string, raw: OkxOrderBookWebSocketDataRaw, updateType: OrderBookUpdateType): boolean {
    if (updateType === 'snapshot') {
      this.lastSeqIdByTopic.set(topicKey, raw.seqId);
      this.awaitingSnapshotTopicSet.delete(topicKey);

      return true;
    }

    if (this.awaitingSnapshotTopicSet.has(topicKey)) {
      this.escalateOrderbookResync(topicKey, 'missingSnapshot');

      return false;
    }

    const lastSeqId = this.lastSeqIdByTopic.get(topicKey);
    const hasComparableSequence = raw.prevSeqId !== undefined && raw.prevSeqId !== -1 && lastSeqId !== undefined;

    if (hasComparableSequence && raw.prevSeqId !== lastSeqId) {
      this.awaitingSnapshotTopicSet.add(topicKey);
      this.logger.warn(`OkxPublicStream: orderbook sequence gap on ${topicKey} (expected prevSeqId=${lastSeqId}, got ${raw.prevSeqId}) — frame withheld until a fresh snapshot`);
      this.escalateOrderbookResync(topicKey, 'sequenceGap');

      return false;
    }

    this.lastSeqIdByTopic.set(topicKey, raw.seqId);
    this.forgetHealedOrderbookGap(topicKey);

    return true;
  }

  /**
   * Ступень лечения. Первый разрыв лечится СРАЗУ — лёгкая переподписка приносит свежий снимок;
   * глушение на `OKX_ORDERBOOK_RESYNC_MIN_INTERVAL_MS` придумано против череды разрывов подряд и
   * применяется только к ПОВТОРНЫМ. Счёт разрывов снимком больше не обнуляется: обнулял его тот
   * самый снимок, который приходил в ответ на нашу же переподписку, и ступень «три разрыва →
   * пересоздать соединение» была недостижима. Теперь счёт стирает только чистый ход потока (см.
   * `forgetHealedOrderbookGap`), а «переподписались, а снимка так и нет» тоже считается разрывом —
   * иначе тема, которую лечение не вылечило, висела бы немой без всякой ступени.
   */
  private escalateOrderbookResync(topicKey: string, trigger: OkxOrderbookResyncTrigger): void {
    const now = Date.now();
    const lastResyncTimestamp = this.lastResyncTimestampByTopic.get(topicKey) ?? 0;
    const isWithinResyncWindow = now - lastResyncTimestamp < OKX_ORDERBOOK_RESYNC_MIN_INTERVAL_MS;

    if (trigger === 'missingSnapshot' && isWithinResyncWindow) {
      return;
    }

    const gapCount = (this.gapCountByTopic.get(topicKey) ?? 0) + 1;
    this.gapCountByTopic.set(topicKey, gapCount);
    this.lastGapTimestampByTopic.set(topicKey, now);

    if (gapCount >= OKX_ORDERBOOK_GAP_RECREATE_THRESHOLD) {
      const connection = this.connectionList.find((item) => item.topicList.includes(topicKey));

      if (connection !== undefined) {
        this.recreateConnection(connection.id, `orderbook sequence gap threshold reached on ${topicKey} (${trigger})`);
      }

      this.gapCountByTopic.delete(topicKey);
      this.lastResyncTimestampByTopic.set(topicKey, now);

      return;
    }

    if (isWithinResyncWindow) {
      return;
    }

    this.logger.warn(`OkxPublicStream: resyncing orderbook ${topicKey} (${trigger}, gapCount=${gapCount})`);
    this.resubscribeTopic(topicKey);
    this.lastResyncTimestampByTopic.set(topicKey, now);
  }

  private forgetOrderbookSequenceState(topicKey: string): void {
    this.lastSeqIdByTopic.delete(topicKey);
    this.gapCountByTopic.delete(topicKey);
    this.lastResyncTimestampByTopic.delete(topicKey);
    this.lastGapTimestampByTopic.delete(topicKey);
    this.awaitingSnapshotTopicSet.delete(topicKey);
  }

  private forgetHealedOrderbookGap(topicKey: string): void {
    const lastGapTimestamp = this.lastGapTimestampByTopic.get(topicKey);

    if (lastGapTimestamp === undefined || Date.now() - lastGapTimestamp < OKX_ORDERBOOK_RESYNC_MIN_INTERVAL_MS) {
      return;
    }

    this.gapCountByTopic.delete(topicKey);
    this.lastGapTimestampByTopic.delete(topicKey);
  }
}

export { OkxPublicStream };
