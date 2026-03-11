import axios from 'axios';
import { BybitLinear } from '../../src/exchanges/BybitLinear';
import { createMockLogger } from '../fixtures/mockLogger';
import {
  BYBIT_RAW_INSTRUMENT_LIST,
  BYBIT_RAW_TICKER_LIST,
  BYBIT_RAW_KLINE_LIST,
  BYBIT_RAW_WALLET_BALANCE,
  BYBIT_RAW_POSITION,
} from '../fixtures/bybitRaw';
import { TradeSymbolTypeEnum, OrderTypeEnum, OrderSideEnum, PositionSideEnum, MarginModeEnum, TimeInForceEnum } from '../../src/types/common';
import { BYBIT_RAW_ORDER_RESPONSE } from '../fixtures/bybitRaw';

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
        isActive: true, type: TradeSymbolTypeEnum.Swap, isLinear: true, contractSize: 1,
        filter: { tickSize: '0.10', stepSize: '0.001', minQty: '0.001', maxQty: '1000', minNotional: '5' },
      };
      client.tradeSymbols.set('BTCUSDT', mockMarket);

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
        type: OrderTypeEnum.Market,
        side: OrderSideEnum.Buy,
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
      client.tradeSymbols.set('BTCUSDT', {
        symbol: 'BTCUSDT', baseAsset: 'BTC', quoteAsset: 'USDT', settle: 'USDT',
        isActive: true, type: TradeSymbolTypeEnum.Swap, isLinear: true, contractSize: 1,
        filter: { tickSize: '0.10', stepSize: '0.001', minQty: '0.001', maxQty: '1000', minNotional: '5' },
      });

      mockInstance.post.mockResolvedValue({
        data: { retCode: 0, result: { orderId: '1', symbol: 'BTCUSDT', side: 'Buy', orderType: 'Market', qty: '0.001', price: '0', orderStatus: 'New', createdTime: '1700000000000' } },
      });

      await client.createOrderWebSocket({ symbol: 'BTCUSDT', type: OrderTypeEnum.Market, side: OrderSideEnum.Buy, amount: 0.001, price: 0 });

      const [, body] = mockInstance.post.mock.calls[0];

      expect(body.orderType).toBe('Market');
      expect(body.side).toBe('Buy');
    });

    it('maps limit type to Limit', async () => {
      const { client, mockInstance } = createClient(true);
      client.tradeSymbols.set('BTCUSDT', {
        symbol: 'BTCUSDT', baseAsset: 'BTC', quoteAsset: 'USDT', settle: 'USDT',
        isActive: true, type: TradeSymbolTypeEnum.Swap, isLinear: true, contractSize: 1,
        filter: { tickSize: '0.10', stepSize: '0.001', minQty: '0.001', maxQty: '1000', minNotional: '5' },
      });

      mockInstance.post.mockResolvedValue({
        data: { retCode: 0, result: { orderId: '1', symbol: 'BTCUSDT', side: 'Sell', orderType: 'Limit', qty: '0.001', price: '65000', orderStatus: 'New', createdTime: '1700000000000' } },
      });

      await client.createOrderWebSocket({ symbol: 'BTCUSDT', type: OrderTypeEnum.Limit, side: OrderSideEnum.Sell, amount: 0.001, price: 65000 });

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
      expect(position.side).toBe(PositionSideEnum.Long);
    });

    it('throws when position list is empty', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({
        data: { result: { list: [] } },
      });

      await expect(client.fetchPosition('BTCUSDT')).rejects.toThrow('Position not found for BTCUSDT');
    });
  });

  describe('createOrderWebSocket optional params', () => {
    it('sends stopPrice as triggerPrice', async () => {
      const { client, mockInstance } = createClient(true);
      client.tradeSymbols.set('BTCUSDT', {
        symbol: 'BTCUSDT', baseAsset: 'BTC', quoteAsset: 'USDT', settle: 'USDT',
        isActive: true, type: TradeSymbolTypeEnum.Swap, isLinear: true, contractSize: 1,
        filter: { tickSize: '0.10', stepSize: '0.001', minQty: '0.001', maxQty: '1000', minNotional: '5' },
      });

      mockInstance.post.mockResolvedValue({
        data: { retCode: 0, result: { orderId: '1', symbol: 'BTCUSDT', side: 'Sell', orderType: 'Market', qty: '0.001', price: '0', orderStatus: 'New', createdTime: '1700000000000' } },
      });

      await client.createOrderWebSocket({ symbol: 'BTCUSDT', type: OrderTypeEnum.Market, side: OrderSideEnum.Sell, amount: 0.001, stopPrice: 60000 });

      const [, body] = mockInstance.post.mock.calls[0];

      expect(body.triggerPrice).toBe('60000.0');
    });

    it('sends reduceOnly when provided', async () => {
      const { client, mockInstance } = createClient(true);
      client.tradeSymbols.set('BTCUSDT', {
        symbol: 'BTCUSDT', baseAsset: 'BTC', quoteAsset: 'USDT', settle: 'USDT',
        isActive: true, type: TradeSymbolTypeEnum.Swap, isLinear: true, contractSize: 1,
        filter: { tickSize: '0.10', stepSize: '0.001', minQty: '0.001', maxQty: '1000', minNotional: '5' },
      });

      mockInstance.post.mockResolvedValue({
        data: { retCode: 0, result: { orderId: '1', symbol: 'BTCUSDT', side: 'Sell', orderType: 'Market', qty: '0.001', price: '0', orderStatus: 'New', createdTime: '1700000000000' } },
      });

      await client.createOrderWebSocket({ symbol: 'BTCUSDT', type: OrderTypeEnum.Market, side: OrderSideEnum.Sell, amount: 0.001, reduceOnly: true });

      const [, body] = mockInstance.post.mock.calls[0];

      expect(body.reduceOnly).toBe(true);
    });

    it('sends timeInForce when provided', async () => {
      const { client, mockInstance } = createClient(true);
      client.tradeSymbols.set('BTCUSDT', {
        symbol: 'BTCUSDT', baseAsset: 'BTC', quoteAsset: 'USDT', settle: 'USDT',
        isActive: true, type: TradeSymbolTypeEnum.Swap, isLinear: true, contractSize: 1,
        filter: { tickSize: '0.10', stepSize: '0.001', minQty: '0.001', maxQty: '1000', minNotional: '5' },
      });

      mockInstance.post.mockResolvedValue({
        data: { retCode: 0, result: { orderId: '1', symbol: 'BTCUSDT', side: 'Buy', orderType: 'Limit', qty: '0.001', price: '65000', orderStatus: 'New', createdTime: '1700000000000' } },
      });

      await client.createOrderWebSocket({ symbol: 'BTCUSDT', type: OrderTypeEnum.Limit, side: OrderSideEnum.Buy, amount: 0.001, price: 65000, timeInForce: TimeInForceEnum.PostOnly });

      const [, body] = mockInstance.post.mock.calls[0];

      expect(body.timeInForce).toBe('PostOnly');
    });

    it('sends clientOrderId as orderLinkId', async () => {
      const { client, mockInstance } = createClient(true);
      client.tradeSymbols.set('BTCUSDT', {
        symbol: 'BTCUSDT', baseAsset: 'BTC', quoteAsset: 'USDT', settle: 'USDT',
        isActive: true, type: TradeSymbolTypeEnum.Swap, isLinear: true, contractSize: 1,
        filter: { tickSize: '0.10', stepSize: '0.001', minQty: '0.001', maxQty: '1000', minNotional: '5' },
      });

      mockInstance.post.mockResolvedValue({
        data: { retCode: 0, result: { orderId: '1', symbol: 'BTCUSDT', side: 'Buy', orderType: 'Market', qty: '0.001', price: '0', orderStatus: 'New', createdTime: '1700000000000' } },
      });

      await client.createOrderWebSocket({ symbol: 'BTCUSDT', type: OrderTypeEnum.Market, side: OrderSideEnum.Buy, amount: 0.001, clientOrderId: 'my-id-123' });

      const [, body] = mockInstance.post.mock.calls[0];

      expect(body.orderLinkId).toBe('my-id-123');
    });
  });

  describe('fetchOrderHistory', () => {
    it('returns normalized order list', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({
        data: { result: { list: [BYBIT_RAW_ORDER_RESPONSE] } },
      });

      const result = await client.fetchOrderHistory('BTCUSDT');

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('abc-123-def');
      expect(result[0].symbol).toBe('BTCUSDT');
      expect(result[0].side).toBe(OrderSideEnum.Buy);
    });
  });

  it('throws "Not implemented" for fetchFundingInfo', async () => {
    const { client } = createClient();

    await expect(client.fetchFundingInfo()).rejects.toThrow('Not implemented for Bybit');
  });

  it('throws "Not implemented" for fetchPositionMode', async () => {
    const { client } = createClient();

    await expect(client.fetchPositionMode()).rejects.toThrow('Not implemented for Bybit');
  });

  it('throws "Not implemented" for fetchFundingRateHistory', async () => {
    const { client } = createClient();

    await expect(client.fetchFundingRateHistory()).rejects.toThrow('Not implemented for Bybit');
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

  describe('loadTradeSymbols', () => {
    it('fetches and normalizes linear trade symbols', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({
        data: { result: { list: BYBIT_RAW_INSTRUMENT_LIST } },
      });

      const tradeSymbols = await client.loadTradeSymbols();

      expect(tradeSymbols.size).toBeGreaterThan(0);
      expect(tradeSymbols.get('BTCUSDT')).toBeDefined();
      expect(tradeSymbols.get('BTCUSDT')!.baseAsset).toBe('BTC');
    });
  });

  describe('fetchTickers', () => {
    it('fetches and normalizes linear tickers', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({
        data: { result: { list: BYBIT_RAW_TICKER_LIST } },
      });

      const tickers = await client.fetchTickers();

      expect(tickers.size).toBeGreaterThan(0);
      expect(tickers.get('BTCUSDT')).toBeDefined();
      expect(tickers.get('BTCUSDT')!.lastPrice).toBe(65432.1);
    });
  });

  describe('fetchKlines', () => {
    it('fetches and normalizes klines', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({
        data: { result: { list: BYBIT_RAW_KLINE_LIST } },
      });

      const klines = await client.fetchKlines('BTCUSDT', '1h');

      expect(klines).toHaveLength(2);
      expect(klines[0].openTimestamp).toBe(1700000000000);
      expect(klines[0].openPrice).toBe(65000);
    });
  });

  describe('fetchBalance', () => {
    it('fetches and normalizes wallet balance', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({
        data: { result: BYBIT_RAW_WALLET_BALANCE },
      });

      const balance = await client.fetchBalance();

      expect(balance.size).toBeGreaterThan(0);
      expect(balance.get('USDT')).toBeDefined();
      expect(balance.get('BTC')).toBeDefined();
    });
  });

  describe('setMarginMode', () => {
    it('sends tradeMode 1 for isolated', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.post.mockResolvedValue({ data: {} });

      await client.setMarginMode(MarginModeEnum.Isolated, 'BTCUSDT');

      const [, body] = mockInstance.post.mock.calls[0];

      expect(body.tradeMode).toBe(1);
      expect(body.symbol).toBe('BTCUSDT');
    });

    it('sends tradeMode 0 for cross', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.post.mockResolvedValue({ data: {} });

      await client.setMarginMode(MarginModeEnum.Cross, 'BTCUSDT');

      const [, body] = mockInstance.post.mock.calls[0];

      expect(body.tradeMode).toBe(0);
    });
  });

  describe('createOrderWebSocket (non-demo — WebSocket path)', () => {
    it('delegates to tradeStream.createOrder', async () => {
      const { client } = createClient(false);
      client.tradeSymbols.set('BTCUSDT', {
        symbol: 'BTCUSDT', baseAsset: 'BTC', quoteAsset: 'USDT', settle: 'USDT',
        isActive: true, type: TradeSymbolTypeEnum.Swap, isLinear: true, contractSize: 1,
        filter: { tickSize: '0.10', stepSize: '0.001', minQty: '0.001', maxQty: '1000', minNotional: '5' },
      });

      const mockOrder = {
        id: 'ws-order-456',
        symbol: 'BTCUSDT',
        type: OrderTypeEnum.Market,
        side: OrderSideEnum.Buy,
        amount: 0.001,
        price: 0,
        status: 'open' as const,
        timestamp: 1700000000000,
      };

      const tradeStream = (client as any).tradeStream;
      tradeStream.createOrder.mockResolvedValue(mockOrder);

      const order = await client.createOrderWebSocket({
        symbol: 'BTCUSDT',
        type: OrderTypeEnum.Market,
        side: OrderSideEnum.Buy,
        amount: 0.001,
        price: 0,
      });

      expect(order.id).toBe('ws-order-456');
      expect(tradeStream.createOrder).toHaveBeenCalledWith(
        expect.objectContaining({ category: 'linear', symbol: 'BTCUSDT' }),
      );
    });
  });

  describe('close', () => {
    it('calls publicStream.close and tradeStream.disconnect in non-demo mode', async () => {
      const { client } = createClient(false);

      await client.close();

      const publicStream = (client as any).publicStream;
      const tradeStream = (client as any).tradeStream;

      expect(publicStream.close).toHaveBeenCalled();
      expect(tradeStream.disconnect).toHaveBeenCalled();
    });

    it('calls only publicStream.close in demo mode', async () => {
      const { client } = createClient(true);

      await client.close();

      const publicStream = (client as any).publicStream;

      expect(publicStream.close).toHaveBeenCalled();
    });
  });
});
