import axios from 'axios';
import { BybitSpot } from '../../src/exchanges/BybitSpot';
import { createMockLogger } from '../fixtures/mockLogger';
import { createMockAxiosInstance } from '../fixtures/mockAxios';
import {
  BYBIT_RAW_INSTRUMENT_LIST,
  BYBIT_RAW_TICKER_LIST,
  BYBIT_RAW_KLINE_LIST,
  BYBIT_RAW_WALLET_BALANCE,
  BYBIT_RAW_ORDER_RESPONSE,
  BYBIT_RAW_PUBLIC_TRADE_LIST,
  BYBIT_RAW_FEE_RATE_LIST,
  BYBIT_RAW_TRANSACTION_LOG_LIST,
  BYBIT_RAW_CLOSED_PNL_LIST,
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
      tradeStream.isConnected.mockReturnValue(true);
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

  describe('fetchOrderHistory', () => {
    it('returns normalized order history', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({
        data: { retCode: 0, result: { list: [BYBIT_RAW_ORDER_RESPONSE] } },
      });

      const result = await client.fetchOrderHistory('BTCUSDT');

      expect(result).toHaveLength(1);
      expect(result[0].symbol).toBe('BTCUSDT');
    });
  });

  describe('cancelOrder', () => {
    it('returns order with canceled status', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.post.mockResolvedValue({
        data: { retCode: 0, result: { orderId: 'order-1', orderLinkId: '' } },
      });

      const result = await client.cancelOrder('BTCUSDT', 'order-1');

      expect(result.id).toBe('order-1');
      expect(result.symbol).toBe('BTCUSDT');
      expect(result.status).toBe('canceled');
    });
  });

  describe('getOrder', () => {
    it('returns order from realtime when found', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValueOnce({
        data: { retCode: 0, result: { list: [BYBIT_RAW_ORDER_RESPONSE] } },
      });

      const result = await client.getOrder('BTCUSDT', 'abc-123-def');

      expect(result.id).toBe('abc-123-def');
      expect(result.symbol).toBe('BTCUSDT');
      expect(result.side).toBe(OrderSideEnum.Buy);
      expect(result.type).toBe(OrderTypeEnum.Limit);
      expect(mockInstance.get).toHaveBeenCalledTimes(1);
    });

    it('falls back to history when not found in realtime', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get
        .mockResolvedValueOnce({ data: { retCode: 0, result: { list: [] } } })
        .mockResolvedValueOnce({ data: { retCode: 0, result: { list: [BYBIT_RAW_ORDER_RESPONSE] } } });

      const result = await client.getOrder('BTCUSDT', 'abc-123-def');

      expect(result.id).toBe('abc-123-def');
      expect(mockInstance.get).toHaveBeenCalledTimes(2);
    });

    it('throws when order not found in both realtime and history', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get
        .mockResolvedValueOnce({ data: { retCode: 0, result: { list: [] } } })
        .mockResolvedValueOnce({ data: { retCode: 0, result: { list: [] } } });

      await expect(client.getOrder('BTCUSDT', 'missing')).rejects.toThrow('Order missing not found for BTCUSDT');
      expect(mockInstance.get).toHaveBeenCalledTimes(2);
    });
  });

  describe('fetchOpenOrders', () => {
    it('returns array of normalized orders', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({
        data: { retCode: 0, result: { list: [BYBIT_RAW_ORDER_RESPONSE] } },
      });

      const result = await client.fetchOpenOrders();

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('abc-123-def');
      expect(result[0].symbol).toBe('BTCUSDT');
    });
  });

  describe('fetchOrderBook', () => {
    it('returns normalized order book', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({
        data: {
          retCode: 0,
          result: {
            a: [['65001.00', '0.800']],
            b: [['65000.00', '1.500']],
            ts: 1700000000000,
            u: 123456,
          },
        },
      });

      const result = await client.fetchOrderBook('BTCUSDT');

      expect(result.symbol).toBe('BTCUSDT');
      expect(result.askList).toHaveLength(1);
      expect(result.askList[0].price).toBe(65001);
      expect(result.askList[0].quantity).toBe(0.8);
      expect(result.bidList).toHaveLength(1);
      expect(result.bidList[0].price).toBe(65000);
      expect(result.bidList[0].quantity).toBe(1.5);
    });
  });

  describe('fetchTrades', () => {
    it('returns normalized public trades', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({
        data: { retCode: 0, result: { list: BYBIT_RAW_PUBLIC_TRADE_LIST } },
      });

      const result = await client.fetchTrades('BTCUSDT');

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('exec-1');
      expect(result[0].symbol).toBe('BTCUSDT');
      expect(result[0].price).toBe(65000.5);
      expect(result[0].quantity).toBe(0.1);
      expect(result[0].isBuyerMaker).toBe(false);
    });
  });

  describe('fetchFeeRate', () => {
    it('returns normalized fee rate list', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({
        data: { retCode: 0, result: { list: BYBIT_RAW_FEE_RATE_LIST } },
      });

      const result = await client.fetchFeeRate();

      expect(result).toHaveLength(2);
      expect(result[0].symbol).toBe('BTCUSDT');
      expect(result[0].makerRate).toBe(0.0001);
      expect(result[0].takerRate).toBe(0.0006);
    });
  });

  describe('modifyOrder', () => {
    it('amends and re-fetches the order', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.post.mockResolvedValueOnce({
        data: { retCode: 0, result: { orderId: 'order-1', orderLinkId: '' } },
      });
      mockInstance.get.mockResolvedValueOnce({
        data: { retCode: 0, result: { list: [BYBIT_RAW_ORDER_RESPONSE] } },
      });

      const result = await client.modifyOrder({ symbol: 'BTCUSDT', orderId: 'order-1', price: 66000 });

      expect(result.id).toBe('abc-123-def');
      expect(result.symbol).toBe('BTCUSDT');
    });
  });

  describe('cancelAllOrders', () => {
    it('completes without error', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.post.mockResolvedValue({
        data: { retCode: 0, result: { list: [] } },
      });

      await expect(client.cancelAllOrders('BTCUSDT')).resolves.toBeUndefined();
    });
  });

  describe('createBatchOrders', () => {
    it('returns array of orders', async () => {
      const { client, mockInstance } = createClient();
      client.tradeSymbols.set('BTCUSDT', BTCUSDT_SPOT_TRADE_SYMBOL);

      mockInstance.post.mockResolvedValue({
        data: { retCode: 0, result: { list: [{ orderId: 'batch-1' }] } },
      });

      const result = await client.createBatchOrders([
        { symbol: 'BTCUSDT', type: OrderTypeEnum.Market, side: OrderSideEnum.Buy, amount: 0.001 },
      ]);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('batch-1');
      expect(result[0].symbol).toBe('BTCUSDT');
    });
  });

  describe('cancelBatchOrders', () => {
    it('completes without error', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.post.mockResolvedValue({
        data: { retCode: 0, result: { list: [] } },
      });

      await expect(client.cancelBatchOrders('BTCUSDT', ['order-1', 'order-2'])).resolves.toBeUndefined();
    });
  });

  describe('fetchIncome', () => {
    it('returns normalized income list', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({
        data: { retCode: 0, result: { list: BYBIT_RAW_TRANSACTION_LOG_LIST } },
      });

      const result = await client.fetchIncome();

      expect(result).toHaveLength(2);
      expect(result[0].symbol).toBe('BTCUSDT');
      expect(result[0].incomeType).toBe('TRADE');
      expect(result[0].income).toBe(-6500);
      expect(result[0].asset).toBe('USDT');
    });
  });

  describe('fetchClosedPnl', () => {
    it('returns normalized closed PnL list', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({
        data: { retCode: 0, result: { list: BYBIT_RAW_CLOSED_PNL_LIST } },
      });

      const result = await client.fetchClosedPnl();

      expect(result).toHaveLength(1);
      expect(result[0].symbol).toBe('BTCUSDT');
      expect(result[0].orderId).toBe('order-1');
      expect(result[0].side).toBe(OrderSideEnum.Buy);
      expect(result[0].quantity).toBe(0.1);
      expect(result[0].entryPrice).toBe(64000);
      expect(result[0].exitPrice).toBe(65000);
      expect(result[0].closedPnl).toBe(100);
    });
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

  describe('fetchBalances', () => {
    it('fetches and normalizes wallet balance', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({
        data: { result: BYBIT_RAW_WALLET_BALANCE },
      });

      const result = await client.fetchBalances();

      expect(result.balanceByAsset.size).toBeGreaterThan(0);
      expect(result.balanceByAsset.get('USDT')).toBeDefined();
      expect(result.balanceByAsset.get('BTC')).toBeDefined();
      expect(result.totalWalletBalance).toBe(1801.1);
      expect(result.totalAvailableBalance).toBe(1501.1);
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
