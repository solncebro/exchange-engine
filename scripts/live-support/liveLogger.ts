import type { ExchangeLogger } from '../../src/types/common';
import type { LiveLoggerArgs } from './liveLogger.types';
import { formatPayload, redactText } from './liveOutput';

function formatLogLine(first: Record<string, unknown> | string, restList: unknown[]): string {
  if (typeof first === 'string') {
    if (restList.length === 0) {
      return first;
    }

    return `${first} ${restList.map(formatPayload).join(' ')}`;
  }

  const message = restList.length > 0 ? formatPayload(restList[0]) : '';

  return `${message} ${formatPayload(first)}`;
}

export function createLiveLogger(args: LiveLoggerArgs): ExchangeLogger {
  const write = (level: string, first: Record<string, unknown> | string, restList: unknown[]): void => {
    const text = redactText(formatLogLine(first, restList));

    args.recordList.push({ level, text });

    if (args.isVerbose) {
      console.log(`      [${level}] ${text}`);
    }
  };

  return {
    debug: (first: Record<string, unknown> | string, ...restList: unknown[]): void => write('debug', first, restList),
    info: (first: Record<string, unknown> | string, ...restList: unknown[]): void => write('info', first, restList),
    warn: (first: Record<string, unknown> | string, ...restList: unknown[]): void => write('warn', first, restList),
    error: (first: Record<string, unknown> | string, ...restList: unknown[]): void => write('error', first, restList),
    fatal: (first: Record<string, unknown> | string, ...restList: unknown[]): void => write('fatal', first, restList),
  };
}
