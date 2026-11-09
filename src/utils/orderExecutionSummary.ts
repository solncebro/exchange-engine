import type { OrderExecutionSummary } from '../types/common';
import type { FetchOrderExecutionSummaryArgs } from '../types/exchange';
import type { OrderExecutionEntry, OrderExecutionWindow, SummarizeOrderExecutionArgs } from './orderExecutionSummary.types';

const HISTORY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_WINDOW_COUNT = 366;

function buildOrderExecutionWindowList(args: FetchOrderExecutionSummaryArgs): OrderExecutionWindow[] {
  if (!args.symbol.trim() || !args.orderId.trim() || !Number.isSafeInteger(args.startTime) || !Number.isSafeInteger(args.endTime) || args.startTime < 0 || args.endTime < args.startTime || args.endTime - args.startTime >= HISTORY_WINDOW_MS * MAX_WINDOW_COUNT) {
    throw new Error('Invalid order execution history window');
  }

  const windowList: OrderExecutionWindow[] = [];

  for (let startTime = args.startTime; startTime <= args.endTime; startTime += HISTORY_WINDOW_MS) {
    windowList.push({ startTime, endTime: Math.min(args.endTime, startTime + HISTORY_WINDOW_MS - 1) });
  }

  return windowList;
}

function summarizeOrderExecutionList(args: SummarizeOrderExecutionArgs): OrderExecutionSummary {
  const executionById = new Map<string, OrderExecutionEntry>();
  let filledAmount = 0;
  let quoteAmount = 0;
  const feeAmountByAsset = new Map<string, number>();
  let firstFillTimeMs: number | null = null;
  let lastFillTimeMs: number | null = null;

  for (const entry of args.executionList) {
    if (!Number.isFinite(entry.price) || entry.price <= 0 || !Number.isFinite(entry.quoteAmount) || entry.quoteAmount <= 0 || (entry.feeAmount !== null && !Number.isFinite(entry.feeAmount)) || !entry.id || entry.orderId !== args.orderId || entry.symbol !== args.symbol || !Number.isFinite(entry.amount) || entry.amount <= 0 || !Number.isSafeInteger(entry.timeMs) || entry.timeMs < args.startTime || entry.timeMs > args.endTime) {
      throw new Error('Unconfirmed order execution record');
    }

    const previous = executionById.get(entry.id);

    if (previous) {
      if (previous.amount !== entry.amount || previous.timeMs !== entry.timeMs || previous.price !== entry.price || previous.quoteAmount !== entry.quoteAmount || previous.feeAmount !== entry.feeAmount || previous.feeAsset !== entry.feeAsset) throw new Error('Conflicting order execution records');

      continue;
    }

    executionById.set(entry.id, entry);
    filledAmount += entry.amount;
    quoteAmount += entry.quoteAmount;

    if (entry.feeAmount !== null && entry.feeAsset !== null) {
      feeAmountByAsset.set(entry.feeAsset, (feeAmountByAsset.get(entry.feeAsset) ?? 0) + entry.feeAmount);
    }
    firstFillTimeMs = Math.min(firstFillTimeMs ?? entry.timeMs, entry.timeMs);
    lastFillTimeMs = Math.max(lastFillTimeMs ?? 0, entry.timeMs);
  }

  if (!Number.isFinite(filledAmount) || !Number.isFinite(quoteAmount) || [...feeAmountByAsset.values()].some(amount => !Number.isFinite(amount))) throw new Error('Invalid total order execution amount');

  const executionList = [...executionById.values()].map(entry => ({ executionId: entry.id, orderId: entry.orderId, amount: entry.amount, price: entry.price, quoteAmount: entry.quoteAmount, feeAmount: entry.feeAmount, feeAsset: entry.feeAsset, timestamp: entry.timeMs }));

  return { filledAmount, firstFillTimeMs, lastFillTimeMs, executionList, quoteAmount, averagePrice: filledAmount > 0 ? quoteAmount / filledAmount : null, feeAmountByAsset: Object.fromEntries(feeAmountByAsset) };
}

export { buildOrderExecutionWindowList, summarizeOrderExecutionList };
