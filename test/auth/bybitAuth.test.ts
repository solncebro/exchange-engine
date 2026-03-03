import { buildBybitAuthHeaders } from '../../src/auth/bybitAuth';
import { hmacSha256 } from '../../src/utils/crypto';

describe('buildBybitAuthHeaders', () => {
  const apiKey = 'testApiKey';
  const secret = 'testSecret';
  const timestamp = 1700000000000;
  const payload = '{"symbol":"BTCUSDT"}';

  it('returns 4 headers', () => {
    const result = buildBybitAuthHeaders({ apiKey, secret, timestamp, payload });

    expect(Object.keys(result)).toHaveLength(4);
  });

  it('sets X-BAPI-API-KEY', () => {
    const result = buildBybitAuthHeaders({ apiKey, secret, timestamp, payload });

    expect(result['X-BAPI-API-KEY']).toBe(apiKey);
  });

  it('sets X-BAPI-TIMESTAMP as string', () => {
    const result = buildBybitAuthHeaders({ apiKey, secret, timestamp, payload });

    expect(result['X-BAPI-TIMESTAMP']).toBe('1700000000000');
  });

  it('uses default recvWindow of 5000', () => {
    const result = buildBybitAuthHeaders({ apiKey, secret, timestamp, payload });

    expect(result['X-BAPI-RECV-WINDOW']).toBe('5000');
  });

  it('computes correct SIGN', () => {
    const recvWindow = 5000;
    const signPayload = `${timestamp}${apiKey}${recvWindow}${payload}`;
    const expectedSign = hmacSha256(signPayload, secret);

    const result = buildBybitAuthHeaders({ apiKey, secret, timestamp, payload });

    expect(result['X-BAPI-SIGN']).toBe(expectedSign);
  });

  it('uses custom recvWindow', () => {
    const result = buildBybitAuthHeaders({ apiKey, secret, timestamp, payload, recvWindow: 10000 });

    expect(result['X-BAPI-RECV-WINDOW']).toBe('10000');
  });
});
