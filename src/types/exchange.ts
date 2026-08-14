import type {
  ExchangeConfig,
  ExchangeLogger,
  KlineInterval,
  Kline,
  TradeSymbolBySymbol,
  Order,
  TickerBySymbol,
  AccountBalances,
  Position,
  FundingRateHistory,
  FundingInfo,
  WebSocketConnectionInfo,
  OrderBook,
  OrderBookHandler,
  RawOrderbookHandler,
  PublicTrade,
  PublicTradeHandler,
  MarkPrice,
  MarkPriceHandler,
  OpenInterest,
  FeeRate,
  Income,
  ClosedPnl,
  UserDataStreamHandlerArgs,
  OrderRateLimitSnapshot,
} from './common';
import {
  MarginModeEnum,
  MarketUnitEnum,
  OrderFilterEnum,
  OrderSideEnum,
  OrderTypeEnum,
  PositionModeEnum,
  PositionSideEnum,
  TimeInForceEnum,
  TriggerByEnum,
  WorkingTypeEnum,
} from './common';

export interface ExchangeArgs {
  config: ExchangeConfig;
  logger: ExchangeLogger;
  onNotify?: (message: string) => void | Promise<void>;
}

export interface CreateOrderWebSocketArgs {
  symbol: string;
  type: OrderTypeEnum;
  side: OrderSideEnum;
  amount: number;
  price?: number;
  stopPrice?: number;
  triggerDirection?: 1 | 2;
  triggerBy?: TriggerByEnum;
  closePosition?: boolean;
  workingType?: WorkingTypeEnum;
  positionSide?: PositionSideEnum;
  reduceOnly?: boolean;
  closeOnTrigger?: boolean;
  timeInForce?: TimeInForceEnum;
  clientOrderId?: string;
  orderFilter?: OrderFilterEnum;
  marketUnit?: MarketUnitEnum;
  quoteOrderQty?: number;
  /** Скользящий стоп: цена, с которой он начинает вести за ценой. */
  activationPrice?: number;
  /** Скользящий стоп: отступ в ПРОЦЕНТАХ — единственная единица во всей библиотеке.
   *  Собственные единицы бирж (сотые доли процента у спота Binance, абсолютное расстояние
   *  в цене у Bybit) заперты внутри своего клиента и наружу не выходят.
   *  Ни один вход чтения его обратно НЕ возвращает — если значение нужно потом, хранить у себя. */
  callbackRate?: number;
}

export interface FetchPageWithLimitArgs {
  startTime?: number;
  endTime?: number;
  limit?: number;
}

/**
 * Что именно спрашиваем в журнале начислений. Это НАМЕРЕНИЕ, а не биржевое слово: как оно
 * называется на конкретной бирже, решает биржевой слой.
 * - `funding` — списания и начисления по ставке финансирования;
 * - `realizedPnl` — реализованный итог сделок, ВАЛОВОЙ (комиссия в него не входит);
 * - `commission` — торговая комиссия, со знаком минус когда она списана.
 */
export type IncomeTypeFilter = 'funding' | 'realizedPnl' | 'commission';

export interface FetchIncomeArgs extends FetchPageWithLimitArgs {
  incomeType?: IncomeTypeFilter;
  symbol?: string;
}

export type KlineHandler = (symbol: string, kline: Kline) => void;

export interface SubscribeKlinesArgs {
  symbol: string;
  interval: KlineInterval;
  handler: KlineHandler;
}

export interface SubscribeOrderbookArgs {
  symbol: string;
  depth: number;
  handler: OrderBookHandler;
}

export interface SubscribePublicTradesArgs {
  symbol: string;
  handler: PublicTradeHandler;
}

export interface FetchAllKlinesOptions {
  chunkSize?: number;
  pauseBetweenChunksMs?: number;
  trimLastKline?: boolean;
  onChunkLoaded?: (chunkResult: Map<string, Kline[]>) => void;
}

export interface ModifyOrderArgs {
  symbol: string;
  orderId: string;
  price?: number;
  amount?: number;
  triggerPrice?: number;
}

export interface ModifyBatchOrderArgs {
  symbol: string;
  orderId: string;
  side: OrderSideEnum;
  clientOrderId?: string;
  price?: number;
  amount?: number;
  triggerPrice?: number;
}

export interface ResubscribeKlinesArgs {
  symbol: string;
  interval: string;
}

export interface ResubscribeOrderbookArgs {
  symbol: string;
  depth: number;
}

export interface SetOrderbookLiveSymbolArgs {
  symbol: string;
  isLive: boolean;
}

export interface ResubscribePublicTradesArgs {
  symbol: string;
}

/**
 * Исход постановки ОДНОЙ заявки из пачки. Записей ровно столько, сколько было заявок, и в том
 * же порядке: биржи по-разному прячут отказ отдельной заявки (Binance выбрасывал её из ответа,
 * Bybit возвращал «открытую» заявку с пустым номером), и оба вида молчания приводили к тому,
 * что вызывающий считал стоп поставленным, когда его нет.
 */
export interface CreateOrderItemResult {
  /** Заявка, если она действительно встала; null — не встала. */
  order: Order | null;
  isSuccess: boolean;
  errorCode: number | null;
  errorText: string | null;
  /** Rate-limit budget snapshot from the response header (WS path), when present. */
  rateLimit?: OrderRateLimitSnapshot;
}

export type CreateBatchOrdersResult = CreateOrderItemResult[];

export interface CancelOrderItemResult {
  orderId: string;
  isSuccess: boolean;
  errorCode: number | null;
  errorText: string | null;
  /** Rate-limit budget snapshot from the response header (WS path), when present. */
  rateLimit?: OrderRateLimitSnapshot;
}

export type CancelBatchOrdersResult = CancelOrderItemResult[];

export interface ModifyOrderItemResult {
  orderId: string;
  isSuccess: boolean;
  errorCode: number | null;
  errorText: string | null;
  /** Rate-limit budget snapshot from the response header (WS path), when present. */
  rateLimit?: OrderRateLimitSnapshot;
}

export type ModifyBatchOrdersResult = ModifyOrderItemResult[];

export type OrderRateLimitSource = 'binance-exchange-info' | 'bybit-exchange-header' | 'bybit-documented' | 'fallback';

export interface OrderRateLimit {
  writeRequestsPerSecond: number;
  source: OrderRateLimitSource;
}

export interface ExchangeClient {
  readonly apiKey: string;
  readonly tradeSymbols: TradeSymbolBySymbol;

  loadTradeSymbols(): Promise<TradeSymbolBySymbol>;
  fetchTickers(): Promise<TickerBySymbol>;
  fetchKlines(symbol: string, interval: KlineInterval, options?: FetchPageWithLimitArgs): Promise<Kline[]>;
  fetchAllKlines(symbolList: string[], interval: KlineInterval, options?: FetchAllKlinesOptions): Promise<Map<string, Kline[]>>;
  fetchBalances(): Promise<AccountBalances>;
  fetchFundingRateHistory(symbol: string, options?: FetchPageWithLimitArgs): Promise<FundingRateHistory[]>;
  fetchPosition(symbol: string): Promise<Position>;
  fetchPositionSnapshot(symbol: string, positionIdx?: number): Promise<Position | null>;
  fetchPositionList(symbol: string): Promise<Position[]>;
  fetchAllPositions(): Promise<Position[]>;
  setLeverage(leverage: number, symbol: string): Promise<void>;
  setMarginMode(marginMode: MarginModeEnum, symbol: string): Promise<void>;
  amountToPrecision(symbol: string, amount: number): number;
  priceToPrecision(symbol: string, price: number): number;
  getMinOrderQty(symbol: string): number;
  getMinNotional(symbol: string): number;
  getMaxOrderQty(symbol: string): number;
  getMarketMaxOrderQty(symbol: string): number;
  fetchFundingInfo(symbol?: string): Promise<FundingInfo[]>;
  fetchPositionMode(): Promise<PositionModeEnum | undefined>;
  createOrderWebSocket(args: CreateOrderWebSocketArgs): Promise<Order>;
  fetchOrderHistory(symbol: string, options?: FetchPageWithLimitArgs): Promise<Order[]>;
  isTradeWebSocketConnected(): boolean;
  connectTradeWebSocket(): Promise<void>;
  getWebSocketConnectionInfoList(): WebSocketConnectionInfo[];
  close(): Promise<void>;

  cancelOrder(symbol: string, orderId: string): Promise<Order>;
  getOrder(symbol: string, orderId: string): Promise<Order>;
  getOrderByClientOrderId(symbol: string, clientOrderId: string): Promise<Order>;
  fetchOpenOrders(symbol?: string): Promise<Order[]>;
  fetchOpenConditionalOrders(settleCoin: string): Promise<Order[]>;
  modifyOrder(args: ModifyOrderArgs): Promise<Order>;
  cancelAllOrders(symbol: string): Promise<void>;
  createBatchOrders(orderList: CreateOrderWebSocketArgs[]): Promise<CreateBatchOrdersResult>;
  cancelBatchOrders(symbol: string, orderIdList: string[]): Promise<CancelBatchOrdersResult>;
  modifyBatchOrders(orderList: ModifyBatchOrderArgs[]): Promise<ModifyBatchOrdersResult>;
  getOrderRateLimit(): Promise<OrderRateLimit>;

  fetchOrderBook(symbol: string, limit?: number): Promise<OrderBook>;
  fetchTrades(symbol: string, limit?: number): Promise<PublicTrade[]>;
  fetchMarkPrice(symbol?: string): Promise<MarkPrice[]>;
  fetchOpenInterest(symbol: string): Promise<OpenInterest>;

  fetchFeeRate(symbol?: string): Promise<FeeRate[]>;
  fetchIncome(options?: FetchIncomeArgs): Promise<Income[]>;
  fetchClosedPnl(symbol?: string, options?: FetchPageWithLimitArgs): Promise<ClosedPnl[]>;

  setPositionMode(mode: PositionModeEnum): Promise<void>;

  watchTickers(): AsyncGenerator<TickerBySymbol>;
  subscribeKlines(args: SubscribeKlinesArgs): void;
  unsubscribeKlines(args: SubscribeKlinesArgs): void;
  resubscribeKlines(args: ResubscribeKlinesArgs): void;
  resubscribeKlineList(argsList: ResubscribeKlinesArgs[]): void;
  resubscribeOrderbook(args: ResubscribeOrderbookArgs): void;
  resubscribePublicTrades(args: ResubscribePublicTradesArgs): void;
  resubscribeMarkPrices(): void;
  subscribeMarkPrices(handler: MarkPriceHandler): void;
  unsubscribeMarkPrices(handler: MarkPriceHandler): void;
  subscribeAllTickers(handler: (tickers: TickerBySymbol) => void, symbolList: string[]): void;
  unsubscribeAllTickers(handler: (tickers: TickerBySymbol) => void): void;
  subscribeOrderbook(args: SubscribeOrderbookArgs): void;
  unsubscribeOrderbook(args: SubscribeOrderbookArgs): void;
  setOrderbookLiveSymbol(args: SetOrderbookLiveSymbolArgs): void;
  subscribeRawOrderbook(handler: RawOrderbookHandler): void;
  unsubscribeRawOrderbook(handler: RawOrderbookHandler): void;
  subscribePublicTrades(args: SubscribePublicTradesArgs): void;
  unsubscribePublicTrades(args: SubscribePublicTradesArgs): void;
  awaitWebSocketConnectionsReady(): Promise<void>;

  connectUserDataStream(handler: UserDataStreamHandlerArgs): Promise<void>;
  disconnectUserDataStream(): void;
  isUserDataStreamConnected(): boolean;
}
