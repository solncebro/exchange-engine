import type { OrderRateLimitSource } from '../../src/types/exchange';
import { formatNumber } from './checkSupport';
import type { LiveCheck, LiveCheckContext, LiveCheckOutcome } from './liveCheck.types';

const TIMEOUT_MS = 60_000;
const KNOWN_SOURCE_LIST: readonly OrderRateLimitSource[] = [
  'binance-exchange-info',
  'bybit-exchange-header',
  'bybit-documented',
  'okx-documented',
  'fallback',
];

async function checkOrderRateLimit(context: LiveCheckContext): Promise<LiveCheckOutcome> {
  const orderRateLimit = await context.exchange.futures.getOrderRateLimit();
  const summaryText = `предел ${formatNumber(orderRateLimit.writeRequestsPerSecond)} заявок в секунду, источник '${orderRateLimit.source}'`;

  if (!Number.isFinite(orderRateLimit.writeRequestsPerSecond) || orderRateLimit.writeRequestsPerSecond <= 0) {
    return { status: 'diverged', fact: `${summaryText}; предел не больше нуля` };
  }

  if (!KNOWN_SOURCE_LIST.includes(orderRateLimit.source)) {
    return { status: 'diverged', fact: `${summaryText}; источник не из перечисления` };
  }

  return { status: 'confirmed', fact: summaryText };
}

export const orderRateLimitCheck: LiveCheck = {
  title: 'Предел частоты заявок (контракты): больше нуля, источник назван',
  timeoutMs: TIMEOUT_MS,
  isCredentialsRequired: false,
  isOrdersRequired: false,
  run: checkOrderRateLimit,
};
