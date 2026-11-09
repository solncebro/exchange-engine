import axios from 'axios';
import { BybitHttpClient } from '../../src/http/BybitHttpClient';
import { createMockLogger } from '../fixtures/mockLogger';
import { createMockAxiosInstance } from '../fixtures/mockAxios';
import { BYBIT_RAW_MARK_PRICE_KLINE_RESPONSE_BTCUSDT_1793721600000 } from '../fixtures/bybitRaw';

jest.mock('axios');
// Пауза между страницами журнала операций в тестах не нужна — листание проверяется по запросам.
jest.mock('../../src/utils/sleep', () => ({ sleep: jest.fn().mockResolvedValue(undefined) }));
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
      expect(options.headers['X-BAPI-RECV-WINDOW']).toBe('7000');
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

  describe('fetchAllInstrumentsInfo', () => {
    it('makes two requests for linear (Trading + PreLaunch) and concatenates results', async () => {
      mockInstance.get
        .mockResolvedValueOnce({
          data: { retCode: 0, result: { list: [{ symbol: 'BTCUSDT' }, { symbol: 'ETHUSDT' }], nextPageCursor: '' } },
        })
        .mockResolvedValueOnce({
          data: { retCode: 0, result: { list: [{ symbol: 'MEGAUSDT' }], nextPageCursor: '' } },
        });

      const result = await client.fetchAllInstrumentsInfo('linear');

      expect(mockInstance.get).toHaveBeenCalledTimes(2);
      expect(mockInstance.get.mock.calls[0][1].params).toEqual(
        expect.objectContaining({ category: 'linear', status: 'Trading', limit: 1000 }),
      );
      expect(mockInstance.get.mock.calls[1][1].params).toEqual(
        expect.objectContaining({ category: 'linear', status: 'PreLaunch', limit: 1000 }),
      );
      expect(result.map((r) => r.symbol)).toEqual(['BTCUSDT', 'ETHUSDT', 'MEGAUSDT']);
    });

    it('makes a single request for spot (only Trading)', async () => {
      mockInstance.get.mockResolvedValueOnce({
        data: { retCode: 0, result: { list: [{ symbol: 'BTCUSDT' }], nextPageCursor: '' } },
      });

      const result = await client.fetchAllInstrumentsInfo('spot');

      expect(mockInstance.get).toHaveBeenCalledTimes(1);
      expect(mockInstance.get.mock.calls[0][1].params).toEqual(
        expect.objectContaining({ category: 'spot', status: 'Trading', limit: 1000 }),
      );
      expect(result.map((r) => r.symbol)).toEqual(['BTCUSDT']);
    });

    it('paginates Trading and PreLaunch independently using nextPageCursor', async () => {
      mockInstance.get
        .mockResolvedValueOnce({
          data: { retCode: 0, result: { list: [{ symbol: 'BTCUSDT' }], nextPageCursor: 'tradingCursor' } },
        })
        .mockResolvedValueOnce({
          data: { retCode: 0, result: { list: [{ symbol: 'ETHUSDT' }], nextPageCursor: '' } },
        })
        .mockResolvedValueOnce({
          data: { retCode: 0, result: { list: [{ symbol: 'MEGAUSDT' }], nextPageCursor: '' } },
        });

      const result = await client.fetchAllInstrumentsInfo('linear');

      expect(mockInstance.get).toHaveBeenCalledTimes(3);
      expect(mockInstance.get.mock.calls[0][1].params.cursor).toBeUndefined();
      expect(mockInstance.get.mock.calls[1][1].params.cursor).toBe('tradingCursor');
      expect(mockInstance.get.mock.calls[1][1].params.status).toBe('Trading');
      expect(mockInstance.get.mock.calls[2][1].params.status).toBe('PreLaunch');
      expect(mockInstance.get.mock.calls[2][1].params.cursor).toBeUndefined();
      expect(result.map((r) => r.symbol)).toEqual(['BTCUSDT', 'ETHUSDT', 'MEGAUSDT']);
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

  describe('fetchMarkPriceKline', () => {
    it('reads the public mark-price kline as an open request without a signature', async () => {
      mockInstance.get.mockResolvedValueOnce({ data: BYBIT_RAW_MARK_PRICE_KLINE_RESPONSE_BTCUSDT_1793721600000 });

      const response = await client.fetchMarkPriceKline({ category: 'linear', symbol: 'BTCUSDT', start: 1793721600000, end: 1793721659999 });
      const [, options] = mockInstance.get.mock.calls[0];

      expect(options.headers).toBeUndefined();
      expect(response.result.list[0][1]).toBe('77660.1');
    });

    it('requests the exact one-minute mark-price window with one result', async () => {
      await client.fetchMarkPriceKline({
        category: 'linear',
        symbol: 'BTCUSDT',
        start: 1700000000000,
        end: 1700000059999,
      });

      const [url, options] = mockInstance.get.mock.calls[0];

      expect(url).toBe('/v5/market/mark-price-kline');
      expect(options.params).toEqual(expect.objectContaining({
        category: 'linear',
        symbol: 'BTCUSDT',
        interval: '1',
        start: 1700000000000,
        end: 1700000059999,
        limit: 1,
      }));
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

    it('includes orderLinkId when provided', async () => {
      await client.getOpenOrders('linear', { symbol: 'BTCUSDT', orderLinkId: 'kf-abc-e0' });

      const [, options] = mockInstance.get.mock.calls[0];

      expect(options.params.orderLinkId).toBe('kf-abc-e0');
    });
  });

  describe('fetchAllOpenOrders', () => {
    it('follows nextPageCursor across three one-order pages until an empty page ends the list', async () => {
      mockInstance.get
        .mockResolvedValueOnce({ data: { result: { list: [{ symbol: '1' }], nextPageCursor: 'c1' } } })
        .mockResolvedValueOnce({ data: { result: { list: [{ symbol: '2' }], nextPageCursor: 'c2' } } })
        .mockResolvedValueOnce({ data: { result: { list: [{ symbol: '3' }], nextPageCursor: 'c3' } } })
        .mockResolvedValueOnce({ data: { result: { list: [], nextPageCursor: '' } } });

      const result = await client.fetchAllOpenOrders('linear', { settleCoin: 'USDT' });

      expect(result.map((row: any) => row.symbol)).toEqual(['1', '2', '3']);
      expect(mockInstance.get).toHaveBeenCalledTimes(4);
      expect(mockInstance.get.mock.calls.map(([, options]) => options.params.cursor)).toEqual([undefined, 'c1', 'c2', 'c3']);
      expect(mockInstance.get.mock.calls.every(([, options]) => options.params.limit === 50)).toBe(true);
    });

    // Живой ответ 18.09.2026: непустой курсор стоит и на последней ЗАПОЛНЕННОЙ странице —
    // конец узнаётся по пустому списку следующей страницы, а не по одному курсору.
    it('stops on a non-empty page whose cursor is followed by an empty page', async () => {
      mockInstance.get
        .mockResolvedValueOnce({ data: { result: { list: [{ symbol: '1' }, { symbol: '2' }, { symbol: '3' }], nextPageCursor: 'c1' } } })
        .mockResolvedValueOnce({ data: { result: { list: [], nextPageCursor: '' } } });

      const result = await client.fetchAllOpenOrders('linear', { settleCoin: 'USDT' });

      expect(result.map((row: any) => row.symbol)).toEqual(['1', '2', '3']);
      expect(mockInstance.get).toHaveBeenCalledTimes(2);
    });

    it('stops on a null cursor without a second request', async () => {
      mockInstance.get.mockResolvedValueOnce({ data: { result: { list: [{ symbol: '1' }], nextPageCursor: null } } });

      const result = await client.fetchAllOpenOrders('linear', { settleCoin: 'USDT' });

      expect(result.map((row: any) => row.symbol)).toEqual(['1']);
      expect(mockInstance.get).toHaveBeenCalledTimes(1);
    });

    it('throws instead of paging on when the exchange repeats the same cursor', async () => {
      mockInstance.get.mockResolvedValue({ data: { result: { list: [{ symbol: 'x' }], nextPageCursor: 'same' } } });

      await expect(client.fetchAllOpenOrders('linear', { settleCoin: 'USDT' })).rejects.toThrow('open orders handed out a page cursor it had already handed out');
      expect(mockInstance.get).toHaveBeenCalledTimes(2);
    });

    it('throws on cursors that come back in a circle instead of running into the page ceiling', async () => {
      let pageCount = 0;
      mockInstance.get.mockImplementation(async () => {
        pageCount++;

        return { data: { result: { list: [{ symbol: `S${pageCount}` }], nextPageCursor: pageCount % 2 === 0 ? 'A' : 'B' } } };
      });

      await expect(client.fetchAllOpenOrders('linear', { settleCoin: 'USDT' })).rejects.toThrow('already handed out');
      expect(mockInstance.get).toHaveBeenCalledTimes(3);
    });

    it('throws on a first page without a list instead of answering with no orders', async () => {
      mockInstance.get.mockResolvedValueOnce({ data: { result: { nextPageCursor: 'abc' } } });

      await expect(client.fetchAllOpenOrders('linear', { settleCoin: 'USDT' })).rejects.toThrow('open orders page 1 came without a list');
    });
  });

  describe('fetchAllPositionList', () => {
    it('throws on a first page without a list instead of answering with no positions', async () => {
      mockInstance.get.mockResolvedValueOnce({ data: { result: { nextPageCursor: 'abc' } } });

      await expect(client.fetchAllPositionList('linear', { settleCoin: 'USDT' })).rejects.toThrow('position list page 1 came without a list');
      expect(mockInstance.get).toHaveBeenCalledTimes(1);
    });

    it('throws on a second page without a list after a full first page instead of answering partially', async () => {
      mockInstance.get
        .mockResolvedValueOnce({ data: { result: { list: Array.from({ length: 200 }, () => ({ symbol: 'A' })), nextPageCursor: 'c1' } } })
        .mockResolvedValueOnce({ data: { result: {} } });

      await expect(client.fetchAllPositionList('linear', { settleCoin: 'USDT' })).rejects.toThrow('position list page 2 came without a list');
      expect(mockInstance.get).toHaveBeenCalledTimes(2);
    });

    it.each([
      [3800, 3800, null],
      [3801, null, 'reached the page count limit (20)'],
    ])('reads %s positions when even the last filled page hands out a cursor: %s read, refusal %s', async (total, expectedLength, expectedError) => {
      let servedCount = 0;
      let pageCount = 0;
      mockInstance.get.mockImplementation(async () => {
        pageCount++;
        const size = Math.min(200, total - servedCount);
        servedCount += size;

        return { data: { result: { list: Array.from({ length: size }, () => ({ symbol: 'X' })), nextPageCursor: size === 0 ? '' : `c${pageCount}` } } };
      });

      const reading = client.fetchAllPositionList('linear', { settleCoin: 'USDT' });

      if (expectedError === null) {
        await expect(reading).resolves.toHaveLength(expectedLength ?? 0);
      } else {
        await expect(reading).rejects.toThrow(expectedError);
      }

      expect(pageCount).toBe(20);
    });
  });

  describe('fetchAllOrderExecutionList', () => {
    it('reads execution pages of 100 by cursor through the common traversal until the empty page', async () => {
      mockInstance.get
        .mockResolvedValueOnce({ data: { result: { list: [{ execId: '1' }], nextPageCursor: 'c1' } } })
        .mockResolvedValueOnce({ data: { result: { list: [], nextPageCursor: 'c2' } } });

      const result = await client.fetchAllOrderExecutionList({ symbol: 'BTCUSDT', orderId: '77', startTime: 1000, endTime: 5000 });

      expect(result.map((row: any) => row.execId)).toEqual(['1']);
      expect(mockInstance.get.mock.calls.map(([path]) => path)).toEqual(['/v5/execution/list', '/v5/execution/list']);
      expect(mockInstance.get.mock.calls.map(([, options]) => options.params.cursor)).toEqual([undefined, 'c1']);
      expect(mockInstance.get.mock.calls.every(([, options]) => options.params.limit === 100 && options.params.category === 'linear' && options.params.orderId === '77')).toBe(true);
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

    it('includes orderLinkId when provided', async () => {
      await client.getOrderHistory('linear', { symbol: 'BTCUSDT', orderLinkId: 'kf-abc-x1' });

      const [, options] = mockInstance.get.mock.calls[0];

      expect(options.params.orderLinkId).toBe('kf-abc-x1');
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

  describe('amendBatchOrders', () => {
    it('sends POST to /v5/order/amend-batch with category and request body', async () => {
      mockInstance.post.mockResolvedValue({
        data: {
          retCode: 0,
          retMsg: 'OK',
          result: { list: [{ category: 'linear', symbol: 'BTCUSDT', orderId: '1', orderLinkId: '' }] },
          retExtInfo: { list: [{ code: 0, msg: 'OK' }] },
          time: 1700000000000,
        },
      });

      const requestList = [{ symbol: 'BTCUSDT', orderId: '1', price: '30000', qty: '0.1' }];
      const response = await client.amendBatchOrders('linear', requestList);

      const [url, body] = mockInstance.post.mock.calls[0];

      expect(url).toBe('/v5/order/amend-batch');
      expect(body).toEqual({ category: 'linear', request: requestList });
      expect(response.result.list).toHaveLength(1);
      expect(response.retExtInfo.list[0].code).toBe(0);
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

  describe('setPositionMode', () => {
    it('calls POST /v5/position/switch-mode with category and mode', async () => {
      await client.setPositionMode({ category: 'linear', mode: 3 });

      const [url, body] = mockInstance.post.mock.calls[0];

      expect(url).toBe('/v5/position/switch-mode');
      expect(body.category).toBe('linear');
      expect(body.mode).toBe(3);
    });

    it('includes coin when provided', async () => {
      await client.setPositionMode({ category: 'linear', mode: 0, coin: 'USDT' });

      const [, body] = mockInstance.post.mock.calls[0];

      expect(body.coin).toBe('USDT');
      expect(body.symbol).toBeUndefined();
    });

    it('includes symbol when provided', async () => {
      await client.setPositionMode({ category: 'linear', mode: 3, symbol: 'ETHUSDT' });

      const [, body] = mockInstance.post.mock.calls[0];

      expect(body).toEqual({ category: 'linear', mode: 3, symbol: 'ETHUSDT' });
    });

    it('sends only the symbol when both symbol and coin are given: the symbol has the priority', async () => {
      await client.setPositionMode({ category: 'linear', mode: 3, symbol: 'ETHUSDT', coin: 'USDT' });

      const [, body] = mockInstance.post.mock.calls[0];

      expect(body).toEqual({ category: 'linear', mode: 3, symbol: 'ETHUSDT' });
    });

    it('omits coin and symbol when not provided', async () => {
      await client.setPositionMode({ category: 'linear', mode: 3 });

      const [, body] = mockInstance.post.mock.calls[0];

      expect(body.coin).toBeUndefined();
      expect(body.symbol).toBeUndefined();
    });
  });

  describe('addPositionMargin', () => {
    it('calls POST /v5/position/add-margin with the margin as a string and the position index', async () => {
      await client.addPositionMargin({ category: 'linear', symbol: 'ETHUSDT', margin: '1', positionIdx: 0 });

      const [url, body] = mockInstance.post.mock.calls[0];

      expect(url).toBe('/v5/position/add-margin');
      expect(body).toEqual({ category: 'linear', symbol: 'ETHUSDT', margin: '1', positionIdx: 0 });
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

    it('passes the page cursor when provided', async () => {
      await client.fetchTransactionLog({ category: 'linear', cursor: 'abc' });

      const [, options] = mockInstance.get.mock.calls[0];

      expect(options.params.cursor).toBe('abc');
    });
  });

  describe('fetchAllTransactionLog', () => {
    it('follows nextPageCursor until the exchange stops handing one out', async () => {
      mockInstance.get
        .mockResolvedValueOnce({ data: { result: { list: [{ symbol: '1' }], nextPageCursor: 'c1' } } })
        .mockResolvedValueOnce({ data: { result: { list: [{ symbol: '2' }], nextPageCursor: 'c2' } } })
        .mockResolvedValueOnce({ data: { result: { list: [{ symbol: '3' }], nextPageCursor: '' } } });

      const result = await client.fetchAllTransactionLog({ category: 'linear', limit: 1, startTime: 5, endTime: 9 });

      expect(result.map((row) => row.symbol)).toEqual(['1', '2', '3']);
      expect(mockInstance.get.mock.calls.map(([, options]) => options.params.cursor)).toEqual([undefined, 'c1', 'c2']);
      expect(mockInstance.get.mock.calls.every(([, options]) => options.params.startTime === 5 && options.params.endTime === 9)).toBe(true);
    });

    // 17.09.2026: the live exchange ends the log with nextPageCursor: null. The loop did not stop on
    // it, sent `cursor=null` 73 times in two seconds and got 10006 — every funding read and report failed.
    it('stops on a null cursor — the way the exchange really ends the log', async () => {
      mockInstance.get
        .mockResolvedValueOnce({ data: { result: { list: [{ symbol: '1' }], nextPageCursor: 'c1' } } })
        .mockResolvedValueOnce({ data: { result: { list: [], nextPageCursor: null } } })
        .mockResolvedValue({ data: { result: { list: [{ symbol: 'must not be read' }], nextPageCursor: null } } });

      const result = await client.fetchAllTransactionLog({ category: 'linear', limit: 50 });

      expect(result.map((row) => row.symbol)).toEqual(['1']);
      expect(mockInstance.get).toHaveBeenCalledTimes(2);
      expect(mockInstance.get.mock.calls.map(([, options]) => options.params.cursor)).toEqual([undefined, 'c1']);
    });

    it('throws instead of paging on when the exchange repeats the same cursor', async () => {
      mockInstance.get.mockResolvedValue({ data: { result: { list: [{ symbol: 'x' }], nextPageCursor: 'same' } } });

      await expect(client.fetchAllTransactionLog({ category: 'linear' })).rejects.toThrow('same page cursor twice');
      expect(mockInstance.get).toHaveBeenCalledTimes(2);
    });

    it('throws rather than returning a partial log when the page count limit is reached', async () => {
      let pageNumber = 0;

      mockInstance.get.mockImplementation(async () => ({ data: { result: { list: [{ symbol: 'x' }], nextPageCursor: `c${++pageNumber}` } } }));

      await expect(client.fetchAllTransactionLog({ category: 'linear' })).rejects.toThrow('page count limit');
    });
  });
});
