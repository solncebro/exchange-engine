export type ExchangeName = 'binance' | 'bybit';

export type OrderSide = 'buy' | 'sell';

export type OrderType = 'market' | 'limit';

export type MarginMode = 'isolated' | 'cross';

export type PositionSide = 'long' | 'short' | 'both';

export type MarketType = 'spot' | 'swap' | 'future';

export type TimeInForce = 'GTC' | 'IOC' | 'FOK' | 'PostOnly';

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
  demoMode?: boolean;
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
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTimestamp: number;
  quoteVolume: number;
  trades: number;
}

export interface MarketFilter {
  tickSize: string;
  stepSize: string;
  minQty: string;
  maxQty: string;
  minNotional: string;
}

export interface Market {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  settle: string;
  active: boolean;
  type: MarketType;
  linear: boolean;
  contractSize: number;
  filter: MarketFilter;
}

export type MarketBySymbol = Map<string, Market>;

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
