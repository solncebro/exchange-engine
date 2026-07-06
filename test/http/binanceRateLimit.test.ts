import {
  BINANCE_BAN_DEFAULT_COOLDOWN_MS,
  BINANCE_BAN_MAX_COOLDOWN_MS,
  BINANCE_WEIGHT_NEAR_CAP_COOLDOWN_MS,
  parseRetryAfterMs,
  parseUsedWeight1m,
  resolveRateLimitCooldownMs,
} from '../../src/http/binanceRateLimit';

describe('parseUsedWeight1m', () => {
  it('reads the x-mbx-used-weight-1m header as a number', () => {
    expect(parseUsedWeight1m({ 'x-mbx-used-weight-1m': '1500' })).toBe(1500);
  });

  it('returns undefined when the header is absent (non-Binance response)', () => {
    expect(parseUsedWeight1m({ 'content-type': 'application/json' })).toBeUndefined();
    expect(parseUsedWeight1m(undefined)).toBeUndefined();
  });

  it('returns undefined for a non-numeric header', () => {
    expect(parseUsedWeight1m({ 'x-mbx-used-weight-1m': 'oops' })).toBeUndefined();
  });
});

describe('parseRetryAfterMs', () => {
  it('reads retry-after seconds as milliseconds', () => {
    expect(parseRetryAfterMs({ 'retry-after': '120' })).toBe(120000);
  });

  it('returns undefined when absent', () => {
    expect(parseRetryAfterMs({})).toBeUndefined();
  });
});

describe('resolveRateLimitCooldownMs', () => {
  it('returns no cooldown for a healthy response well under the weight cap', () => {
    expect(resolveRateLimitCooldownMs({ status: 200, usedWeight: 100, retryAfterMs: undefined })).toBe(0);
  });

  it('throttles when used weight reaches 80% of the 2400/min cap (>= 1920)', () => {
    expect(resolveRateLimitCooldownMs({ status: 200, usedWeight: 1920, retryAfterMs: undefined })).toBe(BINANCE_WEIGHT_NEAR_CAP_COOLDOWN_MS);
    expect(resolveRateLimitCooldownMs({ status: 200, usedWeight: 1919, retryAfterMs: undefined })).toBe(0);
  });

  it('backs off on HTTP 418 using Retry-After (bounded by the max cooldown)', () => {
    expect(resolveRateLimitCooldownMs({ status: 418, usedWeight: undefined, retryAfterMs: 45000 })).toBe(45000);
  });

  it('caps an enormous 418 ban backoff so the client is not blocked for days', () => {
    const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
    expect(resolveRateLimitCooldownMs({ status: 418, usedWeight: undefined, retryAfterMs: threeDaysMs })).toBe(BINANCE_BAN_MAX_COOLDOWN_MS);
  });

  it('uses a default backoff on 418 when Retry-After is missing', () => {
    expect(resolveRateLimitCooldownMs({ status: 418, usedWeight: undefined, retryAfterMs: undefined })).toBe(BINANCE_BAN_DEFAULT_COOLDOWN_MS);
  });
});
