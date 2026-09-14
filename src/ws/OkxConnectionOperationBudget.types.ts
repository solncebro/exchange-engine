import type { ExchangeLogger } from '../types/common';

export interface OkxConnectionOperationBudgetArgs {
  label: string;
  logger: ExchangeLogger;
  limitPerWindow: number;
  windowMs: number;
  warnRatio: number;
}
