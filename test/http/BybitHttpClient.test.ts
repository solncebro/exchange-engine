import axios from 'axios';
import { BybitHttpClient } from '../../src/http/BybitHttpClient';
import { createMockLogger } from '../fixtures/mockLogger';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('BybitHttpClient', () => {
  let client: BybitHttpClient;
  let mockInstance: Record<string, jest.Mock>;

  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(1700000000000);

    mockInstance = {
      get: jest.fn().mockResolvedValue({ data: {} }),
      post: jest.fn().mockResolvedValue({ data: {} }),
      put: jest.fn().mockResolvedValue({ data: {} }),
      delete: jest.fn().mockResolvedValue({ data: {} }),
    };
    mockedAxios.create.mockReturnValue(mockInstance as any);

    client = new BybitHttpClient({
      baseUrl: 'https://api.bybit.com',
      apiKey: 'testKey',
      secret: 'testSecret',
      logger: createMockLogger(),
    });
  });

  describe('authenticatedGet', () => {
    it('builds auth headers from query string', async () => {
      await client.fetchInstrumentsInfo('linear');

      const [url, options] = mockInstance.get.mock.calls[0];

      expect(url).toBe('/v5/market/instruments-info');
      expect(options.params.category).toBe('linear');
      expect(options.headers['X-BAPI-API-KEY']).toBe('testKey');
      expect(options.headers['X-BAPI-SIGN']).toBeDefined();
      expect(options.headers['X-BAPI-TIMESTAMP']).toBe('1700000000000');
    });
  });

  describe('authenticatedPost', () => {
    it('builds auth headers from JSON body', async () => {
      mockInstance.post.mockResolvedValue({
        data: { retCode: 0, result: { orderId: '123', symbol: 'BTCUSDT', side: 'Buy', orderType: 'Limit', qty: '1', price: '100', orderStatus: 'New', createdTime: '1700000000000' } },
      });

      await client.createOrder({ category: 'linear', symbol: 'BTCUSDT', side: 'Buy', orderType: 'Limit', qty: '0.1' });

      const [, body, options] = mockInstance.post.mock.calls[0];

      expect(options.headers['X-BAPI-SIGN']).toBeDefined();
      expect(body).toEqual(expect.objectContaining({ symbol: 'BTCUSDT' }));
    });
  });

  describe('createOrder', () => {
    it('returns result on retCode=0', async () => {
      const mockResponse = {
        retCode: 0,
        result: { orderId: '123', symbol: 'BTCUSDT', side: 'Buy', orderType: 'Limit', qty: '0.1', price: '65000', orderStatus: 'New', createdTime: '1700000000000' },
      };
      mockInstance.post.mockResolvedValue({ data: mockResponse });

      const result = await client.createOrder({ category: 'linear', symbol: 'BTCUSDT' });

      expect(result.result.orderId).toBe('123');
    });

    it('throws on retCode != 0', async () => {
      mockInstance.post.mockResolvedValue({
        data: { retCode: 10001, retMsg: 'Invalid parameter' },
      });

      await expect(client.createOrder({ category: 'linear' })).rejects.toThrow('Bybit API error 10001: Invalid parameter');
    });
  });

  describe('fetchInstrumentsInfo', () => {
    it('calls /v5/market/instruments-info with category', async () => {
      await client.fetchInstrumentsInfo('linear');

      expect(mockInstance.get).toHaveBeenCalledWith(
        '/v5/market/instruments-info',
        expect.objectContaining({ params: expect.objectContaining({ category: 'linear' }) }),
      );
    });

    it('includes symbol filter when provided', async () => {
      await client.fetchInstrumentsInfo('spot', { symbol: 'BTCUSDT' });

      const [, options] = mockInstance.get.mock.calls[0];

      expect(options.params.symbol).toBe('BTCUSDT');
    });
  });

  describe('setLeverage', () => {
    it('sends stringified leverage values', async () => {
      await client.setLeverage({ category: 'linear', symbol: 'BTCUSDT', buyLeverage: 10, sellLeverage: 10 });

      const [url, body] = mockInstance.post.mock.calls[0];

      expect(url).toBe('/v5/position/set-leverage');
      expect(body.buyLeverage).toBe('10');
      expect(body.sellLeverage).toBe('10');
    });
  });
});
