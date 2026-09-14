import { ExchangeError } from '../errors/ExchangeError';
import { OKX_STALE_TIMESTAMP_ERROR_CODE } from '../constants/okx';

export function isOkxStaleTimestampError(error: unknown): boolean {
  if (error instanceof ExchangeError) {
    return error.code === OKX_STALE_TIMESTAMP_ERROR_CODE;
  }

  if (error instanceof Error) {
    return error.message.includes(`[${OKX_STALE_TIMESTAMP_ERROR_CODE}]`);
  }

  return false;
}
