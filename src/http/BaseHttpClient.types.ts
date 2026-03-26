import type { ExchangeLogger } from '../types/common';

export interface BaseHttpClientArgs {
  baseUrl: string;
  apiKey: string;
  logger: ExchangeLogger;
  timeout?: number;
  httpsAgent?: unknown;
}

export interface HttpErrorResponseData {
  code?: unknown;
  msg?: unknown;
}

export interface HttpRecord {
  [key: string]: unknown;
}

export interface HttpQueryParams {
  [key: string]: string | number | boolean;
}

export interface HttpHeaders {
  [key: string]: string;
}
