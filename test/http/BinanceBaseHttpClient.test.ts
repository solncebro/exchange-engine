import axios from 'axios';
import { BinanceBaseHttpClient } from '../../src/http/BinanceBaseHttpClient';
import type { BinanceEndpoints, BinanceHttpClientArgs } from '../../src/http/BinanceBaseHttpClient';
import { createMockLogger } from '../fixtures/mockLogger';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

class TestBinanceHttpClient extends BinanceBaseHttpClient {
  protected readonly endpoints: BinanceEndpoints = {
    exchangeInfo: '/test/exchangeInfo',
    ticker24hr: '/test/ticker24hr',
    depth: '/test/depth',
    klines: '/test/klines',
    trades: '/test/trades',
    order: '/test/order',
    openOrders: '/test/openOrders',
    account: '/test/account',
    listenKey: '/test/listenKey',
  };

  constructor(args: BinanceHttpClientArgs) {
    super(args, 30000);
  }

  exposeSignedGet<T>(path: string, params?: Record<string, string | number | boolean>) {
    return this.signedGet<T>(path, params);
  }

  exposeSignedPost<T>(path: string, params?: Record<string, string | number | boolean>) {
    return this.signedPost<T>(path, params);
  }

  exposeSignedDelete<T>(path: string, params?: Record<string, string | number | boolean>) {
    return this.signedDelete<T>(path, params);
  }
}

describe('BinanceBaseHttpClient', () => {
  let client: TestBinanceHttpClient;
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

    client = new TestBinanceHttpClient({
      baseUrl: 'https://fapi.binance.com',
      apiKey: 'testKey',
      secret: 'testSecret',
      logger: createMockLogger(),
    });
  });

  describe('signedGet', () => {
    it('adds timestamp, recvWindow and signature to params', async () => {
      await client.exposeSignedGet('/test', { symbol: 'BTCUSDT' });

      const [, callOptions] = mockInstance.get.mock.calls[0];

      expect(callOptions.params.timestamp).toBe(1700000000000);
      expect(callOptions.params.recvWindow).toBe(5000);
      expect(callOptions.params.signature).toBeDefined();
    });

    it('includes X-MBX-APIKEY header', async () => {
      await client.exposeSignedGet('/test');

      const [, callOptions] = mockInstance.get.mock.calls[0];

      expect(callOptions.headers['X-MBX-APIKEY']).toBe('testKey');
    });
  });

  describe('signedPost', () => {
    it('sends signed params as query params (postWithParams)', async () => {
      await client.exposeSignedPost('/test', { symbol: 'BTCUSDT' });

      const [, body, callOptions] = mockInstance.post.mock.calls[0];

      expect(body).toBeNull();
      expect(callOptions.params.signature).toBeDefined();
      expect(callOptions.headers['X-MBX-APIKEY']).toBe('testKey');
    });
  });

  describe('signedDelete', () => {
    it('sends signed params', async () => {
      await client.exposeSignedDelete('/test', { symbol: 'BTCUSDT', orderId: '123' });

      const [, callOptions] = mockInstance.delete.mock.calls[0];

      expect(callOptions.params.signature).toBeDefined();
      expect(callOptions.params.symbol).toBe('BTCUSDT');
    });
  });

  describe('fetchExchangeInfo', () => {
    it('calls GET on exchangeInfo endpoint', async () => {
      await client.fetchExchangeInfo();

      expect(mockInstance.get).toHaveBeenCalledWith(
        '/test/exchangeInfo',
        expect.objectContaining({}),
      );
    });
  });

  describe('fetchTickers', () => {
    it('calls GET on ticker24hr endpoint', async () => {
      await client.fetchTickers();

      expect(mockInstance.get).toHaveBeenCalledWith(
        '/test/ticker24hr',
        expect.objectContaining({}),
      );
    });
  });

  describe('createOrder', () => {
    it('uses signedPost on order endpoint', async () => {
      await client.createOrder({ symbol: 'BTCUSDT', side: 'BUY', type: 'LIMIT' });

      const [url] = mockInstance.post.mock.calls[0];

      expect(url).toBe('/test/order');
    });
  });

  describe('createListenKey', () => {
    it('sends POST with auth headers', async () => {
      await client.createListenKey();

      const [url, body, options] = mockInstance.post.mock.calls[0];

      expect(url).toBe('/test/listenKey');
      expect(options.headers['X-MBX-APIKEY']).toBe('testKey');
    });
  });
});
