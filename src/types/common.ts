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
  TakeProfitMarket = 'takeProfitMarket',
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

export interface ExchangeConfig {
  apiKey: string;
  secret: string;
  recvWindow?: number;
  isDemoMode?: boolean;
  httpsAgent?: unknown;
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
}

export type TradeSymbolBySymbol = Map<string, TradeSymbol>;

export interface Position {
  symbol: string;
  side: PositionSideEnum;
  contracts: number;
  entryPrice: number;
  markPrice: number;
  unrealizedPnl: number;
  leverage: number;
  marginMode: MarginModeEnum;
  liquidationPrice: number;
  info: Record<string, unknown>;
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
}

export interface Balance {
  asset: string;
  free: number;
  locked: number;
  total: number;
}

export type BalanceByAsset = Map<string, Balance>;

export interface AccountBalances {
  totalWalletBalance: number;
  totalAvailableBalance: number;
  balanceByAsset: BalanceByAsset;
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
  url: string;
  isConnected: boolean;
  type: WebSocketConnectionTypeEnum;
  subscriptionList: string[];
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
}

export interface PublicTrade {
  id: string;
  symbol: string;
  price: number;
  quantity: number;
  quoteQuantity: number;
  timestamp: number;
  isBuyerMaker: boolean;
}

export interface MarkPrice {
  symbol: string;
  markPrice: number;
  indexPrice: number;
  lastFundingRate: number;
  nextFundingTime: number;
  timestamp: number;
}

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

export type OrderUpdateHandler = (event: OrderUpdateEvent) => void;
export type PositionUpdateHandler = (event: PositionUpdateEvent) => void;

export interface UserDataStreamHandlerArgs {
  onOrderUpdate: OrderUpdateHandler;
  onPositionUpdate: PositionUpdateHandler;
}
