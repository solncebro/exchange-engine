import {
  OKX_ALGO_HISTORY_ORD_TYPE_LIST,
  OKX_ALGO_TRAILING_ORD_TYPE,
  OKX_AMEND_ORDER_GONE_ERROR_CODE,
  OKX_CANCEL_ORDER_GONE_ERROR_CODE,
  OKX_CLIENT_ORDER_ID_PATTERN,
  OKX_EXPECTED_ERROR_CODE_LIST,
  OKX_KLINE_INTERVAL,
  OKX_KLINE_INTERVAL_MS,
  OKX_KLINE_INTERVAL_REVERSE,
  OKX_ORDER_NOT_FOUND_ERROR_CODE,
  OKX_PENDING_ALGO_ORD_TYPE_FILTER,
  OKX_SILENT_THRESHOLD_MS,
  OKX_STALE_THRESHOLD_MS,
} from '../../src/constants/okx';

describe('OKX_KLINE_INTERVAL / OKX_KLINE_INTERVAL_MS', () => {
  it('shares the same keys except 1M, which is only in OKX_KLINE_INTERVAL', () => {
    const intervalKeyList = Object.keys(OKX_KLINE_INTERVAL).sort();
    const intervalMsKeyList = Object.keys(OKX_KLINE_INTERVAL_MS).sort();

    expect(intervalKeyList).toContain('1M');
    expect(intervalMsKeyList).not.toContain('1M');
    expect(intervalKeyList.filter((key) => key !== '1M')).toEqual(intervalMsKeyList);
  });

  it('has only positive values divisible by 1000', () => {
    Object.values(OKX_KLINE_INTERVAL_MS).forEach((value) => {
      expect(value).toBeGreaterThan(0);
      expect(value % 1000).toBe(0);
    });
  });

  it('asks OKX for the UTC grid on every interval OKX cuts by UTC+8 by default', () => {
    expect(OKX_KLINE_INTERVAL['6h']).toBe('6Hutc');
    expect(OKX_KLINE_INTERVAL['12h']).toBe('12Hutc');
    expect(OKX_KLINE_INTERVAL['1d']).toBe('1Dutc');
    expect(OKX_KLINE_INTERVAL['3d']).toBe('3Dutc');
    expect(OKX_KLINE_INTERVAL['1w']).toBe('1Wutc');
    expect(OKX_KLINE_INTERVAL['1M']).toBe('1Mutc');
  });

  it('leaves the intervals of four hours and below alone, their grid divides eight hours evenly', () => {
    expect(OKX_KLINE_INTERVAL['1s']).toBe('1s');
    expect(OKX_KLINE_INTERVAL['30m']).toBe('30m');
    expect(OKX_KLINE_INTERVAL['1h']).toBe('1H');
    expect(OKX_KLINE_INTERVAL['4h']).toBe('4H');
  });

  it('translates every interval back to the unified key it came from', () => {
    Object.entries(OKX_KLINE_INTERVAL).forEach(([unified, okxInterval]) => {
      expect(OKX_KLINE_INTERVAL_REVERSE[okxInterval]).toBe(unified);
    });

    expect(Object.keys(OKX_KLINE_INTERVAL_REVERSE)).toHaveLength(Object.keys(OKX_KLINE_INTERVAL).length);
  });

  it('names the public stream candle channels OKX publishes on the UTC grid', () => {
    expect(`candle${OKX_KLINE_INTERVAL['1d']}`).toBe('candle1Dutc');
    expect(`candle${OKX_KLINE_INTERVAL['6h']}`).toBe('candle6Hutc');
    expect(`candle${OKX_KLINE_INTERVAL['1w']}`).toBe('candle1Wutc');
  });
});

describe('OKX_CLIENT_ORDER_ID_PATTERN', () => {
  it('accepts alphanumeric strings up to 32 characters', () => {
    expect(OKX_CLIENT_ORDER_ID_PATTERN.test('abc123')).toBe(true);
    expect(OKX_CLIENT_ORDER_ID_PATTERN.test('A1')).toBe(true);
    expect(OKX_CLIENT_ORDER_ID_PATTERN.test('a'.repeat(32))).toBe(true);
  });

  it('rejects empty strings, non-alphanumeric characters and strings over 32 characters', () => {
    expect(OKX_CLIENT_ORDER_ID_PATTERN.test('')).toBe(false);
    expect(OKX_CLIENT_ORDER_ID_PATTERN.test('a-b')).toBe(false);
    expect(OKX_CLIENT_ORDER_ID_PATTERN.test('a_b')).toBe(false);
    expect(OKX_CLIENT_ORDER_ID_PATTERN.test('a'.repeat(33))).toBe(false);
  });
});

describe('OKX_EXPECTED_ERROR_CODE_LIST', () => {
  it('is built from the named codes, so renaming a number cannot leave the list behind', () => {
    expect(OKX_EXPECTED_ERROR_CODE_LIST).toEqual([
      OKX_ORDER_NOT_FOUND_ERROR_CODE,
      OKX_CANCEL_ORDER_GONE_ERROR_CODE,
      OKX_AMEND_ORDER_GONE_ERROR_CODE,
    ]);
  });

  it('carries every named expected code and nothing else', () => {
    const namedCodeList = [OKX_ORDER_NOT_FOUND_ERROR_CODE, OKX_CANCEL_ORDER_GONE_ERROR_CODE, OKX_AMEND_ORDER_GONE_ERROR_CODE];

    namedCodeList.forEach((code) => expect(OKX_EXPECTED_ERROR_CODE_LIST).toContain(code));
    expect(OKX_EXPECTED_ERROR_CODE_LIST).toHaveLength(namedCodeList.length);
  });
});

/**
 * F3. Само ЧИСЛО порога немоты ничем не держалось: подмена на 61 с — всё ещё больше биржевых
 * шестидесяти секунд, но уже без двойного запаса — оставляла набор зелёным. Биржа подпирает
 * молчащую подписку сама: «If there are no updates to the depth for an extended period(Around 60
 * seconds) … OKX will send a message with 'asks': [], 'bids': [] to inform users that the
 * connection is still active»; индекс — «Push data every 100ms if there are any changes, otherwise
 * push once a minute».
 */
describe('OKX_SILENT_THRESHOLD_MS', () => {
  const OKX_DOCUMENTED_KEEPALIVE_INTERVAL_MS = 60000;

  it('keeps at least a double margin over the interval the exchange feeds a quiet subscription at', () => {
    expect(OKX_SILENT_THRESHOLD_MS).toBeGreaterThanOrEqual(2 * OKX_DOCUMENTED_KEEPALIVE_INTERVAL_MS);
  });

  it('stays a threshold of its own, above the one that judges a socket that answers nothing', () => {
    expect(OKX_SILENT_THRESHOLD_MS).toBeGreaterThan(OKX_STALE_THRESHOLD_MS);
  });
});

describe('OKX_ALGO_HISTORY_ORD_TYPE_LIST', () => {
  it('asks the same conditional order types the open list asks for', () => {
    expect(OKX_ALGO_HISTORY_ORD_TYPE_LIST).toEqual([OKX_PENDING_ALGO_ORD_TYPE_FILTER, OKX_ALGO_TRAILING_ORD_TYPE]);
  });
});
