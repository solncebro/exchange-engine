import axios from 'axios';
import type { AxiosError as AxiosErrorType } from 'axios';
import { BinanceBaseHttpClient } from '../../src/http/BinanceBaseHttpClient';
import type { BinanceEndpoints, BinanceHttpClientArgs } from '../../src/http/BinanceBaseHttpClient';
import { resetBinanceRequestGateRegistry } from '../../src/http/binanceRequestGate';
import { createMockLogger } from '../fixtures/mockLogger';
import { createMockAxiosInstance } from '../fixtures/mockAxios';

const actualAxios = jest.requireActual<typeof import('axios')>('axios');
const { AxiosError, AxiosHeaders } = actualAxios;

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
    allOrders: '/test/allOrders',
    account: '/test/account',
    listenKey: '/test/listenKey',
  };

  constructor(args: BinanceHttpClientArgs) {
    super(args, 30000);
  }

  exposeSignedPut<T>(path: string, params?: Record<string, string | number | boolean>) {
    return this.signedPut<T>(path, params);
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
    // Память о лимитах — общая на адрес и живёт весь процесс: без сброса запрет из одного теста
    // держал бы запросы всех следующих.
    resetBinanceRequestGateRegistry();

    mockInstance = createMockAxiosInstance();
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

  describe('stale timestamp', () => {
    function createBinanceRefusal(status: number, code: number, message: string): AxiosErrorType {
      const headers = new AxiosHeaders();

      return new AxiosError(`Request failed with status code ${status}`, 'ERR_BAD_REQUEST', undefined, {}, {
        status,
        data: { code, msg: message },
        statusText: 'Refused',
        headers,
        config: { headers },
      } as never);
    }

    function createStaleTimestampError(): AxiosErrorType {
      return createBinanceRefusal(400, -1021, 'Timestamp for this request is outside of the recvWindow.');
    }

    it('signs at send time, not in advance — a retried read carries a fresh timestamp', async () => {
      let nowMs = 1700000000000;

      jest.spyOn(Date, 'now').mockImplementation(() => nowMs);
      mockInstance.get
        .mockImplementationOnce(() => {
          // Биржа приняла запрос протухшим и ответила «слишком занят» — пауза перед повтором ещё
          // состарит его, поэтому повтор обязан идти с новой подписью.
          nowMs += 4000;

          return Promise.reject(createBinanceRefusal(500, -1000, 'Internal error.'));
        })
        .mockResolvedValueOnce({ data: { ok: true } });

      await client.exposeSignedGet('/test');

      const [, firstOptions] = mockInstance.get.mock.calls[0];
      const [, secondOptions] = mockInstance.get.mock.calls[1];

      expect(firstOptions.params.timestamp).toBe(1700000000000);
      expect(secondOptions.params.timestamp).toBe(1700000004000);
    }, 15000);

    it('re-signs with a fresh timestamp and retries', async () => {
      let nowMs = 1700000000000;

      jest.spyOn(Date, 'now').mockImplementation(() => nowMs);
      mockInstance.get
        .mockImplementationOnce(() => {
          // Отказ приходит, когда запрос уже состарился в пути: следующая попытка обязана нести
          // СВЕЖУЮ отметку, иначе повтор бессмыслен.
          nowMs += 9000;

          return Promise.reject(createStaleTimestampError());
        })
        .mockResolvedValueOnce({ data: { ok: true } });

      const response = await client.exposeSignedGet<{ ok: boolean }>('/test');

      expect(response).toEqual({ ok: true });
      expect(mockInstance.get).toHaveBeenCalledTimes(2);

      const [, firstOptions] = mockInstance.get.mock.calls[0];
      const [, secondOptions] = mockInstance.get.mock.calls[1];

      expect(firstOptions.params.timestamp).toBe(1700000000000);
      expect(secondOptions.params.timestamp).toBe(1700000009000);
      expect(secondOptions.params.signature).not.toBe(firstOptions.params.signature);
    });

    it('retries an order placement too — a rejected request never reached the book', async () => {
      mockInstance.post
        .mockRejectedValueOnce(createStaleTimestampError())
        .mockResolvedValueOnce({ data: { orderId: 7 } });

      const response = await client.exposeSignedPost<{ orderId: number }>('/test/order', { symbol: 'BTCUSDT' });

      expect(response).toEqual({ orderId: 7 });
      expect(mockInstance.post).toHaveBeenCalledTimes(2);
    });

    it('gives up after the second rejection instead of hammering', async () => {
      mockInstance.get.mockRejectedValue(createStaleTimestampError());

      await expect(client.exposeSignedGet('/test')).rejects.toThrow('-1021');
      expect(mockInstance.get).toHaveBeenCalledTimes(2);
    });

    it('does not retry any other refusal', async () => {
      mockInstance.get.mockRejectedValue(createBinanceRefusal(400, -2013, 'Order does not exist.'));

      await expect(client.exposeSignedGet('/test')).rejects.toThrow('-2013');
      expect(mockInstance.get).toHaveBeenCalledTimes(1);
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

      const [url, , options] = mockInstance.post.mock.calls[0];

      expect(url).toBe('/test/listenKey');
      expect(options.headers['X-MBX-APIKEY']).toBe('testKey');
    });
  });

  describe('fetchOrderBook', () => {
    it('calls GET on depth endpoint with symbol', async () => {
      await client.fetchOrderBook('BTCUSDT');

      const [url, options] = mockInstance.get.mock.calls[0];

      expect(url).toBe('/test/depth');
      expect(options.params.symbol).toBe('BTCUSDT');
    });

    it('includes limit when provided', async () => {
      await client.fetchOrderBook('BTCUSDT', 20);

      const [, options] = mockInstance.get.mock.calls[0];

      expect(options.params.limit).toBe(20);
    });
  });

  describe('fetchKlines', () => {
    it('calls GET on klines endpoint with symbol and interval', async () => {
      await client.fetchKlines('BTCUSDT', '1h');

      const [url, options] = mockInstance.get.mock.calls[0];

      expect(url).toBe('/test/klines');
      expect(options.params.symbol).toBe('BTCUSDT');
      expect(options.params.interval).toBe('1h');
    });

    it('applies time range options', async () => {
      await client.fetchKlines('BTCUSDT', '1h', { startTime: 1000, endTime: 2000, limit: 500 });

      const [, options] = mockInstance.get.mock.calls[0];

      expect(options.params.startTime).toBe(1000);
      expect(options.params.endTime).toBe(2000);
      expect(options.params.limit).toBe(500);
    });
  });

  describe('fetchTrades', () => {
    it('calls GET on trades endpoint with symbol', async () => {
      await client.fetchTrades('BTCUSDT');

      const [url, options] = mockInstance.get.mock.calls[0];

      expect(url).toBe('/test/trades');
      expect(options.params.symbol).toBe('BTCUSDT');
    });

    it('includes limit when provided', async () => {
      await client.fetchTrades('BTCUSDT', 50);

      const [, options] = mockInstance.get.mock.calls[0];

      expect(options.params.limit).toBe(50);
    });
  });

  describe('cancelOrder', () => {
    it('calls signedDelete on order endpoint', async () => {
      await client.cancelOrder('BTCUSDT', '12345');

      const [url, options] = mockInstance.delete.mock.calls[0];

      expect(url).toBe('/test/order');
      expect(options.params.symbol).toBe('BTCUSDT');
      expect(options.params.orderId).toBe('12345');
      expect(options.params.signature).toBeDefined();
    });
  });

  describe('getOrder', () => {
    it('calls signedGet on order endpoint', async () => {
      await client.getOrder('BTCUSDT', '12345');

      const [url, options] = mockInstance.get.mock.calls[0];

      expect(url).toBe('/test/order');
      expect(options.params.symbol).toBe('BTCUSDT');
      expect(options.params.orderId).toBe('12345');
      expect(options.params.signature).toBeDefined();
    });
  });

  describe('getOrderByClientOrderId', () => {
    it('calls signedGet on order endpoint with origClientOrderId', async () => {
      await client.getOrderByClientOrderId('BTCUSDT', 'kf-abc-e0');

      const [url, options] = mockInstance.get.mock.calls[0];

      expect(url).toBe('/test/order');
      expect(options.params.symbol).toBe('BTCUSDT');
      expect(options.params.origClientOrderId).toBe('kf-abc-e0');
      expect(options.params.orderId).toBeUndefined();
      expect(options.params.signature).toBeDefined();
    });
  });

  describe('getOpenOrders', () => {
    it('calls signedGet on openOrders endpoint', async () => {
      await client.getOpenOrders('BTCUSDT');

      const [url, options] = mockInstance.get.mock.calls[0];

      expect(url).toBe('/test/openOrders');
      expect(options.params.symbol).toBe('BTCUSDT');
      expect(options.params.signature).toBeDefined();
    });

    it('omits symbol when not provided', async () => {
      await client.getOpenOrders();

      const [url, options] = mockInstance.get.mock.calls[0];

      expect(url).toBe('/test/openOrders');
      expect(options.params.symbol).toBeUndefined();
    });
  });

  describe('fetchAccount', () => {
    it('calls signedGet on account endpoint', async () => {
      await client.fetchAccount();

      const [url, options] = mockInstance.get.mock.calls[0];

      expect(url).toBe('/test/account');
      expect(options.params.signature).toBeDefined();
    });
  });

  describe('keepAliveListenKey', () => {
    it('sends PUT with listenKey and auth headers', async () => {
      await client.keepAliveListenKey('testListenKey');

      const [url, body, options] = mockInstance.put.mock.calls[0];

      expect(url).toBe('/test/listenKey');
      expect(body).toEqual({ listenKey: 'testListenKey' });
      expect(options.headers['X-MBX-APIKEY']).toBe('testKey');
    });
  });

  describe('deleteListenKey', () => {
    it('sends DELETE with listenKey and auth headers', async () => {
      await client.deleteListenKey('testListenKey');

      const [url, options] = mockInstance.delete.mock.calls[0];

      expect(url).toBe('/test/listenKey');
      expect(options.params.listenKey).toBe('testListenKey');
      expect(options.headers['X-MBX-APIKEY']).toBe('testKey');
    });
  });

  describe('rate-limit awareness (REQUEST_WEIGHT / 418)', () => {
    let rateLogger: ReturnType<typeof createMockLogger>;
    let rateClient: TestBinanceHttpClient;

    beforeEach(() => {
      rateLogger = createMockLogger();
      rateClient = new TestBinanceHttpClient({
        baseUrl: 'https://fapi.binance.com',
        apiKey: 'k',
        secret: 's',
        logger: rateLogger,
      });
    });

    it('warns and arms a throttle when used weight nears the per-IP cap', async () => {
      mockInstance.get.mockResolvedValueOnce({ data: [], status: 200, headers: { 'x-mbx-used-weight-1m': '2000' } });

      await rateClient.fetchTickers();

      expect(rateLogger.warn).toHaveBeenCalledWith(expect.stringContaining('REQUEST_WEIGHT near cap'));
    });

    it('does not throttle on a healthy low-weight response', async () => {
      mockInstance.get.mockResolvedValueOnce({ data: [], status: 200, headers: { 'x-mbx-used-weight-1m': '100' } });

      await rateClient.fetchTickers();

      expect(rateLogger.warn).not.toHaveBeenCalledWith(expect.stringContaining('REQUEST_WEIGHT'));
    });

    it('logs and surfaces an HTTP 418 ban without retrying it', async () => {
      const banError = {
        isAxiosError: true,
        message: 'banned',
        response: { status: 418, headers: { 'retry-after': '120' }, data: {} },
      };
      mockInstance.get.mockRejectedValue(banError);

      await expect(rateClient.fetchKlines('BTCUSDT', '1m')).rejects.toBeDefined();

      expect(rateLogger.error).toHaveBeenCalledWith(expect.stringContaining('refused the address'));
      expect(mockInstance.get).toHaveBeenCalledTimes(1); // 418 must not be retried
    });

    /**
     * До 07.09.2026 паузу знали только чтения, и пока биржа держала адрес закрытым, постановка и
     * отмена заявок продолжали стучаться — именно этим запрет и продлевается.
     */
    it('holds a WRITE for the ban as well, not just reads', async () => {
      (Date.now as unknown as jest.SpyInstance).mockRestore();
      jest.useFakeTimers();

      const bannedUntilMs = Date.now() + 120_000;
      mockInstance.get.mockRejectedValueOnce({
        isAxiosError: true,
        message: 'banned',
        response: { status: 418, headers: {}, data: { code: -1003, msg: `IP banned until ${bannedUntilMs}.` } },
      });
      await expect(rateClient.fetchKlines('BTCUSDT', '1m')).rejects.toBeDefined();

      mockInstance.post.mockResolvedValue({ data: { orderId: 1 }, status: 200, headers: {} });
      const orderPromise = rateClient.exposeSignedPost('/test/order', { symbol: 'BTCUSDT' });

      await jest.advanceTimersByTimeAsync(1000);
      expect(mockInstance.post).not.toHaveBeenCalled();

      await jest.advanceTimersByTimeAsync(120_000);
      await orderPromise;
      expect(mockInstance.post).toHaveBeenCalledTimes(1);

      jest.useRealTimers();
    });
  });
});
