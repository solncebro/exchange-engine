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
  BYBIT_RAW_CLOSED_PNL_FLOCKUSDT,
  BYBIT_RAW_TRANSACTION_LOG_LIST,
  BYBIT_RAW_AMEND_BATCH_RESPONSE,
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

  describe('fetchPositionSnapshot', () => {
    it('returns null when result list is empty (position never opened)', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({
        data: { result: { list: [] } },
      });

      const result = await client.fetchPositionSnapshot('BTCUSDT', 1);

      expect(result).toBeNull();
    });

    it('returns first list element when positionIdx is undefined (oneWay mode)', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({
        data: { result: { list: [{ ...BYBIT_RAW_POSITION, positionIdx: 0 }] } },
      });

      const result = await client.fetchPositionSnapshot('BTCUSDT');

      expect(result).not.toBeNull();
      expect(result?.positionIdx).toBe(0);
    });

    it('filters by positionIdx in hedge mode and returns matching entry', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({
        data: {
          result: {
            list: [
              { ...BYBIT_RAW_POSITION, positionIdx: 1, side: 'Buy', size: '100' },
              { ...BYBIT_RAW_POSITION, positionIdx: 2, side: 'Sell', size: '0' },
            ],
          },
        },
      });

      const longResult = await client.fetchPositionSnapshot('BTCUSDT', 1);
      const shortResult = await client.fetchPositionSnapshot('BTCUSDT', 2);

      expect(longResult?.positionIdx).toBe(1);
      expect(longResult?.contracts).toBe(100);
      expect(shortResult?.positionIdx).toBe(2);
      expect(shortResult?.contracts).toBe(0);
    });

    it('returns null when positionIdx is specified but not present in list', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({
        data: {
          result: {
            list: [{ ...BYBIT_RAW_POSITION, positionIdx: 1, side: 'Buy' }],
          },
        },
      });

      const result = await client.fetchPositionSnapshot('BTCUSDT', 2);

      expect(result).toBeNull();
    });

    it('returns normalized position with contracts=0 when side is empty (Bybit raw side=None)', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({
        data: {
          result: {
            list: [{ ...BYBIT_RAW_POSITION, positionIdx: 1, side: '', size: '0' }],
          },
        },
      });

      const result = await client.fetchPositionSnapshot('BTCUSDT', 1);

      expect(result).not.toBeNull();
      expect(result?.contracts).toBe(0);
      expect(result?.side).toBe(PositionSideEnum.Both);
    });

    it('throws when positionIdx is undefined but raw list contains hedge entries (positionIdx 1/2)', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({
        data: {
          result: {
            list: [
              { ...BYBIT_RAW_POSITION, positionIdx: 1, side: 'Buy', size: '10' },
              { ...BYBIT_RAW_POSITION, positionIdx: 2, side: 'Sell', size: '0' },
            ],
          },
        },
      });

      await expect(client.fetchPositionSnapshot('BTCUSDT')).rejects.toThrow(
        /is in hedge mode/,
      );
    });

    it('throws when raw entry is missing positionIdx (defensive against future Bybit API regression)', async () => {
      const { client, mockInstance } = createClient();
      const rawWithoutIdx: Record<string, unknown> = { ...BYBIT_RAW_POSITION };

      delete rawWithoutIdx.positionIdx;

      mockInstance.get.mockResolvedValue({
        data: { result: { list: [rawWithoutIdx] } },
      });

      await expect(client.fetchPositionSnapshot('BTCUSDT', 1)).rejects.toThrow(
        /raw entry without positionIdx/,
      );
    });

    it('throws when raw entry has positionIdx=null', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({
        data: { result: { list: [{ ...BYBIT_RAW_POSITION, positionIdx: null }] } },
      });

      await expect(client.fetchPositionSnapshot('BTCUSDT', 1)).rejects.toThrow(
        /raw entry without positionIdx/,
      );
    });
  });

  describe('fetchPositionList', () => {
    it('returns empty array when result list is empty', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({
        data: { result: { list: [] } },
      });

      const result = await client.fetchPositionList('BTCUSDT');

      expect(result).toEqual([]);
    });

    it('returns all positions from hedge mode (two entries, both sides)', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({
        data: {
          result: {
            list: [
              { ...BYBIT_RAW_POSITION, positionIdx: 1, side: 'Buy', size: '100' },
              { ...BYBIT_RAW_POSITION, positionIdx: 2, side: 'Sell', size: '50' },
            ],
          },
        },
      });

      const result = await client.fetchPositionList('BTCUSDT');

      expect(result).toHaveLength(2);
      expect(result[0].positionIdx).toBe(1);
      expect(result[1].positionIdx).toBe(2);
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

  describe('fetchFundingInfo', () => {
    it('reads one instrument when a symbol is given', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({
        data: { result: { list: [BYBIT_RAW_INSTRUMENT_LIST[0]] } },
      });

      const result = await client.fetchFundingInfo('BTCUSDT');

      expect(mockInstance.get).toHaveBeenCalledTimes(1);

      const [url, options] = mockInstance.get.mock.calls[0];

      expect(url).toBe('/v5/market/instruments-info');
      expect(options.params.category).toBe('linear');
      expect(options.params.symbol).toBe('BTCUSDT');

      expect(result).toEqual([
        { symbol: 'BTCUSDT', fundingIntervalHours: 8, adjustedFundingRateCap: 0.005, adjustedFundingRateFloor: -0.005 },
      ]);
    });

    it('walks the whole instrument list when no symbol is given', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({
        data: { result: { list: BYBIT_RAW_INSTRUMENT_LIST, nextPageCursor: '' } },
      });

      const result = await client.fetchFundingInfo();

      const [url, options] = mockInstance.get.mock.calls[0];

      expect(url).toBe('/v5/market/instruments-info');
      expect(options.params.category).toBe('linear');
      expect(options.params.symbol).toBeUndefined();

      // Инструмент без интервала фандинга (ETHBTC) в ответ не попадает.
      expect(result.every((entry) => entry.symbol === 'BTCUSDT')).toBe(true);
      expect(result[0].fundingIntervalHours).toBe(8);
    });
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

    // Ответ Bybit установленного значения не несёт, но принятая без ошибки установка ставит
    // ровно запрошенное — это и есть подтверждение (контракт единый с Binance).
    it('confirms the requested leverage on an accepted set', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.post.mockResolvedValue({ data: { retCode: 0, retMsg: 'OK' } });

      const result = await client.setLeverage(20, 'BTCUSDT');

      expect(result.confirmedLeverage).toBe(20);
    });

    // 110043 «leverage not modified» = на бирже УЖЕ стоит ровно запрошенное — тоже подтверждение.
    it('confirms the requested leverage on the "not modified" answer', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.post.mockResolvedValue({ data: { retCode: 110043, retMsg: 'leverage not modified' } });

      const result = await client.setLeverage(20, 'BTCUSDT');

      expect(result.confirmedLeverage).toBe(20);
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

    it('throws for the 1s interval which Bybit REST does not support', async () => {
      const { client } = createClient();

      await expect(client.fetchKlines('BTCUSDT', '1s')).rejects.toThrow(
        "Kline interval '1s' is not supported by Bybit REST",
      );
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

  // На едином счёте Bybit режим маржи — свойство ВСЕГО счёта, а не символа (проверено
  // живым чтением 08.08.2026: marginMode=ISOLATED_MARGIN, unifiedMarginStatus=5).
  // Раньше просьба переключить режим молча ничего не делала: попросили изолированную
  // маржу перед рискованным входом — счёт остался как был, и узнать об этом было неоткуда.
  describe('setMarginMode', () => {
    function armAccountInfo(mockInstance: Record<string, jest.Mock>, marginMode: string): void {
      mockInstance.get.mockResolvedValue({ data: { retCode: 0, result: { marginMode } } });
      mockInstance.post.mockResolvedValue({ data: { retCode: 0, result: {} } });
    }

    it('actually switches the account to isolated margin', async () => {
      const { client, mockInstance } = createClient();
      armAccountInfo(mockInstance, 'REGULAR_MARGIN');

      await client.setMarginMode(MarginModeEnum.Isolated, 'BTCUSDT');

      const [path, body] = mockInstance.post.mock.calls[0];

      expect(path).toBe('/v5/account/set-margin-mode');
      expect(body.setMarginMode).toBe('ISOLATED_MARGIN');
    });

    it('switches back to cross margin under the exchange wording for it', async () => {
      const { client, mockInstance } = createClient();
      armAccountInfo(mockInstance, 'ISOLATED_MARGIN');

      await client.setMarginMode(MarginModeEnum.Cross, 'BTCUSDT');

      const [, body] = mockInstance.post.mock.calls[0];

      expect(body.setMarginMode).toBe('REGULAR_MARGIN');
    });

    it('writes nothing when the account is already in the requested mode', async () => {
      const { client, mockInstance } = createClient();
      armAccountInfo(mockInstance, 'ISOLATED_MARGIN');

      await client.setMarginMode(MarginModeEnum.Isolated, 'BTCUSDT');

      expect(mockInstance.post).not.toHaveBeenCalled();
    });

    it('warns that the switch reaches the whole account, not just the requested symbol', async () => {
      const mockInstance = createMockAxiosInstance();
      mockedAxios.create.mockReturnValue(mockInstance as any);
      const logger = createMockLogger();
      const client = new BybitLinear({ config: { apiKey: 'k', secret: 's' }, logger });
      armAccountInfo(mockInstance, 'REGULAR_MARGIN');

      await client.setMarginMode(MarginModeEnum.Isolated, 'BTCUSDT');

      expect(logger.warn).toHaveBeenCalled();
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
    it('returns the real order fetched after cancellation', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.post.mockResolvedValue({
        data: { retCode: 0, result: { orderId: 'order-1', orderLinkId: '' } },
      });
      mockInstance.get.mockResolvedValueOnce({
        data: {
          result: {
            list: [{ ...BYBIT_RAW_ORDER_RESPONSE, orderId: 'order-1', symbol: 'BTCUSDT', orderStatus: 'Cancelled' }],
          },
        },
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

  describe('getOrderByClientOrderId', () => {
    it('returns order from realtime by orderLinkId', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValueOnce({
        data: { result: { list: [BYBIT_RAW_ORDER_RESPONSE] } },
      });

      const result = await client.getOrderByClientOrderId('BTCUSDT', 'kf-abc-e0');

      const [, options] = mockInstance.get.mock.calls[0];

      expect(options.params.orderLinkId).toBe('kf-abc-e0');
      expect(result.id).toBe('abc-123-def');
      expect(mockInstance.get).toHaveBeenCalledTimes(1);
    });

    it('falls back to history when not found in realtime', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get
        .mockResolvedValueOnce({ data: { result: { list: [] } } })
        .mockResolvedValueOnce({ data: { result: { list: [BYBIT_RAW_ORDER_RESPONSE] } } });

      const result = await client.getOrderByClientOrderId('BTCUSDT', 'kf-abc-e0');

      expect(result.id).toBe('abc-123-def');
      expect(mockInstance.get).toHaveBeenCalledTimes(2);
    });

    it('throws when order not found in both realtime and history', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get
        .mockResolvedValueOnce({ data: { result: { list: [] } } })
        .mockResolvedValueOnce({ data: { result: { list: [] } } });

      await expect(client.getOrderByClientOrderId('BTCUSDT', 'missing')).rejects.toThrow(
        'Order with client id missing not found for BTCUSDT',
      );
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

    it('makes a single transaction log request and returns all three income kinds sorted by time, ascending', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({
        data: { result: { list: [
          // A trade row later in time: yields a realizedPnl row and a commission row.
          { symbol: 'ICNTUSDT', type: 'TRADE', qty: '10', cashFlow: '-100', fee: '0.5', funding: '0', currency: 'USDT', transactionTime: '5000', tradeId: 't1', orderId: 'o1' },
          // A settlement row earlier in time, funding only (its cash flow and fee are zero).
          { symbol: 'FLOCKUSDT', type: 'SETTLEMENT', qty: '55994', cashFlow: '0', fee: '0', funding: '-2.5', currency: 'USDT', transactionTime: '1000', tradeId: '', orderId: '' },
        ] } },
      });

      const result = await client.fetchIncome();

      expect(mockInstance.get).toHaveBeenCalledTimes(1);
      expect(result).toHaveLength(3);
      expect(result.map((row) => row.timestamp)).toEqual([1000, 5000, 5000]);

      const fundingRow = result.find((row) => row.kind === 'funding');
      const realizedPnlRow = result.find((row) => row.kind === 'realizedPnl');
      const commissionRow = result.find((row) => row.kind === 'commission');

      expect(fundingRow?.income).toBeCloseTo(-2.5, 8);
      expect(realizedPnlRow?.income).toBeCloseTo(-100, 8);
      expect(commissionRow?.income).toBeCloseTo(-0.5, 8);
    });

    it('passes the time window and clamps the limit for the transaction log request', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({
        data: { result: { list: BYBIT_RAW_TRANSACTION_LOG_LIST } },
      });

      await client.fetchIncome({ startTime: 1000, endTime: 2000, limit: 100 });

      const [, options] = mockInstance.get.mock.calls.at(-1);

      expect(options.params.startTime).toBe(1000);
      expect(options.params.endTime).toBe(2000);
      expect(options.params.limit).toBe(50);
    });

    it('keeps only funding rows inside the window for the funding filter', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({
        data: { result: { list: BYBIT_RAW_TRANSACTION_LOG_LIST } },
      });

      const result = await client.fetchIncome({
        startTime: 1700000000500,
        endTime: 1700000002000,
        limit: 100,
        incomeType: 'funding',
      });

      expect(result).toHaveLength(1);
      expect(result[0].incomeType).toBe('FUNDING');
      expect(result[0].income).toBe(0.5);
    });

    // Проверено на живом счёте 08.08.2026: в записи журнала cashFlow — реализованный итог
    // БЕЗ комиссии, комиссия лежит отдельным полем, и тождество change = cashFlow + funding − fee
    // сошлось до восьмого знака. Тем самым оба вида значат ровно то же, что у соседней биржи.
    it('reports the realized result of trades, commission excluded', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({
        data: { result: { list: [
          { symbol: 'ICNTUSDT', type: 'TRADE', qty: '10', cashFlow: '-134.42656869', fee: '0.34382205', funding: '0', currency: 'USDT', transactionTime: '1700000000000', tradeId: 't1', orderId: 'o1' },
          { symbol: 'ETHUSDT', type: 'FUNDING', qty: '0', cashFlow: '0.50', fee: '0', funding: '0.5', currency: 'USDT', transactionTime: '1700000001000', tradeId: '', orderId: '' },
        ] } },
      });

      const result = await client.fetchIncome({ incomeType: 'realizedPnl' });

      expect(result).toHaveLength(1);
      expect(result[0].symbol).toBe('ICNTUSDT');
      expect(result[0].income).toBeCloseTo(-134.42656869, 8);
    });

    it('reports commission with the same sign as the neighbouring exchange: charged means negative', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({
        data: { result: { list: [
          { symbol: 'ICNTUSDT', type: 'TRADE', qty: '10', cashFlow: '-134.42656869', fee: '0.34382205', funding: '0', currency: 'USDT', transactionTime: '1700000000000', tradeId: 't1', orderId: 'o1' },
          { symbol: 'ETHUSDT', type: 'FUNDING', qty: '0', cashFlow: '0.50', fee: '0', funding: '0.5', currency: 'USDT', transactionTime: '1700000001000', tradeId: '', orderId: '' },
        ] } },
      });

      const result = await client.fetchIncome({ incomeType: 'commission' });

      expect(result).toHaveLength(1);
      expect(result[0].income).toBeCloseTo(-0.34382205, 8);
    });

    // FLOCKUSDT 02.09.2026: строка SETTLEMENT несёт cashFlow=0, начисление лежит в funding.
    it('returns the funding of a settlement row from its funding field, not its zero cash flow', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({
        data: { result: { list: [
          { symbol: 'FLOCKUSDT', type: 'TRADE', qty: '2729', cashFlow: '5.04865', fee: '0.11239114', funding: '0', currency: 'USDT', transactionTime: '1788364800470', tradeId: 't1', orderId: 'o1' },
          { symbol: 'FLOCKUSDT', type: 'SETTLEMENT', qty: '55994', cashFlow: '0', fee: '0', funding: '-2.3156522', currency: 'USDT', transactionTime: '1788364800000', tradeId: '', orderId: '' },
          { symbol: 'FLOCKUSDT', type: 'SETTLEMENT', qty: '55994', cashFlow: '0', fee: '0', funding: '-1.13346936', currency: 'USDT', transactionTime: '1788350400000', tradeId: '', orderId: '' },
        ] } },
      });

      const result = await client.fetchIncome({ symbol: 'FLOCKUSDT', incomeType: 'funding', startTime: 1788337740000, endTime: 1788364900000 });

      expect(result).toHaveLength(2);
      expect(result.reduce((sum, row) => sum + row.income, 0)).toBeCloseTo(-3.44912156, 8);
    });

    it('asks for the largest page the exchange allows when the caller named no limit', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({ data: { result: { list: [] } } });

      await client.fetchIncome();

      const [, options] = mockInstance.get.mock.calls.at(-1);

      // Умолчание биржи — 20 записей. Молча отдать первые 20 из окна и выдать это за ответ
      // хуже, чем отказать: потребитель посчитает по неполным данным и не узнает об этом.
      expect(options.params.limit).toBe(50);
    });

    it('reads the following pages by cursor instead of refusing a full first page', async () => {
      const { client, mockInstance } = createClient();
      const fullPageList = Array.from({ length: 50 }, () => BYBIT_RAW_TRANSACTION_LOG_LIST[0]);
      mockInstance.get
        .mockResolvedValueOnce({ data: { result: { list: fullPageList, nextPageCursor: 'page-2' } } })
        .mockResolvedValueOnce({ data: { result: { list: [BYBIT_RAW_TRANSACTION_LOG_LIST[1]], nextPageCursor: '' } } });

      const result = await client.fetchIncome();

      expect(mockInstance.get).toHaveBeenCalledTimes(2);
      const [, firstOptions] = mockInstance.get.mock.calls[0];
      const [, secondOptions] = mockInstance.get.mock.calls[1];
      expect(firstOptions.params.cursor).toBeUndefined();
      expect(secondOptions.params.cursor).toBe('page-2');
      expect(secondOptions.params.limit).toBe(50);
      expect(result).toHaveLength(51);
      expect(result.at(-1)?.symbol).toBe(BYBIT_RAW_TRANSACTION_LOG_LIST[1].symbol);
    });

    it('narrows the answer to the requested symbol', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({
        data: { result: { list: BYBIT_RAW_TRANSACTION_LOG_LIST } },
      });

      const result = await client.fetchIncome({ symbol: 'ETHUSDT' });

      expect(result).toHaveLength(1);
      expect(result[0].symbol).toBe('ETHUSDT');
    });

    it('sums the funding across every page of a long holding window', async () => {
      const { client, mockInstance } = createClient();
      // A ten-hour trade on a busy account: the first page is all other symbols' trades, the
      // funding settlements only show up on the second page. Before paging this read refused
      // outright and the trade closed with its funding unknown (REZUSDT, Bybit, 10.09.2026).
      const tradeRow = { symbol: 'ETHUSDT', type: 'TRADE', qty: '1', cashFlow: '-1', fee: '0.1', funding: '0', currency: 'USDT', transactionTime: '1500', tradeId: 't', orderId: 'o' };
      const settlementRow = { symbol: 'REZUSDT', type: 'SETTLEMENT', qty: '100', cashFlow: '0', fee: '0', funding: '-1.25', currency: 'USDT', transactionTime: '1600', tradeId: '', orderId: '' };
      mockInstance.get
        .mockResolvedValueOnce({ data: { result: { list: Array.from({ length: 50 }, () => tradeRow), nextPageCursor: 'page-2' } } })
        .mockResolvedValueOnce({ data: { result: { list: [settlementRow, settlementRow] } } });

      const result = await client.fetchIncome({ symbol: 'REZUSDT', startTime: 1000, endTime: 2000, incomeType: 'funding' });

      expect(result).toHaveLength(2);
      expect(result.reduce((sum, row) => sum + row.income, 0)).toBeCloseTo(-2.5, 8);
    });

    it('still refuses instead of answering partially when the cursor never ends', async () => {
      const { client, mockInstance } = createClient();
      const fullPageList = Array.from({ length: 50 }, () => BYBIT_RAW_TRANSACTION_LOG_LIST[0]);
      mockInstance.get.mockResolvedValue({ data: { result: { list: fullPageList, nextPageCursor: 'again' } } });

      await expect(client.fetchIncome({ incomeType: 'funding' })).rejects.toThrow('page count limit');
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
      expect(result[0].entryPrice).toBe(65000);
      expect(result[0].exitPrice).toBe(64000);
      expect(result[0].closedPnl).toBeCloseTo(99, 9);
    });

    // FLOCKUSDT 02.09.2026: биржевое поле closedPnl (98.3460386) уже вычло фандинг 3.44912156.
    it('reports the result net of commissions but WITHOUT the funding the exchange folded into its own field', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({
        data: { result: { list: [BYBIT_RAW_CLOSED_PNL_FLOCKUSDT] } },
      });

      const result = await client.fetchClosedPnl('FLOCKUSDT');

      expect(result).toHaveLength(1);
      expect(result[0].closedPnl).toBeCloseTo(101.79516016, 6);
    });
  });

  // Обе ручки границы времени принимают и УВАЖАЮТ — проверено живым запросом 08.08.2026:
  // узкое окно вернуло одну запись вместо пяти. Раньше окно молча выбрасывалось, и «сделки
  // за вчера» отдавали последние N записей независимо от дат.
  describe('time window is passed to the exchange, not dropped', () => {
    it('asks order history for the requested window', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({ data: { retCode: 0, result: { list: [] } } });

      await client.fetchOrderHistory('BTCUSDT', { startTime: 1000, endTime: 2000, limit: 30 });

      const [, options] = mockInstance.get.mock.calls.at(-1);

      expect(options.params.startTime).toBe(1000);
      expect(options.params.endTime).toBe(2000);
      expect(options.params.limit).toBe(30);
    });

    it('asks closed PnL for the requested window', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({ data: { retCode: 0, result: { list: [] } } });

      await client.fetchClosedPnl('BTCUSDT', { startTime: 1000, endTime: 2000, limit: 20 });

      const [, options] = mockInstance.get.mock.calls.at(-1);

      expect(options.params.startTime).toBe(1000);
      expect(options.params.endTime).toBe(2000);
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
      expect(result[0].isSuccess).toBe(true);
      expect(result[0].order?.id).toBe('batch-1');
      expect(result[0].order?.symbol).toBe('BTCUSDT');
      expect(result[0].errorText).toBeNull();
    });

    it('reports a rejected order as rejected: a failure used to come back as an open order with a junk id', async () => {
      const { client, mockInstance } = createClient();
      client.tradeSymbols.set('BTCUSDT', BTCUSDT_TRADE_SYMBOL);

      mockInstance.post.mockResolvedValue({
        data: {
          retCode: 0,
          result: { list: [{ orderId: 'batch-1' }, { orderId: '' }] },
          retExtInfo: { list: [{ code: 0, msg: 'OK' }, { code: 110007, msg: 'Insufficient available balance' }] },
        },
      });

      const result = await client.createBatchOrders([
        { symbol: 'BTCUSDT', type: OrderTypeEnum.Market, side: OrderSideEnum.Buy, amount: 0.001 },
        { symbol: 'BTCUSDT', type: OrderTypeEnum.Market, side: OrderSideEnum.Buy, amount: 0.002 },
      ]);

      expect(result).toHaveLength(2);
      expect(result[0].isSuccess).toBe(true);
      expect(result[0].order?.id).toBe('batch-1');
      expect(result[1].isSuccess).toBe(false);
      expect(result[1].order).toBeNull();
      expect(result[1].errorCode).toBe(110007);
      expect(result[1].errorText).toBe('Insufficient available balance');
    });

    it('never reports success on a missing order id, even when the exchange sent no per-order status', async () => {
      const { client, mockInstance } = createClient();
      client.tradeSymbols.set('BTCUSDT', BTCUSDT_TRADE_SYMBOL);

      mockInstance.post.mockResolvedValue({
        data: { retCode: 0, result: { list: [{}] } },
      });

      const result = await client.createBatchOrders([
        { symbol: 'BTCUSDT', type: OrderTypeEnum.Market, side: OrderSideEnum.Buy, amount: 0.001 },
      ]);

      expect(result[0].isSuccess).toBe(false);
      expect(result[0].order).toBeNull();
      expect(result[0].errorText).not.toBeNull();
    });
  });

  describe('cancelBatchOrders', () => {
    it('returns empty array on empty input without calling httpClient', async () => {
      const { client, mockInstance } = createClient();

      const result = await client.cancelBatchOrders('BTCUSDT', []);

      expect(result).toEqual([]);
      expect(mockInstance.post).not.toHaveBeenCalled();
    });

    it('maps all-success batch via retExtInfo.list code=0', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.post.mockResolvedValue({
        data: {
          retCode: 0,
          result: {
            list: [
              { orderId: 'order-1' },
              { orderId: 'order-2' },
            ],
          },
          retExtInfo: {
            list: [
              { code: 0, msg: 'OK' },
              { code: 0, msg: 'OK' },
            ],
          },
        },
      });

      const result = await client.cancelBatchOrders('BTCUSDT', ['order-1', 'order-2']);

      expect(result).toEqual([
        { orderId: 'order-1', isSuccess: true, errorCode: null, errorText: null },
        { orderId: 'order-2', isSuccess: true, errorCode: null, errorText: null },
      ]);
    });

    it('maps all-failure batch with non-zero codes', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.post.mockResolvedValue({
        data: {
          retCode: 0,
          result: { list: [{ orderId: 'order-1' }, { orderId: 'order-2' }] },
          retExtInfo: {
            list: [
              { code: 110001, msg: 'Order does not exist' },
              { code: 10001, msg: 'Some other error' },
            ],
          },
        },
      });

      const result = await client.cancelBatchOrders('BTCUSDT', ['order-1', 'order-2']);

      expect(result).toEqual([
        { orderId: 'order-1', isSuccess: false, errorCode: 110001, errorText: 'Order does not exist' },
        { orderId: 'order-2', isSuccess: false, errorCode: 10001, errorText: 'Some other error' },
      ]);
    });

    it('maps mixed success/failure with 10 success + 2 fail', async () => {
      const { client, mockInstance } = createClient();
      const orderIdList = Array.from({ length: 12 }, (_, index) => `order-${index + 1}`);
      const successItem = { code: 0, msg: 'OK' };
      const extInfoList = [
        ...Array.from({ length: 10 }, () => successItem),
        { code: 110001, msg: 'Order does not exist' },
        { code: 10006, msg: 'Too many visits!' },
      ];

      mockInstance.post.mockResolvedValue({
        data: {
          retCode: 0,
          result: { list: orderIdList.map((id) => ({ orderId: id })) },
          retExtInfo: { list: extInfoList },
        },
      });

      const result = await client.cancelBatchOrders('BTCUSDT', orderIdList);

      expect(result).toHaveLength(12);
      expect(result.slice(0, 10).every((entry) => entry.isSuccess)).toBe(true);
      expect(result[10]).toEqual({
        orderId: 'order-11',
        isSuccess: false,
        errorCode: 110001,
        errorText: 'Order does not exist',
      });
      expect(result[11]).toEqual({
        orderId: 'order-12',
        isSuccess: false,
        errorCode: 10006,
        errorText: 'Too many visits!',
      });
    });

    it('falls back to "Unknown error" when retExtInfo.list is missing for an index', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.post.mockResolvedValue({
        data: {
          retCode: 0,
          result: { list: [{ orderId: 'order-1' }] },
        },
      });

      const result = await client.cancelBatchOrders('BTCUSDT', ['order-1']);

      expect(result).toEqual([
        { orderId: 'order-1', isSuccess: false, errorCode: null, errorText: 'Unknown error' },
      ]);
    });
  });

  describe('modifyBatchOrders', () => {
    it('returns empty array for empty input without HTTP call', async () => {
      const { client, mockInstance } = createClient();

      const result = await client.modifyBatchOrders([]);

      expect(result).toEqual([]);
      expect(mockInstance.post).not.toHaveBeenCalled();
    });

    it('maps Bybit retExtInfo per-order errors and posts to /v5/order/amend-batch', async () => {
      const { client, mockInstance } = createClient();
      client.tradeSymbols.set('BTCUSDT', BTCUSDT_TRADE_SYMBOL);
      mockInstance.post.mockResolvedValue({ data: BYBIT_RAW_AMEND_BATCH_RESPONSE });

      const result = await client.modifyBatchOrders([
        { symbol: 'BTCUSDT', orderId: '1', side: OrderSideEnum.Buy, price: 30000 },
        { symbol: 'BTCUSDT', orderId: '2', side: OrderSideEnum.Buy, price: 30100 },
      ]);

      expect(result).toEqual([
        { orderId: '1', isSuccess: true, errorCode: null, errorText: null },
        { orderId: '2', isSuccess: false, errorCode: 110001, errorText: 'Order does not exist' },
      ]);

      const [url, body] = mockInstance.post.mock.calls[0];

      expect(url).toBe('/v5/order/amend-batch');
      expect(body).toEqual({
        category: 'linear',
        request: [
          { symbol: 'BTCUSDT', orderId: '1', price: '30000' },
          { symbol: 'BTCUSDT', orderId: '2', price: '30100' },
        ],
      });
    });

    it('rejects the whole batch when the exchange refuses it with a top-level retCode', async () => {
      const { client, mockInstance } = createClient();
      client.tradeSymbols.set('BTCUSDT', BTCUSDT_TRADE_SYMBOL);
      mockInstance.post.mockResolvedValue({
        data: { retCode: 10001, retMsg: 'params error', result: {}, retExtInfo: {} },
      });

      await expect(client.modifyBatchOrders([
        { symbol: 'BTCUSDT', orderId: '1', side: OrderSideEnum.Buy, price: 30000 },
      ])).rejects.toMatchObject({ code: 10001 });
    });

    it('falls back to "Unknown error" when retExtInfo entry is missing', async () => {
      const { client, mockInstance } = createClient();
      client.tradeSymbols.set('BTCUSDT', BTCUSDT_TRADE_SYMBOL);
      mockInstance.post.mockResolvedValue({
        data: {
          retCode: 0,
          result: { list: [{ orderId: '1' }] },
        },
      });

      const result = await client.modifyBatchOrders([
        { symbol: 'BTCUSDT', orderId: '1', side: OrderSideEnum.Buy, price: 30000 },
      ]);

      expect(result).toEqual([
        { orderId: '1', isSuccess: false, errorCode: null, errorText: 'Unknown error' },
      ]);
    });

    it('serializes optional fields (clientOrderId, amount, triggerPrice) with precision', async () => {
      const { client, mockInstance } = createClient();
      client.tradeSymbols.set('BTCUSDT', BTCUSDT_TRADE_SYMBOL);
      mockInstance.post.mockResolvedValue({
        data: {
          retCode: 0,
          result: { list: [{ orderId: '1' }] },
          retExtInfo: { list: [{ code: 0, msg: 'OK' }] },
        },
      });

      await client.modifyBatchOrders([
        {
          symbol: 'BTCUSDT',
          orderId: '1',
          side: OrderSideEnum.Buy,
          clientOrderId: 'client-1',
          price: 30000,
          amount: 0.1234,
          triggerPrice: 29500,
        },
      ]);

      const [, body] = mockInstance.post.mock.calls[0];

      expect(body.request[0]).toEqual({
        symbol: 'BTCUSDT',
        orderId: '1',
        orderLinkId: 'client-1',
        price: '30000',
        qty: '0.123',
        triggerPrice: '29500',
      });
    });

    it('chunks input by BYBIT_LINEAR_BATCH_CHUNK_SIZE=20', async () => {
      const { client, mockInstance } = createClient();
      client.tradeSymbols.set('BTCUSDT', BTCUSDT_TRADE_SYMBOL);

      const buildExtInfoList = (count: number) => Array.from({ length: count }, () => ({ code: 0, msg: 'OK' }));
      const buildResultList = (count: number, startIdx: number) =>
        Array.from({ length: count }, (_, idx) => ({
          category: 'linear',
          symbol: 'BTCUSDT',
          orderId: String(startIdx + idx + 1),
          orderLinkId: '',
        }));

      mockInstance.post.mockResolvedValueOnce({
        data: {
          retCode: 0,
          result: { list: buildResultList(20, 0) },
          retExtInfo: { list: buildExtInfoList(20) },
        },
      });
      mockInstance.post.mockResolvedValueOnce({
        data: {
          retCode: 0,
          result: { list: buildResultList(5, 20) },
          retExtInfo: { list: buildExtInfoList(5) },
        },
      });

      const orderList = Array.from({ length: 25 }, (_, idx) => ({
        symbol: 'BTCUSDT',
        orderId: String(idx + 1),
        side: OrderSideEnum.Buy,
        price: 30000,
      }));

      const result = await client.modifyBatchOrders(orderList);

      expect(mockInstance.post).toHaveBeenCalledTimes(2);
      expect(mockInstance.post.mock.calls[0][1].request).toHaveLength(20);
      expect(mockInstance.post.mock.calls[1][1].request).toHaveLength(5);
      expect(result).toHaveLength(25);
      expect(result[0].orderId).toBe('1');
      expect(result[24].orderId).toBe('25');
    });
  });

  describe('createBatchOrders chunking (linear=20)', () => {
    it('chunks createBatchOrders by 20 and aggregates results', async () => {
      const { client, mockInstance } = createClient();
      client.tradeSymbols.set('BTCUSDT', BTCUSDT_TRADE_SYMBOL);

      const buildResultList = (count: number, startIdx: number) => ({
        retCode: 0,
        result: {
          list: Array.from({ length: count }, (_, idx) => ({ orderId: `id-${startIdx + idx + 1}` })),
        },
      });

      mockInstance.post.mockResolvedValueOnce({ data: buildResultList(20, 0) });
      mockInstance.post.mockResolvedValueOnce({ data: buildResultList(5, 20) });

      const orderList = Array.from({ length: 25 }, () => ({
        symbol: 'BTCUSDT',
        type: OrderTypeEnum.Market,
        side: OrderSideEnum.Buy,
        amount: 0.001,
      }));

      const result = await client.createBatchOrders(orderList);

      expect(mockInstance.post).toHaveBeenCalledTimes(2);
      expect(mockInstance.post.mock.calls[0][1].request).toHaveLength(20);
      expect(mockInstance.post.mock.calls[1][1].request).toHaveLength(5);
      expect(result).toHaveLength(25);
      expect(result[0].order?.id).toBe('id-1');
      expect(result[24].order?.id).toBe('id-25');
    });

    it('returns empty array on empty input without HTTP call', async () => {
      const { client, mockInstance } = createClient();

      const result = await client.createBatchOrders([]);

      expect(result).toEqual([]);
      expect(mockInstance.post).not.toHaveBeenCalled();
    });
  });

  describe('cancelBatchOrders chunking (linear=20)', () => {
    it('chunks cancelBatchOrders by 20 and aggregates results', async () => {
      const { client, mockInstance } = createClient();

      const buildResponse = (count: number, startIdx: number) => ({
        retCode: 0,
        result: {
          list: Array.from({ length: count }, (_, idx) => ({ orderId: `order-${startIdx + idx + 1}` })),
        },
        retExtInfo: { list: Array.from({ length: count }, () => ({ code: 0, msg: 'OK' })) },
      });

      mockInstance.post.mockResolvedValueOnce({ data: buildResponse(20, 0) });
      mockInstance.post.mockResolvedValueOnce({ data: buildResponse(5, 20) });

      const orderIdList = Array.from({ length: 25 }, (_, idx) => `order-${idx + 1}`);

      const result = await client.cancelBatchOrders('BTCUSDT', orderIdList);

      expect(mockInstance.post).toHaveBeenCalledTimes(2);
      expect(mockInstance.post.mock.calls[0][1].request).toHaveLength(20);
      expect(mockInstance.post.mock.calls[1][1].request).toHaveLength(5);
      expect(result).toHaveLength(25);
      expect(result[0]).toEqual({ orderId: 'order-1', isSuccess: true, errorCode: null, errorText: null });
      expect(result[24]).toEqual({ orderId: 'order-25', isSuccess: true, errorCode: null, errorText: null });
    });
  });

  describe('batch operations WS routing', () => {
    describe('createBatchOrders', () => {
      it('uses WebSocket when tradeStream is connected', async () => {
        const { client, mockInstance } = createClient(false);
        client.tradeSymbols.set('BTCUSDT', BTCUSDT_TRADE_SYMBOL);

        const tradeStream = (client as any).tradeStream;
        const wsOrder = {
          id: 'ws-batch-1',
          clientOrderId: '',
          symbol: 'BTCUSDT',
          side: OrderSideEnum.Buy,
          type: OrderTypeEnum.Market,
          timeInForce: TimeInForceEnum.Gtc,
          price: 0,
          avgPrice: 0,
          stopPrice: 0,
          amount: 0.001,
          filledAmount: 0,
          filledQuoteAmount: 0,
          status: 'open',
          reduceOnly: false,
          timestamp: 1700000000000,
          updatedTimestamp: 1700000000000,
        };
        tradeStream.isConnected.mockReturnValue(true);
        tradeStream.createBatchOrders.mockResolvedValue([wsOrder]);

        const result = await client.createBatchOrders([
          { symbol: 'BTCUSDT', type: OrderTypeEnum.Market, side: OrderSideEnum.Buy, amount: 0.001 },
        ]);

        expect(tradeStream.createBatchOrders).toHaveBeenCalledTimes(1);
        expect(tradeStream.createBatchOrders.mock.calls[0][0]).toBe('linear');
        expect(mockInstance.post).not.toHaveBeenCalled();
        expect(result).toEqual([wsOrder]);
      });

      it('falls back to REST when tradeStream is not connected', async () => {
        const { client, mockInstance } = createClient(false);
        client.tradeSymbols.set('BTCUSDT', BTCUSDT_TRADE_SYMBOL);

        const tradeStream = (client as any).tradeStream;
        tradeStream.isConnected.mockReturnValue(false);
        mockInstance.post.mockResolvedValue({
          data: { retCode: 0, result: { list: [{ orderId: 'rest-1' }] } },
        });

        await client.createBatchOrders([
          { symbol: 'BTCUSDT', type: OrderTypeEnum.Market, side: OrderSideEnum.Buy, amount: 0.001 },
        ]);

        expect(tradeStream.createBatchOrders).not.toHaveBeenCalled();
        expect(mockInstance.post).toHaveBeenCalledWith(
          '/v5/order/create-batch',
          expect.any(Object),
          expect.any(Object),
        );
      });

      it('uses REST in demo mode (tradeStream === null)', async () => {
        const { client, mockInstance } = createClient(true);
        client.tradeSymbols.set('BTCUSDT', BTCUSDT_TRADE_SYMBOL);

        mockInstance.post.mockResolvedValue({
          data: { retCode: 0, result: { list: [{ orderId: 'demo-1' }] } },
        });

        await client.createBatchOrders([
          { symbol: 'BTCUSDT', type: OrderTypeEnum.Market, side: OrderSideEnum.Buy, amount: 0.001 },
        ]);

        expect((client as any).tradeStream).toBeNull();
        expect(mockInstance.post).toHaveBeenCalledWith(
          '/v5/order/create-batch',
          expect.any(Object),
          expect.any(Object),
        );
      });
    });

    describe('modifyBatchOrders', () => {
      it('uses WebSocket when tradeStream is connected', async () => {
        const { client, mockInstance } = createClient(false);
        client.tradeSymbols.set('BTCUSDT', BTCUSDT_TRADE_SYMBOL);

        const tradeStream = (client as any).tradeStream;
        tradeStream.isConnected.mockReturnValue(true);
        tradeStream.modifyBatchOrders.mockResolvedValue([
          { orderId: '1', isSuccess: true, errorCode: null, errorText: null },
        ]);

        const result = await client.modifyBatchOrders([
          { symbol: 'BTCUSDT', orderId: '1', side: OrderSideEnum.Buy, price: 30000 },
        ]);

        expect(tradeStream.modifyBatchOrders).toHaveBeenCalledTimes(1);
        expect(tradeStream.modifyBatchOrders.mock.calls[0][0]).toBe('linear');
        expect(tradeStream.modifyBatchOrders.mock.calls[0][1]).toEqual(['1']);
        expect(mockInstance.post).not.toHaveBeenCalled();
        expect(result).toEqual([{ orderId: '1', isSuccess: true, errorCode: null, errorText: null }]);
      });

      it('falls back to REST when tradeStream is not connected', async () => {
        const { client, mockInstance } = createClient(false);
        client.tradeSymbols.set('BTCUSDT', BTCUSDT_TRADE_SYMBOL);

        const tradeStream = (client as any).tradeStream;
        tradeStream.isConnected.mockReturnValue(false);
        mockInstance.post.mockResolvedValue({ data: BYBIT_RAW_AMEND_BATCH_RESPONSE });

        await client.modifyBatchOrders([
          { symbol: 'BTCUSDT', orderId: '1', side: OrderSideEnum.Buy, price: 30000 },
        ]);

        expect(tradeStream.modifyBatchOrders).not.toHaveBeenCalled();
        expect(mockInstance.post).toHaveBeenCalledWith(
          '/v5/order/amend-batch',
          expect.any(Object),
          expect.any(Object),
        );
      });

      it('uses REST in demo mode (tradeStream === null)', async () => {
        const { client, mockInstance } = createClient(true);
        client.tradeSymbols.set('BTCUSDT', BTCUSDT_TRADE_SYMBOL);

        mockInstance.post.mockResolvedValue({ data: BYBIT_RAW_AMEND_BATCH_RESPONSE });

        await client.modifyBatchOrders([
          { symbol: 'BTCUSDT', orderId: '1', side: OrderSideEnum.Buy, price: 30000 },
        ]);

        expect((client as any).tradeStream).toBeNull();
        expect(mockInstance.post).toHaveBeenCalledWith(
          '/v5/order/amend-batch',
          expect.any(Object),
          expect.any(Object),
        );
      });
    });

    describe('cancelBatchOrders', () => {
      it('uses WebSocket when tradeStream is connected', async () => {
        const { client, mockInstance } = createClient(false);

        const tradeStream = (client as any).tradeStream;
        tradeStream.isConnected.mockReturnValue(true);
        tradeStream.cancelBatchOrders.mockResolvedValue([
          { orderId: 'order-1', isSuccess: true, errorCode: null, errorText: null },
        ]);

        const result = await client.cancelBatchOrders('BTCUSDT', ['order-1']);

        expect(tradeStream.cancelBatchOrders).toHaveBeenCalledTimes(1);
        expect(tradeStream.cancelBatchOrders.mock.calls[0][0]).toBe('linear');
        expect(tradeStream.cancelBatchOrders.mock.calls[0][1]).toEqual(['order-1']);
        expect(mockInstance.post).not.toHaveBeenCalled();
        expect(result).toEqual([{ orderId: 'order-1', isSuccess: true, errorCode: null, errorText: null }]);
      });

      it('falls back to REST when tradeStream is not connected', async () => {
        const { client, mockInstance } = createClient(false);

        const tradeStream = (client as any).tradeStream;
        tradeStream.isConnected.mockReturnValue(false);
        mockInstance.post.mockResolvedValue({
          data: {
            retCode: 0,
            result: { list: [{ orderId: 'order-1' }] },
            retExtInfo: { list: [{ code: 0, msg: 'OK' }] },
          },
        });

        await client.cancelBatchOrders('BTCUSDT', ['order-1']);

        expect(tradeStream.cancelBatchOrders).not.toHaveBeenCalled();
        expect(mockInstance.post).toHaveBeenCalledWith(
          '/v5/order/cancel-batch',
          expect.any(Object),
          expect.any(Object),
        );
      });

      it('uses REST in demo mode (tradeStream === null)', async () => {
        const { client, mockInstance } = createClient(true);

        mockInstance.post.mockResolvedValue({
          data: {
            retCode: 0,
            result: { list: [{ orderId: 'order-1' }] },
            retExtInfo: { list: [{ code: 0, msg: 'OK' }] },
          },
        });

        await client.cancelBatchOrders('BTCUSDT', ['order-1']);

        expect((client as any).tradeStream).toBeNull();
        expect(mockInstance.post).toHaveBeenCalledWith(
          '/v5/order/cancel-batch',
          expect.any(Object),
          expect.any(Object),
        );
      });
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

  describe('fetchPositionMode', () => {
    it('returns Hedge when any USDT position has positionIdx 1 or 2', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({
        data: { result: { list: [{ ...BYBIT_RAW_POSITION, positionIdx: 1 }] } },
      });

      const mode = await client.fetchPositionMode();

      expect(mode).toBe(PositionModeEnum.Hedge);
    });

    it('returns Hedge when both Long and Short positionIdx are present', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({
        data: {
          result: {
            list: [
              { ...BYBIT_RAW_POSITION, positionIdx: 1 },
              { ...BYBIT_RAW_POSITION, positionIdx: 2 },
            ],
          },
        },
      });

      const mode = await client.fetchPositionMode();

      expect(mode).toBe(PositionModeEnum.Hedge);
    });

    it('returns OneWay when all USDT positions have positionIdx 0', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({
        data: { result: { list: [{ ...BYBIT_RAW_POSITION, positionIdx: 0 }] } },
      });

      const mode = await client.fetchPositionMode();

      expect(mode).toBe(PositionModeEnum.OneWay);
    });

    it('returns undefined when there are no USDT positions', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({
        data: { result: { list: [] } },
      });

      const mode = await client.fetchPositionMode();

      expect(mode).toBeUndefined();
    });

    it('passes settleCoin=USDT to the position list endpoint', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({
        data: { result: { list: [] } },
      });

      await client.fetchPositionMode();

      const lastCall = mockInstance.get.mock.calls[mockInstance.get.mock.calls.length - 1];
      const requestPath = lastCall[0] as string;
      const requestParams = (lastCall[1] as { params?: Record<string, unknown> } | undefined)?.params;

      expect(requestPath).toBe('/v5/position/list');
      expect(requestParams).toMatchObject({ category: 'linear', settleCoin: 'USDT' });
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

  // Время закрытия Bybit не присылает, но оно однозначно выводится из начала и длительности
  // интервала. Из-за нуля на его месте обходной приём «если ноль — посчитай сам» разошёлся
  // по трём приложениям сразу.
  describe('history klines', () => {
    it('states when the kline closed instead of leaving a zero for the caller to patch', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({
        data: { retCode: 0, result: { list: [['1700000000000', '1', '2', '0.5', '1.5', '10', '15']] } },
      });

      const [kline] = await client.fetchKlines('BTCUSDT', '30m');

      expect(kline.openTimestamp).toBe(1700000000000);
      expect(kline.closeTimestamp).toBe(1700000000000 + 30 * 60 * 1000);
    });
  });

  describe('getOrderRateLimit', () => {
    // Предел частоты был зашит числом в коде: биржа его поменяла — соседняя биржа подстроится
    // (она читает его с биржи), а эта нет. Bybit сообщает предел заголовком ответа на заявку,
    // и торговый канал этот заголовок уже разбирает — берём оттуда.
    it('prefers the limit the exchange itself reported on an order response', async () => {
      const { client } = createClient();
      const tradeStream = (client as any).tradeStream;
      tradeStream.getLastReportedOrderRateLimit.mockReturnValue({ limit: 20, remaining: 19, resetMs: 1700000001000 });

      const result = await client.getOrderRateLimit();

      expect(result).toEqual({ writeRequestsPerSecond: 20, source: 'bybit-exchange-header' });
    });

    it('falls back to the documented value while the exchange has not reported one', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockClear();
      mockInstance.post.mockClear();

      const result = await client.getOrderRateLimit();

      expect(result).toEqual({ writeRequestsPerSecond: 10, source: 'bybit-documented' });
      expect(mockInstance.get).not.toHaveBeenCalled();
      expect(mockInstance.post).not.toHaveBeenCalled();
    });
  });

  // На Bybit скольжение — свойство позиции, а не заявка: отдельного номера у него нет.
  // Наружу это обязано выглядеть так же, как на Binance, иначе потребителю приходится
  // знать, с какой биржей он работает.
  describe('trailing stop (Bybit keeps it on the position, not as an order)', () => {
    function armTrailingRequest(mockInstance: Record<string, jest.Mock>): void {
      mockInstance.post.mockResolvedValue({ data: { retCode: 0, retMsg: 'OK', result: {} } });
    }

    it('sends the percentage offset as an absolute price distance measured from the activation price', async () => {
      const { client, mockInstance } = createClient();
      client.tradeSymbols.set('BTCUSDT', BTCUSDT_TRADE_SYMBOL);
      armTrailingRequest(mockInstance);

      await client.createOrderWebSocket({
        symbol: 'BTCUSDT',
        type: OrderTypeEnum.TrailingStop,
        side: OrderSideEnum.Sell,
        amount: 0.1,
        activationPrice: 70000,
        callbackRate: 2,
      });

      const [path, body] = mockInstance.post.mock.calls[0];

      expect(path).toBe('/v5/position/trading-stop');
      expect(body.category).toBe('linear');
      expect(body.symbol).toBe('BTCUSDT');
      expect(body.trailingStop).toBe('1400');
      expect(body.activePrice).toBe('70000');
      expect(body.tpslMode).toBe('Full');
      expect(body.positionIdx).toBe(0);
    });

    it('falls back to the current mark price when no activation price is given', async () => {
      const { client, mockInstance } = createClient();
      client.tradeSymbols.set('BTCUSDT', BTCUSDT_TRADE_SYMBOL);
      mockInstance.get.mockResolvedValue({
        data: { retCode: 0, retMsg: 'OK', result: { list: BYBIT_RAW_MARK_PRICE_TICKER_LIST } },
      });
      armTrailingRequest(mockInstance);

      await client.createOrderWebSocket({
        symbol: 'BTCUSDT',
        type: OrderTypeEnum.TrailingStop,
        side: OrderSideEnum.Sell,
        amount: 0.1,
        callbackRate: 1,
      });

      const [, body] = mockInstance.post.mock.calls[0];

      // Mark price 65450.50, отступ 1% = 654.505 — на сетку цены символа (шаг 0.10) это 654.5.
      // Расстояние — тоже цена, и биржа принимает его только по своей сетке.
      expect(body.trailingStop).toBe('654.5');
      expect(body.activePrice).toBeUndefined();
    });

    it('addresses the hedge position the order was aimed at', async () => {
      const { client, mockInstance } = createClient();
      client.tradeSymbols.set('BTCUSDT', BTCUSDT_TRADE_SYMBOL);
      armTrailingRequest(mockInstance);

      await client.createOrderWebSocket({
        symbol: 'BTCUSDT',
        type: OrderTypeEnum.TrailingStop,
        side: OrderSideEnum.Buy,
        amount: 0.1,
        positionSide: PositionSideEnum.Short,
        activationPrice: 70000,
        callbackRate: 2,
      });

      const [path, body] = mockInstance.post.mock.calls[0];

      expect(path).toBe('/v5/position/trading-stop');
      expect(body.positionIdx).toBe(2);
    });

    it('returns an order the caller can later cancel: same symbol, same type, non-empty id', async () => {
      const { client, mockInstance } = createClient();
      client.tradeSymbols.set('BTCUSDT', BTCUSDT_TRADE_SYMBOL);
      armTrailingRequest(mockInstance);

      const order = await client.createOrderWebSocket({
        symbol: 'BTCUSDT',
        type: OrderTypeEnum.TrailingStop,
        side: OrderSideEnum.Sell,
        amount: 0.1,
        activationPrice: 70000,
        callbackRate: 2,
      });

      expect(order.id).not.toBe('');
      expect(order.symbol).toBe('BTCUSDT');
      expect(order.type).toBe(OrderTypeEnum.TrailingStop);
      expect(order.isConditional).toBe(true);
      expect(order.status).toBe('open');
    });

    it('refuses a trailing stop with no offset instead of sending a meaningless zero distance', async () => {
      const { client, mockInstance } = createClient();
      client.tradeSymbols.set('BTCUSDT', BTCUSDT_TRADE_SYMBOL);
      armTrailingRequest(mockInstance);

      await expect(
        client.createOrderWebSocket({
          symbol: 'BTCUSDT',
          type: OrderTypeEnum.TrailingStop,
          side: OrderSideEnum.Sell,
          amount: 0.1,
          activationPrice: 70000,
        }),
      ).rejects.toThrow(ExchangeError);

      expect(mockInstance.post).not.toHaveBeenCalled();
    });

    it('cancels by clearing the distance, exactly as the exchange documents it', async () => {
      const { client, mockInstance } = createClient();
      client.tradeSymbols.set('BTCUSDT', BTCUSDT_TRADE_SYMBOL);
      armTrailingRequest(mockInstance);

      const order = await client.createOrderWebSocket({
        symbol: 'BTCUSDT',
        type: OrderTypeEnum.TrailingStop,
        side: OrderSideEnum.Sell,
        amount: 0.1,
        activationPrice: 70000,
        callbackRate: 2,
      });

      mockInstance.post.mockClear();

      const canceled = await client.cancelOrder('BTCUSDT', order.id);

      const [path, body] = mockInstance.post.mock.calls[0];

      expect(path).toBe('/v5/position/trading-stop');
      expect(body.trailingStop).toBe('0');
      expect(canceled.status).toBe('canceled');
      expect(canceled.id).toBe(order.id);
    });

    it('reads the live distance back from the position, so the id survives a restart', async () => {
      const { client, mockInstance } = createClient();
      client.tradeSymbols.set('BTCUSDT', BTCUSDT_TRADE_SYMBOL);
      mockInstance.get.mockResolvedValue({
        data: {
          retCode: 0,
          retMsg: 'OK',
          result: { list: [{ ...BYBIT_RAW_POSITION, positionIdx: 0, trailingStop: '1400', activePrice: '70000' }] },
        },
      });

      const order = await client.getOrder('BTCUSDT', 'bybitTrailingStop|0');

      expect(order.id).toBe('bybitTrailingStop|0');
      expect(order.type).toBe(OrderTypeEnum.TrailingStop);
      expect(order.stopPrice).toBe(70000);
      expect(order.status).toBe('open');
    });

    it('reports no trailing stop as a missing order, not as an armed one', async () => {
      const { client, mockInstance } = createClient();
      client.tradeSymbols.set('BTCUSDT', BTCUSDT_TRADE_SYMBOL);
      mockInstance.get.mockResolvedValue({
        data: {
          retCode: 0,
          retMsg: 'OK',
          result: { list: [{ ...BYBIT_RAW_POSITION, positionIdx: 0, trailingStop: '0' }] },
        },
      });

      await expect(client.getOrder('BTCUSDT', 'bybitTrailingStop|0')).rejects.toThrow();
      // Читаем позицию, а не книгу заявок: скольжения в книге не существует.
      expect(mockInstance.get.mock.calls[0][0]).toBe('/v5/position/list');
    });

    it('never lets a trailing stop slip through the plain order builder disguised as a market order', () => {
      const { client } = createClient();
      client.tradeSymbols.set('BTCUSDT', BTCUSDT_TRADE_SYMBOL);

      expect(() =>
        (client as any).buildBybitOrderParams({
          symbol: 'BTCUSDT',
          type: OrderTypeEnum.TrailingStop,
          side: OrderSideEnum.Sell,
          amount: 0.1,
          callbackRate: 2,
        }),
      ).toThrow(ExchangeError);
    });
  });
});
