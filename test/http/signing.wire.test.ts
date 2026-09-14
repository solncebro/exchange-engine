import axios from 'axios';
import { buildBinanceSignedParams } from '../../src/auth/binanceAuth';
import { serializeQueryParams } from '../../src/utils/serializeQueryParams';

describe('signed request wire-format parity', () => {
  const batchOrders = JSON.stringify([
    { symbol: 'BTCUSDT', side: 'BUY', type: 'LIMIT', quantity: '0.001', price: '50000' },
  ]);

  it('serializeQueryParams percent-encodes comma and colon', () => {
    const serialized = serializeQueryParams({ batchOrders });

    expect(serialized).toContain('%2C');
    expect(serialized).toContain('%3A');
    expect(serialized).not.toContain(',');
    expect(serialized).not.toContain(':');
  });

  it('axios sends the exact query string that was HMAC-signed for a batch payload', () => {
    const signed = buildBinanceSignedParams({ params: { batchOrders }, secret: 'testSecret' });
    const signedString = serializeQueryParams(signed);

    const instance = axios.create({ paramsSerializer: { serialize: serializeQueryParams } });
    const uri = instance.getUri({ url: '/fapi/v1/batchOrders', params: signed });
    const wireQuery = uri.slice(uri.indexOf('?') + 1);

    expect(wireQuery).toBe(signedString);
  });

  it('default axios serializer diverges from the signed string (the original -1022 cause)', () => {
    const signed = buildBinanceSignedParams({ params: { batchOrders }, secret: 'testSecret' });
    const signedString = serializeQueryParams(signed);

    const defaultInstance = axios.create();
    const uri = defaultInstance.getUri({ url: '/fapi/v1/batchOrders', params: signed });
    const wireQuery = uri.slice(uri.indexOf('?') + 1);

    expect(wireQuery).not.toBe(signedString);
    expect(wireQuery).toContain(',');
  });
});

describe('OKX signed GET requestPath parity', () => {
  it('matches the query string axios actually sends for a signed GET', () => {
    const params = { instType: 'SWAP', instId: 'BTC-USDT-SWAP', after: '1700000000000' };
    const requestPath = `/api/v5/trade/orders-pending?${serializeQueryParams(params)}`;

    const instance = axios.create({ paramsSerializer: { serialize: serializeQueryParams } });
    const uri = instance.getUri({ url: '/api/v5/trade/orders-pending', params });

    expect(uri).toBe(requestPath);
  });
});
