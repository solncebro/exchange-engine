import { buildOkxAuthHeaders, buildOkxRestTimestamp, buildOkxWebSocketLoginArgs } from '../../src/auth/okxAuth';

describe('buildOkxAuthHeaders', () => {
  const apiKey = 'testApiKey';
  const secret = 'testSecret';
  const passphrase = 'testPassphrase';
  const timestamp = '2020-12-08T09:08:57.715Z';

  it('returns 4 headers', () => {
    const result = buildOkxAuthHeaders({ apiKey, secret, passphrase, method: 'GET', requestPath: '/api/v5/account/balance?ccy=BTC', timestamp });

    expect(Object.keys(result)).toHaveLength(4);
  });

  it('sets OK-ACCESS-KEY to apiKey', () => {
    const result = buildOkxAuthHeaders({ apiKey, secret, passphrase, method: 'GET', requestPath: '/api/v5/account/balance?ccy=BTC', timestamp });

    expect(result['OK-ACCESS-KEY']).toBe(apiKey);
  });

  it('sets OK-ACCESS-PASSPHRASE to passphrase', () => {
    const result = buildOkxAuthHeaders({ apiKey, secret, passphrase, method: 'GET', requestPath: '/api/v5/account/balance?ccy=BTC', timestamp });

    expect(result['OK-ACCESS-PASSPHRASE']).toBe(passphrase);
  });

  it('sets OK-ACCESS-TIMESTAMP to the passed timestamp as is', () => {
    const result = buildOkxAuthHeaders({ apiKey, secret, passphrase, method: 'GET', requestPath: '/api/v5/account/balance?ccy=BTC', timestamp });

    expect(result['OK-ACCESS-TIMESTAMP']).toBe(timestamp);
  });

  it('computes correct sign for GET request', () => {
    const result = buildOkxAuthHeaders({ apiKey, secret, passphrase, method: 'GET', requestPath: '/api/v5/account/balance?ccy=BTC', timestamp });

    expect(result['OK-ACCESS-SIGN']).toBe('HfaUnzuQblZ+1rEdG2bDItEs5nYrHHfHAVJEvZMlfGw=');
  });

  it('computes correct sign for POST request with body', () => {
    const body = '{"instId":"BTC-USDT","tdMode":"cash","side":"buy","ordType":"market","sz":"1"}';

    const result = buildOkxAuthHeaders({ apiKey, secret, passphrase, method: 'POST', requestPath: '/api/v5/trade/order', body, timestamp });

    expect(result['OK-ACCESS-SIGN']).toBe('4uxCxVQepKi2UKJIxmBJFYCj1TJuygq5NTP6W79UvfI=');
  });
});

describe('buildOkxRestTimestamp', () => {
  it('formats a timestamp in milliseconds as ISO 8601 UTC', () => {
    const result = buildOkxRestTimestamp(1607418537715);

    expect(result).toBe('2020-12-08T09:08:57.715Z');
  });
});

describe('buildOkxWebSocketLoginArgs', () => {
  const apiKey = 'testApiKey';
  const secret = 'testSecret';
  const passphrase = 'testPassphrase';
  const timestampSeconds = '1538054050';

  it('computes correct sign', () => {
    const result = buildOkxWebSocketLoginArgs({ apiKey, secret, passphrase, timestampSeconds });

    expect(result.sign).toBe('gTyhF/N0xEWsnjcjrIg7AnNJwqdkcUuj+EUVPT84cS8=');
  });

  it('returns exactly apiKey, passphrase, timestamp and sign', () => {
    const result = buildOkxWebSocketLoginArgs({ apiKey, secret, passphrase, timestampSeconds });

    expect(Object.keys(result).sort()).toEqual(['apiKey', 'passphrase', 'sign', 'timestamp'].sort());
    expect(result.apiKey).toBe(apiKey);
    expect(result.passphrase).toBe(passphrase);
    expect(result.timestamp).toBe(timestampSeconds);
  });
});
