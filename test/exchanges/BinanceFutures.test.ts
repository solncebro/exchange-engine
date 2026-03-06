import axios from 'axios';
import { BinanceFutures } from '../../src/exchanges/BinanceFutures';
import { createMockLogger } from '../fixtures/mockLogger';
import {
  BINANCE_RAW_POSITION_RISK,
  BINANCE_RAW_FUNDING_RATE_HISTORY,
  BINANCE_RAW_EXCHANGE_INFO,
  BINANCE_RAW_TICKER_LIST,
  BINANCE_RAW_KLINE_LIST,
  BINANCE_RAW_ACCOUNT,
  BINANCE_RAW_ORDER_RESPONSE,
} from '../fixtures/binanceRaw';
import { MarginMode, OrderSide, OrderType, PositionSide, TradeSymbolType } from '../../src/types/common';
import { BinanceFuturesPublicStream } from '../../src/ws/BinanceFuturesPublicStream';

jest.mock('axios');
jest.mock('../../src/ws/BinanceFuturesPublicStream');

const mockedAxios = axios as jest.Mocked<typeof axios>;

function createClient(isDemoMode = false) {
  const mockInstance: Record<string, jest.Mock> = {
    get: jest.fn().mockResolvedValue({ data: {} }),
    post: jest.fn().mockResolvedValue({ data: {} }),
    put: jest.fn().mockResolvedValue({ data: {} }),
    delete: jest.fn().mockResolvedValue({ data: {} }),
  };
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
      expect(position.side).toBe(PositionSide.Long);
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
      mockInstance.get.mockResolvedValue({ data: BINANCE_RAW_FUNDING_RATE_HISTORY });

      const result = await client.fetchFundingRateHistory('BTCUSDT');

      expect(result).toHaveLength(2);
      expect(result[0].symbol).toBe('BTCUSDT');
      expect(result[0].fundingRate).toBe(0.0001);
      expect(result[0].fundingTime).toBe(1700006400000);
      expect(result[0].markPrice).toBe(65500);
    });

    it('returns null markPrice for empty string', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({ data: BINANCE_RAW_FUNDING_RATE_HISTORY });

      const result = await client.fetchFundingRateHistory('BTCUSDT');

      expect(result[1].markPrice).toBeNull();
    });
  });

  describe('setMarginMode', () => {
    it('maps isolated to ISOLATED', async () => {
      const { client, mockInstance } = createClient();

      await client.setMarginMode(MarginMode.Isolated, 'BTCUSDT');

      const [, , options] = mockInstance.post.mock.calls[0];

      expect(options.params.marginType).toBe('ISOLATED');
    });

    it('maps cross to CROSSED', async () => {
      const { client, mockInstance } = createClient();

      await client.setMarginMode(MarginMode.Cross, 'BTCUSDT');

      const [, , options] = mockInstance.post.mock.calls[0];

      expect(options.params.marginType).toBe('CROSSED');
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
      expect(btc!.type).toBe(TradeSymbolType.Swap);
    });

    it('returns cached symbols on second call', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({ data: BINANCE_RAW_EXCHANGE_INFO });

      await client.loadTradeSymbols();
      const result = await client.loadTradeSymbols();

      expect(result.size).toBe(2);
      expect(mockInstance.get).toHaveBeenCalledTimes(1);
    });

    it('reloads when shouldReload is true', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({ data: BINANCE_RAW_EXCHANGE_INFO });

      await client.loadTradeSymbols();
      await client.loadTradeSymbols(true);

      expect(mockInstance.get).toHaveBeenCalledTimes(2);
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
      expect(btc!.close).toBe(65432.1);
      expect(btc!.percentage).toBe(2.35);
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

  describe('fetchBalance', () => {
    it('returns normalized balance', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({ data: BINANCE_RAW_ACCOUNT });

      const result = await client.fetchBalance();

      expect(result).toBeInstanceOf(Map);

      const usdt = result.get('USDT');

      expect(usdt).toBeDefined();
      expect(usdt!.free).toBe(1000.5);
      expect(usdt!.locked).toBe(200);
      expect(usdt!.total).toBe(1200.5);

      expect(result.has('DOGE')).toBe(false);
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
        type: OrderType.Market,
        side: OrderSide.Buy,
        amount: 0.1,
        price: 0,
      });

      expect(result.id).toBe('123456789');
      expect(result.symbol).toBe('BTCUSDT');
      expect(result.side).toBe(OrderSide.Buy);

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
        type: OrderType.Limit,
        side: OrderSide.Sell,
        amount: 0.5,
        price: 65000,
      });

      const [, , options] = mockInstance.post.mock.calls[0];

      expect(options.params.price).toBe('65000.0');
      expect(options.params.timeInForce).toBe('GTC');
    });

    it('does not override existing timeInForce for limit orders', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({ data: BINANCE_RAW_EXCHANGE_INFO });
      await client.loadTradeSymbols();

      mockInstance.post.mockResolvedValue({ data: BINANCE_RAW_ORDER_RESPONSE });

      await client.createOrderWebSocket({
        symbol: 'BTCUSDT',
        type: OrderType.Limit,
        side: OrderSide.Buy,
        amount: 0.1,
        price: 65000,
        params: { timeInForce: 'IOC' },
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

      expect(result).toBe('0.123');
    });

    it('returns raw amount for unknown symbol', () => {
      const { client } = createClient();

      const result = client.amountToPrecision('UNKNOWN', 0.12345);

      expect(result).toBe('0.12345');
    });
  });

  describe('priceToPrecision', () => {
    it('applies precision for known symbol', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({ data: BINANCE_RAW_EXCHANGE_INFO });
      await client.loadTradeSymbols();

      const result = client.priceToPrecision('BTCUSDT', 65432.123);

      expect(result).toBe('65432.1');
    });

    it('returns raw price for unknown symbol', () => {
      const { client } = createClient();

      const result = client.priceToPrecision('UNKNOWN', 65432.123);

      expect(result).toBe('65432.123');
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
