import {
  buildBinanceAuthHeaders,
  buildBinanceSignature,
  buildBinanceSignedParams,
  buildBinanceWebSocketSignedParams,
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

  afterEach(() => {
    jest.restoreAllMocks();
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

describe('buildBinanceWebSocketSignedParams', () => {
  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(1700000000000);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('sorts keys alphabetically and produces correct signature', () => {
    const result = buildBinanceWebSocketSignedParams({
      params: { z: 'value_z', a: 'value_a', m: 'value_m' },
      secret: 'testSecret',
    });

    expect(result.a).toBe('value_a');
    expect(result.m).toBe('value_m');
    expect(result.z).toBe('value_z');

    const sortedQueryString = 'a=value_a&m=value_m&recvWindow=5000&timestamp=1700000000000&z=value_z';
    const expectedSignature = hmacSha256(sortedQueryString, 'testSecret');
    expect(result.signature).toBe(expectedSignature);
  });

  it('produces different signature from REST for same params due to key ordering', () => {
    const params = { symbol: 'BTCUSDT', side: 'BUY', quantity: '0.1' };
    const secret = 'testSecret';

    const wsResult = buildBinanceWebSocketSignedParams({ params, secret });
    const restResult = buildBinanceSignedParams({ params, secret });

    // WS sorts alphabetically: quantity, recvWindow, side, symbol, timestamp
    // REST preserves insertion order: symbol, side, quantity, timestamp, recvWindow
    expect(wsResult.signature).not.toBe(restResult.signature);
  });

  it('includes timestamp, recvWindow, and signature in result', () => {
    const result = buildBinanceWebSocketSignedParams({
      params: { symbol: 'BTCUSDT' },
      secret: 'secret',
    });

    expect(result.timestamp).toBe(1700000000000);
    expect(result.recvWindow).toBe(5000);
    expect(result.signature).toBeDefined();
    expect(result.symbol).toBe('BTCUSDT');
  });

  it('preserves apiKey when provided in params', () => {
    const result = buildBinanceWebSocketSignedParams({
      params: { apiKey: 'myKey', symbol: 'ETHUSDT' },
      secret: 'secret',
    });

    expect(result.apiKey).toBe('myKey');
    expect(result.symbol).toBe('ETHUSDT');
  });
});
