import axios from 'axios';
import { BybitLinear } from '../../src/exchanges/BybitLinear';
import { createMockLogger } from '../fixtures/mockLogger';
import { BYBIT_RAW_POSITION } from '../fixtures/bybitRaw';
import { MarketType, OrderType, OrderSide, PositionSide } from '../../src/types/common';

jest.mock('axios');
jest.mock('../../src/ws/BybitPublicStream');
jest.mock('../../src/ws/BybitTradeStream');

const mockedAxios = axios as jest.Mocked<typeof axios>;

function createClient(isDemoMode = false) {
  const mockInstance: Record<string, jest.Mock> = {
    get: jest.fn().mockResolvedValue({ data: {} }),
    post: jest.fn().mockResolvedValue({ data: {} }),
    put: jest.fn().mockResolvedValue({ data: {} }),
    delete: jest.fn().mockResolvedValue({ data: {} }),
  };
  mockedAxios.create.mockReturnValue(mockInstance as any);

  const client = new BybitLinear({
    config: { apiKey: 'testKey', secret: 'testSecret', isDemoMode },
    logger: createMockLogger(),
  });

  return { client, mockInstance };
}

describe('BybitLinear', () => {
  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(1700000000000);
  });

  it('uses production URL by default', () => {
    createClient(false);

    expect(mockedAxios.create).toHaveBeenCalledWith(
      expect.objectContaining({ baseURL: 'https://api.bybit.com' }),
    );
  });

  it('uses demo URL when isDemoMode is true', () => {
    createClient(true);

    expect(mockedAxios.create).toHaveBeenCalledWith(
      expect.objectContaining({ baseURL: 'https://api-demo.bybit.com' }),
    );
  });

  describe('createOrderWebSocket (demo mode — REST fallback)', () => {
    it('falls back to REST in demo mode and returns order', async () => {
      const { client, mockInstance } = createClient(true);
      const mockMarket = {
        symbol: 'BTCUSDT', baseAsset: 'BTC', quoteAsset: 'USDT', settle: 'USDT',
        isActive: true, type: MarketType.Swap, isLinear: true, contractSize: 1,
        filter: { tickSize: '0.10', stepSize: '0.001', minQty: '0.001', maxQty: '1000', minNotional: '5' },
      };
      client.markets.set('BTCUSDT', mockMarket);

      mockInstance.post.mockResolvedValue({
        data: {
          retCode: 0,
          result: {
            orderId: 'rest-order-123',
            symbol: 'BTCUSDT',
            side: 'Buy',
            orderType: 'Market',
            qty: '0.001',
            price: '0',
            orderStatus: 'New',
            createdTime: '1700000000000',
          },
        },
      });

      const order = await client.createOrderWebSocket({
        symbol: 'BTCUSDT',
        type: OrderType.Market,
        side: OrderSide.Buy,
        amount: 0.001,
        price: 0,
      });

      expect(order.id).toBe('rest-order-123');
      expect(order.status).toBe('open');
    });
  });

  describe('order params construction', () => {
    it('maps market type to Market', async () => {
      const { client, mockInstance } = createClient(true);
      client.markets.set('BTCUSDT', {
        symbol: 'BTCUSDT', baseAsset: 'BTC', quoteAsset: 'USDT', settle: 'USDT',
        isActive: true, type: MarketType.Swap, isLinear: true, contractSize: 1,
        filter: { tickSize: '0.10', stepSize: '0.001', minQty: '0.001', maxQty: '1000', minNotional: '5' },
      });

      mockInstance.post.mockResolvedValue({
        data: { retCode: 0, result: { orderId: '1', symbol: 'BTCUSDT', side: 'Buy', orderType: 'Market', qty: '0.001', price: '0', orderStatus: 'New', createdTime: '1700000000000' } },
      });

      await client.createOrderWebSocket({ symbol: 'BTCUSDT', type: OrderType.Market, side: OrderSide.Buy, amount: 0.001, price: 0 });

      const [, body] = mockInstance.post.mock.calls[0];

      expect(body.orderType).toBe('Market');
      expect(body.side).toBe('Buy');
    });

    it('maps limit type to Limit', async () => {
      const { client, mockInstance } = createClient(true);
      client.markets.set('BTCUSDT', {
        symbol: 'BTCUSDT', baseAsset: 'BTC', quoteAsset: 'USDT', settle: 'USDT',
        isActive: true, type: MarketType.Swap, isLinear: true, contractSize: 1,
        filter: { tickSize: '0.10', stepSize: '0.001', minQty: '0.001', maxQty: '1000', minNotional: '5' },
      });

      mockInstance.post.mockResolvedValue({
        data: { retCode: 0, result: { orderId: '1', symbol: 'BTCUSDT', side: 'Sell', orderType: 'Limit', qty: '0.001', price: '65000', orderStatus: 'New', createdTime: '1700000000000' } },
      });

      await client.createOrderWebSocket({ symbol: 'BTCUSDT', type: OrderType.Limit, side: OrderSide.Sell, amount: 0.001, price: 65000 });

      const [, body] = mockInstance.post.mock.calls[0];

      expect(body.orderType).toBe('Limit');
      expect(body.side).toBe('Sell');
    });
  });

  describe('fetchPosition', () => {
    it('normalizes position from raw data', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({
        data: { result: { list: [BYBIT_RAW_POSITION] } },
      });

      const position = await client.fetchPosition('BTCUSDT');

      expect(position.symbol).toBe('BTCUSDT');
      expect(position.side).toBe(PositionSide.Long);
    });

    it('throws when position list is empty', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({
        data: { result: { list: [] } },
      });

      await expect(client.fetchPosition('BTCUSDT')).rejects.toThrow('Position not found for BTCUSDT');
    });
  });

  describe('setLeverage', () => {
    it('sends equal buy/sell leverage', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.post.mockResolvedValue({ data: {} });

      await client.setLeverage(20, 'BTCUSDT');

      const [, body] = mockInstance.post.mock.calls[0];

      expect(body.buyLeverage).toBe('20');
      expect(body.sellLeverage).toBe('20');
    });
  });
});
