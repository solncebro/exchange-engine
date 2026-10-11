import axios from 'axios';
import { OkxHttpClient } from '../../src/http/OkxHttpClient';
import { ExchangeError } from '../../src/errors/ExchangeError';
import { hmacSha256Base64 } from '../../src/utils/crypto';
import type { ExchangeLogger } from '../../src/types/common';
import { createMockLogger } from '../fixtures/mockLogger';
import { createMockAxiosInstance } from '../fixtures/mockAxios';
import { OKX_MAX_PAGE_COUNT, OKX_ORDER_PAGE_LIMIT, OKX_POSITIONS_HISTORY_PAGE_LIMIT } from '../../src/constants/okx';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const TIMESTAMP = '2023-11-14T22:13:20.000Z';

function okxSuccess<T>(data: T[]): { data: { code: string; msg: string; data: T[] } } {
  return { data: { code: '0', msg: '', data } };
}

describe('OkxHttpClient', () => {
  let client: OkxHttpClient;
  let mockInstance: Record<string, jest.Mock>;
  let logger: jest.Mocked<ExchangeLogger>;

  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(1700000000000);

    mockInstance = createMockAxiosInstance();
    mockedAxios.create.mockReturnValue(mockInstance as any);
    logger = createMockLogger();

    client = new OkxHttpClient({
      baseUrl: 'https://www.okx.com',
      apiKey: 'testKey',
      secret: 'testSecret',
      passphrase: 'testPassphrase',
      isDemoMode: false,
      logger,
    });
  });

  describe('constructor', () => {
    function buildClientWithEmptyPassphrase(): OkxHttpClient {
      return new OkxHttpClient({
        baseUrl: 'https://www.okx.com',
        apiKey: 'testKey',
        secret: 'testSecret',
        passphrase: '',
        isDemoMode: false,
        logger: createMockLogger(),
      });
    }

    it('throws when passphrase is empty', () => {
      expect(buildClientWithEmptyPassphrase).toThrow(ExchangeError);

      try {
        buildClientWithEmptyPassphrase();
        throw new Error('expected the constructor to throw');
      } catch (error) {
        expect((error as ExchangeError).code).toBe('OKX_PASSPHRASE_REQUIRED');
      }
    });
  });

  describe('public-only credentials', () => {
    it('accepts empty credentials and sends an unsigned public request', async () => {
      const publicClient = new OkxHttpClient({
        baseUrl: 'https://www.okx.com', apiKey: '', secret: '', passphrase: '', isDemoMode: false, logger,
      });
      mockInstance.get.mockResolvedValue(okxSuccess([{ instId: 'BTC-USDT-SWAP' }]));

      await expect(publicClient.fetchInstruments('SWAP')).resolves.toEqual([{ instId: 'BTC-USDT-SWAP' }]);
      expect(mockInstance.get.mock.calls[0][1].headers).toEqual({});
    });

    it.each([
      { apiKey: 'testKey', secret: '' },
      { apiKey: '', secret: 'testSecret' },
    ])('rejects partial credentials without a passphrase: %p', (credentials) => {
      expect(() => new OkxHttpClient({
        baseUrl: 'https://www.okx.com', ...credentials, passphrase: '', isDemoMode: false, logger,
      })).toThrow(expect.objectContaining({ code: 'OKX_PASSPHRASE_REQUIRED' }));
    });

    it.each([
      { apiKey: '', secret: '', passphrase: '' },
      { apiKey: '', secret: 'testSecret', passphrase: 'testPassphrase' },
      { apiKey: 'testKey', secret: '', passphrase: 'testPassphrase' },
    ])('rejects private requests before HTTP when credentials are incomplete: %p', async (credentials) => {
      const publicClient = new OkxHttpClient({
        baseUrl: 'https://www.okx.com', ...credentials, isDemoMode: false, logger,
      });

      await expect(publicClient.placeOrder({ instId: 'BTC-USDT-SWAP' })).rejects.toMatchObject({ code: 'OKX_CREDENTIALS_REQUIRED' });
      await expect(publicClient.fetchBalance()).rejects.toMatchObject({ code: 'OKX_CREDENTIALS_REQUIRED' });
      expect(mockInstance.post).not.toHaveBeenCalled();
      expect(mockInstance.get).not.toHaveBeenCalled();
    });
  });

  describe('responses without a data field', () => {
    it('fetchInstruments returns an empty list instead of throwing', async () => {
      mockInstance.get.mockResolvedValue({ data: { code: '0', msg: '' } });

      await expect(client.fetchInstruments('SWAP')).resolves.toEqual([]);
    });

    it('placeOrder reports an empty order response instead of throwing a TypeError', async () => {
      mockInstance.post.mockResolvedValue({ data: { code: '0', msg: '' } });

      await expect(client.placeOrder({ instId: 'BTC-USDT-SWAP' })).rejects.toThrow('OKX returned an empty order response');
    });

    it('placeBatchOrders returns a response carrying an empty data list', async () => {
      mockInstance.post.mockResolvedValue({ data: { code: '0', msg: '' } });

      const response = await client.placeBatchOrders([{ instId: 'BTC-USDT-SWAP' }]);

      expect(response.data).toEqual([]);
    });

    it('setPositionMode returns an empty list instead of undefined', async () => {
      mockInstance.post.mockResolvedValue({ data: { code: '0', msg: '' } });

      await expect(client.setPositionMode('long_short_mode')).resolves.toEqual([]);
    });

    it('setLeverage returns an empty list instead of undefined', async () => {
      mockInstance.post.mockResolvedValue({ data: { code: '0', msg: '' } });

      await expect(client.setLeverage({ instId: 'BTC-USDT-SWAP', lever: '10', mgnMode: 'cross' })).resolves.toEqual([]);
    });
  });

  describe('public GET methods', () => {
    it('fetchInstruments calls GET /api/v5/public/instruments with instType', async () => {
      mockInstance.get.mockResolvedValue(okxSuccess([{ instId: 'BTC-USDT-SWAP' }]));

      const result = await client.fetchInstruments('SWAP');

      const [url, options] = mockInstance.get.mock.calls[0];

      expect(url).toBe('/api/v5/public/instruments');
      expect(options.params.instType).toBe('SWAP');
      expect(result).toEqual([{ instId: 'BTC-USDT-SWAP' }]);
    });

    it('fetchTickers calls GET /api/v5/market/tickers with instType', async () => {
      mockInstance.get.mockResolvedValue(okxSuccess([{ instId: 'BTC-USDT-SWAP' }]));

      await client.fetchTickers('SWAP');

      const [url, options] = mockInstance.get.mock.calls[0];

      expect(url).toBe('/api/v5/market/tickers');
      expect(options.params.instType).toBe('SWAP');
    });

    it('fetchCandles calls GET /api/v5/market/candles with instId, bar and time range', async () => {
      mockInstance.get.mockResolvedValue(okxSuccess([['1700000000000', '1', '2', '0.5', '1.5', '10', '10']]));

      const result = await client.fetchCandles({ instId: 'BTC-USDT-SWAP', bar: '1m', after: 'a', before: 'b', limit: 100 });

      const [url, options] = mockInstance.get.mock.calls[0];

      expect(url).toBe('/api/v5/market/candles');
      expect(options.params).toEqual({ instId: 'BTC-USDT-SWAP', bar: '1m', after: 'a', before: 'b', limit: '100' });
      expect(result).toEqual([['1700000000000', '1', '2', '0.5', '1.5', '10', '10']]);
    });

    it('fetchHistoryCandles calls GET /api/v5/market/history-candles', async () => {
      mockInstance.get.mockResolvedValue(okxSuccess([['1700000000000']]));

      await client.fetchHistoryCandles({ instId: 'BTC-USDT-SWAP', bar: '1m' });

      const [url, options] = mockInstance.get.mock.calls[0];

      expect(url).toBe('/api/v5/market/history-candles');
      expect(options.params).toEqual({ instId: 'BTC-USDT-SWAP', bar: '1m' });
    });

    it('fetchOrderBook calls GET /api/v5/market/books with instId and sz', async () => {
      mockInstance.get.mockResolvedValue(okxSuccess([{ asks: [], bids: [], ts: '1' }]));

      await client.fetchOrderBook('BTC-USDT-SWAP', 50);

      const [url, options] = mockInstance.get.mock.calls[0];

      expect(url).toBe('/api/v5/market/books');
      expect(options.params).toEqual({ instId: 'BTC-USDT-SWAP', sz: '50' });
    });

    it('fetchOrderBook omits sz when depth is not provided', async () => {
      mockInstance.get.mockResolvedValue(okxSuccess([{ asks: [], bids: [], ts: '1' }]));

      await client.fetchOrderBook('BTC-USDT-SWAP');

      const [, options] = mockInstance.get.mock.calls[0];

      expect(options.params).toEqual({ instId: 'BTC-USDT-SWAP' });
    });

    it('fetchTrades calls GET /api/v5/market/trades with instId and limit', async () => {
      mockInstance.get.mockResolvedValue(okxSuccess([{ instId: 'BTC-USDT-SWAP', tradeId: '1' }]));

      await client.fetchTrades('BTC-USDT-SWAP', 10);

      const [url, options] = mockInstance.get.mock.calls[0];

      expect(url).toBe('/api/v5/market/trades');
      expect(options.params).toEqual({ instId: 'BTC-USDT-SWAP', limit: '10' });
    });

    it('fetchMarkPrice calls GET /api/v5/public/mark-price with instType', async () => {
      mockInstance.get.mockResolvedValue(okxSuccess([{ instId: 'BTC-USDT-SWAP', markPx: '1' }]));

      await client.fetchMarkPrice('SWAP');

      const [url, options] = mockInstance.get.mock.calls[0];

      expect(url).toBe('/api/v5/public/mark-price');
      expect(options.params).toEqual({ instType: 'SWAP' });
    });

    it('fetchMarkPrice includes instId when provided', async () => {
      mockInstance.get.mockResolvedValue(okxSuccess([{ instId: 'BTC-USDT-SWAP', markPx: '1' }]));

      await client.fetchMarkPrice('SWAP', 'BTC-USDT-SWAP');

      const [, options] = mockInstance.get.mock.calls[0];

      expect(options.params).toEqual({ instType: 'SWAP', instId: 'BTC-USDT-SWAP' });
    });

    it('fetchOpenInterest calls GET /api/v5/public/open-interest with instType and instId', async () => {
      mockInstance.get.mockResolvedValue(okxSuccess([{ instId: 'BTC-USDT-SWAP', oi: '1' }]));

      await client.fetchOpenInterest('SWAP', 'BTC-USDT-SWAP');

      const [url, options] = mockInstance.get.mock.calls[0];

      expect(url).toBe('/api/v5/public/open-interest');
      expect(options.params).toEqual({ instType: 'SWAP', instId: 'BTC-USDT-SWAP' });
    });

    it('fetchFundingRate calls GET /api/v5/public/funding-rate with instId', async () => {
      mockInstance.get.mockResolvedValue(okxSuccess([{ instId: 'BTC-USDT-SWAP', fundingRate: '0.0001' }]));

      await client.fetchFundingRate('BTC-USDT-SWAP');

      const [url, options] = mockInstance.get.mock.calls[0];

      expect(url).toBe('/api/v5/public/funding-rate');
      expect(options.params).toEqual({ instId: 'BTC-USDT-SWAP' });
    });

    it('fetchFundingRateHistory calls GET /api/v5/public/funding-rate-history with instId and time range', async () => {
      mockInstance.get.mockResolvedValue(okxSuccess([{ instId: 'BTC-USDT-SWAP', fundingRate: '0.0001' }]));

      await client.fetchFundingRateHistory({ instId: 'BTC-USDT-SWAP', limit: 50 });

      const [url, options] = mockInstance.get.mock.calls[0];

      expect(url).toBe('/api/v5/public/funding-rate-history');
      expect(options.params).toEqual({ instId: 'BTC-USDT-SWAP', limit: '50' });
    });
  });

  describe('signed GET methods', () => {
    it('fetchBalance calls GET /api/v5/account/balance', async () => {
      mockInstance.get.mockResolvedValue(okxSuccess([{ totalEq: '1000' }]));

      const result = await client.fetchBalance();

      const [url] = mockInstance.get.mock.calls[0];

      expect(url).toBe('/api/v5/account/balance');
      expect(result).toEqual([{ totalEq: '1000' }]);
    });

    it('fetchPositions calls GET /api/v5/account/positions with instType and instId', async () => {
      mockInstance.get.mockResolvedValue(okxSuccess([{ instId: 'BTC-USDT-SWAP' }]));

      await client.fetchPositions({ instType: 'SWAP', instId: 'BTC-USDT-SWAP' });

      const [url, options] = mockInstance.get.mock.calls[0];

      expect(url).toBe('/api/v5/account/positions');
      expect(options.params).toEqual({ instType: 'SWAP', instId: 'BTC-USDT-SWAP' });
    });

    it('fetchPositionsHistory calls GET /api/v5/account/positions-history', async () => {
      mockInstance.get.mockResolvedValue(okxSuccess([{ instId: 'BTC-USDT-SWAP' }]));

      await client.fetchPositionsHistory({ instType: 'SWAP', after: 'a' });

      const [url, options] = mockInstance.get.mock.calls[0];

      expect(url).toBe('/api/v5/account/positions-history');
      expect(options.params).toEqual({ instType: 'SWAP', after: 'a' });
    });

    it('fetchAccountConfig calls GET /api/v5/account/config', async () => {
      mockInstance.get.mockResolvedValue(okxSuccess([{ uid: '1', acctLv: '2', posMode: 'long_short_mode' }]));

      await client.fetchAccountConfig();

      const [url] = mockInstance.get.mock.calls[0];

      expect(url).toBe('/api/v5/account/config');
    });

    it('fetchTradeFee calls GET /api/v5/account/trade-fee with instType', async () => {
      mockInstance.get.mockResolvedValue(okxSuccess([{ level: '1', taker: '0.001', maker: '0.0008' }]));

      await client.fetchTradeFee({ instType: 'SWAP', instId: 'BTC-USDT-SWAP' });

      const [url, options] = mockInstance.get.mock.calls[0];

      expect(url).toBe('/api/v5/account/trade-fee');
      expect(options.params).toEqual({ instType: 'SWAP', instId: 'BTC-USDT-SWAP' });
    });

    it('fetchBills calls GET /api/v5/account/bills when isArchive is false', async () => {
      mockInstance.get.mockResolvedValue(okxSuccess([{ billId: '1' }]));

      await client.fetchBills({ isArchive: false, instType: 'SWAP' });

      const [url, options] = mockInstance.get.mock.calls[0];

      expect(url).toBe('/api/v5/account/bills');
      expect(options.params).toEqual({ instType: 'SWAP' });
    });

    it('fetchBills calls GET /api/v5/account/bills-archive when isArchive is true', async () => {
      mockInstance.get.mockResolvedValue(okxSuccess([{ billId: '1' }]));

      await client.fetchBills({ isArchive: true, begin: '1', end: '2', type: '2', subType: '8' });

      const [url, options] = mockInstance.get.mock.calls[0];

      expect(url).toBe('/api/v5/account/bills-archive');
      expect(options.params).toEqual({ begin: '1', end: '2', type: '2', subType: '8' });
    });

    it('fetchOrder calls GET /api/v5/trade/order with instId, ordId and clOrdId', async () => {
      mockInstance.get.mockResolvedValue(okxSuccess([{ instId: 'BTC-USDT-SWAP', ordId: '1' }]));

      await client.fetchOrder({ instId: 'BTC-USDT-SWAP', ordId: '1', clOrdId: 'cid1' });

      const [url, options] = mockInstance.get.mock.calls[0];

      expect(url).toBe('/api/v5/trade/order');
      expect(options.params).toEqual({ instId: 'BTC-USDT-SWAP', ordId: '1', clOrdId: 'cid1' });
    });

    it('fetchPendingOrders calls GET /api/v5/trade/orders-pending with instType', async () => {
      mockInstance.get.mockResolvedValue(okxSuccess([{ instId: 'BTC-USDT-SWAP', ordId: '1' }]));

      await client.fetchPendingOrders({ instType: 'SWAP', instId: 'BTC-USDT-SWAP' });

      const [url, options] = mockInstance.get.mock.calls[0];

      expect(url).toBe('/api/v5/trade/orders-pending');
      expect(options.params).toEqual({ instType: 'SWAP', instId: 'BTC-USDT-SWAP' });
    });

    it('fetchOrderHistory calls GET /api/v5/trade/orders-history when isArchive is false', async () => {
      mockInstance.get.mockResolvedValue(okxSuccess([{ instId: 'BTC-USDT-SWAP', ordId: '1' }]));

      await client.fetchOrderHistory({ instType: 'SWAP', isArchive: false });

      const [url, options] = mockInstance.get.mock.calls[0];

      expect(url).toBe('/api/v5/trade/orders-history');
      expect(options.params).toEqual({ instType: 'SWAP' });
    });

    it('fetchOrderHistory calls GET /api/v5/trade/orders-history-archive when isArchive is true', async () => {
      mockInstance.get.mockResolvedValue(okxSuccess([{ instId: 'BTC-USDT-SWAP', ordId: '1' }]));

      await client.fetchOrderHistory({ instType: 'SWAP', isArchive: true, begin: '1', end: '2' });

      const [url, options] = mockInstance.get.mock.calls[0];

      expect(url).toBe('/api/v5/trade/orders-history-archive');
      expect(options.params).toEqual({ instType: 'SWAP', begin: '1', end: '2' });
    });

    it('fetchAlgoOrder calls GET /api/v5/trade/order-algo with algoId', async () => {
      mockInstance.get.mockResolvedValue(okxSuccess([{ algoId: '1' }]));

      await client.fetchAlgoOrder({ algoId: '1' });

      const [url, options] = mockInstance.get.mock.calls[0];

      expect(url).toBe('/api/v5/trade/order-algo');
      expect(options.params).toEqual({ algoId: '1' });
    });

    it('fetchPendingAlgoOrders calls GET /api/v5/trade/orders-algo-pending with ordType', async () => {
      mockInstance.get.mockResolvedValue(okxSuccess([{ algoId: '1' }]));

      await client.fetchPendingAlgoOrders({ ordType: 'conditional', instType: 'SWAP' });

      const [url, options] = mockInstance.get.mock.calls[0];

      expect(url).toBe('/api/v5/trade/orders-algo-pending');
      expect(options.params).toEqual({ ordType: 'conditional', instType: 'SWAP' });
    });

    it('fetchAlgoOrderHistory calls GET /api/v5/trade/orders-algo-history with ordType and state', async () => {
      mockInstance.get.mockResolvedValue(okxSuccess([{ algoId: '1' }]));

      await client.fetchAlgoOrderHistory({ ordType: 'conditional', state: 'effective', algoId: '1' });

      const [url, options] = mockInstance.get.mock.calls[0];

      expect(url).toBe('/api/v5/trade/orders-algo-history');
      expect(options.params).toEqual({ ordType: 'conditional', state: 'effective', algoId: '1' });
    });
  });

  describe('signed POST methods', () => {
    it('setPositionMode calls POST /api/v5/account/set-position-mode with posMode', async () => {
      mockInstance.post.mockResolvedValue(okxSuccess([{ posMode: 'long_short_mode' }]));

      const result = await client.setPositionMode('long_short_mode');

      const [url, body] = mockInstance.post.mock.calls[0];

      expect(url).toBe('/api/v5/account/set-position-mode');
      expect(body).toEqual({ posMode: 'long_short_mode' });
      expect(result).toEqual([{ posMode: 'long_short_mode' }]);
    });

    it('setLeverage calls POST /api/v5/account/set-leverage with body', async () => {
      mockInstance.post.mockResolvedValue(okxSuccess([{ instId: 'BTC-USDT-SWAP', lever: '10', mgnMode: 'cross', posSide: 'long' }]));

      await client.setLeverage({ instId: 'BTC-USDT-SWAP', lever: '10', mgnMode: 'cross', posSide: 'long' });

      const [url, body] = mockInstance.post.mock.calls[0];

      expect(url).toBe('/api/v5/account/set-leverage');
      expect(body).toEqual({ instId: 'BTC-USDT-SWAP', lever: '10', mgnMode: 'cross', posSide: 'long' });
    });

    it('placeOrder calls POST /api/v5/trade/order and returns data[0] on success', async () => {
      mockInstance.post.mockResolvedValue(okxSuccess([{ ordId: '1', clOrdId: 'cid1', tag: '', ts: '1', sCode: '0', sMsg: '' }]));

      const result = await client.placeOrder({ instId: 'BTC-USDT-SWAP', side: 'buy' });

      const [url, body] = mockInstance.post.mock.calls[0];

      expect(url).toBe('/api/v5/trade/order');
      expect(body).toEqual({ instId: 'BTC-USDT-SWAP', side: 'buy' });
      expect(result).toEqual({ ordId: '1', clOrdId: 'cid1', tag: '', ts: '1', sCode: '0', sMsg: '' });
    });

    it('cancelOrder calls POST /api/v5/trade/cancel-order with instId and ordId', async () => {
      mockInstance.post.mockResolvedValue(okxSuccess([{ ordId: '1', clOrdId: '', tag: '', ts: '1', sCode: '0', sMsg: '' }]));

      await client.cancelOrder({ instId: 'BTC-USDT-SWAP', ordId: '1' });

      const [url, body] = mockInstance.post.mock.calls[0];

      expect(url).toBe('/api/v5/trade/cancel-order');
      expect(body).toEqual({ instId: 'BTC-USDT-SWAP', ordId: '1' });
    });

    it('amendOrder calls POST /api/v5/trade/amend-order', async () => {
      mockInstance.post.mockResolvedValue(okxSuccess([{ ordId: '1', clOrdId: '', tag: '', ts: '1', sCode: '0', sMsg: '' }]));

      await client.amendOrder({ instId: 'BTC-USDT-SWAP', ordId: '1', newSz: '2' });

      const [url, body] = mockInstance.post.mock.calls[0];

      expect(url).toBe('/api/v5/trade/amend-order');
      expect(body).toEqual({ instId: 'BTC-USDT-SWAP', ordId: '1', newSz: '2' });
    });

    it('placeAlgoOrder calls POST /api/v5/trade/order-algo', async () => {
      mockInstance.post.mockResolvedValue(okxSuccess([{ algoId: '1', clOrdId: '', algoClOrdId: '', sCode: '0', sMsg: '' }]));

      await client.placeAlgoOrder({ instId: 'BTC-USDT-SWAP', ordType: 'conditional' });

      const [url, body] = mockInstance.post.mock.calls[0];

      expect(url).toBe('/api/v5/trade/order-algo');
      expect(body).toEqual({ instId: 'BTC-USDT-SWAP', ordType: 'conditional' });
    });

    it('amendAlgoOrder calls POST /api/v5/trade/amend-algos', async () => {
      mockInstance.post.mockResolvedValue(okxSuccess([{ algoId: '1', clOrdId: '', algoClOrdId: '', sCode: '0', sMsg: '' }]));

      await client.amendAlgoOrder({ algoId: '1', newSz: '2' });

      const [url, body] = mockInstance.post.mock.calls[0];

      expect(url).toBe('/api/v5/trade/amend-algos');
      expect(body).toEqual({ algoId: '1', newSz: '2' });
    });

    it('cancelAlgoOrders calls POST /api/v5/trade/cancel-algos with an array body', async () => {
      mockInstance.post.mockResolvedValue({ data: { code: '0', msg: '', data: [{ algoId: '1', clOrdId: '', algoClOrdId: '', sCode: '0', sMsg: '' }] } });

      await client.cancelAlgoOrders([{ algoId: '1', instId: 'BTC-USDT-SWAP' }]);

      const [url, body] = mockInstance.post.mock.calls[0];

      expect(url).toBe('/api/v5/trade/cancel-algos');
      expect(body).toEqual([{ algoId: '1', instId: 'BTC-USDT-SWAP' }]);
    });
  });

  describe('batch POST methods', () => {
    it('placeBatchOrders sends an array body and returns the full response', async () => {
      mockInstance.post.mockResolvedValue({
        data: { code: '0', msg: '', data: [{ ordId: '1', clOrdId: '', tag: '', ts: '1', sCode: '0', sMsg: '' }] },
      });

      const paramsList = [{ instId: 'BTC-USDT-SWAP', side: 'buy' }, { instId: 'ETH-USDT-SWAP', side: 'sell' }];
      const result = await client.placeBatchOrders(paramsList);

      const [, body] = mockInstance.post.mock.calls[0];

      expect(Array.isArray(body)).toBe(true);
      expect(body).toEqual(paramsList);
      expect(result.code).toBe('0');
      expect(result.data).toHaveLength(1);
    });

    it('placeBatchOrders does not throw on code 2 (partial success) and returns the full response', async () => {
      mockInstance.post.mockResolvedValue({
        data: {
          code: '2',
          msg: '',
          data: [
            { ordId: '1', clOrdId: '', tag: '', ts: '1', sCode: '0', sMsg: '' },
            { ordId: '', clOrdId: '', tag: '', ts: '1', sCode: '51008', sMsg: 'Insufficient balance' },
          ],
        },
      });

      const result = await client.placeBatchOrders([{ instId: 'BTC-USDT-SWAP' }, { instId: 'ETH-USDT-SWAP' }]);

      expect(result.code).toBe('2');
      expect(result.data).toHaveLength(2);
    });

    it('placeBatchOrders throws on a genuine top-level error code', async () => {
      mockInstance.post.mockResolvedValue({ data: { code: '50011', msg: 'Too many requests', data: [] } });

      await expect(client.placeBatchOrders([{ instId: 'BTC-USDT-SWAP' }])).rejects.toThrow(ExchangeError);
    });

    it('cancelBatchOrders sends an array body', async () => {
      mockInstance.post.mockResolvedValue({
        data: { code: '0', msg: '', data: [{ ordId: '1', clOrdId: '', tag: '', ts: '1', sCode: '0', sMsg: '' }] },
      });

      const paramsList = [{ instId: 'BTC-USDT-SWAP', ordId: '1' }];
      await client.cancelBatchOrders(paramsList);

      const [url, body] = mockInstance.post.mock.calls[0];

      expect(url).toBe('/api/v5/trade/cancel-batch-orders');
      expect(body).toEqual(paramsList);
    });

    it('amendBatchOrders sends an array body', async () => {
      mockInstance.post.mockResolvedValue({
        data: { code: '0', msg: '', data: [{ ordId: '1', clOrdId: '', tag: '', ts: '1', sCode: '0', sMsg: '' }] },
      });

      const paramsList = [{ instId: 'BTC-USDT-SWAP', ordId: '1', newSz: '2' }];
      await client.amendBatchOrders(paramsList);

      const [url, body] = mockInstance.post.mock.calls[0];

      expect(url).toBe('/api/v5/trade/amend-batch-orders');
      expect(body).toEqual(paramsList);
    });
  });

  describe('order response validation', () => {
    it('placeOrder throws an ExchangeError from sCode when code is 1', async () => {
      mockInstance.post.mockResolvedValue({
        data: { code: '1', msg: 'Operation failed', data: [{ ordId: '', clOrdId: '', tag: '', ts: '1', sCode: '51008', sMsg: 'Insufficient balance' }] },
      });

      await expect(client.placeOrder({ instId: 'BTC-USDT-SWAP' })).rejects.toThrow('Insufficient balance');

      try {
        await client.placeOrder({ instId: 'BTC-USDT-SWAP' });
      } catch (error) {
        expect((error as ExchangeError).code).toBe(51008);
      }
    });

    it('placeOrder returns data[0] on success', async () => {
      mockInstance.post.mockResolvedValue(okxSuccess([{ ordId: '1', clOrdId: 'cid1', tag: '', ts: '1', sCode: '0', sMsg: '' }]));

      const result = await client.placeOrder({ instId: 'BTC-USDT-SWAP' });

      expect(result).toEqual({ ordId: '1', clOrdId: 'cid1', tag: '', ts: '1', sCode: '0', sMsg: '' });
    });

    it('placeOrder throws OKX_EMPTY_ORDER_RESPONSE when data is empty on success', async () => {
      mockInstance.post.mockResolvedValue(okxSuccess([]));

      try {
        await client.placeOrder({ instId: 'BTC-USDT-SWAP' });
        throw new Error('expected placeOrder to throw');
      } catch (error) {
        expect((error as ExchangeError).code).toBe('OKX_EMPTY_ORDER_RESPONSE');
      }
    });

    it('cancelOrder logs an expected error and throws with the numeric sCode when the order is already gone', async () => {
      mockInstance.post.mockResolvedValue({
        data: { code: '1', msg: 'Operation failed', data: [{ ordId: '', clOrdId: '', tag: '', ts: '1', sCode: '51400', sMsg: 'Cancellation failed as the order does not exist' }] },
      });

      try {
        await client.cancelOrder({ instId: 'BTC-USDT-SWAP', ordId: '1' });
        throw new Error('expected cancelOrder to throw');
      } catch (error) {
        expect((error as ExchangeError).code).toBe(51400);
      }

      expect(logger.info).toHaveBeenCalled();
      expect(logger.error).not.toHaveBeenCalled();
    });
  });

  describe('fetchIndexTickers', () => {
    it('asks the public index endpoint by index id', async () => {
      mockInstance.get.mockResolvedValue(okxSuccess([]));

      await client.fetchIndexTickers({ instId: 'BTC-USDT' });

      const [url, options] = mockInstance.get.mock.calls[0];

      expect(url).toBe('/api/v5/market/index-tickers');
      expect(options.params).toEqual({ instId: 'BTC-USDT' });
      expect(options.headers['OK-ACCESS-SIGN']).toBeUndefined();
    });

    it('asks by quote currency when no index id is given', async () => {
      mockInstance.get.mockResolvedValue(okxSuccess([]));

      await client.fetchIndexTickers({ quoteCcy: 'USDT' });

      const [, options] = mockInstance.get.mock.calls[0];

      expect(options.params).toEqual({ quoteCcy: 'USDT' });
    });
  });

  describe('a batch rejected before per-entry handling', () => {
    it('carries the exchange reason out instead of an empty list', async () => {
      mockInstance.post.mockResolvedValue({ data: { code: '1', msg: 'Batch orders exceed the limit', data: [] } });

      await expect(client.placeBatchOrders([{ instId: 'BTC-USDT-SWAP' }]))
        .rejects.toThrow('Batch orders exceed the limit');
    });

    it('reports the same for a cancel batch', async () => {
      mockInstance.post.mockResolvedValue({ data: { code: '1', msg: 'All operations failed', data: [] } });

      await expect(client.cancelBatchOrders([{ instId: 'BTC-USDT-SWAP', ordId: '1' }]))
        .rejects.toThrow('All operations failed');
    });

    it('still returns per-entry outcomes when the exchange gave them', async () => {
      mockInstance.post.mockResolvedValue({
        data: { code: '1', msg: '', data: [{ ordId: '', clOrdId: '', tag: '', ts: '1', sCode: '51008', sMsg: 'no balance' }] },
      });

      const response = await client.placeBatchOrders([{ instId: 'BTC-USDT-SWAP' }]);

      expect(response.data).toHaveLength(1);
      expect(response.data[0].sCode).toBe('51008');
    });
  });

  describe('per-entry rejection with a success envelope', () => {
    it('refuses an order the exchange rejected inside a code 0 envelope', async () => {
      mockInstance.post.mockResolvedValue({
        data: { code: '0', msg: '', data: [{ ordId: '', clOrdId: '', tag: '', ts: '1', sCode: '51008', sMsg: 'insufficient balance' }] },
      });

      await expect(client.placeOrder({ instId: 'BTC-USDT-SWAP' })).rejects.toMatchObject({ code: 51008 });
    });

    it('refuses an algo order rejected inside a code 0 envelope', async () => {
      mockInstance.post.mockResolvedValue({
        data: { code: '0', msg: '', data: [{ algoId: '', clOrdId: '', algoClOrdId: '', sCode: '51008', sMsg: 'insufficient balance' }] },
      });

      await expect(client.placeAlgoOrder({ instId: 'BTC-USDT-SWAP' })).rejects.toThrow('51008');
    });

    it('still returns the entry when both the envelope and the entry say success', async () => {
      mockInstance.post.mockResolvedValue({
        data: { code: '0', msg: '', data: [{ ordId: 'ok-1', clOrdId: '', tag: '', ts: '1', sCode: '0', sMsg: '' }] },
      });

      await expect(client.placeOrder({ instId: 'BTC-USDT-SWAP' })).resolves.toMatchObject({ ordId: 'ok-1' });
    });
  });

  describe('signature — signed GET', () => {
    it('builds correct OKX auth headers', async () => {
      mockInstance.get.mockResolvedValue(okxSuccess([{ instId: 'BTC-USDT-SWAP' }]));

      await client.fetchPositions({ instType: 'SWAP' });

      const [, options] = mockInstance.get.mock.calls[0];
      const expectedSign = hmacSha256Base64(`${TIMESTAMP}GET/api/v5/account/positions?instType=SWAP`, 'testSecret');

      expect(options.headers['OK-ACCESS-KEY']).toBe('testKey');
      expect(options.headers['OK-ACCESS-PASSPHRASE']).toBe('testPassphrase');
      expect(options.headers['OK-ACCESS-TIMESTAMP']).toBe(TIMESTAMP);
      expect(options.headers['OK-ACCESS-SIGN']).toBe(expectedSign);
    });

    it('does not include the demo header when isDemoMode is false', async () => {
      mockInstance.get.mockResolvedValue(okxSuccess([{ instId: 'BTC-USDT-SWAP' }]));

      await client.fetchPositions({ instType: 'SWAP' });

      const [, options] = mockInstance.get.mock.calls[0];

      expect(options.headers['x-simulated-trading']).toBeUndefined();
    });
  });

  describe('signature — signed POST', () => {
    it('builds correct OKX auth headers from the JSON body', async () => {
      mockInstance.post.mockResolvedValue(okxSuccess([{ ordId: '1', clOrdId: '', tag: '', ts: '1', sCode: '0', sMsg: '' }]));

      const body = { instId: 'BTC-USDT-SWAP', side: 'buy' };
      await client.placeOrder(body);

      const [, , options] = mockInstance.post.mock.calls[0];
      const bodyText = JSON.stringify(body);
      const expectedSign = hmacSha256Base64(`${TIMESTAMP}POST/api/v5/trade/order${bodyText}`, 'testSecret');

      expect(options.headers['OK-ACCESS-SIGN']).toBe(expectedSign);
      expect(options.headers['OK-ACCESS-KEY']).toBe('testKey');
      expect(options.headers['OK-ACCESS-PASSPHRASE']).toBe('testPassphrase');
      expect(options.headers['OK-ACCESS-TIMESTAMP']).toBe(TIMESTAMP);
    });
  });

  describe('public requests without signing', () => {
    it('do not include auth headers', async () => {
      mockInstance.get.mockResolvedValue(okxSuccess([{ instId: 'BTC-USDT-SWAP' }]));

      await client.fetchTickers('SWAP');

      const [, options] = mockInstance.get.mock.calls[0];

      expect(options.headers['OK-ACCESS-KEY']).toBeUndefined();
      expect(options.headers['x-simulated-trading']).toBeUndefined();
    });
  });

  describe('demo mode', () => {
    let demoClient: OkxHttpClient;

    beforeEach(() => {
      mockInstance = createMockAxiosInstance();
      mockedAxios.create.mockReturnValue(mockInstance as any);

      demoClient = new OkxHttpClient({
        baseUrl: 'https://www.okx.com',
        apiKey: 'testKey',
        secret: 'testSecret',
        passphrase: 'testPassphrase',
        isDemoMode: true,
        logger: createMockLogger(),
      });
    });

    it('adds x-simulated-trading header to public requests', async () => {
      mockInstance.get.mockResolvedValue(okxSuccess([{ instId: 'BTC-USDT-SWAP' }]));

      await demoClient.fetchTickers('SWAP');

      const [, options] = mockInstance.get.mock.calls[0];

      expect(options.headers['x-simulated-trading']).toBe('1');
    });

    it('adds x-simulated-trading header to signed requests', async () => {
      mockInstance.get.mockResolvedValue(okxSuccess([{ instId: 'BTC-USDT-SWAP' }]));

      await demoClient.fetchPositions({ instType: 'SWAP' });

      const [, options] = mockInstance.get.mock.calls[0];

      expect(options.headers['x-simulated-trading']).toBe('1');
    });

    it('adds x-simulated-trading header to signed POST requests', async () => {
      mockInstance.post.mockResolvedValue(okxSuccess([{ ordId: '1', clOrdId: '', tag: '', ts: '1', sCode: '0', sMsg: '' }]));

      await demoClient.placeOrder({ instId: 'BTC-USDT-SWAP' });

      const [, , options] = mockInstance.post.mock.calls[0];

      expect(options.headers['x-simulated-trading']).toBe('1');
    });
  });

  describe('validateResponse', () => {
    it('throws ExchangeError with numeric code and exchange OKX', async () => {
      mockInstance.get.mockResolvedValue({ data: { code: '51000', msg: 'Parameter posSide error', data: [] } });

      try {
        await client.fetchTickers('SWAP');
        throw new Error('expected fetchTickers to throw');
      } catch (error) {
        expect(error).toBeInstanceOf(ExchangeError);
        expect((error as ExchangeError).code).toBe(51000);
        expect((error as ExchangeError).exchange).toBe('OKX');
      }
    });

    it('logs info and still throws for an expected error code', async () => {
      const logger = createMockLogger();

      mockInstance = createMockAxiosInstance();
      mockedAxios.create.mockReturnValue(mockInstance as any);

      const localClient = new OkxHttpClient({
        baseUrl: 'https://www.okx.com',
        apiKey: 'testKey',
        secret: 'testSecret',
        passphrase: 'testPassphrase',
        isDemoMode: false,
        logger,
      });

      mockInstance.get.mockResolvedValue({ data: { code: '51603', msg: 'Order does not exist', data: [] } });

      await expect(localClient.fetchTickers('SWAP')).rejects.toThrow(ExchangeError);
      expect(logger.info).toHaveBeenCalled();
    });

    it('keeps a non-numeric code as a string', async () => {
      mockInstance.get.mockResolvedValue({ data: { code: 'abc', msg: 'Unknown', data: [] } });

      try {
        await client.fetchTickers('SWAP');
        throw new Error('expected fetchTickers to throw');
      } catch (error) {
        expect((error as ExchangeError).code).toBe('abc');
      }
    });

    it('keeps an empty string code as a string instead of coercing it to zero', async () => {
      mockInstance.get.mockResolvedValue({ data: { code: '', msg: 'Unknown', data: [] } });

      try {
        await client.fetchTickers('SWAP');
        throw new Error('expected fetchTickers to throw');
      } catch (error) {
        expect((error as ExchangeError).code).toBe('');
      }
    });

    it('reports a protection page (HTML with HTTP 200) as an exchange error, not as a language crash', async () => {
      mockInstance.get.mockResolvedValue({ data: '<html>Cloudflare: too many requests</html>' });

      await expect(client.fetchTickers('SWAP')).rejects.toMatchObject({
        code: 'OKX_UNEXPECTED_RESPONSE_FORMAT',
        exchange: 'OKX',
      });
    });

    it('reports a body from a proxy that answers in its own format as an exchange error', async () => {
      mockInstance.get.mockResolvedValue({ data: { message: 'service unavailable' } });

      const error = await client.fetchTickers('SWAP').catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ExchangeError);
      expect(error).not.toBeInstanceOf(TypeError);
    });

    it('reports a null body as an exchange error instead of dereferencing it', async () => {
      mockInstance.get.mockResolvedValue({ data: null });

      await expect(client.fetchTickers('SWAP')).rejects.toMatchObject({ code: 'OKX_UNEXPECTED_RESPONSE_FORMAT' });
    });

    it('reports a signed POST answered outside the OKX format as an exchange error', async () => {
      mockInstance.post.mockResolvedValue({ data: '<html>Cloudflare</html>' });

      await expect(client.placeOrder({ instId: 'BTC-USDT-SWAP' })).rejects.toMatchObject({
        code: 'OKX_UNEXPECTED_RESPONSE_FORMAT',
      });
    });
  });

  describe('50102 stale timestamp retry', () => {
    it('re-signs and retries a signed GET once, then succeeds', async () => {
      let nowMs = 1700000000000;

      jest.spyOn(Date, 'now').mockImplementation(() => nowMs);
      mockInstance.get
        .mockImplementationOnce(() => {
          nowMs += 9000;

          return Promise.resolve({ data: { code: '50102', msg: 'Timestamp request expired.', data: [] } });
        })
        .mockResolvedValueOnce(okxSuccess([{ totalEq: '1000' }]));

      const result = await client.fetchBalance();

      expect(result).toEqual([{ totalEq: '1000' }]);
      expect(mockInstance.get).toHaveBeenCalledTimes(2);

      const [, firstOptions] = mockInstance.get.mock.calls[0];
      const [, secondOptions] = mockInstance.get.mock.calls[1];
      const secondTimestamp = secondOptions.headers['OK-ACCESS-TIMESTAMP'];
      const expectedSecondSign = hmacSha256Base64(`${secondTimestamp}GET/api/v5/account/balance`, 'testSecret');

      expect(secondTimestamp).not.toBe(firstOptions.headers['OK-ACCESS-TIMESTAMP']);
      expect(secondOptions.headers['OK-ACCESS-SIGN']).toBe(expectedSecondSign);
    });

    it('re-signs and retries a signed POST once, then succeeds', async () => {
      let nowMs = 1700000000000;

      jest.spyOn(Date, 'now').mockImplementation(() => nowMs);
      mockInstance.post
        .mockImplementationOnce(() => {
          nowMs += 9000;

          return Promise.resolve({ data: { code: '50102', msg: 'Timestamp request expired.', data: [] } });
        })
        .mockResolvedValueOnce(okxSuccess([{ ordId: '1', clOrdId: '', tag: '', ts: '1', sCode: '0', sMsg: '' }]));

      await client.placeOrder({ instId: 'BTC-USDT-SWAP' });

      expect(mockInstance.post).toHaveBeenCalledTimes(2);
      expect(logger.warn).toHaveBeenCalled();

      const [, , firstOptions] = mockInstance.post.mock.calls[0];
      const [, , secondOptions] = mockInstance.post.mock.calls[1];

      expect(firstOptions.headers['OK-ACCESS-TIMESTAMP']).not.toBe(secondOptions.headers['OK-ACCESS-TIMESTAMP']);
    });

    it('gives up after the second rejection instead of retrying forever', async () => {
      mockInstance.post.mockResolvedValue({ data: { code: '50102', msg: 'Timestamp request expired.', data: [] } });

      await expect(client.placeOrder({ instId: 'BTC-USDT-SWAP' })).rejects.toThrow(ExchangeError);
      expect(mockInstance.post).toHaveBeenCalledTimes(2);
    });

    it('re-signs and retries when axios throws an HTTP 401 carrying code 50102', async () => {
      const axiosError: any = new Error('Request failed with status code 401');
      axiosError.response = { status: 401, data: { code: '50102', msg: 'Timestamp request expired.' } };
      axiosError.isAxiosError = true;

      mockInstance.post
        .mockRejectedValueOnce(axiosError)
        .mockResolvedValueOnce(okxSuccess([{ ordId: '1', clOrdId: '', tag: '', ts: '1', sCode: '0', sMsg: '' }]));

      const result = await client.placeOrder({ instId: 'BTC-USDT-SWAP' });

      expect(result).toEqual({ ordId: '1', clOrdId: '', tag: '', ts: '1', sCode: '0', sMsg: '' });
      expect(mockInstance.post).toHaveBeenCalledTimes(2);
    });
  });

  describe('50011 rate limit retry', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('retries a public GET once on 50011 and returns the second response', async () => {
      mockInstance.get
        .mockResolvedValueOnce({ data: { code: '50011', msg: 'Too Many Requests', data: [] } })
        .mockResolvedValueOnce({ data: { code: '0', msg: '', data: [] } });

      const resultPromise = client.fetchTickers('SWAP');

      await jest.advanceTimersByTimeAsync(1000);
      const result = await resultPromise;

      expect(result).toEqual([]);
      expect(mockInstance.get).toHaveBeenCalledTimes(2);
    });

    it('does not retry a signed POST on 50011 — throws immediately', async () => {
      mockInstance.post.mockResolvedValue({ data: { code: '50011', msg: 'Too Many Requests', data: [] } });

      await expect(client.placeOrder({ instId: 'BTC-USDT-SWAP' })).rejects.toThrow(ExchangeError);
      expect(mockInstance.post).toHaveBeenCalledTimes(1);
    });
  });

  describe('fetchAllPendingOrders', () => {
    function buildOrderList(fromInclusive: number, toInclusive: number) {
      const list = [];

      for (let i = fromInclusive; i <= toInclusive; i++) {
        list.push({ instId: 'BTC-USDT-SWAP', ordId: String(i) });
      }

      return list;
    }

    it('pages through results until a short page is returned', async () => {
      mockInstance.get
        .mockResolvedValueOnce(okxSuccess(buildOrderList(1, 100)))
        .mockResolvedValueOnce(okxSuccess(buildOrderList(101, 103)));

      const result = await client.fetchAllPendingOrders({ instType: 'SWAP' });

      expect(result).toHaveLength(103);
      expect(mockInstance.get).toHaveBeenCalledTimes(2);

      const [, secondOptions] = mockInstance.get.mock.calls[1];

      expect(secondOptions.params.after).toBe('100');
    });

    it('makes a single call when the first page is already short', async () => {
      mockInstance.get.mockResolvedValueOnce(okxSuccess(buildOrderList(1, 3)));

      const result = await client.fetchAllPendingOrders({ instType: 'SWAP' });

      expect(result).toHaveLength(3);
      expect(mockInstance.get).toHaveBeenCalledTimes(1);
    });
  });

  describe('fetchAllPendingAlgoOrders', () => {
    function buildAlgoOrderList(fromInclusive: number, toInclusive: number) {
      const list = [];

      for (let i = fromInclusive; i <= toInclusive; i++) {
        list.push({ instId: 'BTC-USDT-SWAP', algoId: String(i) });
      }

      return list;
    }

    it('pages through conditional orders until a short page is returned', async () => {
      mockInstance.get
        .mockResolvedValueOnce(okxSuccess(buildAlgoOrderList(1, OKX_ORDER_PAGE_LIMIT)))
        .mockResolvedValueOnce(okxSuccess(buildAlgoOrderList(101, 104)));

      const result = await client.fetchAllPendingAlgoOrders({ ordType: 'conditional,oco', instType: 'SWAP' });

      expect(result).toHaveLength(OKX_ORDER_PAGE_LIMIT + 4);
      expect(mockInstance.get).toHaveBeenCalledTimes(2);

      const [, secondOptions] = mockInstance.get.mock.calls[1];

      expect(secondOptions.params.after).toBe(String(OKX_ORDER_PAGE_LIMIT));
      expect(secondOptions.params.limit).toBe(String(OKX_ORDER_PAGE_LIMIT));
    });

    it('makes a single call when the first page of conditional orders is already short', async () => {
      mockInstance.get.mockResolvedValueOnce(okxSuccess(buildAlgoOrderList(1, 4)));

      const result = await client.fetchAllPendingAlgoOrders({ ordType: 'conditional,oco', instType: 'SWAP' });

      expect(result).toHaveLength(4);
      expect(mockInstance.get).toHaveBeenCalledTimes(1);
    });

    it('warns and stops at the page count limit instead of paging forever', async () => {
      mockInstance.get.mockResolvedValue(okxSuccess(buildAlgoOrderList(1, OKX_ORDER_PAGE_LIMIT)));

      const result = await client.fetchAllPendingAlgoOrders({ ordType: 'conditional,oco', instType: 'SWAP' });

      expect(mockInstance.get).toHaveBeenCalledTimes(OKX_MAX_PAGE_COUNT);
      expect(result).toHaveLength(OKX_MAX_PAGE_COUNT * OKX_ORDER_PAGE_LIMIT);
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe('fetchAllOrderHistory', () => {
    function buildOrderList(fromInclusive: number, toInclusive: number) {
      const list = [];

      for (let i = fromInclusive; i <= toInclusive; i++) {
        list.push({ instId: 'BTC-USDT-SWAP', ordId: String(i) });
      }

      return list;
    }

    it('pages the order history by order id until a short page is returned', async () => {
      mockInstance.get
        .mockResolvedValueOnce(okxSuccess(buildOrderList(1, OKX_ORDER_PAGE_LIMIT)))
        .mockResolvedValueOnce(okxSuccess(buildOrderList(101, 104)));

      const result = await client.fetchAllOrderHistory({ instType: 'SWAP', isArchive: false, maxRecordCount: 1000 });

      expect(result).toHaveLength(OKX_ORDER_PAGE_LIMIT + 4);
      expect(mockInstance.get.mock.calls[0][0]).toBe('/api/v5/trade/orders-history');
      expect(mockInstance.get.mock.calls[1][1].params.after).toBe(String(OKX_ORDER_PAGE_LIMIT));
    });

    it('stops as soon as the caller has as many rows as asked for', async () => {
      mockInstance.get.mockResolvedValue(okxSuccess(buildOrderList(1, OKX_ORDER_PAGE_LIMIT)));

      const result = await client.fetchAllOrderHistory({ instType: 'SWAP', isArchive: false, maxRecordCount: 10 });

      expect(mockInstance.get).toHaveBeenCalledTimes(1);
      expect(result).toHaveLength(OKX_ORDER_PAGE_LIMIT);
    });

    it('reads the archive endpoint when the caller asks for the archive window', async () => {
      mockInstance.get.mockResolvedValue(okxSuccess([]));

      await client.fetchAllOrderHistory({ instType: 'SWAP', isArchive: true, maxRecordCount: 10 });

      expect(mockInstance.get.mock.calls[0][0]).toBe('/api/v5/trade/orders-history-archive');
    });
  });

  describe('fetchAllAlgoOrderHistory', () => {
    function buildAlgoOrderList(fromInclusive: number, toInclusive: number) {
      const list = [];

      for (let i = fromInclusive; i <= toInclusive; i++) {
        list.push({ instId: 'BTC-USDT-SWAP', algoId: String(i) });
      }

      return list;
    }

    it('pages the conditional order history by algo id until a short page is returned', async () => {
      mockInstance.get
        .mockResolvedValueOnce(okxSuccess(buildAlgoOrderList(1, OKX_ORDER_PAGE_LIMIT)))
        .mockResolvedValueOnce(okxSuccess(buildAlgoOrderList(101, 102)));

      const result = await client.fetchAllAlgoOrderHistory({
        ordType: 'conditional,oco',
        state: 'effective',
        instType: 'SWAP',
        maxRecordCount: 1000,
      });

      expect(result).toHaveLength(OKX_ORDER_PAGE_LIMIT + 2);
      expect(mockInstance.get.mock.calls[0][0]).toBe('/api/v5/trade/orders-algo-history');
      expect(mockInstance.get.mock.calls[1][1].params.after).toBe(String(OKX_ORDER_PAGE_LIMIT));
      expect(mockInstance.get.mock.calls[1][1].params.state).toBe('effective');
    });
  });

  describe('fetchAllPositionsHistory', () => {
    function buildPositionHistoryList(fromInclusive: number, toInclusive: number) {
      const list = [];

      for (let i = fromInclusive; i <= toInclusive; i++) {
        list.push({ instId: 'BTC-USDT-SWAP', posId: String(i), uTime: String(2000000 - i) });
      }

      return list;
    }

    it('pages the position history by close time until a short page is returned', async () => {
      mockInstance.get
        .mockResolvedValueOnce(okxSuccess(buildPositionHistoryList(1, OKX_POSITIONS_HISTORY_PAGE_LIMIT)))
        .mockResolvedValueOnce(okxSuccess(buildPositionHistoryList(101, 102)));

      const result = await client.fetchAllPositionsHistory({ instType: 'SWAP', maxRecordCount: 1000 });

      expect(result).toHaveLength(OKX_POSITIONS_HISTORY_PAGE_LIMIT + 2);
      expect(mockInstance.get.mock.calls[0][0]).toBe('/api/v5/account/positions-history');
      expect(mockInstance.get.mock.calls[1][1].params.after).toBe(String(2000000 - OKX_POSITIONS_HISTORY_PAGE_LIMIT));
    });
  });
});
