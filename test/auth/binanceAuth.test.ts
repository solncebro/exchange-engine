import {
  buildBinanceSignature,
  buildBinanceSignedParams,
  buildBinanceAuthHeaders,
} from '../../src/auth/binanceAuth';
import { hmacSha256 } from '../../src/utils/crypto';

describe('buildBinanceSignature', () => {
  it('returns HMAC-SHA256 of query string', () => {
    const queryString = 'symbol=BTCUSDT&side=BUY';
    const secret = 'testSecret';
    const expected = hmacSha256(queryString, secret);

    expect(buildBinanceSignature(queryString, secret)).toBe(expected);
  });

  it('produces hex string of 64 characters', () => {
    const result = buildBinanceSignature('data', 'secret');

    expect(result).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('buildBinanceSignedParams', () => {
  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(1700000000000);
  });

  it('adds timestamp to params', () => {
    const result = buildBinanceSignedParams({ params: { symbol: 'BTCUSDT' }, secret: 'secret' });

    expect(result.timestamp).toBe(1700000000000);
  });

  it('uses default recvWindow of 5000', () => {
    const result = buildBinanceSignedParams({ params: {}, secret: 'secret' });

    expect(result.recvWindow).toBe(5000);
  });

  it('uses custom recvWindow when provided', () => {
    const result = buildBinanceSignedParams({ params: {}, secret: 'secret', recvWindow: 10000 });

    expect(result.recvWindow).toBe(10000);
  });

  it('adds signature to params', () => {
    const result = buildBinanceSignedParams({ params: { symbol: 'BTCUSDT' }, secret: 'secret' });

    expect(result.signature).toBeDefined();
    expect(typeof result.signature).toBe('string');
  });

  it('preserves original params', () => {
    const result = buildBinanceSignedParams({ params: { symbol: 'BTCUSDT', side: 'BUY' }, secret: 'secret' });

    expect(result.symbol).toBe('BTCUSDT');
    expect(result.side).toBe('BUY');
  });

  it('signature matches manual computation', () => {
    const params = { symbol: 'BTCUSDT' };
    const secret = 'testSecret';
    const result = buildBinanceSignedParams({ params, secret });

    const queryString = new URLSearchParams(
      Object.entries({ symbol: 'BTCUSDT', timestamp: '1700000000000', recvWindow: '5000' }),
    ).toString();
    const expectedSignature = hmacSha256(queryString, secret);

    expect(result.signature).toBe(expectedSignature);
  });
});

describe('buildBinanceAuthHeaders', () => {
  it('returns X-MBX-APIKEY header', () => {
    const result = buildBinanceAuthHeaders('myApiKey');

    expect(result).toEqual({ 'X-MBX-APIKEY': 'myApiKey' });
  });
});
