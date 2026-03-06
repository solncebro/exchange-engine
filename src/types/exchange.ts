import type {
  ExchangeConfig,
  ExchangeLogger,
  KlineInterval,
  Kline,
  TradeSymbolBySymbol,
  Order,
  TickerBySymbol,
  BalanceByAsset,
  Position,
  FundingRateHistory,
} from './common';
import { MarginMode, OrderSide, OrderType } from './common';

export interface ExchangeArgs {
  config: ExchangeConfig;
  logger: ExchangeLogger;
  onNotify?: (message: string) => void | Promise<void>;
}

export interface CreateOrderWebSocketArgs {
  symbol: string;
  type: OrderType;
  side: OrderSide;
  amount: number;
  price: number;
  params?: Record<string, unknown>;
}

export interface FetchPageWithLimitArgs {
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
  readonly tradeSymbols: TradeSymbolBySymbol;

  loadTradeSymbols(shouldReload?: boolean): Promise<TradeSymbolBySymbol>;
  fetchTickers(): Promise<TickerBySymbol>;
  fetchKlines(symbol: string, interval: KlineInterval, options?: FetchPageWithLimitArgs): Promise<Kline[]>;
  fetchAllKlines(symbolList: string[], interval: KlineInterval): Promise<Map<string, Kline[]>>;
  fetchBalance(): Promise<BalanceByAsset>;
  fetchFundingRateHistory(symbol: string, options?: FetchPageWithLimitArgs): Promise<FundingRateHistory[]>;
  fetchPosition(symbol: string): Promise<Position>;
  setLeverage(leverage: number, symbol: string): Promise<void>;
  setMarginMode(marginMode: MarginMode, symbol: string): Promise<void>;
  amountToPrecision(symbol: string, amount: number): string;
  priceToPrecision(symbol: string, price: number): string;
  getMinOrderQty(symbol: string): number;
  getMinNotional(symbol: string): number;
  createOrderWebSocket(args: CreateOrderWebSocketArgs): Promise<Order>;
  close(): Promise<void>;

  watchTickers(): AsyncGenerator<TickerBySymbol>;
  subscribeKlines(args: SubscribeKlinesArgs): void;
  unsubscribeKlines(args: SubscribeKlinesArgs): void;
}
