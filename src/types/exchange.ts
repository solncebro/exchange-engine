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
  PublicTrade,
  MarkPrice,
  OpenInterest,
  FeeRate,
  Income,
  ClosedPnl,
} from './common';
import {
  MarginModeEnum,
  OrderSideEnum,
  OrderTypeEnum,
  PositionModeEnum,
  PositionSideEnum,
  TimeInForceEnum,
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
  closePosition?: boolean;
  workingType?: WorkingTypeEnum;
  positionSide?: PositionSideEnum;
  reduceOnly?: boolean;
  timeInForce?: TimeInForceEnum;
  clientOrderId?: string;
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
  setLeverage(leverage: number, symbol: string): Promise<void>;
  setMarginMode(marginMode: MarginModeEnum, symbol: string): Promise<void>;
  amountToPrecision(symbol: string, amount: number): number;
  priceToPrecision(symbol: string, price: number): number;
  getMinOrderQty(symbol: string): number;
  getMinNotional(symbol: string): number;
  fetchFundingInfo(symbol?: string): Promise<FundingInfo[]>;
  fetchPositionMode(): Promise<PositionModeEnum>;
  createOrderWebSocket(args: CreateOrderWebSocketArgs): Promise<Order>;
  fetchOrderHistory(symbol: string, options?: FetchPageWithLimitArgs): Promise<Order[]>;
  isTradeWebSocketConnected(): boolean;
  connectTradeWebSocket(): Promise<void>;
  getWebSocketConnectionInfoList(): WebSocketConnectionInfo[];
  close(): Promise<void>;

  cancelOrder(symbol: string, orderId: string): Promise<Order>;
  getOrder(symbol: string, orderId: string): Promise<Order>;
  fetchOpenOrders(symbol?: string): Promise<Order[]>;
  modifyOrder(args: ModifyOrderArgs): Promise<Order>;
  cancelAllOrders(symbol: string): Promise<void>;
  createBatchOrders(orderList: CreateOrderWebSocketArgs[]): Promise<Order[]>;
  cancelBatchOrders(symbol: string, orderIdList: string[]): Promise<void>;

  fetchOrderBook(symbol: string, limit?: number): Promise<OrderBook>;
  fetchTrades(symbol: string, limit?: number): Promise<PublicTrade[]>;
  fetchMarkPrice(symbol?: string): Promise<MarkPrice[]>;
  fetchOpenInterest(symbol: string): Promise<OpenInterest>;

  fetchFeeRate(symbol?: string): Promise<FeeRate[]>;
  fetchIncome(options?: FetchPageWithLimitArgs): Promise<Income[]>;
  fetchClosedPnl(symbol?: string, options?: FetchPageWithLimitArgs): Promise<ClosedPnl[]>;

  setPositionMode(mode: PositionModeEnum): Promise<void>;

  watchTickers(): AsyncGenerator<TickerBySymbol>;
  subscribeKlines(args: SubscribeKlinesArgs): void;
  unsubscribeKlines(args: SubscribeKlinesArgs): void;
}
