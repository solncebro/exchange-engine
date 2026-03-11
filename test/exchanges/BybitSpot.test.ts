import axios from 'axios';
import { BybitSpot } from '../../src/exchanges/BybitSpot';
import { createMockLogger } from '../fixtures/mockLogger';
import {
  BYBIT_RAW_INSTRUMENT_LIST,
  BYBIT_RAW_TICKER_LIST,
  BYBIT_RAW_KLINE_LIST,
  BYBIT_RAW_WALLET_BALANCE,
} from '../fixtures/bybitRaw';
import { TradeSymbolTypeEnum, OrderTypeEnum, OrderSideEnum, MarginModeEnum } from '../../src/types/common';

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
      client.tradeSymbols.set('BTCUSDT', {
        symbol: 'BTCUSDT', baseAsset: 'BTC', quoteAsset: 'USDT', settle: '',
        isActive: true, type: TradeSymbolTypeEnum.Spot, isLinear: false, contractSize: 1,
        filter: { tickSize: '0.01', stepSize: '0.001', minQty: '0.001', maxQty: '1000', minNotional: '5' },
      });

      mockInstance.post.mockResolvedValue({
        data: {
          retCode: 0,
          result: { orderId: '123', symbol: 'BTCUSDT', side: 'Buy', orderType: 'Market', qty: '0.001', price: '0', orderStatus: 'New', createdTime: '1700000000000' },
        },
      });

      await client.createOrderWebSocket({ symbol: 'BTCUSDT', type: OrderTypeEnum.Market, side: OrderSideEnum.Buy, amount: 0.001, price: 0 });

      const [, body] = mockInstance.post.mock.calls[0];

      expect(body.marketUnit).toBe('baseCoin');
    });

    it('does not add marketUnit for limit orders', async () => {
      const { client, mockInstance } = createClient();
      client.tradeSymbols.set('BTCUSDT', {
        symbol: 'BTCUSDT', baseAsset: 'BTC', quoteAsset: 'USDT', settle: '',
        isActive: true, type: TradeSymbolTypeEnum.Spot, isLinear: false, contractSize: 1,
        filter: { tickSize: '0.01', stepSize: '0.001', minQty: '0.001', maxQty: '1000', minNotional: '5' },
      });

      mockInstance.post.mockResolvedValue({
        data: {
          retCode: 0,
          result: { orderId: '123', symbol: 'BTCUSDT', side: 'Buy', orderType: 'Limit', qty: '0.001', price: '65000', orderStatus: 'New', createdTime: '1700000000000' },
        },
      });

      await client.createOrderWebSocket({ symbol: 'BTCUSDT', type: OrderTypeEnum.Limit, side: OrderSideEnum.Buy, amount: 0.001, price: 65000 });

      const [, body] = mockInstance.post.mock.calls[0];

      expect(body.marketUnit).toBeUndefined();
    });
  });

  describe('createOrderWebSocket optional params', () => {
    it('sends clientOrderId as orderLinkId', async () => {
      const { client, mockInstance } = createClient();
      client.tradeSymbols.set('BTCUSDT', {
        symbol: 'BTCUSDT', baseAsset: 'BTC', quoteAsset: 'USDT', settle: '',
        isActive: true, type: TradeSymbolTypeEnum.Spot, isLinear: false, contractSize: 1,
        filter: { tickSize: '0.01', stepSize: '0.001', minQty: '0.001', maxQty: '1000', minNotional: '5' },
      });

      mockInstance.post.mockResolvedValue({
        data: { retCode: 0, result: { orderId: '123', symbol: 'BTCUSDT', side: 'Buy', orderType: 'Market', qty: '0.001', price: '0', orderStatus: 'New', createdTime: '1700000000000' } },
      });

      await client.createOrderWebSocket({ symbol: 'BTCUSDT', type: OrderTypeEnum.Market, side: OrderSideEnum.Buy, amount: 0.001, clientOrderId: 'custom-id' });

      const [, body] = mockInstance.post.mock.calls[0];

      expect(body.orderLinkId).toBe('custom-id');
    });
  });

  it('throws "Not supported" for fetchOrderHistory', async () => {
    const { client } = createClient();

    await expect(client.fetchOrderHistory('BTCUSDT')).rejects.toThrow('Not supported for spot market');
  });

  it('throws "Not supported" for fetchFundingInfo', async () => {
    const { client } = createClient();

    await expect(client.fetchFundingInfo()).rejects.toThrow('Not supported for spot market');
  });

  it('throws "Not supported" for fetchPositionMode', async () => {
    const { client } = createClient();

    await expect(client.fetchPositionMode()).rejects.toThrow('Not supported for spot market');
  });

  it('throws "Not supported" for fetchFundingRateHistory', async () => {
    const { client } = createClient();

    await expect(client.fetchFundingRateHistory()).rejects.toThrow('Not supported for spot market');
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

  describe('loadTradeSymbols', () => {
    it('fetches and normalizes spot trade symbols', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({
        data: { result: { list: BYBIT_RAW_INSTRUMENT_LIST } },
      });

      const tradeSymbols = await client.loadTradeSymbols();

      expect(tradeSymbols.size).toBeGreaterThan(0);
      expect(tradeSymbols.get('ETHBTC')).toBeDefined();
      expect(tradeSymbols.get('ETHBTC')!.baseAsset).toBe('ETH');
    });
  });

  describe('fetchTickers', () => {
    it('fetches and normalizes spot tickers', async () => {
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

  describe('close', () => {
    it('calls publicStream.close', async () => {
      const { client } = createClient();

      await client.close();

      const publicStream = (client as any).publicStream;

      expect(publicStream.close).toHaveBeenCalled();
    });
  });
});
