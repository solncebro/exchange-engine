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
  BINANCE_RAW_ALGO_ORDER_RESPONSE,
  BINANCE_RAW_FUNDING_INFO_LIST,
  BINANCE_RAW_POSITION_MODE_HEDGE,
  BINANCE_RAW_POSITION_MODE_ONE_WAY,
  BINANCE_RAW_ORDER_BOOK,
  BINANCE_RAW_PUBLIC_TRADE_LIST,
  BINANCE_RAW_MARK_PRICE_LIST,
  BINANCE_RAW_OPEN_INTEREST,
  BINANCE_RAW_COMMISSION_RATE,
  BINANCE_RAW_INCOME_LIST,
  BINANCE_RAW_MODIFY_BATCH_RESPONSE_MIXED,
} from '../fixtures/binanceRaw';
import { MarginModeEnum, OrderSideEnum, OrderTypeEnum, PositionModeEnum, PositionSideEnum, TimeInForceEnum, TradeSymbolTypeEnum, WorkingTypeEnum } from '../../src/types/common';
import { BinanceFuturesPublicStream } from '../../src/ws/BinanceFuturesPublicStream';
import { BinanceUserDataStream } from '../../src/ws/BinanceUserDataStream';

jest.mock('axios');
jest.mock('../../src/ws/BinanceFuturesPublicStream');
jest.mock('../../src/ws/BinanceTradeStream');
jest.mock('../../src/ws/BinanceUserDataStream');

const mockedAxios = axios as jest.Mocked<typeof axios>;
const MockedUserDataStream = BinanceUserDataStream as jest.MockedClass<typeof BinanceUserDataStream>;

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

  it('threads publicStreamConnectionPacking.maxTopicsPerConnection into the public stream cap', () => {
    const mockInstance = createMockAxiosInstance();
    mockedAxios.create.mockReturnValue(mockInstance as any);
    const MockedPublicStream = BinanceFuturesPublicStream as jest.MockedClass<
      typeof BinanceFuturesPublicStream
    >;
    MockedPublicStream.mockClear();

    new BinanceFutures({
      config: {
        apiKey: 'testKey',
        secret: 'testSecret',
        publicStreamConnectionPacking: { maxTopicsPerConnection: 150 },
      },
      logger: createMockLogger(),
    });

    expect(MockedPublicStream).toHaveBeenCalledWith(
      expect.objectContaining({ maxStreamsPerConnection: 150 }),
    );
  });

  it('leaves the public stream cap undefined when packing is not configured', () => {
    const MockedPublicStream = BinanceFuturesPublicStream as jest.MockedClass<
      typeof BinanceFuturesPublicStream
    >;
    MockedPublicStream.mockClear();
    createClient(false);

    expect(MockedPublicStream).toHaveBeenCalledWith(
      expect.objectContaining({ maxStreamsPerConnection: undefined }),
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

    it('says which of the two sides this position is: the reader must not have to guess', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({ data: [BINANCE_RAW_POSITION_RISK] });

      const position = await client.fetchPosition('BTCUSDT');

      expect(position.positionIdx).toBe(1);
    });

    it('marks a one-way position with zero, exactly as the other exchange does', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({ data: [{ ...BINANCE_RAW_POSITION_RISK, positionSide: 'BOTH' }] });

      const position = await client.fetchPosition('BTCUSDT');

      expect(position.positionIdx).toBe(0);
    });

    it('throws when symbol not found in response', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({ data: [] });

      await expect(client.fetchPosition('BTCUSDT')).rejects.toThrow('Position not found for BTCUSDT');
    });
  });

  describe('fetchPositionSnapshot', () => {
    it('returns null when response is empty', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({ data: [] });

      const result = await client.fetchPositionSnapshot('BTCUSDT', 1);

      expect(result).toBeNull();
    });

    it('returns BOTH-side entry when positionIdx is undefined (oneWay)', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({
        data: [{ ...BINANCE_RAW_POSITION_RISK, positionSide: 'BOTH' }],
      });

      const result = await client.fetchPositionSnapshot('BTCUSDT');

      expect(result).not.toBeNull();
      expect(result?.side).toBe(PositionSideEnum.Both);
    });

    it('maps positionIdx=1 to positionSide=LONG and returns matched entry', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({
        data: [
          { ...BINANCE_RAW_POSITION_RISK, positionSide: 'LONG', positionAmt: '0.5' },
          { ...BINANCE_RAW_POSITION_RISK, positionSide: 'SHORT', positionAmt: '0' },
        ],
      });

      const result = await client.fetchPositionSnapshot('BTCUSDT', 1);

      expect(result?.side).toBe(PositionSideEnum.Long);
      expect(result?.contracts).toBe(0.5);
      expect(result?.positionIdx).toBe(1);
    });

    it('maps positionIdx=2 to positionSide=SHORT', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({
        data: [
          { ...BINANCE_RAW_POSITION_RISK, positionSide: 'LONG', positionAmt: '0' },
          { ...BINANCE_RAW_POSITION_RISK, positionSide: 'SHORT', positionAmt: '0.3' },
        ],
      });

      const result = await client.fetchPositionSnapshot('BTCUSDT', 2);

      expect(result?.side).toBe(PositionSideEnum.Short);
      expect(result?.contracts).toBe(0.3);
      expect(result?.positionIdx).toBe(2);
    });

    it('returns null when target positionSide is not present', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({
        data: [{ ...BINANCE_RAW_POSITION_RISK, positionSide: 'LONG' }],
      });

      const result = await client.fetchPositionSnapshot('BTCUSDT', 2);

      expect(result).toBeNull();
    });

    it('throws on invalid positionIdx values (defensive)', async () => {
      const { client } = createClient();

      await expect(client.fetchPositionSnapshot('BTCUSDT', 99)).rejects.toThrow(
        /invalid positionIdx=99/,
      );
      await expect(client.fetchPositionSnapshot('BTCUSDT', -1)).rejects.toThrow(
        /invalid positionIdx=-1/,
      );
    });

    it('throws when positionIdx is undefined but response contains LONG/SHORT entries (hedge mode)', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({
        data: [
          { ...BINANCE_RAW_POSITION_RISK, positionSide: 'LONG', positionAmt: '0.5' },
          { ...BINANCE_RAW_POSITION_RISK, positionSide: 'SHORT', positionAmt: '0' },
        ],
      });

      await expect(client.fetchPositionSnapshot('BTCUSDT')).rejects.toThrow(
        /is in hedge mode/,
      );
    });

    it('returns null when positionIdx is undefined and only BOTH entry is present (oneWay closed)', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({
        data: [{ ...BINANCE_RAW_POSITION_RISK, positionSide: 'OTHER', positionAmt: '0' }],
      });

      const result = await client.fetchPositionSnapshot('BTCUSDT');

      expect(result).toBeNull();
    });
  });

  describe('fetchPositionList', () => {
    it('returns empty array when response is empty', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({ data: [] });

      const result = await client.fetchPositionList('BTCUSDT');

      expect(result).toEqual([]);
    });

    it('returns all entries with mapped positionIdx (hedge mode)', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({
        data: [
          { ...BINANCE_RAW_POSITION_RISK, positionSide: 'LONG' },
          { ...BINANCE_RAW_POSITION_RISK, positionSide: 'SHORT' },
        ],
      });

      const result = await client.fetchPositionList('BTCUSDT');

      expect(result).toHaveLength(2);
      expect(result[0].positionIdx).toBe(1);
      expect(result[1].positionIdx).toBe(2);
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

    // Подтверждение — это ФАКТ из ответа биржи, не эхо запроса: до 14.08.2026 ответ выбрасывался,
    // и проверить «плечо действительно стало нужным» было нечем, хотя лог выглядел как подтверждение.
    it('returns the leverage the exchange actually confirmed', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.post.mockResolvedValue({ data: { symbol: 'BTCUSDT', leverage: 20, maxNotionalValue: '1000000' } });

      const result = await client.setLeverage(20, 'BTCUSDT');

      expect(result.confirmedLeverage).toBe(20);
    });

    it('reports null when the answer carries no usable leverage — never invents the requested value', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.post.mockResolvedValue({ data: {} });

      const result = await client.setLeverage(20, 'BTCUSDT');

      expect(result.confirmedLeverage).toBeNull();
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
      expect(btc!.lastPrice).toBe(78516.3);
      expect(btc!.priceChangePercent).toBe(0.062);
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

    // Происхождение обычной заявки запоминается ПРИ СОЗДАНИИ: тогда первое же чтение по номеру
    // идёт одним запросом в свою службу, а не опрашивает обе (вторая всегда отвечала −2013 —
    // лишний круг по сети прямо в горячем пути постановки лесенки, прод 14.08.2026).
    it('reads a just-created plain order with a single plain-book request, not both services', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({ data: BINANCE_RAW_EXCHANGE_INFO });
      await client.loadTradeSymbols();

      mockInstance.post.mockResolvedValue({ data: BINANCE_RAW_ORDER_RESPONSE });

      const created = await client.createOrderWebSocket({
        symbol: 'BTCUSDT',
        type: OrderTypeEnum.Limit,
        side: OrderSideEnum.Sell,
        amount: 0.5,
        price: 65000,
      });

      mockInstance.get.mockClear();
      mockInstance.get.mockResolvedValue({ data: BINANCE_RAW_ORDER_RESPONSE });

      await client.getOrder('BTCUSDT', created.id);

      const getUrlList = mockInstance.get.mock.calls.map(([url]) => url);

      expect(getUrlList).toEqual(['/fapi/v1/order']);
    });

    // С 09.12.2025 условные заявки USDⓈ-M живут в отдельной Algo-службе: старый вход
    // отбивает их кодом -4120. Поэтому тесты ниже проверяют НОВЫЙ адрес и НОВЫЕ имена полей.
    it('routes a conditional order to the algo endpoint with the renamed trigger price', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({ data: BINANCE_RAW_EXCHANGE_INFO });
      await client.loadTradeSymbols();

      mockInstance.post.mockResolvedValue({ data: BINANCE_RAW_ALGO_ORDER_RESPONSE });

      await client.createOrderWebSocket({
        symbol: 'BTCUSDT',
        type: OrderTypeEnum.StopMarket,
        side: OrderSideEnum.Sell,
        amount: 0.1,
        stopPrice: 60000,
      });

      const [url, , options] = mockInstance.post.mock.calls[0];

      expect(url).toBe('/fapi/v1/algoOrder');
      expect(options.params.algoType).toBe('CONDITIONAL');
      expect(options.params.type).toBe('STOP_MARKET');
      expect(options.params.triggerPrice).toBe('60000');
      // Старые имена уйти не должны — иначе биржа молча их проигнорирует.
      expect(options.params.stopPrice).toBeUndefined();
    });

    it('sends closePosition instead of quantity, since the two are mutually exclusive', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({ data: BINANCE_RAW_EXCHANGE_INFO });
      await client.loadTradeSymbols();

      mockInstance.post.mockResolvedValue({ data: BINANCE_RAW_ALGO_ORDER_RESPONSE });

      await client.createOrderWebSocket({
        symbol: 'BTCUSDT',
        type: OrderTypeEnum.StopMarket,
        side: OrderSideEnum.Sell,
        amount: 0.1,
        stopPrice: 60000,
        closePosition: true,
      });

      const [url, , options] = mockInstance.post.mock.calls[0];

      expect(url).toBe('/fapi/v1/algoOrder');
      expect(options.params.closePosition).toBe(true);
      expect(options.params.quantity).toBeUndefined();
    });

    it('sends workingType on the algo endpoint', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({ data: BINANCE_RAW_EXCHANGE_INFO });
      await client.loadTradeSymbols();

      mockInstance.post.mockResolvedValue({ data: BINANCE_RAW_ALGO_ORDER_RESPONSE });

      await client.createOrderWebSocket({
        symbol: 'BTCUSDT',
        type: OrderTypeEnum.StopMarket,
        side: OrderSideEnum.Sell,
        amount: 0.1,
        stopPrice: 60000,
        workingType: WorkingTypeEnum.MarkPrice,
      });

      const [url, , options] = mockInstance.post.mock.calls[0];

      expect(url).toBe('/fapi/v1/algoOrder');
      expect(options.params.workingType).toBe('MARK_PRICE');
    });

    it('keeps plain orders on the legacy endpoint', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({ data: BINANCE_RAW_EXCHANGE_INFO });
      await client.loadTradeSymbols();

      mockInstance.post.mockResolvedValue({ data: BINANCE_RAW_ORDER_RESPONSE });

      await client.createOrderWebSocket({
        symbol: 'BTCUSDT',
        type: OrderTypeEnum.Limit,
        side: OrderSideEnum.Sell,
        amount: 0.1,
        price: 65000,
      });

      const [url] = mockInstance.post.mock.calls[0];

      expect(url).toBe('/fapi/v1/order');
    });

    it('tags a conditional order with clientAlgoId, not newClientOrderId', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({ data: BINANCE_RAW_EXCHANGE_INFO });
      await client.loadTradeSymbols();

      mockInstance.post.mockResolvedValue({ data: BINANCE_RAW_ALGO_ORDER_RESPONSE });

      await client.createOrderWebSocket({
        symbol: 'BTCUSDT',
        type: OrderTypeEnum.StopMarket,
        side: OrderSideEnum.Sell,
        amount: 0.1,
        stopPrice: 60000,
        clientOrderId: 'rbr_abc1',
      });

      const [, , options] = mockInstance.post.mock.calls[0];

      expect(options.params.clientAlgoId).toBe('rbr_abc1');
      expect(options.params.newClientOrderId).toBeUndefined();
    });

    it('omits reduceOnly in hedge mode, where the exchange forbids it', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({ data: BINANCE_RAW_EXCHANGE_INFO });
      await client.loadTradeSymbols();

      mockInstance.post.mockResolvedValue({ data: BINANCE_RAW_ALGO_ORDER_RESPONSE });

      await client.createOrderWebSocket({
        symbol: 'BTCUSDT',
        type: OrderTypeEnum.StopMarket,
        side: OrderSideEnum.Buy,
        amount: 0.1,
        stopPrice: 60000,
        positionSide: PositionSideEnum.Short,
        reduceOnly: true,
      });

      const [, , options] = mockInstance.post.mock.calls[0];

      expect(options.params.positionSide).toBe('SHORT');
      expect(options.params.reduceOnly).toBeUndefined();
    });

    it('returns the conditional order under its own algo id', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({ data: BINANCE_RAW_EXCHANGE_INFO });
      await client.loadTradeSymbols();

      mockInstance.post.mockResolvedValue({ data: BINANCE_RAW_ALGO_ORDER_RESPONSE });

      const order = await client.createOrderWebSocket({
        symbol: 'BTCUSDT',
        type: OrderTypeEnum.StopMarket,
        side: OrderSideEnum.Sell,
        amount: 0.1,
        stopPrice: 60000,
      });

      expect(order.id).toBe('3000000000003505');
      expect(order.isConditional).toBe(true);
      expect(order.stopPrice).toBe(60000);
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

    it('returns amount unchanged when symbol metadata is not loaded', () => {
      const { client } = createClient();

      const result = client.amountToPrecision('UNKNOWN', 0.12345);

      expect(result).toBe(0.12345);
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

  describe('getOrderByClientOrderId', () => {
    it('returns normalized order queried by client order id', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({ data: BINANCE_RAW_ORDER_RESPONSE });

      const result = await client.getOrderByClientOrderId('BTCUSDT', 'kf-abc-e0');

      const [, options] = mockInstance.get.mock.calls[0];

      expect(options.params.origClientOrderId).toBe('kf-abc-e0');
      expect(result.id).toBe('123456789');
      expect(result.symbol).toBe('BTCUSDT');
      expect(result.side).toBe(OrderSideEnum.Buy);
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

    it('asks the exchange for the requested income kind and symbol instead of filtering at home', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({ data: [] });

      await client.fetchIncome({ incomeType: 'realizedPnl', symbol: 'BTCUSDT', startTime: 1000, endTime: 2000 });

      const [, config] = mockInstance.get.mock.calls[0];

      expect(config.params.incomeType).toBe('REALIZED_PNL');
      expect(config.params.symbol).toBe('BTCUSDT');
      expect(config.params.startTime).toBe(1000);
    });

    it('translates the commission intent into the exchange wording', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({ data: [] });

      await client.fetchIncome({ incomeType: 'commission' });

      const [, config] = mockInstance.get.mock.calls[0];

      expect(config.params.incomeType).toBe('COMMISSION');
    });
  });

  // Итог закрытия у Binance готовой ручкой не отдаётся: собираем его из списка собственных
  // сделок. Смысл полей обязан совпасть с Bybit, иначе одно и то же поле будет значить разное.
  describe('fetchClosedPnl', () => {
    const CLOSING_TRADE_LIST = [
      // Заполнение, которое ОТКРЫВАЛО позицию: ничего не закрыло, итог нулевой,
      // но комиссию биржа за него взяла — и в итог сделки она обязана войти.
      { orderId: 10, symbol: 'BTCUSDT', side: 'SELL', price: '100', qty: '2', realizedPnl: '0', commission: '0.10', time: 1000 },
      // Два заполнения ОДНОЙ закрывающей заявки.
      { orderId: 20, symbol: 'BTCUSDT', side: 'BUY', price: '96', qty: '1', realizedPnl: '4', commission: '0.05', time: 5000 },
      { orderId: 20, symbol: 'BTCUSDT', side: 'BUY', price: '98', qty: '1', realizedPnl: '2', commission: '0.05', time: 5500 },
    ];

    it('returns one row per closing order, with the volume-weighted exit price', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({ data: CLOSING_TRADE_LIST });

      const result = await client.fetchClosedPnl('BTCUSDT');

      expect(result).toHaveLength(1);
      expect(result[0].symbol).toBe('BTCUSDT');
      expect(result[0].orderId).toBe('20');
      expect(result[0].side).toBe(OrderSideEnum.Buy);
      expect(result[0].quantity).toBe(2);
      expect(result[0].exitPrice).toBe(97);
      expect(result[0].timestamp).toBe(5500);
    });

    it('reports the result NET of the whole trade commission, opening fills included', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({ data: CLOSING_TRADE_LIST });

      const result = await client.fetchClosedPnl('BTCUSDT');

      // Проверено на живом счёте 08.08.2026: у Binance итог ВАЛОВОЙ, комиссия списывается
      // отдельно и берётся ДВАЖДЫ — на открытии и на закрытии. У соседней биржи контракт тот
      // же — валовой − комиссия открытия − комиссия закрытия (её собственное поле вычитает ещё и
      // фандинг, поэтому оно наружу не отдаётся, 02.09.2026), поэтому вычитаем обе и здесь:
      // 6 − 0.10 закрытия − 0.10 открытия.
      expect(result[0].closedPnl).toBeCloseTo(6 - 0.1 - 0.1, 9);
    });

    it('keeps the identity consumers rely on: gross minus result equals the whole commission', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({ data: CLOSING_TRADE_LIST });

      const [row] = await client.fetchClosedPnl('BTCUSDT');
      const grossPnl = (row.entryPrice - row.exitPrice) * row.quantity;

      expect(grossPnl - row.closedPnl).toBeCloseTo(0.2, 9);
    });

    it('splits the opening commission across partial closes in proportion to what was closed', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({
        data: [
          { orderId: 10, symbol: 'BTCUSDT', side: 'SELL', price: '100', qty: '4', realizedPnl: '0', commission: '0.40', time: 1000 },
          { orderId: 20, symbol: 'BTCUSDT', side: 'BUY', price: '99', qty: '1', realizedPnl: '1', commission: '0.01', time: 2000 },
          { orderId: 30, symbol: 'BTCUSDT', side: 'BUY', price: '98', qty: '3', realizedPnl: '6', commission: '0.03', time: 3000 },
        ],
      });

      const result = await client.fetchClosedPnl('BTCUSDT');
      const firstClose = result.find((row) => row.orderId === '20');
      const secondClose = result.find((row) => row.orderId === '30');

      // Четверть позиции закрыта первой заявкой — на неё приходится четверть комиссии открытия.
      expect(firstClose?.closedPnl).toBeCloseTo(1 - 0.01 - 0.1, 9);
      expect(secondClose?.closedPnl).toBeCloseTo(6 - 0.03 - 0.3, 9);
    });

    it('derives the entry price of a long the other way round', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({
        data: [{ orderId: 30, symbol: 'BTCUSDT', side: 'SELL', price: '110', qty: '2', realizedPnl: '20', commission: '0.2', time: 7000 }],
      });

      const [row] = await client.fetchClosedPnl('BTCUSDT');
      const grossPnl = (row.exitPrice - row.entryPrice) * row.quantity;

      expect(row.entryPrice).toBeCloseTo(100, 9);
      expect(grossPnl - row.closedPnl).toBeCloseTo(0.2, 9);
    });

    it('reads the whole account when no symbol is given, exactly as the other exchange does', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({ data: [] });

      await expect(client.fetchClosedPnl()).resolves.toEqual([]);

      const [, config] = mockInstance.get.mock.calls[0];

      expect(config.params.symbol).toBeUndefined();
    });

    // Закрытие неликвида биржа дробит на сотни исполнений (VELVETUSDT 14.08.2026 — 129 штук в
    // одну миллисекунду). Одной страницы на это не хватает, а недобранный хвост занижает итог.
    function buildClosingPage(startId: number, count: number, orderId: number) {
      return Array.from({ length: count }, (unused, index) => ({
        id: startId + index,
        orderId,
        symbol: 'BTCUSDT',
        side: 'BUY',
        price: '98',
        qty: '1',
        realizedPnl: '2',
        commission: '0.01',
        time: 5000 + index,
      }));
    }

    it('pages through the whole window instead of stopping at the first page', async () => {
      const { client, mockInstance } = createClient();

      mockInstance.get
        .mockResolvedValueOnce({ data: buildClosingPage(1, 1000, 20) })
        .mockResolvedValueOnce({ data: buildClosingPage(1001, 200, 20) });

      const [row] = await client.fetchClosedPnl('BTCUSDT', { startTime: 1000 });

      expect(mockInstance.get).toHaveBeenCalledTimes(2);
      expect(row.quantity).toBe(1200);

      const [, firstConfig] = mockInstance.get.mock.calls[0];
      const [, secondConfig] = mockInstance.get.mock.calls[1];

      expect(firstConfig.params.startTime).toBe(1000);
      expect(firstConfig.params.limit).toBe(1000);
      // Номер и окно времени биржа вместе не принимает — вторая страница идёт только по номеру.
      expect(secondConfig.params.fromId).toBe(1001);
      expect(secondConfig.params.startTime).toBeUndefined();
    });

    it('does not double-count an execution repeated on the page seam', async () => {
      const { client, mockInstance } = createClient();

      mockInstance.get
        .mockResolvedValueOnce({ data: buildClosingPage(1, 1000, 20) })
        // Биржа повторила последнее исполнение первой страницы в начале второй.
        .mockResolvedValueOnce({ data: [...buildClosingPage(1000, 1, 20), ...buildClosingPage(1001, 5, 20)] });

      const [row] = await client.fetchClosedPnl('BTCUSDT', { startTime: 1000 });

      expect(row.quantity).toBe(1005);
    });

    it('stops paging once the executions pass the end of the window', async () => {
      const { client, mockInstance } = createClient();

      mockInstance.get
        .mockResolvedValueOnce({ data: buildClosingPage(1, 1000, 20) })
        // Вторая страница адресуется номером, конца окна биржа для неё уже не применяет.
        .mockResolvedValueOnce({ data: buildClosingPage(1001, 1000, 20).map((raw) => ({ ...raw, time: 90000 })) })
        .mockResolvedValue({ data: [] });

      const [row] = await client.fetchClosedPnl('BTCUSDT', { startTime: 1000, endTime: 60000 });

      expect(mockInstance.get).toHaveBeenCalledTimes(2);
      expect(row.quantity).toBe(1000);
    });

    it('asks for one page only when no window start is given', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({ data: CLOSING_TRADE_LIST });

      await client.fetchClosedPnl('BTCUSDT');

      expect(mockInstance.get).toHaveBeenCalledTimes(1);
    });

    it('counts the limit in result rows, the way the other exchange does', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({
        data: [
          { id: 1, orderId: 10, symbol: 'BTCUSDT', side: 'SELL', price: '100', qty: '4', realizedPnl: '0', commission: '0.40', time: 1000 },
          { id: 2, orderId: 20, symbol: 'BTCUSDT', side: 'BUY', price: '99', qty: '1', realizedPnl: '1', commission: '0.01', time: 2000 },
          { id: 3, orderId: 30, symbol: 'BTCUSDT', side: 'BUY', price: '98', qty: '3', realizedPnl: '6', commission: '0.03', time: 3000 },
        ],
      });

      const result = await client.fetchClosedPnl('BTCUSDT', { limit: 1 });

      expect(result).toHaveLength(1);
      expect(result[0].orderId).toBe('30');
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
      expect(result[0].isSuccess).toBe(true);
      expect(result[0].order?.id).toBe('123456789');
      expect(result[0].order?.symbol).toBe('BTCUSDT');
      expect(result[0].order?.side).toBe(OrderSideEnum.Buy);
      expect(result[0].errorText).toBeNull();
    });

    it('keeps one entry per requested order when the exchange rejects some of them', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({ data: BINANCE_RAW_EXCHANGE_INFO });
      await client.loadTradeSymbols();

      // Отказ ровно посередине: раньше он выбрасывался из ответа, ответ становился короче
      // запроса, и каждый следующий исход приписывался не той заявке.
      mockInstance.post.mockResolvedValue({
        data: [
          { ...BINANCE_RAW_ORDER_RESPONSE, orderId: 111 },
          { code: -2010, msg: 'Account has insufficient balance' },
          { ...BINANCE_RAW_ORDER_RESPONSE, orderId: 333 },
        ],
      });

      const result = await client.createBatchOrders([
        { symbol: 'BTCUSDT', type: OrderTypeEnum.Market, side: OrderSideEnum.Buy, amount: 0.1 },
        { symbol: 'BTCUSDT', type: OrderTypeEnum.Market, side: OrderSideEnum.Buy, amount: 0.2 },
        { symbol: 'BTCUSDT', type: OrderTypeEnum.Market, side: OrderSideEnum.Buy, amount: 0.3 },
      ]);

      expect(result).toHaveLength(3);
      expect(result[0].isSuccess).toBe(true);
      expect(result[0].order?.id).toBe('111');
      expect(result[1].isSuccess).toBe(false);
      expect(result[1].order).toBeNull();
      expect(result[1].errorCode).toBe(-2010);
      expect(result[1].errorText).toBe('Account has insufficient balance');
      expect(result[2].isSuccess).toBe(true);
      expect(result[2].order?.id).toBe('333');
    });

    it('reports a short exchange answer as failure instead of silently losing orders', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({ data: BINANCE_RAW_EXCHANGE_INFO });
      await client.loadTradeSymbols();

      mockInstance.post.mockResolvedValue({ data: [{ ...BINANCE_RAW_ORDER_RESPONSE, orderId: 111 }] });

      const result = await client.createBatchOrders([
        { symbol: 'BTCUSDT', type: OrderTypeEnum.Market, side: OrderSideEnum.Buy, amount: 0.1 },
        { symbol: 'BTCUSDT', type: OrderTypeEnum.Market, side: OrderSideEnum.Buy, amount: 0.2 },
      ]);

      expect(result).toHaveLength(2);
      expect(result[0].isSuccess).toBe(true);
      expect(result[1].isSuccess).toBe(false);
      expect(result[1].order).toBeNull();
      expect(result[1].errorText).not.toBeNull();
    });

    // Пакет — теперь основной путь постановки лесенки, и его заявки обязаны запоминать своё
    // происхождение так же, как одиночные: иначе первая же проверка постановки снова опрашивает
    // обе службы по каждому номеру.
    it('reads a batch-created plain order with a single plain-book request', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({ data: BINANCE_RAW_EXCHANGE_INFO });
      await client.loadTradeSymbols();

      mockInstance.post.mockResolvedValue({ data: [{ ...BINANCE_RAW_ORDER_RESPONSE, orderId: 777 }] });

      const result = await client.createBatchOrders([
        { symbol: 'BTCUSDT', type: OrderTypeEnum.Limit, side: OrderSideEnum.Sell, amount: 0.5, price: 65000 },
      ]);

      expect(result[0].isSuccess).toBe(true);

      mockInstance.get.mockClear();
      mockInstance.get.mockResolvedValue({ data: { ...BINANCE_RAW_ORDER_RESPONSE, orderId: 777 } });

      await client.getOrder('BTCUSDT', '777');

      const getUrlList = mockInstance.get.mock.calls.map(([url]) => url);

      expect(getUrlList).toEqual(['/fapi/v1/order']);
    });
  });

  describe('cancelBatchOrders', () => {
    it('returns empty array on empty input without calling httpClient', async () => {
      const { client, mockInstance } = createClient();

      const result = await client.cancelBatchOrders('BTCUSDT', []);

      expect(result).toEqual([]);
      expect(mockInstance.delete).not.toHaveBeenCalled();
    });

    it('maps all-success batch with status=CANCELED', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.delete.mockResolvedValue({
        data: [
          { orderId: 1, status: 'CANCELED', clientOrderId: 'a' },
          { orderId: 2, status: 'CANCELED', clientOrderId: 'b' },
        ],
      });

      const result = await client.cancelBatchOrders('BTCUSDT', ['1001', '1002']);

      expect(result).toEqual([
        { orderId: '1001', isSuccess: true, errorCode: null, errorText: null },
        { orderId: '1002', isSuccess: true, errorCode: null, errorText: null },
      ]);
    });

    // Условные заявки живут в отдельной службе, и пакетная отмена обычной книги их не
    // видит: просили снять пачку стопов — часть оставалась висеть. Одиночная отмена
    // развилку имела, пакетная — нет.
    it('cancels a known conditional order through its own service, not the plain book', async () => {
      const { client, mockInstance } = createClient();
      // Читаем список условных заявок — так клиент узнаёт происхождение номера.
      mockInstance.get.mockResolvedValue({
        data: [{ ...BINANCE_RAW_ALGO_ORDER_RESPONSE, algoId: 777, symbol: 'BTCUSDT' }],
      });
      await client.fetchOpenConditionalOrders('USDT');

      mockInstance.delete.mockResolvedValue({ data: { success: true } });

      const result = await client.cancelBatchOrders('BTCUSDT', ['777']);

      const deletedPathList = mockInstance.delete.mock.calls.map((call: unknown[]) => call[0]);

      expect(deletedPathList).toContain('/fapi/v1/algoOrder');
      expect(result).toEqual([{ orderId: '777', isSuccess: true, errorCode: null, errorText: null }]);
    });

    it('still sends plain orders of the same batch through the plain book', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({
        data: [{ ...BINANCE_RAW_ALGO_ORDER_RESPONSE, algoId: 777, symbol: 'BTCUSDT' }],
      });
      await client.fetchOpenConditionalOrders('USDT');

      mockInstance.delete.mockImplementation((path: string) =>
        path === '/fapi/v1/algoOrder'
          ? Promise.resolve({ data: { success: true } })
          : Promise.resolve({ data: [{ orderId: 555, status: 'CANCELED' }] }),
      );

      const result = await client.cancelBatchOrders('BTCUSDT', ['777', '555']);

      expect(result).toHaveLength(2);
      expect(result.find((item) => item.orderId === '777')?.isSuccess).toBe(true);
      expect(result.find((item) => item.orderId === '555')?.isSuccess).toBe(true);
    });

    it('sends orderIdList as a JSON array of numbers', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.delete.mockResolvedValue({
        data: [{ orderId: 1, status: 'CANCELED' }],
      });

      await client.cancelBatchOrders('BTCUSDT', ['1870270071']);

      expect(mockInstance.delete.mock.calls[0][1].params.orderIdList).toBe('[1870270071]');
    });

    it('skips non-numeric orderIds without breaking result alignment', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.delete.mockResolvedValue({
        data: [
          { orderId: 1, status: 'CANCELED' },
          { code: -2011, msg: 'Unknown order sent.' },
        ],
      });

      const result = await client.cancelBatchOrders('BTCUSDT', ['1001', 'order-x', '1002']);

      expect(mockInstance.delete.mock.calls[0][1].params.orderIdList).toBe('[1001,1002]');
      expect(result).toEqual([
        { orderId: '1001', isSuccess: true, errorCode: null, errorText: null },
        { orderId: 'order-x', isSuccess: false, errorCode: null, errorText: 'Binance requires a numeric orderId' },
        { orderId: '1002', isSuccess: false, errorCode: -2011, errorText: 'Unknown order sent.' },
      ]);
    });

    it('does not call httpClient when the whole chunk is non-numeric', async () => {
      const { client, mockInstance } = createClient();

      const result = await client.cancelBatchOrders('BTCUSDT', ['order-x', 'order-y']);

      expect(mockInstance.delete).not.toHaveBeenCalled();
      expect(result.every((entry) => !entry.isSuccess)).toBe(true);
      expect(result).toHaveLength(2);
    });

    it('maps all-failure batch with code -2011 Unknown order', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.delete.mockResolvedValue({
        data: [
          { code: -2011, msg: 'Unknown order sent.' },
          { code: -2011, msg: 'Unknown order sent.' },
        ],
      });

      const result = await client.cancelBatchOrders('BTCUSDT', ['1001', '1002']);

      expect(result).toEqual([
        { orderId: '1001', isSuccess: false, errorCode: -2011, errorText: 'Unknown order sent.' },
        { orderId: '1002', isSuccess: false, errorCode: -2011, errorText: 'Unknown order sent.' },
      ]);
    });

    it('maps mixed success/failure (10 success + 2 fail) across two chunks', async () => {
      const { client, mockInstance } = createClient();
      const orderIdList = Array.from({ length: 12 }, (_, index) => `${1001 + index}`);
      const firstChunkData = Array.from({ length: 10 }, (_, index) => ({
        orderId: index + 1,
        status: 'CANCELED',
      }));
      const secondChunkData = [
        { code: -2011, msg: 'Unknown order sent.' },
        { code: -1003, msg: 'Too many requests; current limit is 1200 request weight per 1 MINUTE.' },
      ];

      mockInstance.delete
        .mockResolvedValueOnce({ data: firstChunkData })
        .mockResolvedValueOnce({ data: secondChunkData });

      const result = await client.cancelBatchOrders('BTCUSDT', orderIdList);

      expect(mockInstance.delete).toHaveBeenCalledTimes(2);
      expect(result).toHaveLength(12);
      expect(result.slice(0, 10).every((entry) => entry.isSuccess)).toBe(true);
      expect(result[10]).toEqual({
        orderId: '1011',
        isSuccess: false,
        errorCode: -2011,
        errorText: 'Unknown order sent.',
      });
      expect(result[11]).toEqual({
        orderId: '1012',
        isSuccess: false,
        errorCode: -1003,
        errorText: 'Too many requests; current limit is 1200 request weight per 1 MINUTE.',
      });
    });

    it('chunks 25 orderIds into 3 HTTP calls of size 10/10/5', async () => {
      const { client, mockInstance } = createClient();
      const orderIdList = Array.from({ length: 25 }, (_, index) => `${1001 + index}`);

      mockInstance.delete.mockImplementation(async (_url: string, options: any) => {
        const requestList = JSON.parse(options.params.orderIdList) as number[];
        const data = requestList.map((_orderId, index) => ({ orderId: index + 1, status: 'CANCELED' }));

        return { data };
      });

      const result = await client.cancelBatchOrders('BTCUSDT', orderIdList);

      expect(result).toHaveLength(25);
      expect(result.every((entry) => entry.isSuccess)).toBe(true);
      expect(mockInstance.delete).toHaveBeenCalledTimes(3);

      const firstCallParams = JSON.parse(mockInstance.delete.mock.calls[0][1].params.orderIdList);
      const secondCallParams = JSON.parse(mockInstance.delete.mock.calls[1][1].params.orderIdList);
      const thirdCallParams = JSON.parse(mockInstance.delete.mock.calls[2][1].params.orderIdList);

      expect(firstCallParams).toHaveLength(10);
      expect(firstCallParams[0]).toBe(1001);
      expect(firstCallParams[9]).toBe(1010);
      expect(secondCallParams).toHaveLength(10);
      expect(secondCallParams[0]).toBe(1011);
      expect(secondCallParams[9]).toBe(1020);
      expect(thirdCallParams).toHaveLength(5);
      expect(thirdCallParams[0]).toBe(1021);
      expect(thirdCallParams[4]).toBe(1025);
    });

    it('falls back to "Unknown error" when response item is missing fields', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.delete.mockResolvedValue({ data: [{}] });

      const result = await client.cancelBatchOrders('BTCUSDT', ['1001']);

      expect(result).toEqual([
        { orderId: '1001', isSuccess: false, errorCode: null, errorText: 'Unknown error' },
      ]);
    });
  });

  describe('modifyBatchOrders', () => {
    it('returns empty array for empty input without HTTP call', async () => {
      const { client, mockInstance } = createClient();

      const result = await client.modifyBatchOrders([]);

      expect(result).toEqual([]);
      expect(mockInstance.put).not.toHaveBeenCalled();
    });

    it('maps Binance per-order response to ModifyOrderItemResult', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({ data: BINANCE_RAW_EXCHANGE_INFO });
      await client.loadTradeSymbols();

      mockInstance.put.mockResolvedValue({ data: BINANCE_RAW_MODIFY_BATCH_RESPONSE_MIXED });

      const result = await client.modifyBatchOrders([
        { symbol: 'BTCUSDT', orderId: '100', side: OrderSideEnum.Buy, price: 30005, amount: 1 },
        { symbol: 'BTCUSDT', orderId: '101', side: OrderSideEnum.Buy, price: 30100, amount: 1 },
      ]);

      expect(result).toEqual([
        { orderId: '100', isSuccess: true, errorCode: null, errorText: null },
        { orderId: '101', isSuccess: false, errorCode: -2022, errorText: 'ReduceOnly Order is rejected.' },
      ]);
    });

    it('chunks input by BINANCE_FUTURES_MODIFY_BATCH_CHUNK_SIZE=5 and concatenates results', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({ data: BINANCE_RAW_EXCHANGE_INFO });
      await client.loadTradeSymbols();

      mockInstance.put.mockResolvedValueOnce({
        data: Array.from({ length: 5 }, (_, index) => ({
          orderId: index + 1,
          symbol: 'BTCUSDT',
          status: 'NEW',
          updateTime: 1700000000000,
        })),
      });
      mockInstance.put.mockResolvedValueOnce({
        data: [{ orderId: 6, symbol: 'BTCUSDT', status: 'NEW', updateTime: 1700000000000 }],
      });

      const orderList = Array.from({ length: 6 }, (_, index) => ({
        symbol: 'BTCUSDT',
        orderId: String(index + 1),
        side: OrderSideEnum.Buy,
        price: 30000,
      }));
      const result = await client.modifyBatchOrders(orderList);

      expect(mockInstance.put).toHaveBeenCalledTimes(2);
      expect(result).toHaveLength(6);
      expect(result.every((entry) => entry.isSuccess)).toBe(true);
    });

    it('sends correctly mapped side (BUY/SELL) and precision-adjusted price/quantity', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({ data: BINANCE_RAW_EXCHANGE_INFO });
      await client.loadTradeSymbols();

      mockInstance.put.mockResolvedValue({
        data: [{ orderId: 1, symbol: 'BTCUSDT', status: 'NEW' }],
      });

      await client.modifyBatchOrders([
        { symbol: 'BTCUSDT', orderId: '1', side: OrderSideEnum.Sell, price: 30000.123456, amount: 0.123456 },
      ]);

      const [, , options] = mockInstance.put.mock.calls[0];
      const batchOrders = JSON.parse(options.params.batchOrders);

      expect(batchOrders).toHaveLength(1);
      expect(batchOrders[0].symbol).toBe('BTCUSDT');
      expect(batchOrders[0].orderId).toBe('1');
      expect(batchOrders[0].side).toBe('SELL');
      expect(batchOrders[0].price).toBe('30000.1');
      expect(batchOrders[0].quantity).toBe('0.123');
    });
  });

  describe('createBatchOrders chunking', () => {
    it('chunks input by BINANCE_FUTURES_CREATE_BATCH_CHUNK_SIZE=5', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({ data: BINANCE_RAW_EXCHANGE_INFO });
      await client.loadTradeSymbols();

      mockInstance.post.mockResolvedValueOnce({
        data: Array.from({ length: 5 }, (_, index) => ({ ...BINANCE_RAW_ORDER_RESPONSE, orderId: index + 1 })),
      });
      mockInstance.post.mockResolvedValueOnce({
        data: [{ ...BINANCE_RAW_ORDER_RESPONSE, orderId: 6 }],
      });

      const orderList = Array.from({ length: 6 }, () => ({
        symbol: 'BTCUSDT',
        type: OrderTypeEnum.Limit,
        side: OrderSideEnum.Buy,
        amount: 0.001,
        price: 30000,
      }));
      const result = await client.createBatchOrders(orderList);

      const batchOrdersCallList = mockInstance.post.mock.calls.filter(
        (call: unknown[]) => call[0] === '/fapi/v1/batchOrders',
      );

      expect(batchOrdersCallList).toHaveLength(2);
      expect(result).toHaveLength(6);
    });

    it('returns empty array on empty input without calling httpClient', async () => {
      const { client, mockInstance } = createClient();

      const result = await client.createBatchOrders([]);

      expect(result).toEqual([]);
      expect(mockInstance.post).not.toHaveBeenCalled();
    });

    it('reports a per-order error in place, with a warning, instead of dropping the entry', async () => {
      const logger = createMockLogger();
      const mockInstance = createMockAxiosInstance();
      mockedAxios.create.mockReturnValue(mockInstance as any);

      const client = new BinanceFutures({
        config: { apiKey: 'testKey', secret: 'testSecret', isDemoMode: false },
        logger,
      });

      mockInstance.get.mockResolvedValue({ data: BINANCE_RAW_EXCHANGE_INFO });
      await client.loadTradeSymbols();

      mockInstance.post.mockResolvedValue({
        data: [
          BINANCE_RAW_ORDER_RESPONSE,
          { code: -2022, msg: 'ReduceOnly Order is rejected.' },
        ],
      });

      const result = await client.createBatchOrders([
        { symbol: 'BTCUSDT', type: OrderTypeEnum.Limit, side: OrderSideEnum.Buy, amount: 0.001, price: 30000 },
        { symbol: 'BTCUSDT', type: OrderTypeEnum.Limit, side: OrderSideEnum.Buy, amount: 0.001, price: 30000, reduceOnly: true },
      ]);

      expect(result).toHaveLength(2);
      expect(result[0].isSuccess).toBe(true);
      expect(result[0].order?.id).toBe(String(BINANCE_RAW_ORDER_RESPONSE.orderId));
      expect(result[1].isSuccess).toBe(false);
      expect(result[1].errorCode).toBe(-2022);
      expect(result[1].errorText).toBe('ReduceOnly Order is rejected.');
      expect(logger.warn).toHaveBeenCalled();
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

  describe('getOrderRateLimit', () => {
    it('parses ORDERS limit from exchangeInfo (300 / 10s → 30 RPS)', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({
        data: {
          symbols: [],
          rateLimits: [
            { rateLimitType: 'REQUEST_WEIGHT', interval: 'MINUTE', intervalNum: 1, limit: 2400 },
            { rateLimitType: 'ORDERS', interval: 'SECOND', intervalNum: 10, limit: 300 },
          ],
        },
      });

      const result = await client.getOrderRateLimit();

      expect(result).toEqual({ writeRequestsPerSecond: 30, source: 'binance-exchange-info' });
    });

    it('falls back to 15 RPS when ORDERS limit absent', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({
        data: {
          symbols: [],
          rateLimits: [
            { rateLimitType: 'REQUEST_WEIGHT', interval: 'MINUTE', intervalNum: 1, limit: 2400 },
          ],
        },
      });

      const result = await client.getOrderRateLimit();

      expect(result).toEqual({ writeRequestsPerSecond: 15, source: 'fallback' });
    });

    it('returns the strictest of multiple ORDERS limits (300/10s vs 1200/min → 20 RPS)', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({
        data: {
          symbols: [],
          rateLimits: [
            { rateLimitType: 'ORDERS', interval: 'SECOND', intervalNum: 10, limit: 300 },
            { rateLimitType: 'ORDERS', interval: 'MINUTE', intervalNum: 1, limit: 1200 },
          ],
        },
      });

      const result = await client.getOrderRateLimit();

      expect(result).toEqual({ writeRequestsPerSecond: 20, source: 'binance-exchange-info' });
    });
  });

  // Образец события счёта (ccxt, js/src/pro/binance.js — payload из документации Binance):
  // позиция несёт только s/pa/ep/cr/up/mt/iw/ps, средства — a/wb/cw. Ни цены маркировки,
  // ни плеча, ни цены ликвидации в позиции НЕТ.
  describe('ACCOUNT_UPDATE event', () => {
    function emitAccountUpdate(client: BinanceFutures, handler: Record<string, jest.Mock>): void {
      (client as any).handleUserDataMessage(
        {
          e: 'ACCOUNT_UPDATE',
          T: 1700000000000,
          a: {
            B: [{ a: 'USDT', wb: '1234.5', cw: '1000.25' }],
            P: [{ s: 'BTCUSDT', pa: '-0.5', ep: '65000', up: '-12.5', ps: 'BOTH' }],
          },
        },
        handler,
      );
    }

    it('reports the fields the event does not carry as unknown, not as zero', () => {
      const { client } = createClient();
      const handler = { onOrderUpdate: jest.fn(), onPositionUpdate: jest.fn(), onBalanceUpdate: jest.fn() };

      emitAccountUpdate(client, handler);

      const [positionUpdate] = handler.onPositionUpdate.mock.calls[0];

      // Ноль неотличим от настоящего нуля, и сторож ликвидации, сравнивая с нулём, не
      // сработает никогда. Пусто означает «биржа этого не сообщила».
      expect(positionUpdate.markPrice).toBeNull();
      expect(positionUpdate.leverage).toBeNull();
      expect(positionUpdate.liquidationPrice).toBeNull();
    });

    it('still reports what the event does carry', () => {
      const { client } = createClient();
      const handler = { onOrderUpdate: jest.fn(), onPositionUpdate: jest.fn(), onBalanceUpdate: jest.fn() };

      emitAccountUpdate(client, handler);

      const [positionUpdate] = handler.onPositionUpdate.mock.calls[0];

      expect(positionUpdate.symbol).toBe('BTCUSDT');
      expect(positionUpdate.side).toBe('Sell');
      expect(positionUpdate.size).toBe(0.5);
      expect(positionUpdate.entryPrice).toBe(65000);
      expect(positionUpdate.unrealisedPnl).toBe(-12.5);
    });

    it('reports the balance change: futures state the wallet balance, not free and locked', () => {
      const { client } = createClient();
      const handler = { onOrderUpdate: jest.fn(), onPositionUpdate: jest.fn(), onBalanceUpdate: jest.fn() };

      emitAccountUpdate(client, handler);

      const [balanceUpdate] = handler.onBalanceUpdate.mock.calls[0];

      expect(balanceUpdate.balanceList).toEqual([
        { asset: 'USDT', free: null, locked: null, total: 1234.5 },
      ]);
    });
  });

  describe('connectUserDataStream keepAlive recovery', () => {
    const createHandler = () => ({
      onOrderUpdate: jest.fn(),
      onPositionUpdate: jest.fn(),
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('recreates the stream with a fresh listenKey after a keepAlive failure', async () => {
      jest.useFakeTimers();

      const { client, mockInstance } = createClient();
      mockInstance.post.mockResolvedValue({ data: { listenKey: 'lk-1' } });
      mockInstance.put.mockRejectedValue(new Error('keepAlive failed'));

      await client.connectUserDataStream(createHandler());

      expect(MockedUserDataStream).toHaveBeenCalledTimes(1);

      await jest.advanceTimersByTimeAsync(30 * 60 * 1000);
      await jest.advanceTimersByTimeAsync(1);

      expect(MockedUserDataStream).toHaveBeenCalledTimes(2);
      const listenKeyPostCallList = mockInstance.post.mock.calls.filter(([url]) =>
        String(url).includes('listenKey')
      );
      expect(listenKeyPostCallList.length).toBe(2);
    });

    it('does not recreate the stream while keepAlive succeeds', async () => {
      jest.useFakeTimers();

      const { client, mockInstance } = createClient();
      mockInstance.post.mockResolvedValue({ data: { listenKey: 'lk-1' } });
      mockInstance.put.mockResolvedValue({ data: {} });

      await client.connectUserDataStream(createHandler());
      await jest.advanceTimersByTimeAsync(30 * 60 * 1000);

      expect(MockedUserDataStream).toHaveBeenCalledTimes(1);
    });
  });
});
