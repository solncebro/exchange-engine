export enum ExchangeName {
  Binance = 'binance',
  Bybit = 'bybit',
}

export enum OrderSide {
  Buy = 'buy',
  Sell = 'sell',
}

export enum OrderType {
  Market = 'market',
  Limit = 'limit',
}

export enum MarginMode {
  Isolated = 'isolated',
  Cross = 'cross',
}

export enum PositionSide {
  Long = 'long',
  Short = 'short',
  Both = 'both',
}

export enum TradeSymbolType {
  Spot = 'spot',
  Swap = 'swap',
  Future = 'future',
}

export enum TimeInForce {
  Gtc = 'GTC',
  Ioc = 'IOC',
  Fok = 'FOK',
  PostOnly = 'PostOnly',
}

export type KlineInterval =
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
}

export interface ExchangeLogger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
  fatal(message: string, ...args: unknown[]): void;
}

export interface Ticker {
  symbol: string;
  close: number;
  percentage: number;
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
  type: TradeSymbolType;
  isLinear: boolean;
  contractSize: number;
  filter: TradeSymbolFilter;
}

export type TradeSymbolBySymbol = Map<string, TradeSymbol>;

export interface Position {
  symbol: string;
  side: PositionSide;
  contracts: number;
  entryPrice: number;
  markPrice: number;
  unrealizedPnl: number;
  leverage: number;
  marginMode: MarginMode;
  liquidationPrice: number;
  info: Record<string, unknown>;
}

export interface Order {
  id: string;
  symbol: string;
  side: OrderSide;
  type: OrderType;
  amount: number;
  price: number;
  status: string;
  timestamp: number;
}

export interface Balance {
  asset: string;
  free: number;
  locked: number;
  total: number;
}

export type BalanceByAsset = Map<string, Balance>;

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

export enum PositionMode {
  Hedge = 'hedge',
  OneWay = 'oneWay',
}
