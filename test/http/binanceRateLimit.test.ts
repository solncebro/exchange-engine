import {
  BINANCE_BAN_DEFAULT_COOLDOWN_MS,
  BINANCE_WEIGHT_NEAR_CAP_COOLDOWN_MS,
  observeRateLimitResponse,
  parseBinanceBanUntilMs,
  parseRetryAfterMs,
  parseUsedWeight1m,
} from '../../src/http/binanceRateLimit';

const NOW_MS = 1_757_000_000_000;

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

describe('parseBinanceBanUntilMs', () => {
  it('reads the deadline the exchange names in the -1003 message', () => {
    const body = {
      code: -1003,
      msg: 'Way too many requests; current limit is 2400 request weight per 1 MINUTE. Please use WebSocket Streams for live updates to avoid polling the API. IP banned until 1757000480000. Please use WebSocket Streams for live updates.',
    };

    expect(parseBinanceBanUntilMs(body)).toBe(1757000480000);
  });

  it('returns undefined for any other error body', () => {
    expect(parseBinanceBanUntilMs({ code: -2013, msg: 'Order does not exist' })).toBeUndefined();
    expect(parseBinanceBanUntilMs({})).toBeUndefined();
    expect(parseBinanceBanUntilMs(undefined)).toBeUndefined();
  });
});

describe('observeRateLimitResponse', () => {
  it('sees no stop at all on a healthy response well under the weight cap', () => {
    const observation = observeRateLimitResponse({
      status: 200,
      headers: { 'x-mbx-used-weight-1m': '100' },
      body: [],
      nowMs: NOW_MS,
    });

    expect(observation).toEqual({ usedWeight: 100, banUntilMs: undefined, throttleUntilMs: undefined });
  });

  it('throttles when used weight reaches 80% of the 2400/min cap (>= 1920)', () => {
    const nearCap = observeRateLimitResponse({ status: 200, headers: { 'x-mbx-used-weight-1m': '1920' }, body: [], nowMs: NOW_MS });
    const belowCap = observeRateLimitResponse({ status: 200, headers: { 'x-mbx-used-weight-1m': '1919' }, body: [], nowMs: NOW_MS });

    expect(nearCap.throttleUntilMs).toBe(NOW_MS + BINANCE_WEIGHT_NEAR_CAP_COOLDOWN_MS);
    expect(belowCap.throttleUntilMs).toBeUndefined();
  });

  it('holds every request until the deadline the 418 body names — not for a minute', () => {
    const bannedUntilMs = NOW_MS + 8 * 60 * 1000;
    const observation = observeRateLimitResponse({
      status: 418,
      headers: {},
      body: { code: -1003, msg: `Way too many requests; IP banned until ${bannedUntilMs}.` },
      nowMs: NOW_MS,
    });

    expect(observation.banUntilMs).toBe(bannedUntilMs);
  });

  it('takes the LATER of the two deadlines the exchange names', () => {
    const bodyDeadlineMs = NOW_MS + 8 * 60 * 1000;
    const later = observeRateLimitResponse({
      status: 418,
      headers: { 'retry-after': '60' },
      body: { code: -1003, msg: `IP banned until ${bodyDeadlineMs}.` },
      nowMs: NOW_MS,
    });
    const headerWins = observeRateLimitResponse({
      status: 418,
      headers: { 'retry-after': '900' },
      body: { code: -1003, msg: `IP banned until ${NOW_MS + 60_000}.` },
      nowMs: NOW_MS,
    });

    expect(later.banUntilMs).toBe(bodyDeadlineMs);
    expect(headerWins.banUntilMs).toBe(NOW_MS + 900_000);
  });

  it('treats 429 as a closed door too — it is the warning that comes before the ban', () => {
    const observation = observeRateLimitResponse({ status: 429, headers: { 'retry-after': '5' }, body: {}, nowMs: NOW_MS });

    expect(observation.banUntilMs).toBe(NOW_MS + 5000);
  });

  it('falls back to a default wait when the refusal names no deadline at all', () => {
    const observation = observeRateLimitResponse({ status: 418, headers: {}, body: {}, nowMs: NOW_MS });

    expect(observation.banUntilMs).toBe(NOW_MS + BINANCE_BAN_DEFAULT_COOLDOWN_MS);
  });

  it('sees the ban in the body even when the status says nothing about it', () => {
    const bannedUntilMs = NOW_MS + 120_000;
    const observation = observeRateLimitResponse({
      status: 400,
      headers: {},
      body: { code: -1003, msg: `IP banned until ${bannedUntilMs}.` },
      nowMs: NOW_MS,
    });

    expect(observation.banUntilMs).toBe(bannedUntilMs);
  });
});
