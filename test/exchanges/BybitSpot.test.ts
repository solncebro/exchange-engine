import axios from 'axios';
import { BybitSpot } from '../../src/exchanges/BybitSpot';
import { createMockLogger } from '../fixtures/mockLogger';
import { MarketType, OrderType, OrderSide, MarginMode } from '../../src/types/common';

jest.mock('axios');
jest.mock('../../src/ws/BybitPublicStream');

const mockedAxios = axios as jest.Mocked<typeof axios>;

function createClient() {
  const mockInstance: Record<string, jest.Mock> = {
    get: jest.fn().mockResolvedValue({ data: {} }),
    post: jest.fn().mockResolvedValue({ data: {} }),
    put: jest.fn().mockResolvedValue({ data: {} }),
    delete: jest.fn().mockResolvedValue({ data: {} }),
  };
  mockedAxios.create.mockReturnValue(mockInstance as any);

  const client = new BybitSpot({
    config: { apiKey: 'testKey', secret: 'testSecret' },
    logger: createMockLogger(),
  });

  return { client, mockInstance };
}

describe('BybitSpot', () => {
  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(1700000000000);
  });

  describe('createOrderWebSocket', () => {
    it('adds marketUnit=baseCoin for market orders', async () => {
      const { client, mockInstance } = createClient();
      client.markets.set('BTCUSDT', {
        symbol: 'BTCUSDT', baseAsset: 'BTC', quoteAsset: 'USDT', settle: '',
        isActive: true, type: MarketType.Spot, isLinear: false, contractSize: 1,
        filter: { tickSize: '0.01', stepSize: '0.001', minQty: '0.001', maxQty: '1000', minNotional: '5' },
      });

      mockInstance.post.mockResolvedValue({
        data: {
          retCode: 0,
          result: { orderId: '123', symbol: 'BTCUSDT', side: 'Buy', orderType: 'Market', qty: '0.001', price: '0', orderStatus: 'New', createdTime: '1700000000000' },
        },
      });

      await client.createOrderWebSocket({ symbol: 'BTCUSDT', type: OrderType.Market, side: OrderSide.Buy, amount: 0.001, price: 0 });

      const [, body] = mockInstance.post.mock.calls[0];

      expect(body.marketUnit).toBe('baseCoin');
    });

    it('does not add marketUnit for limit orders', async () => {
      const { client, mockInstance } = createClient();
      client.markets.set('BTCUSDT', {
        symbol: 'BTCUSDT', baseAsset: 'BTC', quoteAsset: 'USDT', settle: '',
        isActive: true, type: MarketType.Spot, isLinear: false, contractSize: 1,
        filter: { tickSize: '0.01', stepSize: '0.001', minQty: '0.001', maxQty: '1000', minNotional: '5' },
      });

      mockInstance.post.mockResolvedValue({
        data: {
          retCode: 0,
          result: { orderId: '123', symbol: 'BTCUSDT', side: 'Buy', orderType: 'Limit', qty: '0.001', price: '65000', orderStatus: 'New', createdTime: '1700000000000' },
        },
      });

      await client.createOrderWebSocket({ symbol: 'BTCUSDT', type: OrderType.Limit, side: OrderSide.Buy, amount: 0.001, price: 65000 });

      const [, body] = mockInstance.post.mock.calls[0];

      expect(body.marketUnit).toBeUndefined();
    });
  });

  it('throws "Not supported" for fetchPosition', async () => {
    const { client } = createClient();

    await expect(client.fetchPosition('BTCUSDT')).rejects.toThrow('Not supported for spot market');
  });

  it('throws "Not supported" for setLeverage', async () => {
    const { client } = createClient();

    await expect(client.setLeverage(10, 'BTCUSDT')).rejects.toThrow('Not supported for spot market');
  });

  it('throws "Not supported" for setMarginMode', async () => {
    const { client } = createClient();

    await expect(client.setMarginMode(MarginMode.Isolated, 'BTCUSDT')).rejects.toThrow('Not supported for spot market');
  });
});
