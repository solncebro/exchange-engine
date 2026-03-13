import axios from 'axios';
import { BybitHttpClient } from '../../src/http/BybitHttpClient';
import { createMockLogger } from '../fixtures/mockLogger';
import { createMockAxiosInstance } from '../fixtures/mockAxios';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('BybitHttpClient', () => {
  let client: BybitHttpClient;
  let mockInstance: Record<string, jest.Mock>;

  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(1700000000000);

    mockInstance = createMockAxiosInstance();
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

  describe('fetchOrderBook', () => {
    it('calls GET /v5/market/orderbook with category and symbol', async () => {
      await client.fetchOrderBook('linear', 'BTCUSDT');

      const [url, options] = mockInstance.get.mock.calls[0];

      expect(url).toBe('/v5/market/orderbook');
      expect(options.params.category).toBe('linear');
      expect(options.params.symbol).toBe('BTCUSDT');
    });

    it('includes limit when provided', async () => {
      await client.fetchOrderBook('linear', 'BTCUSDT', 25);

      const [, options] = mockInstance.get.mock.calls[0];

      expect(options.params.limit).toBe(25);
    });
  });

  describe('fetchKline', () => {
    it('calls GET /v5/market/kline with category, symbol, interval', async () => {
      await client.fetchKline({ category: 'linear', symbol: 'BTCUSDT', interval: '15' });

      const [url, options] = mockInstance.get.mock.calls[0];

      expect(url).toBe('/v5/market/kline');
      expect(options.params.category).toBe('linear');
      expect(options.params.symbol).toBe('BTCUSDT');
      expect(options.params.interval).toBe('15');
    });

    it('applies time range options', async () => {
      await client.fetchKline({
        category: 'linear',
        symbol: 'BTCUSDT',
        interval: '15',
        options: { startTime: 1000, endTime: 2000, limit: 200 },
      });

      const [, options] = mockInstance.get.mock.calls[0];

      expect(options.params.startTime).toBe(1000);
      expect(options.params.endTime).toBe(2000);
      expect(options.params.limit).toBe(200);
    });
  });

  describe('fetchFundingHistory', () => {
    it('calls GET /v5/market/funding/history', async () => {
      await client.fetchFundingHistory('linear', 'BTCUSDT');

      const [url, options] = mockInstance.get.mock.calls[0];

      expect(url).toBe('/v5/market/funding/history');
      expect(options.params.category).toBe('linear');
      expect(options.params.symbol).toBe('BTCUSDT');
    });

    it('applies time range options', async () => {
      await client.fetchFundingHistory('linear', 'BTCUSDT', { startTime: 1000, limit: 50 });

      const [, options] = mockInstance.get.mock.calls[0];

      expect(options.params.startTime).toBe(1000);
      expect(options.params.limit).toBe(50);
    });
  });

  describe('fetchOpenInterest', () => {
    it('calls GET /v5/market/open-interest', async () => {
      await client.fetchOpenInterest('linear', 'BTCUSDT');

      const [url, options] = mockInstance.get.mock.calls[0];

      expect(url).toBe('/v5/market/open-interest');
      expect(options.params.category).toBe('linear');
      expect(options.params.symbol).toBe('BTCUSDT');
    });

    it('includes period and limit when provided', async () => {
      await client.fetchOpenInterest('linear', 'BTCUSDT', { period: '5min', limit: 100 });

      const [, options] = mockInstance.get.mock.calls[0];

      expect(options.params.period).toBe('5min');
      expect(options.params.limit).toBe(100);
    });
  });

  describe('fetchRecentTrades', () => {
    it('calls GET /v5/market/recent-trade', async () => {
      await client.fetchRecentTrades('linear', 'BTCUSDT');

      const [url, options] = mockInstance.get.mock.calls[0];

      expect(url).toBe('/v5/market/recent-trade');
      expect(options.params.category).toBe('linear');
      expect(options.params.symbol).toBe('BTCUSDT');
    });

    it('includes limit when provided', async () => {
      await client.fetchRecentTrades('linear', 'BTCUSDT', 50);

      const [, options] = mockInstance.get.mock.calls[0];

      expect(options.params.limit).toBe(50);
    });
  });

  describe('amendOrder', () => {
    it('calls POST /v5/order/amend', async () => {
      await client.amendOrder({ category: 'linear', symbol: 'BTCUSDT', orderId: '123', qty: '0.2' });

      const [url, body] = mockInstance.post.mock.calls[0];

      expect(url).toBe('/v5/order/amend');
      expect(body).toEqual(expect.objectContaining({ symbol: 'BTCUSDT', orderId: '123' }));
    });
  });

  describe('cancelOrder', () => {
    it('calls POST /v5/order/cancel', async () => {
      await client.cancelOrder({ category: 'linear', symbol: 'BTCUSDT', orderId: '123' });

      const [url, body] = mockInstance.post.mock.calls[0];

      expect(url).toBe('/v5/order/cancel');
      expect(body).toEqual(expect.objectContaining({ symbol: 'BTCUSDT', orderId: '123' }));
    });
  });

  describe('cancelAllOrders', () => {
    it('calls POST /v5/order/cancel-all with category', async () => {
      await client.cancelAllOrders('linear');

      const [url, body] = mockInstance.post.mock.calls[0];

      expect(url).toBe('/v5/order/cancel-all');
      expect(body).toEqual({ category: 'linear' });
    });

    it('includes symbol when provided', async () => {
      await client.cancelAllOrders('linear', 'BTCUSDT');

      const [, body] = mockInstance.post.mock.calls[0];

      expect(body).toEqual({ category: 'linear', symbol: 'BTCUSDT' });
    });
  });

  describe('getOpenOrders', () => {
    it('calls GET /v5/order/realtime with category', async () => {
      await client.getOpenOrders('linear');

      const [url, options] = mockInstance.get.mock.calls[0];

      expect(url).toBe('/v5/order/realtime');
      expect(options.params.category).toBe('linear');
    });

    it('includes symbol and limit when provided', async () => {
      await client.getOpenOrders('linear', { symbol: 'BTCUSDT', limit: 10 });

      const [, options] = mockInstance.get.mock.calls[0];

      expect(options.params.symbol).toBe('BTCUSDT');
      expect(options.params.limit).toBe(10);
    });
  });

  describe('getOrderHistory', () => {
    it('calls GET /v5/order/history with category', async () => {
      await client.getOrderHistory('linear');

      const [url, options] = mockInstance.get.mock.calls[0];

      expect(url).toBe('/v5/order/history');
      expect(options.params.category).toBe('linear');
    });

    it('includes symbol and limit when provided', async () => {
      await client.getOrderHistory('linear', { symbol: 'BTCUSDT', limit: 20 });

      const [, options] = mockInstance.get.mock.calls[0];

      expect(options.params.symbol).toBe('BTCUSDT');
      expect(options.params.limit).toBe(20);
    });
  });

  describe('createBatchOrders', () => {
    it('calls POST /v5/order/create-batch', async () => {
      const requestList = [{ symbol: 'BTCUSDT', side: 'Buy' }];
      await client.createBatchOrders('linear', requestList);

      const [url, body] = mockInstance.post.mock.calls[0];

      expect(url).toBe('/v5/order/create-batch');
      expect(body).toEqual({ category: 'linear', request: requestList });
    });
  });

  describe('cancelBatchOrders', () => {
    it('calls POST /v5/order/cancel-batch', async () => {
      const requestList = [{ symbol: 'BTCUSDT', orderId: '111' }];
      await client.cancelBatchOrders('linear', requestList);

      const [url, body] = mockInstance.post.mock.calls[0];

      expect(url).toBe('/v5/order/cancel-batch');
      expect(body).toEqual({ category: 'linear', request: requestList });
    });
  });

  describe('getPositionList', () => {
    it('includes limit when provided', async () => {
      await client.getPositionList('linear', { limit: 50 });

      const [url, options] = mockInstance.get.mock.calls[0];

      expect(url).toBe('/v5/position/list');
      expect(options.params.limit).toBe(50);
    });
  });

  describe('switchIsolated', () => {
    it('calls POST /v5/position/switch-isolated with stringified leverage', async () => {
      await client.switchIsolated({
        category: 'linear',
        symbol: 'BTCUSDT',
        tradeMode: 1,
        buyLeverage: 10,
        sellLeverage: 10,
      });

      const [url, body] = mockInstance.post.mock.calls[0];

      expect(url).toBe('/v5/position/switch-isolated');
      expect(body.tradeMode).toBe(1);
      expect(body.buyLeverage).toBe('10');
      expect(body.sellLeverage).toBe('10');
    });
  });

  describe('setTradingStop', () => {
    it('calls POST /v5/position/trading-stop', async () => {
      const params = { category: 'linear', symbol: 'BTCUSDT', takeProfit: '70000' };
      await client.setTradingStop(params);

      const [url, body] = mockInstance.post.mock.calls[0];

      expect(url).toBe('/v5/position/trading-stop');
      expect(body).toEqual(params);
    });
  });

  describe('getClosedPnl', () => {
    it('calls GET /v5/position/closed-pnl with category', async () => {
      await client.getClosedPnl('linear');

      const [url, options] = mockInstance.get.mock.calls[0];

      expect(url).toBe('/v5/position/closed-pnl');
      expect(options.params.category).toBe('linear');
    });

    it('includes symbol and limit when provided', async () => {
      await client.getClosedPnl('linear', { symbol: 'BTCUSDT', limit: 30 });

      const [, options] = mockInstance.get.mock.calls[0];

      expect(options.params.symbol).toBe('BTCUSDT');
      expect(options.params.limit).toBe(30);
    });
  });

  describe('fetchWalletBalance', () => {
    it('calls GET /v5/account/wallet-balance with accountType', async () => {
      await client.fetchWalletBalance('UNIFIED');

      const [url, options] = mockInstance.get.mock.calls[0];

      expect(url).toBe('/v5/account/wallet-balance');
      expect(options.params.accountType).toBe('UNIFIED');
    });
  });

  describe('fetchAccountInfo', () => {
    it('calls GET /v5/account/info', async () => {
      await client.fetchAccountInfo();

      const [url] = mockInstance.get.mock.calls[0];

      expect(url).toBe('/v5/account/info');
    });
  });

  describe('fetchFeeRate', () => {
    it('calls GET /v5/account/fee-rate with category', async () => {
      await client.fetchFeeRate('linear');

      const [url, options] = mockInstance.get.mock.calls[0];

      expect(url).toBe('/v5/account/fee-rate');
      expect(options.params.category).toBe('linear');
    });

    it('includes symbol when provided', async () => {
      await client.fetchFeeRate('linear', { symbol: 'BTCUSDT' });

      const [, options] = mockInstance.get.mock.calls[0];

      expect(options.params.symbol).toBe('BTCUSDT');
    });
  });

  describe('setMarginMode', () => {
    it('calls POST /v5/account/set-margin-mode', async () => {
      await client.setMarginMode('REGULAR_MARGIN');

      const [url, body] = mockInstance.post.mock.calls[0];

      expect(url).toBe('/v5/account/set-margin-mode');
      expect(body).toEqual({ setMarginMode: 'REGULAR_MARGIN' });
    });
  });

  describe('fetchTransactionLog', () => {
    it('calls GET /v5/account/transaction-log without options', async () => {
      await client.fetchTransactionLog();

      const [url] = mockInstance.get.mock.calls[0];

      expect(url).toBe('/v5/account/transaction-log');
    });

    it('includes category and limit when provided', async () => {
      await client.fetchTransactionLog({ category: 'linear', limit: 50 });

      const [, options] = mockInstance.get.mock.calls[0];

      expect(options.params.category).toBe('linear');
      expect(options.params.limit).toBe(50);
    });
  });
});
