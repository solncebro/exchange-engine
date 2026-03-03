import type {
  ExchangeConfig,
  ExchangeLogger,
  KlineInterval,
  Kline,
  MarginMode,
  MarketBySymbol,
  Order,
  OrderSide,
  OrderType,
  TickerBySymbol,
  BalanceByAsset,
  Position,
} from './common';

export interface ExchangeArgs {
  config: ExchangeConfig;
  logger: ExchangeLogger;
  onNotify?: (message: string) => void | Promise<void>;
}

export interface CreateOrderWsArgs {
  symbol: string;
  type: OrderType;
  side: OrderSide;
  amount: number;
  price: number;
  params?: Record<string, unknown>;
}

export interface FetchKlinesArgs {
  startTime?: number;
  endTime?: number;
  limit?: number;
}

export type KlineHandler = (symbol: string, kline: Kline) => void;

export interface SubscribeKlinesArgs {
  symbol: string;
  interval: KlineInterval;
  handler: KlineHandler;
}

export interface ExchangeClient {
  readonly apiKey: string;
  readonly markets: MarketBySymbol;

  loadMarkets(reload?: boolean): Promise<MarketBySymbol>;
  fetchTickers(): Promise<TickerBySymbol>;
  fetchKlines(symbol: string, interval: KlineInterval, options?: FetchKlinesArgs): Promise<Kline[]>;
  fetchAllKlines(symbolList: string[], interval: KlineInterval): Promise<Map<string, Kline[]>>;
  fetchBalance(): Promise<BalanceByAsset>;
  fetchPosition(symbol: string): Promise<Position>;
  setLeverage(leverage: number, symbol: string): Promise<void>;
  setMarginMode(marginMode: MarginMode, symbol: string): Promise<void>;
  amountToPrecision(symbol: string, amount: number): string;
  priceToPrecision(symbol: string, price: number): string;
  getMinOrderQty(symbol: string): number;
  getMinNotional(symbol: string): number;
  createOrderWs(args: CreateOrderWsArgs): Promise<Order>;
  close(): Promise<void>;

  watchTickers(): AsyncGenerator<TickerBySymbol>;
  subscribeKlines(args: SubscribeKlinesArgs): void;
  unsubscribeKlines(args: SubscribeKlinesArgs): void;
}
