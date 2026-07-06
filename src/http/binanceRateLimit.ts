export const BINANCE_REQUEST_WEIGHT_LIMIT_PER_MIN = 2400;
export const BINANCE_WEIGHT_THROTTLE_RATIO = 0.8;
export const BINANCE_WEIGHT_NEAR_CAP_COOLDOWN_MS = 2000;
export const BINANCE_BAN_DEFAULT_COOLDOWN_MS = 30000;
export const BINANCE_BAN_MAX_COOLDOWN_MS = 60000;

const USED_WEIGHT_HEADER = 'x-mbx-used-weight-1m';
const RETRY_AFTER_HEADER = 'retry-after';
const HTTP_STATUS_IP_BANNED = 418;

function readHeader(headers: unknown, name: string): string | undefined {
  if (!headers || typeof headers !== 'object') {
    return undefined;
  }

  const value = (headers as Record<string, unknown>)[name];

  if (value === undefined || value === null) {
    return undefined;
  }

  return String(value);
}

export function parseUsedWeight1m(headers: unknown): number | undefined {
  const raw = readHeader(headers, USED_WEIGHT_HEADER);

  if (raw === undefined) {
    return undefined;
  }

  const value = Number(raw);

  return Number.isFinite(value) ? value : undefined;
}

export function parseRetryAfterMs(headers: unknown): number | undefined {
  const raw = readHeader(headers, RETRY_AFTER_HEADER);

  if (raw === undefined) {
    return undefined;
  }

  const seconds = Number(raw);

  return Number.isFinite(seconds) ? seconds * 1000 : undefined;
}

interface ResolveRateLimitCooldownArgs {
  status: number | undefined;
  usedWeight: number | undefined;
  retryAfterMs: number | undefined;
}

export function resolveRateLimitCooldownMs(args: ResolveRateLimitCooldownArgs): number {
  if (args.status === HTTP_STATUS_IP_BANNED) {
    const banMs = args.retryAfterMs ?? BINANCE_BAN_DEFAULT_COOLDOWN_MS;

    return Math.min(banMs, BINANCE_BAN_MAX_COOLDOWN_MS);
  }

  const throttleThreshold = BINANCE_REQUEST_WEIGHT_LIMIT_PER_MIN * BINANCE_WEIGHT_THROTTLE_RATIO;

  if (args.usedWeight !== undefined && args.usedWeight >= throttleThreshold) {
    return BINANCE_WEIGHT_NEAR_CAP_COOLDOWN_MS;
  }

  return 0;
}
