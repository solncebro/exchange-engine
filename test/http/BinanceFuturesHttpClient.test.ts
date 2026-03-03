import axios from 'axios';
import { BinanceFuturesHttpClient } from '../../src/http/BinanceFuturesHttpClient';
import { createMockLogger } from '../fixtures/mockLogger';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('BinanceFuturesHttpClient', () => {
  let client: BinanceFuturesHttpClient;
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

    client = new BinanceFuturesHttpClient({
      baseUrl: 'https://fapi.binance.com',
      apiKey: 'testKey',
      secret: 'testSecret',
      logger: createMockLogger(),
    });
  });

  it('uses /fapi/v1/ and /fapi/v2/ endpoints', async () => {
    await client.fetchExchangeInfo();
    expect(mockInstance.get).toHaveBeenCalledWith('/fapi/v1/exchangeInfo', expect.anything());
  });

  describe('fetchPositionRisk', () => {
    it('calls signedGet /fapi/v2/positionRisk', async () => {
      await client.fetchPositionRisk('BTCUSDT');

      const [url, options] = mockInstance.get.mock.calls[0];

      expect(url).toBe('/fapi/v2/positionRisk');
      expect(options.params.symbol).toBe('BTCUSDT');
      expect(options.params.signature).toBeDefined();
    });
  });

  describe('setLeverage', () => {
    it('calls signedPost with symbol and leverage', async () => {
      await client.setLeverage('BTCUSDT', 20);

      const [url, , options] = mockInstance.post.mock.calls[0];

      expect(url).toBe('/fapi/v1/leverage');
      expect(options.params.symbol).toBe('BTCUSDT');
      expect(options.params.leverage).toBe(20);
    });
  });

  describe('modifyOrder', () => {
    it('calls putWithParams with signed params', async () => {
      await client.modifyOrder({ symbol: 'BTCUSDT', orderId: '123', quantity: '0.1' });

      const [url, , options] = mockInstance.put.mock.calls[0];

      expect(url).toBe('/fapi/v1/order');
      expect(options.params.signature).toBeDefined();
      expect(options.headers['X-MBX-APIKEY']).toBe('testKey');
    });
  });

  describe('setMarginType', () => {
    it('calls signedPost /fapi/v1/marginType', async () => {
      await client.setMarginType('BTCUSDT', 'ISOLATED');

      const [url, , options] = mockInstance.post.mock.calls[0];

      expect(url).toBe('/fapi/v1/marginType');
      expect(options.params.symbol).toBe('BTCUSDT');
      expect(options.params.marginType).toBe('ISOLATED');
    });
  });
});
