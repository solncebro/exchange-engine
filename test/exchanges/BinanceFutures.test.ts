import axios from 'axios';
import { BinanceFutures } from '../../src/exchanges/BinanceFutures';
import { createMockLogger } from '../fixtures/mockLogger';
import { createMockAxiosInstance } from '../fixtures/mockAxios';
import {
  BINANCE_RAW_POSITION_RISK,
  BINANCE_RAW_FUNDING_RATE_HISTORY_LIST,
  BINANCE_RAW_EXCHANGE_INFO,
  BINANCE_RAW_TICKER_LIST,
  BINANCE_RAW_KLINE_LIST,
  BINANCE_RAW_FUTURES_ACCOUNT,
  BINANCE_RAW_ORDER_RESPONSE,
  BINANCE_RAW_FUNDING_INFO_LIST,
  BINANCE_RAW_POSITION_MODE_HEDGE,
  BINANCE_RAW_POSITION_MODE_ONE_WAY,
  BINANCE_RAW_ORDER_BOOK,
  BINANCE_RAW_PUBLIC_TRADE_LIST,
  BINANCE_RAW_MARK_PRICE_LIST,
  BINANCE_RAW_OPEN_INTEREST,
  BINANCE_RAW_COMMISSION_RATE,
  BINANCE_RAW_INCOME_LIST,
} from '../fixtures/binanceRaw';
import { MarginModeEnum, OrderSideEnum, OrderTypeEnum, PositionModeEnum, PositionSideEnum, TimeInForceEnum, TradeSymbolTypeEnum, WorkingTypeEnum } from '../../src/types/common';
import { BinanceFuturesPublicStream } from '../../src/ws/BinanceFuturesPublicStream';

jest.mock('axios');
jest.mock('../../src/ws/BinanceFuturesPublicStream');
jest.mock('../../src/ws/BinanceTradeStream');

const mockedAxios = axios as jest.Mocked<typeof axios>;

function createClient(isDemoMode = false) {
  const mockInstance = createMockAxiosInstance();
  mockedAxios.create.mockReturnValue(mockInstance as any);

  const client = new BinanceFutures({
    config: { apiKey: 'testKey', secret: 'testSecret', isDemoMode },
    logger: createMockLogger(),
  });

  return { client, mockInstance };
}

describe('BinanceFutures', () => {
  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(1700000000000);
  });

  it('uses production URL by default', () => {
    createClient(false);

    expect(mockedAxios.create).toHaveBeenCalledWith(
      expect.objectContaining({ baseURL: 'https://fapi.binance.com' }),
    );
  });

  it('uses demo URL when isDemoMode is true', () => {
    createClient(true);

    expect(mockedAxios.create).toHaveBeenCalledWith(
      expect.objectContaining({ baseURL: 'https://demo-fapi.binance.com' }),
    );
  });

  describe('fetchPosition', () => {
    it('normalizes position from raw data', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({ data: [BINANCE_RAW_POSITION_RISK] });

      const position = await client.fetchPosition('BTCUSDT');

      expect(position.symbol).toBe('BTCUSDT');
      expect(position.side).toBe(PositionSideEnum.Long);
      expect(position.contracts).toBe(0.1);
    });

    it('throws when symbol not found in response', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({ data: [] });

      await expect(client.fetchPosition('BTCUSDT')).rejects.toThrow('Position not found for BTCUSDT');
    });
  });

  describe('setLeverage', () => {
    it('calls httpClient.setLeverage with symbol and leverage', async () => {
      const { client, mockInstance } = createClient();

      await client.setLeverage(20, 'BTCUSDT');

      const [url, , options] = mockInstance.post.mock.calls[0];

      expect(url).toBe('/fapi/v1/leverage');
      expect(options.params.symbol).toBe('BTCUSDT');
      expect(options.params.leverage).toBe(20);
    });
  });

  describe('fetchFundingRateHistory', () => {
    it('returns normalized funding rate history', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({ data: BINANCE_RAW_FUNDING_RATE_HISTORY_LIST });

      const result = await client.fetchFundingRateHistory('BTCUSDT');

      expect(result).toHaveLength(2);
      expect(result[0].symbol).toBe('BTCUSDT');
      expect(result[0].fundingRate).toBe(0.0001);
      expect(result[0].fundingTime).toBe(1700006400000);
      expect(result[0].markPrice).toBe(65500);
    });

    it('returns null markPrice for empty string', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({ data: BINANCE_RAW_FUNDING_RATE_HISTORY_LIST });

      const result = await client.fetchFundingRateHistory('BTCUSDT');

      expect(result[1].markPrice).toBeNull();
    });
  });

  describe('setMarginMode', () => {
    it('maps isolated to ISOLATED', async () => {
      const { client, mockInstance } = createClient();

      await client.setMarginMode(MarginModeEnum.Isolated, 'BTCUSDT');

      const [, , options] = mockInstance.post.mock.calls[0];

      expect(options.params.marginType).toBe('ISOLATED');
    });

    it('maps cross to CROSSED', async () => {
      const { client, mockInstance } = createClient();

      await client.setMarginMode(MarginModeEnum.Cross, 'BTCUSDT');

      const [, , options] = mockInstance.post.mock.calls[0];

      expect(options.params.marginType).toBe('CROSSED');
    });

    it('does not throw when Binance returns no-op margin type error', async () => {
      const { client, mockInstance } = createClient();
      const noNeedMarginTypeError = {
        response: {
          status: 400,
          data: {
            code: -4046,
            msg: 'No need to change margin type.',
          },
        },
        message: 'Request failed with status code 400',
      };

      mockInstance.post.mockRejectedValue(noNeedMarginTypeError);

      await expect(client.setMarginMode(MarginModeEnum.Cross, 'BTCUSDT')).resolves.toBeUndefined();
    });
  });

  describe('loadTradeSymbols', () => {
    it('fetches and returns normalized trade symbols', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({ data: BINANCE_RAW_EXCHANGE_INFO });

      const result = await client.loadTradeSymbols();

      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBe(2);

      const btc = result.get('BTCUSDT');

      expect(btc).toBeDefined();
      expect(btc!.symbol).toBe('BTCUSDT');
      expect(btc!.baseAsset).toBe('BTC');
      expect(btc!.quoteAsset).toBe('USDT');
      expect(btc!.type).toBe(TradeSymbolTypeEnum.Swap);
    });

    it('always fetches fresh data on each call', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({ data: BINANCE_RAW_EXCHANGE_INFO });

      await client.loadTradeSymbols();
      await client.loadTradeSymbols();

      expect(mockInstance.get).toHaveBeenCalledTimes(2);
    });

    it('clears previous symbols before populating', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({ data: BINANCE_RAW_EXCHANGE_INFO });

      await client.loadTradeSymbols();

      expect(client.tradeSymbols.size).toBe(2);

      const singleSymbolData = {
        symbols: [BINANCE_RAW_EXCHANGE_INFO.symbols[0]],
      };

      mockInstance.get.mockResolvedValue({ data: singleSymbolData });

      await client.loadTradeSymbols();

      expect(client.tradeSymbols.size).toBe(1);
    });
  });

  describe('fetchTickers', () => {
    it('returns normalized tickers', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({ data: BINANCE_RAW_TICKER_LIST });

      const result = await client.fetchTickers();

      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBe(2);

      const btc = result.get('BTCUSDT');

      expect(btc).toBeDefined();
      expect(btc!.symbol).toBe('BTCUSDT');
      expect(btc!.lastPrice).toBe(65432.1);
      expect(btc!.priceChangePercent).toBe(2.35);
    });
  });

  describe('fetchKlines', () => {
    it('returns normalized klines', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({ data: BINANCE_RAW_KLINE_LIST });

      const result = await client.fetchKlines('BTCUSDT', '1h');

      expect(result).toHaveLength(2);
      expect(result[0].openTimestamp).toBe(1700000000000);
      expect(result[0].openPrice).toBe(65000);
      expect(result[0].highPrice).toBe(66000);
      expect(result[0].closePrice).toBe(65500);
      expect(result[0].volume).toBe(1234.56);
    });
  });

  describe('fetchBalances', () => {
    it('returns normalized balance from futures account format', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({ data: BINANCE_RAW_FUTURES_ACCOUNT });

      const result = await client.fetchBalances();

      expect(result.balanceByAsset).toBeInstanceOf(Map);
      expect(result.balanceByAsset.size).toBeGreaterThan(0);

      const usdt = result.balanceByAsset.get('USDT');

      expect(usdt).toBeDefined();
      expect(usdt!.free).toBe(1000.5);
      expect(usdt!.locked).toBe(200);
      expect(usdt!.total).toBe(1200.5);

      expect(result.balanceByAsset.has('DOGE')).toBe(false);
      expect(result.totalWalletBalance).toBe(1205.5);
      expect(result.totalAvailableBalance).toBe(1000.5);
    });
  });

  describe('createOrderWebSocket', () => {
    it('sends market order params', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({ data: BINANCE_RAW_EXCHANGE_INFO });
      await client.loadTradeSymbols();

      mockInstance.post.mockResolvedValue({ data: BINANCE_RAW_ORDER_RESPONSE });

      const result = await client.createOrderWebSocket({
        symbol: 'BTCUSDT',
        type: OrderTypeEnum.Market,
        side: OrderSideEnum.Buy,
        amount: 0.1,
        price: 0,
      });

      expect(result.id).toBe('123456789');
      expect(result.symbol).toBe('BTCUSDT');
      expect(result.side).toBe(OrderSideEnum.Buy);

      const [, , options] = mockInstance.post.mock.calls[0];

      expect(options.params.symbol).toBe('BTCUSDT');
      expect(options.params.side).toBe('BUY');
      expect(options.params.type).toBe('MARKET');
    });

    it('sends limit order params with price and timeInForce', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({ data: BINANCE_RAW_EXCHANGE_INFO });
      await client.loadTradeSymbols();

      mockInstance.post.mockResolvedValue({ data: BINANCE_RAW_ORDER_RESPONSE });

      await client.createOrderWebSocket({
        symbol: 'BTCUSDT',
        type: OrderTypeEnum.Limit,
        side: OrderSideEnum.Sell,
        amount: 0.5,
        price: 65000,
      });

      const [, , options] = mockInstance.post.mock.calls[0];

      expect(options.params.price).toBe('65000');
      expect(options.params.timeInForce).toBe('GTC');
    });

    it('sends stopPrice when provided', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({ data: BINANCE_RAW_EXCHANGE_INFO });
      await client.loadTradeSymbols();

      mockInstance.post.mockResolvedValue({ data: BINANCE_RAW_ORDER_RESPONSE });

      await client.createOrderWebSocket({
        symbol: 'BTCUSDT',
        type: OrderTypeEnum.StopMarket,
        side: OrderSideEnum.Sell,
        amount: 0.1,
        stopPrice: 60000,
      });

      const [, , options] = mockInstance.post.mock.calls[0];

      expect(options.params.stopPrice).toBe('60000');
    });

    it('sends closePosition when provided', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({ data: BINANCE_RAW_EXCHANGE_INFO });
      await client.loadTradeSymbols();

      mockInstance.post.mockResolvedValue({ data: BINANCE_RAW_ORDER_RESPONSE });

      await client.createOrderWebSocket({
        symbol: 'BTCUSDT',
        type: OrderTypeEnum.StopMarket,
        side: OrderSideEnum.Sell,
        amount: 0.1,
        stopPrice: 60000,
        closePosition: true,
      });

      const [, , options] = mockInstance.post.mock.calls[0];

      expect(options.params.closePosition).toBe(true);
    });

    it('sends workingType when provided', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({ data: BINANCE_RAW_EXCHANGE_INFO });
      await client.loadTradeSymbols();

      mockInstance.post.mockResolvedValue({ data: BINANCE_RAW_ORDER_RESPONSE });

      await client.createOrderWebSocket({
        symbol: 'BTCUSDT',
        type: OrderTypeEnum.StopMarket,
        side: OrderSideEnum.Sell,
        amount: 0.1,
        stopPrice: 60000,
        workingType: WorkingTypeEnum.MarkPrice,
      });

      const [, , options] = mockInstance.post.mock.calls[0];

      expect(options.params.workingType).toBe('MARK_PRICE');
    });

    it('sends positionSide when provided', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({ data: BINANCE_RAW_EXCHANGE_INFO });
      await client.loadTradeSymbols();

      mockInstance.post.mockResolvedValue({ data: BINANCE_RAW_ORDER_RESPONSE });

      await client.createOrderWebSocket({
        symbol: 'BTCUSDT',
        type: OrderTypeEnum.Market,
        side: OrderSideEnum.Buy,
        amount: 0.1,
        positionSide: PositionSideEnum.Long,
      });

      const [, , options] = mockInstance.post.mock.calls[0];

      expect(options.params.positionSide).toBe('LONG');
    });

    it('sends reduceOnly when provided in one-way mode (no positionSide)', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({ data: BINANCE_RAW_EXCHANGE_INFO });
      await client.loadTradeSymbols();

      mockInstance.post.mockResolvedValue({ data: BINANCE_RAW_ORDER_RESPONSE });

      await client.createOrderWebSocket({
        symbol: 'BTCUSDT',
        type: OrderTypeEnum.Market,
        side: OrderSideEnum.Sell,
        amount: 0.1,
        reduceOnly: true,
      });

      const [, , options] = mockInstance.post.mock.calls[0];

      expect(options.params.reduceOnly).toBe(true);
    });

    it('drops reduceOnly in hedge mode (when positionSide is present)', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({ data: BINANCE_RAW_EXCHANGE_INFO });
      await client.loadTradeSymbols();

      mockInstance.post.mockResolvedValue({ data: BINANCE_RAW_ORDER_RESPONSE });

      await client.createOrderWebSocket({
        symbol: 'BTCUSDT',
        type: OrderTypeEnum.Market,
        side: OrderSideEnum.Sell,
        amount: 0.1,
        positionSide: PositionSideEnum.Long,
        reduceOnly: true,
      });

      const [, , options] = mockInstance.post.mock.calls[0];

      expect(options.params.positionSide).toBe('LONG');
      expect(options.params.reduceOnly).toBeUndefined();
    });

    it('sends clientOrderId as newClientOrderId when provided', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({ data: BINANCE_RAW_EXCHANGE_INFO });
      await client.loadTradeSymbols();

      mockInstance.post.mockResolvedValue({ data: BINANCE_RAW_ORDER_RESPONSE });

      await client.createOrderWebSocket({
        symbol: 'BTCUSDT',
        type: OrderTypeEnum.Market,
        side: OrderSideEnum.Buy,
        amount: 0.1,
        clientOrderId: 'my-custom-id',
      });

      const [, , options] = mockInstance.post.mock.calls[0];

      expect(options.params.newClientOrderId).toBe('my-custom-id');
    });

    it('does not override existing timeInForce for limit orders', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({ data: BINANCE_RAW_EXCHANGE_INFO });
      await client.loadTradeSymbols();

      mockInstance.post.mockResolvedValue({ data: BINANCE_RAW_ORDER_RESPONSE });

      await client.createOrderWebSocket({
        symbol: 'BTCUSDT',
        type: OrderTypeEnum.Limit,
        side: OrderSideEnum.Buy,
        amount: 0.1,
        price: 65000,
        timeInForce: TimeInForceEnum.Ioc,
      });

      const [, , options] = mockInstance.post.mock.calls[0];

      expect(options.params.timeInForce).toBe('IOC');
    });
  });

  describe('amountToPrecision', () => {
    it('applies precision for known symbol', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({ data: BINANCE_RAW_EXCHANGE_INFO });
      await client.loadTradeSymbols();

      const result = client.amountToPrecision('BTCUSDT', 0.12345);

      expect(result).toBe(0.123);
    });

    it('floors amount to integer for unknown symbol', () => {
      const { client } = createClient();

      const result = client.amountToPrecision('UNKNOWN', 0.12345);

      expect(result).toBe(0);
    });
  });

  describe('priceToPrecision', () => {
    it('applies precision for known symbol', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({ data: BINANCE_RAW_EXCHANGE_INFO });
      await client.loadTradeSymbols();

      const result = client.priceToPrecision('BTCUSDT', 65432.123);

      expect(result).toBe(65432.1);
    });

    it('rounds price to 8 decimals for unknown symbol', () => {
      const { client } = createClient();

      const result = client.priceToPrecision('UNKNOWN', 65432.123456789012);

      expect(result).toBe(65432.12345679);
    });
  });

  describe('getMinOrderQty', () => {
    it('returns minQty for known symbol', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({ data: BINANCE_RAW_EXCHANGE_INFO });
      await client.loadTradeSymbols();

      expect(client.getMinOrderQty('BTCUSDT')).toBe(0.001);
    });

    it('returns 0 for unknown symbol', () => {
      const { client } = createClient();

      expect(client.getMinOrderQty('UNKNOWN')).toBe(0);
    });
  });

  describe('getMinNotional', () => {
    it('returns minNotional for known symbol', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({ data: BINANCE_RAW_EXCHANGE_INFO });
      await client.loadTradeSymbols();

      expect(client.getMinNotional('BTCUSDT')).toBe(5);
    });

    it('returns 0 for unknown symbol', () => {
      const { client } = createClient();

      expect(client.getMinNotional('UNKNOWN')).toBe(0);
    });
  });

  describe('fetchAllKlines', () => {
    it('returns klines for all symbols', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({ data: BINANCE_RAW_KLINE_LIST });

      const result = await client.fetchAllKlines(['BTCUSDT', 'ETHUSDT'], '1h');

      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBe(2);
      expect(result.get('BTCUSDT')).toHaveLength(2);
      expect(result.get('ETHUSDT')).toHaveLength(2);
    });
  });

  describe('subscribeKlines', () => {
    it('delegates to publicStream', () => {
      const { client } = createClient();
      const handler = jest.fn();

      client.subscribeKlines({ symbol: 'BTCUSDT', interval: '1m', handler });

      const MockedPublicStream = BinanceFuturesPublicStream as jest.MockedClass<typeof BinanceFuturesPublicStream>;
      const publicStreamInstance = MockedPublicStream.mock.instances[0];

      expect(publicStreamInstance.subscribeKlines).toHaveBeenCalledWith('BTCUSDT', '1m', handler);
    });
  });

  describe('unsubscribeKlines', () => {
    it('delegates to publicStream', () => {
      const { client } = createClient();
      const handler = jest.fn();

      client.unsubscribeKlines({ symbol: 'BTCUSDT', interval: '1m', handler });

      const MockedPublicStream = BinanceFuturesPublicStream as jest.MockedClass<typeof BinanceFuturesPublicStream>;
      const publicStreamInstance = MockedPublicStream.mock.instances[0];

      expect(publicStreamInstance.unsubscribeKlines).toHaveBeenCalledWith('BTCUSDT', '1m', handler);
    });
  });

  describe('watchTickers', () => {
    it('subscribes and yields tickers', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({ data: BINANCE_RAW_TICKER_LIST });

      const generator = client.watchTickers();
      const { value } = await generator.next();

      expect(value).toBeInstanceOf(Map);
      expect(value!.size).toBe(2);

      const MockedPublicStream = BinanceFuturesPublicStream as jest.MockedClass<typeof BinanceFuturesPublicStream>;
      const publicStreamInstance = MockedPublicStream.mock.instances[0];

      expect(publicStreamInstance.subscribeAllTickers).toHaveBeenCalled();
    });
  });

  describe('fetchFundingInfo', () => {
    it('returns normalized funding info', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({ data: BINANCE_RAW_FUNDING_INFO_LIST });

      const result = await client.fetchFundingInfo();

      expect(result).toHaveLength(2);
      expect(result[0].symbol).toBe('BTCUSDT');
      expect(result[0].fundingIntervalHours).toBe(8);
      expect(result[0].adjustedFundingRateCap).toBe(0.02);
      expect(result[0].adjustedFundingRateFloor).toBe(-0.02);
    });

    it('passes symbol to httpClient when provided', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({ data: [BINANCE_RAW_FUNDING_INFO_LIST[0]] });

      const result = await client.fetchFundingInfo('BTCUSDT');

      expect(result).toHaveLength(1);

      const [url, options] = mockInstance.get.mock.calls[0];

      expect(url).toBe('/fapi/v1/fundingInfo');
      expect(options.params.symbol).toBe('BTCUSDT');
    });
  });

  describe('fetchPositionMode', () => {
    it('returns Hedge when dualSidePosition is true', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({ data: BINANCE_RAW_POSITION_MODE_HEDGE });

      const result = await client.fetchPositionMode();

      expect(result).toBe(PositionModeEnum.Hedge);
    });

    it('returns OneWay when dualSidePosition is false', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({ data: BINANCE_RAW_POSITION_MODE_ONE_WAY });

      const result = await client.fetchPositionMode();

      expect(result).toBe(PositionModeEnum.OneWay);
    });
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

  describe('modifyOrder', () => {
    it('returns normalized order', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.put.mockResolvedValue({ data: BINANCE_RAW_ORDER_RESPONSE });

      const result = await client.modifyOrder({ symbol: 'BTCUSDT', orderId: '12345' });

      expect(result.id).toBe('123456789');
      expect(result.symbol).toBe('BTCUSDT');
      expect(result.side).toBe(OrderSideEnum.Buy);
    });
  });

  describe('cancelAllOrders', () => {
    it('completes without error', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.delete.mockResolvedValue({ data: {} });

      await expect(client.cancelAllOrders('BTCUSDT')).resolves.toBeUndefined();
    });
  });

  describe('fetchMarkPrice', () => {
    it('returns normalized mark price list', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({ data: BINANCE_RAW_MARK_PRICE_LIST });

      const result = await client.fetchMarkPrice();

      expect(result).toHaveLength(2);
      expect(result[0].symbol).toBe('BTCUSDT');
      expect(result[0].markPrice).toBe(65000.5);
      expect(result[0].indexPrice).toBe(65001);
      expect(result[0].lastFundingRate).toBe(0.0001);
    });
  });

  describe('fetchOpenInterest', () => {
    it('returns normalized open interest', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({ data: BINANCE_RAW_OPEN_INTEREST });

      const result = await client.fetchOpenInterest('BTCUSDT');

      expect(result.symbol).toBe('BTCUSDT');
      expect(result.openInterest).toBe(12345.678);
      expect(result.timestamp).toBe(1700000000000);
    });
  });

  describe('fetchFeeRate', () => {
    it('returns normalized fee rate', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({ data: BINANCE_RAW_COMMISSION_RATE });

      const result = await client.fetchFeeRate('BTCUSDT');

      expect(result).toHaveLength(1);
      expect(result[0].symbol).toBe('BTCUSDT');
      expect(result[0].makerRate).toBe(0.0002);
      expect(result[0].takerRate).toBe(0.0004);
    });
  });

  describe('fetchIncome', () => {
    it('returns normalized income list', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({ data: BINANCE_RAW_INCOME_LIST });

      const result = await client.fetchIncome();

      expect(result).toHaveLength(2);
      expect(result[0].symbol).toBe('BTCUSDT');
      expect(result[0].incomeType).toBe('REALIZED_PNL');
      expect(result[0].income).toBe(15.5);
      expect(result[0].asset).toBe('USDT');
      expect(result[1].incomeType).toBe('FUNDING_FEE');
      expect(result[1].income).toBe(-0.05);
    });
  });

  describe('createBatchOrders', () => {
    it('returns array of normalized orders', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({ data: BINANCE_RAW_EXCHANGE_INFO });
      await client.loadTradeSymbols();

      mockInstance.post.mockResolvedValue({ data: [BINANCE_RAW_ORDER_RESPONSE] });

      const result = await client.createBatchOrders([
        { symbol: 'BTCUSDT', type: OrderTypeEnum.Market, side: OrderSideEnum.Buy, amount: 0.1 },
      ]);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('123456789');
      expect(result[0].symbol).toBe('BTCUSDT');
      expect(result[0].side).toBe(OrderSideEnum.Buy);
    });
  });

  describe('cancelBatchOrders', () => {
    it('completes without error', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.delete.mockResolvedValue({ data: {} });

      await expect(client.cancelBatchOrders('BTCUSDT', ['order-1', 'order-2'])).resolves.toBeUndefined();
    });
  });

  describe('setPositionMode', () => {
    it('sends dualSidePosition true for Hedge', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.post.mockResolvedValue({ data: {} });

      await client.setPositionMode(PositionModeEnum.Hedge);

      const [, , options] = mockInstance.post.mock.calls[0];

      expect(options.params.dualSidePosition).toBe(true);
    });

    it('sends dualSidePosition false for OneWay', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.post.mockResolvedValue({ data: {} });

      await client.setPositionMode(PositionModeEnum.OneWay);

      const [, , options] = mockInstance.post.mock.calls[0];

      expect(options.params.dualSidePosition).toBe(false);
    });

    it('does not throw when Binance returns no-op position mode error', async () => {
      const { client, mockInstance } = createClient();
      const noNeedPositionModeError = {
        response: {
          status: 400,
          data: {
            code: -4059,
            msg: 'No need to change position side.',
          },
        },
        message: 'Request failed with status code 400',
      };

      mockInstance.post.mockRejectedValue(noNeedPositionModeError);

      await expect(client.setPositionMode(PositionModeEnum.Hedge)).resolves.toBeUndefined();
    });
  });

  describe('close', () => {
    it('calls publicStream.close()', async () => {
      const { client } = createClient();

      await client.close();

      const MockedPublicStream = BinanceFuturesPublicStream as jest.MockedClass<typeof BinanceFuturesPublicStream>;
      const publicStreamInstance = MockedPublicStream.mock.instances[0];

      expect(publicStreamInstance.close).toHaveBeenCalled();
    });
  });
});
