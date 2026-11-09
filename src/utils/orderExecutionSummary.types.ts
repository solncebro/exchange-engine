import type { FetchOrderExecutionSummaryArgs } from '../types/exchange';

export interface OrderExecutionEntry {
  id: string;
  orderId: string;
  symbol: string;
  amount: number;
  timeMs: number;
  price: number;
  quoteAmount: number;
  feeAmount: number | null;
  feeAsset: string | null;
}

export interface OrderExecutionWindow {
  startTime: number;
  endTime: number;
}

export interface SummarizeOrderExecutionArgs extends FetchOrderExecutionSummaryArgs {
  executionList: OrderExecutionEntry[];
}
