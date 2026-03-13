import axios from 'axios';
import { BybitSpot } from '../../src/exchanges/BybitSpot';
import { createMockLogger } from '../fixtures/mockLogger';
import { createMockAxiosInstance } from '../fixtures/mockAxios';
import {
  BYBIT_RAW_INSTRUMENT_LIST,
  BYBIT_RAW_TICKER_LIST,
  BYBIT_RAW_KLINE_LIST,
  BYBIT_RAW_WALLET_BALANCE,
} from '../fixtures/bybitRaw';
import { BTCUSDT_SPOT_TRADE_SYMBOL } from '../fixtures/mockTradeSymbol';
import { OrderTypeEnum, OrderSideEnum, MarginModeEnum } from '../../src/types/common';

jest.mock('axios');
jest.mock('../../src/ws/BybitPublicStream');
jest.mock('../../src/ws/BybitTradeStream');

const mockedAxios = axios as jest.Mocked<typeof axios>;

function createClient(isDemoMode = false) {
  const mockInstance = createMockAxiosInstance();
  mockedAxios.create.mockReturnValue(mockInstance as any);

  const client = new BybitSpot({
    config: { apiKey: 'testKey', secret: 'testSecret', isDemoMode },
    logger: createMockLogger(),
  });

  return { client, mockInstance };
}

describe('BybitSpot', () => {
  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(1700000000000);
  });

  describe('createOrderWebSocket (demo mode — REST fallback)', () => {
    it('adds marketUnit=baseCoin for market orders', async () => {
      const { client, mockInstance } = createClient(true);
      client.tradeSymbols.set('BTCUSDT', BTCUSDT_SPOT_TRADE_SYMBOL);

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
      const { client, mockInstance } = createClient(true);
      client.tradeSymbols.set('BTCUSDT', BTCUSDT_SPOT_TRADE_SYMBOL);

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

  describe('createOrderWebSocket optional params (demo mode — REST fallback)', () => {
    it('sends clientOrderId as orderLinkId', async () => {
      const { client, mockInstance } = createClient(true);
      client.tradeSymbols.set('BTCUSDT', BTCUSDT_SPOT_TRADE_SYMBOL);

      mockInstance.post.mockResolvedValue({
        data: { retCode: 0, result: { orderId: '123', symbol: 'BTCUSDT', side: 'Buy', orderType: 'Market', qty: '0.001', price: '0', orderStatus: 'New', createdTime: '1700000000000' } },
      });

      await client.createOrderWebSocket({ symbol: 'BTCUSDT', type: OrderTypeEnum.Market, side: OrderSideEnum.Buy, amount: 0.001, clientOrderId: 'custom-id' });

      const [, body] = mockInstance.post.mock.calls[0];

      expect(body.orderLinkId).toBe('custom-id');
    });
  });

  describe('createOrderWebSocket (non-demo — WebSocket path)', () => {
    it('delegates to tradeStream.createOrder', async () => {
      const { client } = createClient(false);
      client.tradeSymbols.set('BTCUSDT', BTCUSDT_SPOT_TRADE_SYMBOL);

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
        expect.objectContaining({ category: 'spot', symbol: 'BTCUSDT' }),
      );
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

  describe('loadTradeSymbols', () => {
    it('fetches and normalizes spot trade symbols', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({
        data: { result: { list: BYBIT_RAW_INSTRUMENT_LIST } },
      });

      const tradeSymbolBySymbol = await client.loadTradeSymbols();

      expect(tradeSymbolBySymbol.size).toBeGreaterThan(0);
      expect(tradeSymbolBySymbol.get('ETHBTC')).toBeDefined();
      expect(tradeSymbolBySymbol.get('ETHBTC')!.baseAsset).toBe('ETH');
    });
  });

  describe('fetchTickers', () => {
    it('fetches and normalizes spot tickers', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({
        data: { result: { list: BYBIT_RAW_TICKER_LIST } },
      });

      const tickerBySymbol = await client.fetchTickers();

      expect(tickerBySymbol.size).toBeGreaterThan(0);
      expect(tickerBySymbol.get('BTCUSDT')).toBeDefined();
      expect(tickerBySymbol.get('BTCUSDT')!.lastPrice).toBe(65432.1);
    });
  });

  describe('fetchKlines', () => {
    it('fetches and normalizes klines', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({
        data: { result: { list: BYBIT_RAW_KLINE_LIST } },
      });

      const klineList = await client.fetchKlines('BTCUSDT', '1h');

      expect(klineList).toHaveLength(2);
      expect(klineList[0].openTimestamp).toBe(1700000000000);
      expect(klineList[0].openPrice).toBe(65000);
    });
  });

  describe('fetchBalance', () => {
    it('fetches and normalizes wallet balance', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({
        data: { result: BYBIT_RAW_WALLET_BALANCE },
      });

      const balanceByAsset = await client.fetchBalance();

      expect(balanceByAsset.size).toBeGreaterThan(0);
      expect(balanceByAsset.get('USDT')).toBeDefined();
      expect(balanceByAsset.get('BTC')).toBeDefined();
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

    it('calls publicStream.close without tradeStream in demo mode', async () => {
      const { client } = createClient(true);

      await client.close();

      const publicStream = (client as any).publicStream;
      const tradeStream = (client as any).tradeStream;

      expect(publicStream.close).toHaveBeenCalled();
      expect(tradeStream).toBeNull();
    });
  });
});
