import axios from 'axios';
import { BinanceFuturesHttpClient } from '../../src/http/BinanceFuturesHttpClient';
import { createMockLogger } from '../fixtures/mockLogger';
import { createMockAxiosInstance } from '../fixtures/mockAxios';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('BinanceFuturesHttpClient — Algo service transport', () => {
  let client: BinanceFuturesHttpClient;
  let mockInstance: Record<string, jest.Mock>;

  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(1700000000000);

    mockInstance = createMockAxiosInstance();
    mockedAxios.create.mockReturnValue(mockInstance as any);

    client = new BinanceFuturesHttpClient({
      baseUrl: 'https://fapi.binance.com',
      apiKey: 'testKey',
      secret: 'testSecret',
      logger: createMockLogger(),
    });
  });

  describe('createAlgoOrder', () => {
    it('posts to /fapi/v1/algoOrder with a signature', async () => {
      await client.createAlgoOrder({ algoType: 'CONDITIONAL', symbol: 'BTCUSDT', side: 'BUY', type: 'STOP_MARKET' });

      const [url, , options] = mockInstance.post.mock.calls[0];

      expect(url).toBe('/fapi/v1/algoOrder');
      expect(options.params.algoType).toBe('CONDITIONAL');
      expect(options.params.signature).toBeDefined();
    });
  });

  describe('fetchAlgoOrder', () => {
    it('gets /fapi/v1/algoOrder by algo id and sends no symbol', async () => {
      await client.fetchAlgoOrder({ algoId: '3000002125564507' });

      const [url, options] = mockInstance.get.mock.calls[0];

      expect(url).toBe('/fapi/v1/algoOrder');
      expect(options.params.algoId).toBe('3000002125564507');
      // Вход символ не принимает — номер условной заявки адресует её сам по себе.
      expect(options.params.symbol).toBeUndefined();
    });

    it('gets by our own tag when the algo id is unknown', async () => {
      await client.fetchAlgoOrder({ clientAlgoId: 'rbr_abc1' });

      const [, options] = mockInstance.get.mock.calls[0];

      expect(options.params.clientAlgoId).toBe('rbr_abc1');
      expect(options.params.algoId).toBeUndefined();
    });
  });

  describe('cancelAlgoOrder', () => {
    it('deletes /fapi/v1/algoOrder by algo id and sends no symbol', async () => {
      await client.cancelAlgoOrder({ algoId: '3000002125564507' });

      const [url, options] = mockInstance.delete.mock.calls[0];

      expect(url).toBe('/fapi/v1/algoOrder');
      expect(options.params.algoId).toBe('3000002125564507');
      expect(options.params.symbol).toBeUndefined();
    });
  });

  describe('fetchOpenAlgoOrders', () => {
    it('gets /fapi/v1/openAlgoOrders with the symbol when known', async () => {
      await client.fetchOpenAlgoOrders('BTCUSDT');

      const [url, options] = mockInstance.get.mock.calls[0];

      expect(url).toBe('/fapi/v1/openAlgoOrders');
      expect(options.params.symbol).toBe('BTCUSDT');
    });

    it('omits the symbol when asked for every symbol', async () => {
      await client.fetchOpenAlgoOrders();

      const [url, options] = mockInstance.get.mock.calls[0];

      expect(url).toBe('/fapi/v1/openAlgoOrders');
      expect(options.params.symbol).toBeUndefined();
    });
  });

  describe('fetchAllAlgoOrders', () => {
    it('gets /fapi/v1/allAlgoOrders and always sends the symbol', async () => {
      await client.fetchAllAlgoOrders('BTCUSDT', { limit: 10 });

      const [url, options] = mockInstance.get.mock.calls[0];

      expect(url).toBe('/fapi/v1/allAlgoOrders');
      expect(options.params.symbol).toBe('BTCUSDT');
      expect(options.params.limit).toBe(10);
    });
  });

  describe('cancelAllAlgoOrders', () => {
    it('deletes /fapi/v1/algoOpenOrders — a DIFFERENT path from the open-orders listing', async () => {
      await client.cancelAllAlgoOrders('BTCUSDT');

      const [url, options] = mockInstance.delete.mock.calls[0];

      // openAlgoOrders читает список, algoOpenOrders отменяет всё. Перепутать —
      // значит получить молчаливое бездействие вместо отмены.
      expect(url).toBe('/fapi/v1/algoOpenOrders');
      expect(url).not.toBe('/fapi/v1/openAlgoOrders');
      expect(options.params.symbol).toBe('BTCUSDT');
    });
  });

  it('surfaces a negative body code as an exchange error', async () => {
    mockInstance.post.mockResolvedValue({ data: { code: -4120, msg: 'Order type not supported for this endpoint.' } });

    await expect(
      client.createAlgoOrder({ algoType: 'CONDITIONAL', symbol: 'BTCUSDT', side: 'BUY', type: 'STOP_MARKET' }),
    ).rejects.toThrow('Binance API error -4120');
  });
});
