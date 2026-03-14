import type { ExchangeLogger } from '../types/common';

export interface BaseHttpClientArgs {
  baseUrl: string;
  apiKey: string;
  logger: ExchangeLogger;
  timeout?: number;
  httpsAgent?: unknown;
}
