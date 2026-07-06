export enum ExchangeNameEnum {
  Binance = 'binance',
  Bybit = 'bybit',
}

export enum OrderSideEnum {
  Buy = 'buy',
  Sell = 'sell',
}

export enum OrderTypeEnum {
  Market = 'market',
  Limit = 'limit',
  StopMarket = 'stopMarket',
  StopLimit = 'stopLimit',
  TakeProfitMarket = 'takeProfitMarket',
  TakeProfitLimit = 'takeProfitLimit',
  Stop = 'stop',
  TakeProfit = 'takeProfit',
  TrailingStop = 'trailingStop',
}

export enum MarginModeEnum {
  Isolated = 'isolated',
  Cross = 'cross',
}

export enum PositionSideEnum {
  Long = 'long',
  Short = 'short',
  Both = 'both',
}

export enum TradeSymbolTypeEnum {
  Spot = 'spot',
  Swap = 'swap',
  Future = 'future',
}

export enum TimeInForceEnum {
  Gtc = 'GTC',
  Ioc = 'IOC',
  Fok = 'FOK',
  PostOnly = 'PostOnly',
}

export type KlineInterval =
  | '1s'
  | '1m'
  | '3m'
  | '5m'
  | '15m'
  | '30m'
  | '1h'
  | '2h'
  | '4h'
  | '6h'
  | '12h'
  | '1d'
  | '3d'
  | '1w'
  | '1M';

// Semantic topic categories for the Bybit V5 public stream. Each category is a
// distinct message-rate profile (tickers ~1s, klines per-interval, orderbook/trades
// event-driven), which is why they can be packed onto dedicated connections.
export type BybitPublicTopicType = 'tickers' | 'kline' | 'orderbook' | 'publicTrade';

// Controls how public-stream topics are distributed across physical WebSocket
// connections. Default (undefined) preserves the legacy behaviour: a flat fill of
// up to maxTopicsPerConnection topics regardless of type.
export interface PublicStreamConnectionPacking {
  // When true, each connection carries exactly ONE topic type — never mixing
  // tickers/klines/orderbook/trades. A partial last connection of a type is left
  // partial, not back-filled with another type. This isolates a churning stream
  // (e.g. orderbook) from dragging unrelated streams (e.g. klines) on reconnect.
  separateByTopicType?: boolean;
  // Fallback per-connection topic cap (default 200) used when off, and for any type
  // without an explicit override below.
  maxTopicsPerConnection?: number;
  // Per-type cap override, e.g. { orderbook: 100, publicTrade: 100 } shrinks the
  // blast radius of the high-churn streams without fragmenting the stable ones.
  maxTopicsPerConnectionByType?: Partial<Record<BybitPublicTopicType, number>>;
}

export interface ExchangeConfig {
  apiKey: string;
  secret: string;
  recvWindow?: number;
  isDemoMode?: boolean;
  httpsAgent?: unknown;
  publicStreamConnectionPacking?: PublicStreamConnectionPacking;
  lazyOrderbookParse?: boolean;
}

export interface ExchangeLogger {
  debug(obj: Record<string, unknown>, message: string): void;
  debug(message: string, ...args: unknown[]): void;
  info(obj: Record<string, unknown>, message: string): void;
  info(message: string, ...args: unknown[]): void;
  warn(obj: Record<string, unknown>, message: string): void;
  warn(message: string, ...args: unknown[]): void;
  error(obj: Record<string, unknown>, message: string): void;
  error(message: string, ...args: unknown[]): void;
  fatal(obj: Record<string, unknown>, message: string): void;
  fatal(message: string, ...args: unknown[]): void;
}

export interface Ticker {
  symbol: string;
  lastPrice: number;
  openPrice: number;
  highPrice: number;
  lowPrice: number;
  priceChangePercent: number;
  volume: number;
  quoteVolume: number;
  timestamp: number;
  markPrice?: number;
  indexPrice?: number;
  bid1Price?: number;
  bid1Size?: number;
  ask1Price?: number;
  ask1Size?: number;
  fundingRate?: number;
  nextFundingTime?: number;
}

export type TickerBySymbol = Map<string, Ticker>;

export interface Kline {
  openTimestamp: number;
  openPrice: number;
  highPrice: number;
  lowPrice: number;
  closePrice: number;
  volume: number;
  closeTimestamp: number;
  quoteAssetVolume: number;
  numberOfTrades: number;
  takerBuyBaseAssetVolume: number;
  takerBuyQuoteAssetVolume: number;
  isClosed?: boolean;
}

export interface TradeSymbolFilter {
  tickSize: string;
  stepSize: string;
  minQty: string;
  maxQty: string;
  minNotional: string;
  minPrice?: string;
  maxPrice?: string;
  maxNotional?: string;
  marketMinQty?: string;
  marketMaxQty?: string;
  marketStepSize?: string;
  postOnlyMaxQty?: string;
}

export interface LeverageFilter {
  minLeverage: string;
  maxLeverage: string;
  leverageStep: string;
}

export type PriceLimitRisk =
  | {
      source: 'binancePercentPrice';
      multiplierUp: string;
      multiplierDown: string;
      multiplierDecimal: string;
    }
  | {
      source: 'binancePercentPriceBySide';
      bidMultiplierUp: string;
      bidMultiplierDown: string;
      askMultiplierUp: string;
      askMultiplierDown: string;
      avgPriceMins: number;
    }
  | {
      source: 'bybitRiskParameters';
      priceLimitRatioX: string;
      priceLimitRatioY: string;
    };

export interface TradingFunding {
  fundingIntervalMinutes?: number;
  upperFundingRate?: string;
  lowerFundingRate?: string;
}

export interface TradeSymbol {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  settle: string;
  isActive: boolean;
  type: TradeSymbolTypeEnum;
  isLinear: boolean;
  contractSize: number;
  contractType: string;
  filter: TradeSymbolFilter;
  leverageFilter?: LeverageFilter;
  priceLimitRisk?: PriceLimitRisk;
  pricePrecision?: number;
  quantityPrecision?: number;
  funding?: TradingFunding;
  launchTimestamp?: number;
  triggerProtect?: string;
  liquidationFee?: string;
  orderTypeList?: string[];
  timeInForceList?: string[];
  info?: Record<string, unknown>;
}

export type TradeSymbolBySymbol = Map<string, TradeSymbol>;

export interface Position {
  symbol: string;
  side: PositionSideEnum;
  direction: 'long' | 'short' | null;
  contracts: number;
  entryPrice: number;
  markPrice: number;
  unrealizedPnl: number;
  leverage: number;
  marginMode: MarginModeEnum;
  liquidationPrice: number;
  positionIdx?: number;
  info: Record<string, unknown>;
}

export interface OrderRateLimitSnapshot {
  limit: number;
  remaining: number;
  resetMs: number;
}

export interface Order {
  id: string;
  clientOrderId: string;
  symbol: string;
  side: OrderSideEnum;
  type: OrderTypeEnum;
  timeInForce: TimeInForceEnum;
  price: number;
  avgPrice: number;
  stopPrice: number;
  amount: number;
  filledAmount: number;
  filledQuoteAmount: number;
  status: string;
  reduceOnly: boolean;
  timestamp: number;
  updatedTimestamp: number;
  rateLimit?: OrderRateLimitSnapshot;
}

export interface Balance {
  asset: string;
  free: number;
  locked: number;
  total: number;
  walletBalance?: number;
  availableToWithdraw?: number;
  totalOrderInitialMargin?: number;
  totalPositionInitialMargin?: number;
}

export type BalanceByAsset = Map<string, Balance>;

export interface AccountBalances {
  totalWalletBalance: number;
  totalAvailableBalance: number;
  balanceByAsset: BalanceByAsset;
  accountType?: string;
  totalMarginBalance?: number;
  totalInitialMargin?: number;
}

export interface FundingRateHistory {
  symbol: string;
  fundingRate: number;
  fundingTime: number;
  markPrice: number | null;
}

export interface FundingInfo {
  symbol: string;
  fundingIntervalHours: number;
  adjustedFundingRateCap: number;
  adjustedFundingRateFloor: number;
}

export enum PositionModeEnum {
  Hedge = 'hedge',
  OneWay = 'oneWay',
}

export enum WorkingTypeEnum {
  MarkPrice = 'markPrice',
  ContractPrice = 'contractPrice',
}

export enum TriggerByEnum {
  MarkPrice = 'MarkPrice',
  LastPrice = 'LastPrice',
  IndexPrice = 'IndexPrice',
}

export enum OrderFilterEnum {
  Order = 'Order',
  TpslOrder = 'tpslOrder',
  StopOrder = 'StopOrder',
}

export enum MarketUnitEnum {
  BaseCoin = 'baseCoin',
  QuoteCoin = 'quoteCoin',
}

export enum MarketTypeEnum {
  Futures = 'futures',
  Spot = 'spot',
}

export const MARKET_TYPE_LIST: MarketTypeEnum[] = Object.values(MarketTypeEnum);

export enum WebSocketConnectionTypeEnum {
  Public = 'public',
  Trade = 'trade',
  UserData = 'userData',
}

export interface WebSocketConnectionInfo {
  label: string;
  // Compact, context-free identifier (`${type} #N`, e.g. "orderbook #9", or just
  // "#N" in legacy mixed mode). A substring of `label` from the same source — use it
  // in grouped per-connection listings where the stream prefix is already implied by
  // the surrounding header, so it is not repeated on every line.
  shortLabel?: string;
  url: string;
  isConnected: boolean;
  type: WebSocketConnectionTypeEnum;
  subscriptionList: string[];
  messageCount?: number;
  lastMessageTimestamp?: number;
  reconnectCount?: number;
}

export interface OrderBookLevel {
  price: number;
  quantity: number;
}

export interface OrderBook {
  symbol: string;
  askList: OrderBookLevel[];
  bidList: OrderBookLevel[];
  timestamp: number;
  updateId?: number;
  eventTimestamp?: number;
}

export type OrderBookUpdateType = 'snapshot' | 'delta';

export type OrderBookRawLevel = [string, string];

export interface OrderBookUpdate {
  symbol: string;
  updateType: OrderBookUpdateType;
  bidList: OrderBookRawLevel[];
  askList: OrderBookRawLevel[];
  updateId: number;
  eventTimestamp: number;
  receivedTimestamp: number;
}

export type OrderBookHandler = (symbol: string, update: OrderBookUpdate) => void;

export interface RawOrderbookFrame {
  symbol: string;
  raw: string;
  receivedTimestamp: number;
}

export type RawOrderbookHandler = (frame: RawOrderbookFrame) => void;

export interface PublicTrade {
  id: string;
  symbol: string;
  price: number;
  quantity: number;
  quoteQuantity: number;
  timestamp: number;
  isBuyerMaker: boolean;
  isBlockTrade?: boolean;
  side?: OrderSideEnum;
}

export type PublicTradeHandler = (symbol: string, tradeList: PublicTrade[]) => void;

export interface MarkPrice {
  symbol: string;
  markPrice: number;
  indexPrice: number;
  lastFundingRate: number;
  nextFundingTime: number;
  timestamp: number;
}

export interface MarkPriceUpdate {
  symbol: string;
  markPrice: number;
  indexPrice: number;
  timestamp: number;
}

export type MarkPriceHandler = (markPriceList: MarkPriceUpdate[]) => void;

export interface OpenInterest {
  symbol: string;
  openInterest: number;
  timestamp: number;
}

export interface FeeRate {
  symbol: string;
  makerRate: number;
  takerRate: number;
}

export interface Income {
  symbol: string;
  incomeType: string;
  income: number;
  asset: string;
  timestamp: number;
  info: Record<string, unknown>;
  quantity?: number;
}

export interface ClosedPnl {
  symbol: string;
  orderId: string;
  side: OrderSideEnum;
  quantity: number;
  entryPrice: number;
  exitPrice: number;
  closedPnl: number;
  timestamp: number;
}

export interface OrderUpdateEvent {
  symbol: string;
  orderId: string;
  clientOrderId: string;
  side: OrderSideEnum;
  status: string;
  price: number;
  avgPrice: number;
  amount: number;
  filledAmount: number;
  timestamp: number;
  cancelType?: string;
  rejectReason?: string;
}

export interface PositionUpdateEvent {
  symbol: string;
  side: string;
  size: number;
  entryPrice: number;
  markPrice: number;
  unrealisedPnl: number;
  leverage: number;
  liquidationPrice: number;
  positionSide: string;
  timestamp: number;
}

export interface BalanceUpdateItem {
  asset: string;
  free: number;
  locked: number;
}

export interface BalanceUpdateEvent {
  balanceList: BalanceUpdateItem[];
  timestamp: number;
}

export type OrderUpdateHandler = (event: OrderUpdateEvent) => void;
export type PositionUpdateHandler = (event: PositionUpdateEvent) => void;
export type BalanceUpdateHandler = (event: BalanceUpdateEvent) => void;

export interface UserDataStreamHandlerArgs {
  onOrderUpdate: OrderUpdateHandler;
  onPositionUpdate: PositionUpdateHandler;
  onBalanceUpdate?: BalanceUpdateHandler;
}
