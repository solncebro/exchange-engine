import type { FetchPageWithLimitArgs } from '../types/exchange';

export function applyTimeRangeOptions(
  params: Record<string, string | number | boolean>,
  options?: FetchPageWithLimitArgs,
): void {
  if (options?.startTime !== undefined) {
    params.startTime = options.startTime;
  }

  if (options?.endTime !== undefined) {
    params.endTime = options.endTime;
  }

  if (options?.limit !== undefined) {
    params.limit = options.limit;
  }
}
