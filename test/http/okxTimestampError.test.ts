import { ExchangeError } from '../../src/errors/ExchangeError';
import { isOkxStaleTimestampError } from '../../src/http/okxTimestampError';

describe('isOkxStaleTimestampError', () => {
  it('recognizes an ExchangeError with code 50102', () => {
    const error = new ExchangeError('OKX API error 50102: Timestamp request expired.', 50102, 'OKX');

    expect(isOkxStaleTimestampError(error)).toBe(true);
  });

  it('recognizes an enriched Error message containing [50102]', () => {
    const error = new Error('[50102] Timestamp request expired.');

    expect(isOkxStaleTimestampError(error)).toBe(true);
  });

  it('does not recognize an ExchangeError with a different code', () => {
    const error = new ExchangeError('OKX API error 51000: Parameter posSide error', 51000, 'OKX');

    expect(isOkxStaleTimestampError(error)).toBe(false);
  });

  it('does not recognize an unrelated Error message', () => {
    const error = new Error('[51000] Parameter posSide error');

    expect(isOkxStaleTimestampError(error)).toBe(false);
  });

  it('does not recognize non-Error values', () => {
    expect(isOkxStaleTimestampError('50102')).toBe(false);
    expect(isOkxStaleTimestampError(undefined)).toBe(false);
    expect(isOkxStaleTimestampError(null)).toBe(false);
  });
});
