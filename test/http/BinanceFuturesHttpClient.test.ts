import axios from 'axios';
import { BinanceFuturesHttpClient } from '../../src/http/BinanceFuturesHttpClient';
import { createMockLogger } from '../fixtures/mockLogger';
import { createMockAxiosInstance } from '../fixtures/mockAxios';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('BinanceFuturesHttpClient', () => {
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

  describe('fetchMarkPrice', () => {
    it('calls GET /fapi/v1/premiumIndex without symbol', async () => {
      await client.fetchMarkPrice();

      const [url, options] = mockInstance.get.mock.calls[0];

      expect(url).toBe('/fapi/v1/premiumIndex');
      expect(options.params.symbol).toBeUndefined();
    });

    it('includes symbol when provided', async () => {
      await client.fetchMarkPrice('BTCUSDT');

      const [, options] = mockInstance.get.mock.calls[0];

      expect(options.params.symbol).toBe('BTCUSDT');
    });
  });

  describe('fetchOpenInterest', () => {
    it('calls GET /fapi/v1/openInterest with symbol', async () => {
      await client.fetchOpenInterest('BTCUSDT');

      const [url, options] = mockInstance.get.mock.calls[0];

      expect(url).toBe('/fapi/v1/openInterest');
      expect(options.params.symbol).toBe('BTCUSDT');
    });
  });

  describe('cancelAllOrders', () => {
    it('calls signedDelete /fapi/v1/allOpenOrders', async () => {
      await client.cancelAllOrders('BTCUSDT');

      const [url, options] = mockInstance.delete.mock.calls[0];

      expect(url).toBe('/fapi/v1/allOpenOrders');
      expect(options.params.symbol).toBe('BTCUSDT');
      expect(options.params.signature).toBeDefined();
    });
  });

  describe('getAllOrders', () => {
    it('calls signedGet /fapi/v1/allOrders with symbol', async () => {
      await client.getAllOrders('BTCUSDT');

      const [url, options] = mockInstance.get.mock.calls[0];

      expect(url).toBe('/fapi/v1/allOrders');
      expect(options.params.symbol).toBe('BTCUSDT');
      expect(options.params.signature).toBeDefined();
    });

    it('applies time range options', async () => {
      await client.getAllOrders('BTCUSDT', { startTime: 1000, endTime: 2000, limit: 100 });

      const [, options] = mockInstance.get.mock.calls[0];

      expect(options.params.startTime).toBe(1000);
      expect(options.params.endTime).toBe(2000);
      expect(options.params.limit).toBe(100);
    });
  });

  describe('createBatchOrders', () => {
    it('calls signedPost /fapi/v1/batchOrders with stringified order list', async () => {
      const orderList = [{ symbol: 'BTCUSDT', side: 'BUY' }];
      await client.createBatchOrders(orderList);

      const [url, , options] = mockInstance.post.mock.calls[0];

      expect(url).toBe('/fapi/v1/batchOrders');
      expect(options.params.batchOrders).toBe(JSON.stringify(orderList));
      expect(options.params.signature).toBeDefined();
    });
  });

  describe('cancelBatchOrders', () => {
    it('calls signedDelete /fapi/v1/batchOrders with stringified order ids', async () => {
      const orderIdList = ['111', '222'];
      await client.cancelBatchOrders('BTCUSDT', orderIdList);

      const [url, options] = mockInstance.delete.mock.calls[0];

      expect(url).toBe('/fapi/v1/batchOrders');
      expect(options.params.symbol).toBe('BTCUSDT');
      expect(options.params.orderIdList).toBe(JSON.stringify(orderIdList));
      expect(options.params.signature).toBeDefined();
    });
  });

  describe('fetchIncome', () => {
    it('calls signedGet /fapi/v1/income', async () => {
      await client.fetchIncome();

      const [url, options] = mockInstance.get.mock.calls[0];

      expect(url).toBe('/fapi/v1/income');
      expect(options.params.signature).toBeDefined();
    });

    it('applies time range options', async () => {
      await client.fetchIncome({ startTime: 1000, endTime: 2000, limit: 50 });

      const [, options] = mockInstance.get.mock.calls[0];

      expect(options.params.startTime).toBe(1000);
      expect(options.params.endTime).toBe(2000);
      expect(options.params.limit).toBe(50);
    });
  });

  describe('setPositionMode', () => {
    it('calls signedPost /fapi/v1/positionSide/dual', async () => {
      await client.setPositionMode(true);

      const [url, , options] = mockInstance.post.mock.calls[0];

      expect(url).toBe('/fapi/v1/positionSide/dual');
      expect(options.params.dualSidePosition).toBe(true);
      expect(options.params.signature).toBeDefined();
    });
  });

  describe('modifyPositionMargin', () => {
    it('calls signedPost /fapi/v1/positionMargin', async () => {
      await client.modifyPositionMargin('BTCUSDT', 100, 1);

      const [url, , options] = mockInstance.post.mock.calls[0];

      expect(url).toBe('/fapi/v1/positionMargin');
      expect(options.params.symbol).toBe('BTCUSDT');
      expect(options.params.amount).toBe(100);
      expect(options.params.type).toBe(1);
      expect(options.params.signature).toBeDefined();
    });
  });

  describe('fetchFundingInfo', () => {
    it('calls GET /fapi/v1/fundingInfo without symbol', async () => {
      await client.fetchFundingInfo();

      const [url, options] = mockInstance.get.mock.calls[0];

      expect(url).toBe('/fapi/v1/fundingInfo');
      expect(options.params.symbol).toBeUndefined();
    });

    it('includes symbol when provided', async () => {
      await client.fetchFundingInfo('BTCUSDT');

      const [, options] = mockInstance.get.mock.calls[0];

      expect(options.params.symbol).toBe('BTCUSDT');
    });
  });

  describe('fetchFuturesAccount', () => {
    it('calls signedGet /fapi/v2/account', async () => {
      await client.fetchFuturesAccount();

      const [url, options] = mockInstance.get.mock.calls[0];

      expect(url).toBe('/fapi/v2/account');
      expect(options.params.signature).toBeDefined();
    });
  });

  describe('fetchPositionMode', () => {
    it('calls signedGet /fapi/v1/positionSide/dual', async () => {
      await client.fetchPositionMode();

      const [url, options] = mockInstance.get.mock.calls[0];

      expect(url).toBe('/fapi/v1/positionSide/dual');
      expect(options.params.signature).toBeDefined();
    });
  });
});
