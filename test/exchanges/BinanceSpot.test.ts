import axios from 'axios';
import { BinanceSpot } from '../../src/exchanges/BinanceSpot';
import { BinanceSpotUserDataStream } from '../../src/ws/BinanceSpotUserDataStream';
import { createMockLogger } from '../fixtures/mockLogger';
import { createMockAxiosInstance } from '../fixtures/mockAxios';
import {
  BINANCE_RAW_ORDER_RESPONSE,
  BINANCE_RAW_ORDER_BOOK,
  BINANCE_RAW_PUBLIC_TRADE_LIST,
} from '../fixtures/binanceRaw';
import { MarginModeEnum, OrderSideEnum, OrderTypeEnum } from '../../src/types/common';

jest.mock('axios');
jest.mock('../../src/ws/BinanceSpotPublicStream');
jest.mock('../../src/ws/BinanceTradeStream');
jest.mock('../../src/ws/BinanceSpotUserDataStream');

const mockedAxios = axios as jest.Mocked<typeof axios>;
const MockedSpotUserDataStream = BinanceSpotUserDataStream as jest.MockedClass<typeof BinanceSpotUserDataStream>;

function createClient() {
  const mockInstance = createMockAxiosInstance();
  mockedAxios.create.mockReturnValue(mockInstance as any);

  const client = new BinanceSpot({
    config: { apiKey: 'testKey', secret: 'testSecret' },
    logger: createMockLogger(),
  });

  return { client, mockInstance };
}

describe('BinanceSpot', () => {
  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(1700000000000);
  });

  describe('cancelOrder', () => {
    it('returns normalized order', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.delete.mockResolvedValue({ data: BINANCE_RAW_ORDER_RESPONSE });

      const result = await client.cancelOrder('BTCUSDT', '12345');

      expect(result.id).toBe('123456789');
      expect(result.symbol).toBe('BTCUSDT');
      expect(result.side).toBe(OrderSideEnum.Buy);
    });
  });

  describe('getOrder', () => {
    it('returns normalized order', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({ data: BINANCE_RAW_ORDER_RESPONSE });

      const result = await client.getOrder('BTCUSDT', '12345');

      expect(result.id).toBe('123456789');
      expect(result.symbol).toBe('BTCUSDT');
      expect(result.side).toBe(OrderSideEnum.Buy);
      expect(result.type).toBe(OrderTypeEnum.Limit);
    });
  });

  describe('fetchOpenOrders', () => {
    it('returns array of normalized orders', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({ data: [BINANCE_RAW_ORDER_RESPONSE] });

      const result = await client.fetchOpenOrders();

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('123456789');
      expect(result[0].symbol).toBe('BTCUSDT');
    });
  });

  // Раньше защитные заявки отбирались домашним условием «цена срабатывания больше нуля»,
  // и заявка с нулевой ценой срабатывания была невидима. Условность — свойство ТИПА заявки,
  // а не её цены; так это устроено и на соседней бирже.
  describe('fetchOpenConditionalOrders', () => {
    it('finds a stop even when its trigger price is zero', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({
        data: [{ ...BINANCE_RAW_ORDER_RESPONSE, type: 'STOP_LOSS', stopPrice: '0' }],
      });

      const result = await client.fetchOpenConditionalOrders('USDT');

      expect(result).toHaveLength(1);
      expect(result[0].isConditional).toBe(true);
    });

    it('does not mistake an ordinary limit order for a protective one', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({
        data: [{ ...BINANCE_RAW_ORDER_RESPONSE, type: 'LIMIT', stopPrice: '0' }],
      });

      const result = await client.fetchOpenConditionalOrders('USDT');

      expect(result).toHaveLength(0);
    });
  });

  describe('fetchOrderBook', () => {
    it('returns normalized order book with parsed numbers', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({ data: BINANCE_RAW_ORDER_BOOK });

      const result = await client.fetchOrderBook('BTCUSDT');

      expect(result.symbol).toBe('BTCUSDT');
      expect(result.askList).toHaveLength(2);
      expect(result.askList[0].price).toBe(65001);
      expect(result.askList[0].quantity).toBe(0.8);
      expect(result.bidList).toHaveLength(2);
      expect(result.bidList[0].price).toBe(65000);
      expect(result.bidList[0].quantity).toBe(1.5);
    });
  });

  describe('fetchTrades', () => {
    it('returns normalized public trades', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({ data: BINANCE_RAW_PUBLIC_TRADE_LIST });

      const result = await client.fetchTrades('BTCUSDT');

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('12345');
      expect(result[0].symbol).toBe('BTCUSDT');
      expect(result[0].price).toBe(65000.5);
      expect(result[0].quantity).toBe(0.1);
      expect(result[0].isBuyerMaker).toBe(false);
    });
  });

  it('throws "Not supported" for fetchFundingRateHistory', async () => {
    const { client } = createClient();

    await expect(client.fetchFundingRateHistory('BTCUSDT')).rejects.toThrow('Not supported for spot market');
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

    await expect(client.setMarginMode(MarginModeEnum.Isolated, 'BTCUSDT')).rejects.toThrow('Not supported for spot market');
  });

  it('throws "Not supported" for fetchFundingInfo', async () => {
    const { client } = createClient();

    await expect(client.fetchFundingInfo()).rejects.toThrow('Not supported for spot market');
  });

  it('throws "Not supported" for fetchPositionMode', async () => {
    const { client } = createClient();

    await expect(client.fetchPositionMode()).rejects.toThrow('Not supported for spot market');
  });

  describe('fetchOrderHistory', () => {
    it('returns normalized order list', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({ data: [BINANCE_RAW_ORDER_RESPONSE] });

      const result = await client.fetchOrderHistory('BTCUSDT');

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('123456789');
      expect(result[0].symbol).toBe('BTCUSDT');
      expect(result[0].side).toBe(OrderSideEnum.Buy);
    });

    it('calls signedGet /api/v3/allOrders', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({ data: [] });

      await client.fetchOrderHistory('BTCUSDT');

      const [url, options] = mockInstance.get.mock.calls[0];

      expect(url).toBe('/api/v3/allOrders');
      expect(options.params.symbol).toBe('BTCUSDT');
      expect(options.params.signature).toBeDefined();
    });
  });

  describe('connectUserDataStream (WebSocket API)', () => {
    const createHandler = () => ({
      onOrderUpdate: jest.fn(),
      onPositionUpdate: jest.fn(),
      onBalanceUpdate: jest.fn(),
    });

    it('connects a spot user data stream instead of throwing', async () => {
      const { client } = createClient();

      await client.connectUserDataStream(createHandler());

      expect(MockedSpotUserDataStream).toHaveBeenCalledTimes(1);
      expect(MockedSpotUserDataStream.mock.instances[0].connect).toHaveBeenCalled();
    });

    it('does not connect a second stream on repeated calls', async () => {
      const { client } = createClient();
      const handler = createHandler();

      await client.connectUserDataStream(handler);
      await client.connectUserDataStream(handler);

      expect(MockedSpotUserDataStream).toHaveBeenCalledTimes(1);
    });

    it('maps executionReport to onOrderUpdate', async () => {
      const { client } = createClient();
      const handler = createHandler();

      await client.connectUserDataStream(handler);
      const onMessage = MockedSpotUserDataStream.mock.calls[0][0].onMessage;
      onMessage({ e: 'executionReport', s: 'BTCUSDT', i: 99, c: 'cli-1', S: 'SELL', X: 'FILLED', p: '50000', q: '0.5', z: '0.5', Z: '25000', E: 1700000000000 });

      expect(handler.onOrderUpdate).toHaveBeenCalledWith(expect.objectContaining({
        symbol: 'BTCUSDT',
        orderId: '99',
        clientOrderId: 'cli-1',
        side: OrderSideEnum.Sell,
        status: 'closed',
        amount: 0.5,
        filledAmount: 0.5,
        avgPrice: 50000,
      }));
    });

    it('maps outboundAccountPosition to onBalanceUpdate', async () => {
      const { client } = createClient();
      const handler = createHandler();

      await client.connectUserDataStream(handler);
      const onMessage = MockedSpotUserDataStream.mock.calls[0][0].onMessage;
      onMessage({ e: 'outboundAccountPosition', E: 1700000000000, B: [{ a: 'USDT', f: '100.5', l: '0.5' }] });

      expect(handler.onBalanceUpdate).toHaveBeenCalledWith({
        balanceList: [{ asset: 'USDT', free: 100.5, locked: 0.5, total: null }],
        timestamp: 1700000000000,
      });
    });
  });
});
