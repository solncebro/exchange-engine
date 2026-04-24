import axios from 'axios';
import { BybitLinear } from '../../src/exchanges/BybitLinear';
import { createMockLogger } from '../fixtures/mockLogger';
import { createMockAxiosInstance } from '../fixtures/mockAxios';
import {
  BYBIT_RAW_INSTRUMENT_LIST,
  BYBIT_RAW_TICKER_LIST,
  BYBIT_RAW_KLINE_LIST,
  BYBIT_RAW_WALLET_BALANCE,
  BYBIT_RAW_POSITION,
  BYBIT_RAW_ORDER_RESPONSE,
  BYBIT_RAW_ORDER_BOOK,
  BYBIT_RAW_PUBLIC_TRADE_LIST,
  BYBIT_RAW_MARK_PRICE_TICKER_LIST,
  BYBIT_RAW_OPEN_INTEREST,
  BYBIT_RAW_FEE_RATE_LIST,
  BYBIT_RAW_CLOSED_PNL_LIST,
  BYBIT_RAW_TRANSACTION_LOG_LIST,
} from '../fixtures/bybitRaw';
import { BTCUSDT_TRADE_SYMBOL } from '../fixtures/mockTradeSymbol';
import { OrderTypeEnum, OrderSideEnum, PositionSideEnum, MarginModeEnum, PositionModeEnum, TimeInForceEnum } from '../../src/types/common';
import { ExchangeError } from '../../src/errors/ExchangeError';

jest.mock('axios');
jest.mock('../../src/ws/BybitPublicStream');
jest.mock('../../src/ws/BybitTradeStream');

const mockedAxios = axios as jest.Mocked<typeof axios>;

function createClient(isDemoMode = false) {
  const mockInstance = createMockAxiosInstance();
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
      client.tradeSymbols.set('BTCUSDT', BTCUSDT_TRADE_SYMBOL);

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
      client.tradeSymbols.set('BTCUSDT', BTCUSDT_TRADE_SYMBOL);

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
      client.tradeSymbols.set('BTCUSDT', BTCUSDT_TRADE_SYMBOL);

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
      client.tradeSymbols.set('BTCUSDT', BTCUSDT_TRADE_SYMBOL);

      mockInstance.post.mockResolvedValue({
        data: { retCode: 0, result: { orderId: '1', symbol: 'BTCUSDT', side: 'Sell', orderType: 'Market', qty: '0.001', price: '0', orderStatus: 'New', createdTime: '1700000000000' } },
      });

      await client.createOrderWebSocket({ symbol: 'BTCUSDT', type: OrderTypeEnum.Market, side: OrderSideEnum.Sell, amount: 0.001, stopPrice: 60000 });

      const [, body] = mockInstance.post.mock.calls[0];

      expect(body.triggerPrice).toBe('60000');
    });

    it('sends reduceOnly when provided', async () => {
      const { client, mockInstance } = createClient(true);
      client.tradeSymbols.set('BTCUSDT', BTCUSDT_TRADE_SYMBOL);

      mockInstance.post.mockResolvedValue({
        data: { retCode: 0, result: { orderId: '1', symbol: 'BTCUSDT', side: 'Sell', orderType: 'Market', qty: '0.001', price: '0', orderStatus: 'New', createdTime: '1700000000000' } },
      });

      await client.createOrderWebSocket({ symbol: 'BTCUSDT', type: OrderTypeEnum.Market, side: OrderSideEnum.Sell, amount: 0.001, reduceOnly: true });

      const [, body] = mockInstance.post.mock.calls[0];

      expect(body.reduceOnly).toBe(true);
    });

    it('sends timeInForce when provided', async () => {
      const { client, mockInstance } = createClient(true);
      client.tradeSymbols.set('BTCUSDT', BTCUSDT_TRADE_SYMBOL);

      mockInstance.post.mockResolvedValue({
        data: { retCode: 0, result: { orderId: '1', symbol: 'BTCUSDT', side: 'Buy', orderType: 'Limit', qty: '0.001', price: '65000', orderStatus: 'New', createdTime: '1700000000000' } },
      });

      await client.createOrderWebSocket({ symbol: 'BTCUSDT', type: OrderTypeEnum.Limit, side: OrderSideEnum.Buy, amount: 0.001, price: 65000, timeInForce: TimeInForceEnum.PostOnly });

      const [, body] = mockInstance.post.mock.calls[0];

      expect(body.timeInForce).toBe('PostOnly');
    });

    it('sends clientOrderId as orderLinkId', async () => {
      const { client, mockInstance } = createClient(true);
      client.tradeSymbols.set('BTCUSDT', BTCUSDT_TRADE_SYMBOL);

      mockInstance.post.mockResolvedValue({
        data: { retCode: 0, result: { orderId: '1', symbol: 'BTCUSDT', side: 'Buy', orderType: 'Market', qty: '0.001', price: '0', orderStatus: 'New', createdTime: '1700000000000' } },
      });

      await client.createOrderWebSocket({ symbol: 'BTCUSDT', type: OrderTypeEnum.Market, side: OrderSideEnum.Buy, amount: 0.001, clientOrderId: 'my-id-123' });

      const [, body] = mockInstance.post.mock.calls[0];

      expect(body.orderLinkId).toBe('my-id-123');
    });

    it('maps positionSide=Long to positionIdx=1 in hedge mode', async () => {
      const { client, mockInstance } = createClient(true);
      client.tradeSymbols.set('BTCUSDT', BTCUSDT_TRADE_SYMBOL);

      mockInstance.post.mockResolvedValue({
        data: { retCode: 0, result: { orderId: '1', symbol: 'BTCUSDT', side: 'Buy', orderType: 'Market', qty: '0.001', price: '0', orderStatus: 'New', createdTime: '1700000000000' } },
      });

      await client.createOrderWebSocket({
        symbol: 'BTCUSDT',
        type: OrderTypeEnum.Market,
        side: OrderSideEnum.Buy,
        amount: 0.001,
        positionSide: PositionSideEnum.Long,
      });

      const [, body] = mockInstance.post.mock.calls[0];

      expect(body.positionIdx).toBe(1);
    });

    it('maps positionSide=Short to positionIdx=2 in hedge mode', async () => {
      const { client, mockInstance } = createClient(true);
      client.tradeSymbols.set('BTCUSDT', BTCUSDT_TRADE_SYMBOL);

      mockInstance.post.mockResolvedValue({
        data: { retCode: 0, result: { orderId: '1', symbol: 'BTCUSDT', side: 'Sell', orderType: 'Market', qty: '0.001', price: '0', orderStatus: 'New', createdTime: '1700000000000' } },
      });

      await client.createOrderWebSocket({
        symbol: 'BTCUSDT',
        type: OrderTypeEnum.Market,
        side: OrderSideEnum.Sell,
        amount: 0.001,
        positionSide: PositionSideEnum.Short,
      });

      const [, body] = mockInstance.post.mock.calls[0];

      expect(body.positionIdx).toBe(2);
    });

    it('omits positionIdx when positionSide is undefined (one-way mode)', async () => {
      const { client, mockInstance } = createClient(true);
      client.tradeSymbols.set('BTCUSDT', BTCUSDT_TRADE_SYMBOL);

      mockInstance.post.mockResolvedValue({
        data: { retCode: 0, result: { orderId: '1', symbol: 'BTCUSDT', side: 'Buy', orderType: 'Market', qty: '0.001', price: '0', orderStatus: 'New', createdTime: '1700000000000' } },
      });

      await client.createOrderWebSocket({
        symbol: 'BTCUSDT',
        type: OrderTypeEnum.Market,
        side: OrderSideEnum.Buy,
        amount: 0.001,
      });

      const [, body] = mockInstance.post.mock.calls[0];

      expect(body.positionIdx).toBeUndefined();
    });

    it('keeps reduceOnly alongside positionIdx in hedge mode', async () => {
      const { client, mockInstance } = createClient(true);
      client.tradeSymbols.set('BTCUSDT', BTCUSDT_TRADE_SYMBOL);

      mockInstance.post.mockResolvedValue({
        data: { retCode: 0, result: { orderId: '1', symbol: 'BTCUSDT', side: 'Sell', orderType: 'Market', qty: '0.001', price: '0', orderStatus: 'New', createdTime: '1700000000000' } },
      });

      await client.createOrderWebSocket({
        symbol: 'BTCUSDT',
        type: OrderTypeEnum.Market,
        side: OrderSideEnum.Sell,
        amount: 0.001,
        positionSide: PositionSideEnum.Long,
        reduceOnly: true,
      });

      const [, body] = mockInstance.post.mock.calls[0];

      expect(body.positionIdx).toBe(1);
      expect(body.reduceOnly).toBe(true);
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

  describe('fetchFundingRateHistory', () => {
    it('returns normalized funding rate history', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({
        data: {
          result: {
            list: [
              { symbol: 'BTCUSDT', fundingRate: '0.0001', fundingRateTimestamp: '1700000000000' },
            ],
          },
        },
      });

      const result = await client.fetchFundingRateHistory('BTCUSDT');

      expect(result).toHaveLength(1);
      expect(result[0].symbol).toBe('BTCUSDT');
      expect(result[0].fundingRate).toBe(0.0001);
      expect(result[0].fundingTime).toBe(1700000000000);
      expect(result[0].markPrice).toBeNull();
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

  describe('loadTradeSymbols', () => {
    it('fetches and normalizes linear trade symbols', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({
        data: { result: { list: BYBIT_RAW_INSTRUMENT_LIST } },
      });

      const tradeSymbolBySymbol = await client.loadTradeSymbols();

      expect(tradeSymbolBySymbol.size).toBeGreaterThan(0);
      expect(tradeSymbolBySymbol.get('BTCUSDT')).toBeDefined();
      expect(tradeSymbolBySymbol.get('BTCUSDT')!.baseAsset).toBe('BTC');
    });
  });

  describe('fetchTickers', () => {
    it('fetches and normalizes linear tickers', async () => {
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

  describe('setMarginMode', () => {
    it('is a no-op for Bybit Unified Account', async () => {
      const { client, mockInstance } = createClient();

      await client.setMarginMode(MarginModeEnum.Isolated, 'BTCUSDT');

      expect(mockInstance.post).not.toHaveBeenCalled();
    });
  });

  describe('createOrderWebSocket (non-demo — WebSocket path)', () => {
    it('delegates to tradeStream.createOrder', async () => {
      const { client } = createClient(false);
      client.tradeSymbols.set('BTCUSDT', BTCUSDT_TRADE_SYMBOL);

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
        expect.objectContaining({ category: 'linear', symbol: 'BTCUSDT' }),
      );
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
        data: { result: { list: [BYBIT_RAW_ORDER_RESPONSE] } },
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
        .mockResolvedValueOnce({ data: { result: { list: [] } } })
        .mockResolvedValueOnce({ data: { result: { list: [BYBIT_RAW_ORDER_RESPONSE] } } });

      const result = await client.getOrder('BTCUSDT', 'abc-123-def');

      expect(result.id).toBe('abc-123-def');
      expect(mockInstance.get).toHaveBeenCalledTimes(2);
    });

    it('throws when order not found in both realtime and history', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get
        .mockResolvedValueOnce({ data: { result: { list: [] } } })
        .mockResolvedValueOnce({ data: { result: { list: [] } } });

      await expect(client.getOrder('BTCUSDT', 'missing')).rejects.toThrow('Order missing not found for BTCUSDT');
      expect(mockInstance.get).toHaveBeenCalledTimes(2);
    });
  });

  describe('fetchOpenOrders', () => {
    it('returns array of normalized orders', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({
        data: { result: { list: [BYBIT_RAW_ORDER_RESPONSE] } },
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
        data: { result: BYBIT_RAW_ORDER_BOOK },
      });

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
      mockInstance.get.mockResolvedValue({
        data: { result: { list: BYBIT_RAW_PUBLIC_TRADE_LIST } },
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
        data: { result: { list: BYBIT_RAW_FEE_RATE_LIST } },
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
      mockInstance.post.mockResolvedValue({
        data: { retCode: 0, result: { orderId: 'order-1', orderLinkId: '' } },
      });
      mockInstance.get.mockResolvedValue({
        data: { result: { list: [BYBIT_RAW_ORDER_RESPONSE] } },
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

  describe('fetchMarkPrice', () => {
    it('returns normalized mark price list', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({
        data: { result: { list: BYBIT_RAW_MARK_PRICE_TICKER_LIST } },
      });

      const result = await client.fetchMarkPrice();

      expect(result).toHaveLength(2);
      expect(result[0].symbol).toBe('BTCUSDT');
      expect(result[0].markPrice).toBe(65450.5);
      expect(result[0].indexPrice).toBe(65440.2);
      expect(result[0].lastFundingRate).toBe(0.0001);
      expect(result[0].nextFundingTime).toBe(1700028800000);
    });

    it('passes symbol to httpClient when provided', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({
        data: { result: { list: [BYBIT_RAW_MARK_PRICE_TICKER_LIST[0]] } },
      });

      const result = await client.fetchMarkPrice('BTCUSDT');

      expect(result).toHaveLength(1);
      expect(result[0].symbol).toBe('BTCUSDT');

      const [, options] = mockInstance.get.mock.calls[0];

      expect(options.params.symbol).toBe('BTCUSDT');
    });
  });

  describe('fetchOpenInterest', () => {
    it('returns normalized open interest with symbol', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({
        data: { result: { list: [BYBIT_RAW_OPEN_INTEREST] } },
      });

      const result = await client.fetchOpenInterest('BTCUSDT');

      expect(result.symbol).toBe('BTCUSDT');
      expect(result.openInterest).toBe(12345.678);
      expect(result.timestamp).toBe(1700000000000);
    });
  });

  describe('fetchIncome', () => {
    it('returns normalized income list', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({
        data: { result: { list: BYBIT_RAW_TRANSACTION_LOG_LIST } },
      });

      const result = await client.fetchIncome();

      expect(result).toHaveLength(2);
      expect(result[0].symbol).toBe('BTCUSDT');
      expect(result[0].incomeType).toBe('TRADE');
      expect(result[0].income).toBe(-6500);
      expect(result[0].asset).toBe('USDT');
      expect(result[1].incomeType).toBe('FUNDING');
      expect(result[1].income).toBe(0.5);
    });
  });

  describe('fetchClosedPnl', () => {
    it('returns normalized closed PnL list', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({
        data: { result: { list: BYBIT_RAW_CLOSED_PNL_LIST } },
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

  describe('createBatchOrders', () => {
    it('returns array of orders', async () => {
      const { client, mockInstance } = createClient();
      client.tradeSymbols.set('BTCUSDT', BTCUSDT_TRADE_SYMBOL);

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

  describe('setPositionMode', () => {
    it('sends mode 3 for Hedge', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.post.mockResolvedValue({ data: { retCode: 0, result: {} } });

      await client.setPositionMode(PositionModeEnum.Hedge);

      const [, body] = mockInstance.post.mock.calls[0];

      expect(body.category).toBe('linear');
      expect(body.mode).toBe(3);
    });

    it('sends mode 0 for OneWay', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.post.mockResolvedValue({ data: { retCode: 0, result: {} } });

      await client.setPositionMode(PositionModeEnum.OneWay);

      const [, body] = mockInstance.post.mock.calls[0];

      expect(body.mode).toBe(0);
    });

    it('silently handles no-op error 110025', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.post.mockRejectedValue(
        new ExchangeError('Position mode is not modified', 110025, 'bybit'),
      );

      await expect(client.setPositionMode(PositionModeEnum.Hedge)).resolves.toBeUndefined();
    });

    it('re-throws other errors', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.post.mockRejectedValue(
        new ExchangeError('Some other error', 10001, 'bybit'),
      );

      await expect(client.setPositionMode(PositionModeEnum.Hedge)).rejects.toThrow('Some other error');
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
