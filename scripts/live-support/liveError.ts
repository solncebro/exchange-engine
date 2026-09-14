import { ExchangeError } from '../../src/errors/ExchangeError';

export function describeError(error: unknown): string {
  if (error instanceof ExchangeError) {
    return `код ${String(error.code)}: ${error.message}`;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

export function toErrorCode(error: unknown): string {
  return error instanceof ExchangeError ? String(error.code) : '';
}
