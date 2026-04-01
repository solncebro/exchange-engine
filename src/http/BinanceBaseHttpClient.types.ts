import type { ExchangeLogger } from '../types/common';

export interface BinanceErrorResponse {
  code: number;
  msg: string;
}

export interface BinanceHttpClientArgs {
  baseUrl: string;
  apiKey: string;
  secret: string;
  logger: ExchangeLogger;
  httpsAgent?: unknown;
}

export interface BinanceListenKeyResponse {
  listenKey: string;
}

export interface BinanceEndpoints {
  exchangeInfo: string;
  ticker24hr: string;
  depth: string;
  klines: string;
  trades: string;
  order: string;
  openOrders: string;
  allOrders: string;
  account: string;
  listenKey: string;
}

export interface SignRequestResult {
  signedParams: Record<string, string | number | boolean>;
  headers: Record<string, string>;
}
