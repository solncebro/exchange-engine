import type { BybitOrderResponseRaw } from '../normalizers/bybitNormalizer';
import type { ExchangeLogger } from '../types/common';
import type { FetchPageWithLimitArgs } from '../types/exchange';

export type { FetchPageWithLimitArgs };

export interface BybitHttpClientArgs {
  baseUrl: string;
  apiKey: string;
  secret: string;
  logger: ExchangeLogger;
  httpsAgent?: unknown;
}

export interface SymbolFilterArgs {
  symbol?: string;
}

export interface SymbolLimitFilterArgs {
  symbol?: string;
  limit?: number;
  orderId?: string;
  orderLinkId?: string;
  settleCoin?: string;
  baseCoin?: string;
  orderFilter?: string;
}

export interface PeriodFilterArgs {
  period?: string;
  limit?: number;
}

export interface CategoryFilterArgs {
  category?: string;
  limit?: number;
}

export interface FetchTransactionLogArgs extends CategoryFilterArgs {
  startTime?: number;
  endTime?: number;
}

export interface FetchBybitKlineArgs {
  category: string;
  symbol: string;
  interval: string;
  options?: FetchPageWithLimitArgs;
}

export interface SetBybitLeverageArgs {
  category: string;
  symbol: string;
  buyLeverage: number;
  sellLeverage: number;
}

export interface SwitchBybitIsolatedArgs {
  category: string;
  symbol: string;
  tradeMode: number;
  buyLeverage: number;
  sellLeverage: number;
}

export interface BybitListResult<T> {
  list: T[];
  nextPageCursor?: string;
}

export interface BybitListResponse<T> {
  result: BybitListResult<T>;
}

export interface BybitCancelBatchOrderRaw {
  category?: string;
  symbol?: string;
  orderId?: string;
  orderLinkId?: string;
}

export interface BybitCancelBatchOrderExtInfo {
  code: number;
  msg: string;
}

export interface BybitCancelBatchOrdersResponse {
  result: BybitListResult<BybitCancelBatchOrderRaw>;
  retExtInfo: {
    list: BybitCancelBatchOrderExtInfo[];
  };
}

export interface BybitAmendBatchOrderRaw {
  category?: string;
  symbol?: string;
  orderId?: string;
  orderLinkId?: string;
}

export interface BybitAmendBatchOrderExtInfo {
  code: number;
  msg: string;
}

export interface BybitAmendBatchOrdersResponse {
  result: BybitListResult<BybitAmendBatchOrderRaw>;
  retExtInfo: {
    list: BybitAmendBatchOrderExtInfo[];
  };
}

export interface BybitResponse<T> {
  result: T;
}

export interface BybitOrderBookRaw {
  a: string[][];
  b: string[][];
  ts: number;
  u: number;
}

export interface BybitApiResponse {
  retCode: number;
  retMsg: string;
}

export interface BybitCreateOrderApiResponse {
  retCode: number;
  retMsg: string;
  result: BybitOrderResponseRaw;
}

export interface BybitCancelOrderResult {
  orderId: string;
  orderLinkId: string;
}
