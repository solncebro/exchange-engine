import type { ExchangeLogger } from '../types/common';

/** Отказ ОБЕИХ служб — обычной книги и условной — по одной и той же заявке. */
export interface TwoServiceOrderFailure {
  exchangeLabel: string;
  logger: ExchangeLogger;
  symbol: string;
  orderId: string;
  action: string;
  errorList: unknown[];
  missingOrderError: unknown;
  isMissingOrderError: (error: unknown) => boolean;
}
