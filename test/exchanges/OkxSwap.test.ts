import axios from 'axios';
import { OkxSwap } from '../../src/exchanges/OkxSwap';
import { OkxPublicStream } from '../../src/ws/OkxPublicStream';
import { OkxTradeStream } from '../../src/ws/OkxTradeStream';
import { createMockLogger } from '../fixtures/mockLogger';
import { createMockAxiosInstance } from '../fixtures/mockAxios';
import {
  OKX_RAW_INSTRUMENT_SWAP,
  OKX_RAW_INSTRUMENT_INVERSE,
  OKX_RAW_TICKER_LIST,
  OKX_RAW_PUBLIC_TRADE_LIST,
  OKX_RAW_MARK_PRICE_LIST,
  OKX_RAW_INDEX_TICKER_LIST,
  OKX_RAW_FUNDING_RATE,
  OKX_RAW_OPEN_INTEREST,
  OKX_RAW_FEE_RATE,
  OKX_RAW_BALANCE,
  OKX_RAW_POSITION_NET_LONG,
  OKX_RAW_POSITION_HEDGE_SHORT,
  OKX_RAW_POSITION_HISTORY_LIST,
  OKX_RAW_BILL_TRADE_OPEN,
  OKX_RAW_BILL_TRADE_CLOSE,
  OKX_RAW_BILL_FUNDING_EXPENSE,
  OKX_RAW_ORDER_LIVE_POST_ONLY,
  OKX_RAW_ORDER_FILLED,
  OKX_RAW_ALGO_ORDER_STOP_MARKET,
  OKX_RAW_POSITION_TIER_LIST,
} from '../fixtures/okxRaw';
import type { KlineInterval } from '../../src/types/common';
import { MarginModeEnum, OrderSideEnum, OrderTypeEnum, PositionModeEnum, PositionSideEnum } from '../../src/types/common';
import { ExchangeError } from '../../src/errors/ExchangeError';
import { OKX_INCOME_BILL_TYPE } from '../../src/constants/mappings';
import {
  OKX_BILLS_PAGE_LIMIT,
  OKX_BUSINESS_WEBSOCKET_URL,
  OKX_HISTORY_TRIGGERED_ORDER_READ_LIMIT,
  OKX_DEMO_BUSINESS_WEBSOCKET_URL,
  OKX_DEMO_PRIVATE_WEBSOCKET_URL,
  OKX_DEMO_PUBLIC_WEBSOCKET_URL,
  OKX_ORDER_PAGE_LIMIT,
  OKX_ORDER_RATE_LIMIT_RPS,
  OKX_POSITIONS_HISTORY_PAGE_LIMIT,
  OKX_PRIVATE_WEBSOCKET_URL,
  OKX_PUBLIC_WEBSOCKET_URL,
  OKX_RECENT_HISTORY_RETENTION_MS,
} from '../../src/constants/okx';
import * as okxNormalizer from '../../src/normalizers/okxNormalizer';

const MockedOkxPublicStream = OkxPublicStream as jest.MockedClass<typeof OkxPublicStream>;
const MockedOkxTradeStream = OkxTradeStream as jest.MockedClass<typeof OkxTradeStream>;

jest.mock('axios');
jest.mock('../../src/ws/OkxPublicStream');
jest.mock('../../src/ws/OkxTradeStream');
jest.mock('../../src/ws/OkxPrivateStream');

const mockedAxios = axios as jest.Mocked<typeof axios>;

function okxSuccess<T>(data: T[]): { data: { code: string; msg: string; data: T[] } } {
  return { data: { code: '0', msg: '', data } };
}

async function loadInstruments(client: OkxSwap, mockInstance: Record<string, jest.Mock>): Promise<void> {
  mockInstance.get.mockResolvedValueOnce(okxSuccess([OKX_RAW_INSTRUMENT_SWAP]));
  await client.loadTradeSymbols();
  mockInstance.get.mockReset();
}

function createClient(passphrase = 'testPassphrase') {
  const mockInstance = createMockAxiosInstance();
  mockedAxios.create.mockReturnValue(mockInstance as any);
  const logger = createMockLogger();

  const client = new OkxSwap({
    config: { apiKey: 'testKey', secret: 'testSecret', passphrase },
    logger,
  });

  return { client, mockInstance, logger };
}

function buildConnectionFailure(message: string): Error & { response: { status: number; data: unknown } } {
  return Object.assign(new Error(message), { response: { status: 400, data: {} } });
}

const OKX_TEST_KLINE_ROWS: string[][] = [
  ['1700000060000', '10', '11', '9', '10.5', '100', '1000', '1000', '1'],
  ['1700000000000', '9', '10', '8', '9.5', '80', '800', '800', '1'],
];

describe('OkxSwap', () => {
  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(1700000000000);
  });

  describe('constructor', () => {
    it('throws OKX_PASSPHRASE_REQUIRED when passphrase is missing', () => {
      const mockInstance = createMockAxiosInstance();
      mockedAxios.create.mockReturnValue(mockInstance as any);

      let thrown: unknown;

      try {
        new OkxSwap({ config: { apiKey: 'k', secret: 's' }, logger: createMockLogger() });
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(ExchangeError);
      expect((thrown as ExchangeError).code).toBe('OKX_PASSPHRASE_REQUIRED');
    });

    it('stores the private/algo stream labels for stage 7 to use', () => {
      const { client } = createClient();

      expect((client as any).privateStreamLabel).toBe('OKX Swap Private WebSocket');
      expect((client as any).algoPrivateStreamLabel).toBe('OKX Swap Algo WebSocket');
    });

    it('wires the public/trade streams to the production URLs and shares symbolMap/contractValueBySymbol', () => {
      mockedAxios.create.mockReturnValue(createMockAxiosInstance() as any);
      const client = new OkxSwap({ config: { apiKey: 'k', secret: 's', passphrase: 'p' }, logger: createMockLogger() });

      const publicArgs = MockedOkxPublicStream.mock.calls[MockedOkxPublicStream.mock.calls.length - 1][0] as any;
      const tradeArgs = MockedOkxTradeStream.mock.calls[MockedOkxTradeStream.mock.calls.length - 1][0] as any;

      expect(publicArgs.publicUrl).toBe(OKX_PUBLIC_WEBSOCKET_URL);
      expect(publicArgs.businessUrl).toBe(OKX_BUSINESS_WEBSOCKET_URL);
      expect(tradeArgs.url).toBe(OKX_PRIVATE_WEBSOCKET_URL);
      expect(publicArgs.symbolMap).toBe((client as any).symbolMap);
      expect(publicArgs.contractValueBySymbol).toBe((client as any).contractValueBySymbol);
    });

    it('wires the public/trade streams to the demo URLs when isDemoMode is set', () => {
      mockedAxios.create.mockReturnValue(createMockAxiosInstance() as any);
      new OkxSwap({ config: { apiKey: 'k', secret: 's', passphrase: 'p', isDemoMode: true }, logger: createMockLogger() });

      const publicArgs = MockedOkxPublicStream.mock.calls[MockedOkxPublicStream.mock.calls.length - 1][0] as any;
      const tradeArgs = MockedOkxTradeStream.mock.calls[MockedOkxTradeStream.mock.calls.length - 1][0] as any;

      expect(publicArgs.publicUrl).toBe(OKX_DEMO_PUBLIC_WEBSOCKET_URL);
      expect(publicArgs.businessUrl).toBe(OKX_DEMO_BUSINESS_WEBSOCKET_URL);
      expect(tradeArgs.url).toBe(OKX_DEMO_PRIVATE_WEBSOCKET_URL);
    });
  });

  describe('createOrderWebSocket', () => {
    it('places a market order over REST when the order channel is down, sized in contracts', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValueOnce(okxSuccess([OKX_RAW_INSTRUMENT_SWAP]));
      await client.loadTradeSymbols();
      mockInstance.get.mockResolvedValue(okxSuccess([{ uid: '1', acctLv: '2', posMode: 'net_mode' }]));
      mockInstance.post.mockResolvedValue(okxSuccess([{ ordId: 'swap-1', clOrdId: '', tag: '', ts: '1', sCode: '0', sMsg: '' }]));

      const order = await client.createOrderWebSocket({
        symbol: 'BTCUSDT',
        type: OrderTypeEnum.Market,
        side: OrderSideEnum.Buy,
        amount: 0.05,
      });

      const [path, body] = mockInstance.post.mock.calls[0];

      expect(path).toBe('/api/v5/trade/order');
      expect(body).toMatchObject({ instId: 'BTC-USDT-SWAP', tdMode: 'cross', side: 'buy', ordType: 'market', sz: '5' });
      expect(order.id).toBe('swap-1');
    });

    it('refuses to size an order before the instruments are loaded instead of sending contracts as coins', async () => {
      const { client } = createClient();

      await expect(
        client.createOrderWebSocket({ symbol: 'BTCUSDT', type: OrderTypeEnum.Market, side: OrderSideEnum.Buy, amount: 1 }),
      ).rejects.toMatchObject({ code: 'OKX_INSTRUMENTS_NOT_LOADED' });
    });
  });

  describe('loadTradeSymbols', () => {
    it('builds the instrument maps used by resolveContractValue and fetchTrades', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValueOnce(okxSuccess([OKX_RAW_INSTRUMENT_SWAP]));

      const tradeSymbolBySymbol = await client.loadTradeSymbols();

      expect(tradeSymbolBySymbol.get('BTCUSDT')).toBeDefined();

      mockInstance.get.mockResolvedValueOnce(okxSuccess(OKX_RAW_PUBLIC_TRADE_LIST));
      const tradeList = await client.fetchTrades('BTCUSDT');

      expect(tradeList).toHaveLength(OKX_RAW_PUBLIC_TRADE_LIST.length);
    });

    it('keeps the numeric instrument code the exchange sent, so the trade channel can address the instrument', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValueOnce(okxSuccess([OKX_RAW_INSTRUMENT_SWAP]));

      await client.loadTradeSymbols();

      expect((client as any).symbolMap.resolveInstIdCode('BTCUSDT')).toBe(OKX_RAW_INSTRUMENT_SWAP.instIdCode);
    });

    it('refuses the numeric code for an instrument the exchange sent without one', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValueOnce(okxSuccess([{ ...OKX_RAW_INSTRUMENT_SWAP, instIdCode: null }]));

      await client.loadTradeSymbols();

      expect(() => (client as any).symbolMap.resolveInstIdCode('BTCUSDT')).toThrow('OKX instrument codes are not loaded');
    });

    it('throws OKX_INSTRUMENTS_NOT_LOADED for a swap symbol before loadTradeSymbols is called', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue(okxSuccess(OKX_RAW_PUBLIC_TRADE_LIST));

      await expect(client.fetchTrades('BTCUSDT')).rejects.toMatchObject({ code: 'OKX_INSTRUMENTS_NOT_LOADED' });
    });

    it('delegates the instrument filter entirely to isOkxInstrumentSupported, with no duplicated check', async () => {
      const spy = jest.spyOn(okxNormalizer, 'isOkxInstrumentSupported').mockReturnValue(true);

      try {
        const { client, mockInstance } = createClient();
        mockInstance.get.mockResolvedValueOnce(okxSuccess([OKX_RAW_INSTRUMENT_INVERSE]));

        await client.loadTradeSymbols();

        expect((client as any).symbolMap.has('BTCUSD')).toBe(true);
      } finally {
        spy.mockRestore();
      }
    });

    it('logs the count of accepted instruments, not the raw response length', async () => {
      const mockInstance = createMockAxiosInstance();
      mockedAxios.create.mockReturnValue(mockInstance as any);
      const logger = createMockLogger();
      const client = new OkxSwap({ config: { apiKey: 'k', secret: 's', passphrase: 'p' }, logger });
      mockInstance.get.mockResolvedValueOnce(okxSuccess([OKX_RAW_INSTRUMENT_SWAP, OKX_RAW_INSTRUMENT_INVERSE]));

      await client.loadTradeSymbols();

      expect(logger.info).toHaveBeenCalledWith({ instrumentCount: 1 }, '[OKX] Fetched 1 SWAP instruments');
    });

    it('rejects every instrument in the client-side maps when isOkxInstrumentSupported rejects everything', async () => {
      const spy = jest.spyOn(okxNormalizer, 'isOkxInstrumentSupported').mockReturnValue(false);

      try {
        const { client, mockInstance } = createClient();
        mockInstance.get.mockResolvedValueOnce(okxSuccess([OKX_RAW_INSTRUMENT_SWAP]));

        await client.loadTradeSymbols();

        expect((client as any).symbolMap.size()).toBe(0);
        expect((client as any).contractValueBySymbol.size).toBe(0);
      } finally {
        spy.mockRestore();
      }
    });
  });

  describe('fetchKlines', () => {
    it('uses /market/candles without a time window', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue(okxSuccess(OKX_TEST_KLINE_ROWS));

      await client.fetchKlines('BTCUSDT', '1h');

      const [url] = mockInstance.get.mock.calls[0];

      expect(url).toBe('/api/v5/market/candles');
    });

    it('uses /market/history-candles with after = startTime + limit*intervalMs when startTime is given', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue(okxSuccess(OKX_TEST_KLINE_ROWS));

      await client.fetchKlines('BTCUSDT', '1h', { startTime: 1700000000000, limit: 10 });

      const [url, options] = mockInstance.get.mock.calls[0];

      expect(url).toBe('/api/v5/market/history-candles');
      expect(options.params.after).toBe(String(1700000000000 + 10 * 3_600_000));
    });

    it('uses /market/history-candles with after = endTime + 1 when endTime is given', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue(okxSuccess(OKX_TEST_KLINE_ROWS));

      await client.fetchKlines('BTCUSDT', '1h', { endTime: 1700000000000 });

      const [url, options] = mockInstance.get.mock.calls[0];

      expect(url).toBe('/api/v5/market/history-candles');
      expect(options.params.after).toBe('1700000000001');
    });

    it('uses /market/history-candles with after approximated by 31 days per month for 1M with only startTime', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue(okxSuccess(OKX_TEST_KLINE_ROWS));

      await client.fetchKlines('BTCUSDT', '1M', { startTime: 1600000000000, limit: 10 });

      const [url, options] = mockInstance.get.mock.calls[0];

      expect(url).toBe('/api/v5/market/history-candles');
      expect(options.params.after).toBe(String(1600000000000 + 10 * 31 * 24 * 60 * 60 * 1000));
    });

    it('clamps limit to 300 on the wire', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue(okxSuccess(OKX_TEST_KLINE_ROWS));

      await client.fetchKlines('BTCUSDT', '1h', { limit: 1000 });

      const [, options] = mockInstance.get.mock.calls[0];

      expect(options.params.limit).toBe('300');
    });

    it('uses /market/history-candles for the 1s interval even without a time window', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue(okxSuccess(OKX_TEST_KLINE_ROWS));

      await client.fetchKlines('BTCUSDT', '1s');

      const [url] = mockInstance.get.mock.calls[0];

      expect(url).toBe('/api/v5/market/history-candles');
    });

    it('filters klines by startTime after normalization', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue(okxSuccess(OKX_TEST_KLINE_ROWS));

      const klineList = await client.fetchKlines('BTCUSDT', '1h', { startTime: 1700000060000 });

      expect(klineList).toHaveLength(1);
      expect(klineList[0].openTimestamp).toBe(1700000060000);
    });

    it('throws for an interval OKX does not support', async () => {
      const { client } = createClient();

      await expect(client.fetchKlines('BTCUSDT', '2m' as KlineInterval)).rejects.toThrow(
        "Kline interval '2m' is not supported by OKX",
      );
    });

    it('asks for the daily bar on the UTC grid, the one Binance and Bybit cut by', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue(okxSuccess(OKX_TEST_KLINE_ROWS));

      await client.fetchKlines('BTCUSDT', '1d');

      const [, options] = mockInstance.get.mock.calls[0];

      expect(options.params.bar).toBe('1Dutc');
    });

    it('asks for the UTC grid on history-candles as well', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue(okxSuccess(OKX_TEST_KLINE_ROWS));

      await client.fetchKlines('BTCUSDT', '1w', { startTime: 1700000000000 });

      const [url, options] = mockInstance.get.mock.calls[0];

      expect(url).toBe('/api/v5/market/history-candles');
      expect(options.params.bar).toBe('1Wutc');
    });
  });

  describe('fetchBalances', () => {
    it('normalizes the balance response', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue(okxSuccess([OKX_RAW_BALANCE]));

      const result = await client.fetchBalances();

      expect(result.balanceByAsset.get('USDT')).toBeDefined();
    });

    it('throws OKX_BALANCE_EMPTY when the response is empty', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue(okxSuccess([]));

      await expect(client.fetchBalances()).rejects.toMatchObject({ code: 'OKX_BALANCE_EMPTY' });
    });

    it('labels the account with the mode taken from the account config', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get
        .mockResolvedValueOnce(okxSuccess([OKX_RAW_BALANCE]))
        .mockResolvedValueOnce(okxSuccess([{ uid: '1', acctLv: '2', posMode: 'net_mode' }]));

      const result = await client.fetchBalances();

      expect(result.accountType).toBe('acctLv:2');
    });

    it('reads the account config once and reuses it for the next balance call', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get
        .mockResolvedValueOnce(okxSuccess([OKX_RAW_BALANCE]))
        .mockResolvedValueOnce(okxSuccess([{ uid: '1', acctLv: '3', posMode: 'net_mode' }]))
        .mockResolvedValueOnce(okxSuccess([OKX_RAW_BALANCE]));

      await client.fetchBalances();
      const result = await client.fetchBalances();

      const configCallList = mockInstance.get.mock.calls.filter(([url]: [string]) => url === '/api/v5/account/config');

      expect(configCallList).toHaveLength(1);
      expect(result.accountType).toBe('acctLv:3');
    });

    it('returns the balance with a warning when the account config cannot be read', async () => {
      const { client, mockInstance, logger } = createClient();
      mockInstance.get
        .mockResolvedValueOnce(okxSuccess([OKX_RAW_BALANCE]))
        .mockRejectedValueOnce(buildConnectionFailure('account config unavailable'));

      const result = await client.fetchBalances();

      expect(result.balanceByAsset.get('USDT')).toBeDefined();
      expect(result.accountType).toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Could not read the account mode'));
    });
  });

  describe('fetchFeeRate', () => {
    it('throws FEE_RATE_SYMBOL_REQUIRED without a symbol', async () => {
      const { client } = createClient();

      await expect(client.fetchFeeRate()).rejects.toMatchObject({ code: 'FEE_RATE_SYMBOL_REQUIRED' });
    });

    it('requests trade-fee with instFamily (not instId) for a swap symbol', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue(okxSuccess([OKX_RAW_FEE_RATE]));

      await client.fetchFeeRate('BTCUSDT');

      const [, options] = mockInstance.get.mock.calls[0];

      expect(options.params.instFamily).toBe('BTC-USDT');
      expect(options.params.instId).toBeUndefined();
    });

    it('picks the fee group entry matching groupIdBySymbol, not just any group', async () => {
      const { client, mockInstance } = createClient();
      (client as any).groupIdBySymbol.set('BTCUSDT', '2');
      mockInstance.get.mockResolvedValue(
        okxSuccess([
          {
            ...OKX_RAW_FEE_RATE,
            feeGroup: [
              { groupId: '1', maker: '-0.0008', taker: '-0.001' },
              { groupId: '2', maker: '-0.0005', taker: '-0.0007' },
            ],
          },
        ]),
      );

      const [feeRate] = await client.fetchFeeRate('BTCUSDT');

      expect(feeRate.makerRate).toBeCloseTo(0.0005);
      expect(feeRate.takerRate).toBeCloseTo(0.0007);
    });

    it('uses makerUSDC/takerUSDC for a USDC-settled swap symbol', async () => {
      const { client, mockInstance } = createClient();
      (client as any).tradeSymbols.set('ETHUSDC', { settle: 'USDC' });
      mockInstance.get.mockResolvedValue(
        okxSuccess([{ ...OKX_RAW_FEE_RATE, feeGroup: undefined, makerUSDC: '-0.0002', takerUSDC: '-0.0004' }]),
      );

      const [feeRate] = await client.fetchFeeRate('ETHUSDC');

      expect(feeRate.makerRate).toBeCloseTo(0.0002);
      expect(feeRate.takerRate).toBeCloseTo(0.0004);
    });

    it('warns when the rate had to be taken from the outdated top-level fields', async () => {
      const { client, mockInstance } = createClient();
      const logger = (client as any).logger;
      mockInstance.get.mockResolvedValue(
        okxSuccess([{ ...OKX_RAW_FEE_RATE, feeGroup: undefined, makerU: '-0.0002', takerU: '-0.0004' }]),
      );

      await client.fetchFeeRate('BTCUSDT');

      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('outdated top-level fields'));
    });

    it('says nothing when the rate came from the fee group of the instrument', async () => {
      const { client, mockInstance } = createClient();
      const logger = (client as any).logger;
      (client as any).groupIdBySymbol.set('BTCUSDT', '1');
      mockInstance.get.mockResolvedValue(okxSuccess([OKX_RAW_FEE_RATE]));

      await client.fetchFeeRate('BTCUSDT');

      expect(logger.warn).not.toHaveBeenCalled();
    });
  });

  describe('fetchOrderBook', () => {
    it('clamps depth to 400 on the wire', async () => {
      const { client, mockInstance } = createClient();
      await loadInstruments(client, mockInstance);
      mockInstance.get.mockResolvedValue(okxSuccess([{ asks: [], bids: [], ts: '1700000000000' }]));

      await client.fetchOrderBook('BTCUSDT', 9999);

      const [url, options] = mockInstance.get.mock.calls[0];

      expect(url).toBe('/api/v5/market/books');
      expect(options.params.sz).toBe('400');
    });

    it('reports depth in coins, not in contracts', async () => {
      const { client, mockInstance } = createClient();
      await loadInstruments(client, mockInstance);
      mockInstance.get.mockResolvedValue(
        okxSuccess([{ asks: [['62000', '10', '0', '4']], bids: [['61999', '20', '0', '4']], ts: '1700000000000' }]),
      );

      const orderBook = await client.fetchOrderBook('BTCUSDT');

      expect(orderBook.askList[0].quantity).toBeCloseTo(0.1);
      expect(orderBook.bidList[0].quantity).toBeCloseTo(0.2);
    });

    it('refuses to report depth before the instruments are loaded instead of reporting contracts as coins', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue(okxSuccess([{ asks: [], bids: [], ts: '1700000000000' }]));

      await expect(client.fetchOrderBook('BTCUSDT')).rejects.toMatchObject({ code: 'OKX_INSTRUMENTS_NOT_LOADED' });
    });
  });

  describe('fetchFundingRateHistory', () => {
    it('shifts the window bounds by ±1 ms and clamps limit to 400', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue(okxSuccess([]));

      await client.fetchFundingRateHistory('BTCUSDT', { startTime: 1000, endTime: 2000, limit: 5000 });

      const [url, options] = mockInstance.get.mock.calls[0];

      expect(url).toBe('/api/v5/public/funding-rate-history');
      expect(options.params.after).toBe('2001');
      expect(options.params.before).toBe('999');
      expect(options.params.limit).toBe('400');
    });
  });

  describe('getWebSocketConnectionInfoList', () => {
    it('combines the public and trade stream connection info', async () => {
      const { client } = createClient();
      const publicStream = (client as any).publicStream;
      const tradeStream = (client as any).tradeStream;
      publicStream.getConnectionInfoList.mockReturnValue([{ label: 'public' }]);
      tradeStream.getConnectionInfo.mockReturnValue({ label: 'trade' });

      const connectionInfoList = client.getWebSocketConnectionInfoList();

      expect(connectionInfoList).toEqual([{ label: 'public' }, { label: 'trade' }]);
    });
  });

  describe('fetchPositionMode', () => {
    it('returns Hedge for long_short_mode', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue(okxSuccess([{ uid: '1', acctLv: '2', posMode: 'long_short_mode' }]));

      await expect(client.fetchPositionMode()).resolves.toBe(PositionModeEnum.Hedge);
    });

    it('returns OneWay for net_mode', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue(okxSuccess([{ uid: '1', acctLv: '2', posMode: 'net_mode' }]));

      await expect(client.fetchPositionMode()).resolves.toBe(PositionModeEnum.OneWay);
    });

    it('returns undefined for an unrecognized posMode', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue(okxSuccess([{ uid: '1', acctLv: '2', posMode: 'unexpected' }]));

      await expect(client.fetchPositionMode()).resolves.toBeUndefined();
    });

    it('warns when the account is in Spot mode (acctLv 1)', async () => {
      const mockInstance = createMockAxiosInstance();
      mockedAxios.create.mockReturnValue(mockInstance as any);
      const logger = createMockLogger();
      const client = new OkxSwap({ config: { apiKey: 'k', secret: 's', passphrase: 'p' }, logger });
      mockInstance.get.mockResolvedValue(okxSuccess([{ uid: '1', acctLv: '1', posMode: 'net_mode' }]));

      await client.fetchPositionMode();

      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe('setPositionMode', () => {
    it('does not call POST when the account is already in the requested mode', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue(okxSuccess([{ uid: '1', acctLv: '2', posMode: 'net_mode' }]));

      await client.setPositionMode(PositionModeEnum.OneWay);

      expect(mockInstance.post).not.toHaveBeenCalled();
    });

    it('calls POST and invalidates the cached config when the mode differs', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValueOnce(okxSuccess([{ uid: '1', acctLv: '2', posMode: 'net_mode' }]));
      mockInstance.post.mockResolvedValue(okxSuccess([{ posMode: 'long_short_mode' }]));

      await client.setPositionMode(PositionModeEnum.Hedge);

      const [path, body] = mockInstance.post.mock.calls[0];

      expect(path).toBe('/api/v5/account/set-position-mode');
      expect(body.posMode).toBe('long_short_mode');

      mockInstance.get.mockResolvedValueOnce(okxSuccess([{ uid: '1', acctLv: '2', posMode: 'long_short_mode' }]));
      const mode = await client.fetchPositionMode();

      expect(mode).toBe(PositionModeEnum.Hedge);
      expect(mockInstance.get).toHaveBeenCalledTimes(2);
    });
  });

  describe('setLeverage', () => {
    it('sends a single cross-margin request and confirms leverage from the response', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue(okxSuccess([{ uid: '1', acctLv: '2', posMode: 'net_mode' }]));
      mockInstance.post.mockResolvedValue(okxSuccess([{ instId: 'BTC-USDT-SWAP', posSide: 'net', mgnMode: 'cross', lever: '20' }]));

      const result = await client.setLeverage(20, 'BTCUSDT');

      expect(mockInstance.post).toHaveBeenCalledTimes(1);
      const [, body] = mockInstance.post.mock.calls[0];

      expect(body.mgnMode).toBe('cross');
      expect(body.posSide).toBeUndefined();
      expect(result.confirmedLeverage).toBe(20);
    });

    it('sends two isolated requests (long/short) in hedge mode and confirms when both agree', async () => {
      const { client, mockInstance } = createClient();
      (client as any).marginModeBySymbol.set('BTCUSDT', MarginModeEnum.Isolated);
      mockInstance.get.mockResolvedValue(okxSuccess([{ uid: '1', acctLv: '2', posMode: 'long_short_mode' }]));
      mockInstance.post.mockResolvedValue(okxSuccess([{ instId: 'BTC-USDT-SWAP', posSide: 'long', mgnMode: 'isolated', lever: '10' }]));

      const result = await client.setLeverage(10, 'BTCUSDT');

      expect(mockInstance.post).toHaveBeenCalledTimes(2);

      const [, firstBody] = mockInstance.post.mock.calls[0];
      const [, secondBody] = mockInstance.post.mock.calls[1];

      expect(firstBody.lever).toBe('10');
      expect(firstBody.posSide).toBe('long');
      expect(secondBody.lever).toBe('10');
      expect(secondBody.posSide).toBe('short');
      expect(result.confirmedLeverage).toBe(10);
    });

    it('returns null confirmedLeverage when lever is missing from the response', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue(okxSuccess([{ uid: '1', acctLv: '2', posMode: 'net_mode' }]));
      mockInstance.post.mockResolvedValue(okxSuccess([{}]));

      const result = await client.setLeverage(20, 'BTCUSDT');

      expect(result.confirmedLeverage).toBeNull();
    });

    it('still sends the short request when the long one fails, so the two sides do not diverge', async () => {
      const { client, mockInstance } = createClient();
      (client as any).marginModeBySymbol.set('BTCUSDT', MarginModeEnum.Isolated);
      mockInstance.get.mockResolvedValue(okxSuccess([{ uid: '1', acctLv: '2', posMode: 'long_short_mode' }]));
      mockInstance.post
        .mockRejectedValueOnce(new Error('long leg failed'))
        .mockResolvedValue(okxSuccess([{ instId: 'BTC-USDT-SWAP', posSide: 'short', mgnMode: 'isolated', lever: '10' }]));

      await expect(client.setLeverage(10, 'BTCUSDT')).rejects.toMatchObject({ code: 'OKX_LEVERAGE_SIDES_DIVERGED' });

      expect(mockInstance.post).toHaveBeenCalledTimes(2);
      expect(mockInstance.post.mock.calls[1][1].posSide).toBe('short');
    });

    it('names the side that already carries the new leverage when the second request is refused', async () => {
      const { client, mockInstance } = createClient();
      (client as any).marginModeBySymbol.set('BTCUSDT', MarginModeEnum.Isolated);
      mockInstance.get.mockResolvedValue(okxSuccess([{ uid: '1', acctLv: '2', posMode: 'long_short_mode' }]));
      mockInstance.post
        .mockResolvedValueOnce(okxSuccess([{ instId: 'BTC-USDT-SWAP', posSide: 'long', mgnMode: 'isolated', lever: '7' }]))
        .mockRejectedValueOnce(new Error('short leg failed'));

      await expect(client.setLeverage(7, 'BTCUSDT')).rejects.toThrow(/rejected on short.*already applied on long/);
    });

    it('confirms nothing when the two sides answered with different leverage', async () => {
      const { client, mockInstance } = createClient();
      (client as any).marginModeBySymbol.set('BTCUSDT', MarginModeEnum.Isolated);
      mockInstance.get.mockResolvedValue(okxSuccess([{ uid: '1', acctLv: '2', posMode: 'long_short_mode' }]));
      mockInstance.post
        .mockResolvedValueOnce(okxSuccess([{ instId: 'BTC-USDT-SWAP', posSide: 'long', mgnMode: 'isolated', lever: '10' }]))
        .mockResolvedValueOnce(okxSuccess([{ instId: 'BTC-USDT-SWAP', posSide: 'short', mgnMode: 'isolated', lever: '5' }]));

      const result = await client.setLeverage(10, 'BTCUSDT');

      expect(result.confirmedLeverage).toBeNull();
    });
  });

  describe('fetchLeverageTierList', () => {
    it('requests position-tiers by instFamily and normalizes by the contract value', async () => {
      const { client, mockInstance } = createClient();

      await loadInstruments(client, mockInstance);

      mockInstance.get.mockResolvedValue(okxSuccess(OKX_RAW_POSITION_TIER_LIST));

      const result = await client.fetchLeverageTierList('BTCUSDT');

      const [url, options] = mockInstance.get.mock.calls[0];

      expect(url).toBe('/api/v5/public/position-tiers');
      expect(options.params).toEqual({ instType: 'SWAP', tdMode: 'cross', instFamily: 'BTC-USDT' });
      expect(result[0]?.maxBaseAmount).toBeCloseTo(10, 9);
    });
  });

  describe('setMarginMode', () => {
    it('warns when an open position remains in a different margin mode', async () => {
      const mockInstance = createMockAxiosInstance();
      mockedAxios.create.mockReturnValue(mockInstance as any);
      const logger = createMockLogger();
      const client = new OkxSwap({ config: { apiKey: 'k', secret: 's', passphrase: 'p' }, logger });
      mockInstance.get.mockResolvedValue(okxSuccess([{ ...OKX_RAW_POSITION_NET_LONG, mgnMode: 'cross' }]));

      await client.setMarginMode(MarginModeEnum.Isolated, 'BTCUSDT');

      expect(logger.warn).toHaveBeenCalled();
    });

    it('does not warn when there is no open position', async () => {
      const { client, mockInstance } = createClient();
      const logger = (client as any).logger;
      mockInstance.get.mockResolvedValueOnce(okxSuccess([{ uid: '1', acctLv: '2', posMode: 'net_mode' }]));
      mockInstance.get.mockResolvedValue(okxSuccess([]));

      await client.setMarginMode(MarginModeEnum.Isolated, 'BTCUSDT');

      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('warns that isolated margin does not exist in the multi-currency account mode', async () => {
      const { client, mockInstance } = createClient();
      const logger = (client as any).logger;
      mockInstance.get.mockResolvedValueOnce(okxSuccess([{ uid: '1', acctLv: '3', posMode: 'net_mode' }]));
      mockInstance.get.mockResolvedValue(okxSuccess([]));

      await client.setMarginMode(MarginModeEnum.Isolated, 'BTCUSDT');

      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Isolated margin is unavailable in account mode 3'));
    });

    it('warns when the open positions cannot be read while switching the margin mode', async () => {
      const { client, mockInstance } = createClient();
      const logger = (client as any).logger;
      mockInstance.get.mockRejectedValue(buildConnectionFailure('positions unreachable'));

      await client.setMarginMode(MarginModeEnum.Cross, 'BTCUSDT');

      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Could not verify open positions'));
    });

    it('warns when the account mode cannot be read while switching to isolated margin', async () => {
      const { client, mockInstance } = createClient();
      const logger = (client as any).logger;
      mockInstance.get.mockRejectedValue(buildConnectionFailure('config unreachable'));

      await client.setMarginMode(MarginModeEnum.Isolated, 'BTCUSDT');

      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Could not read the account mode'));
    });

    it('says nothing about the account mode when cross margin is requested', async () => {
      const { client, mockInstance } = createClient();
      const logger = (client as any).logger;
      mockInstance.get.mockResolvedValueOnce(okxSuccess([{ uid: '1', acctLv: '4', posMode: 'net_mode' }]));
      mockInstance.get.mockResolvedValue(okxSuccess([]));

      await client.setMarginMode(MarginModeEnum.Cross, 'BTCUSDT');

      expect(logger.warn).not.toHaveBeenCalled();
    });
  });

  describe('margin mode after a restart', () => {
    it('takes the margin mode of an open position from the exchange instead of assuming cross', async () => {
      const { client, mockInstance } = createClient();
      await loadInstruments(client, mockInstance);
      mockInstance.get.mockResolvedValue(okxSuccess([{ ...OKX_RAW_POSITION_NET_LONG, mgnMode: 'isolated' }]));

      const params = await (client as any).buildOkxOrderParams({
        symbol: 'BTCUSDT',
        type: OrderTypeEnum.Limit,
        side: OrderSideEnum.Buy,
        amount: 1,
        price: 100,
      });

      expect(params.tdMode).toBe('isolated');
      const [url] = mockInstance.get.mock.calls[0];
      expect(url).toBe('/api/v5/account/positions');
    });

    it('asks the exchange once per instrument and reuses the answer afterwards', async () => {
      const { client, mockInstance } = createClient();
      await loadInstruments(client, mockInstance);
      mockInstance.get.mockResolvedValue(okxSuccess([{ ...OKX_RAW_POSITION_NET_LONG, mgnMode: 'isolated' }]));

      await (client as any).resolveTradeMode('BTCUSDT');
      await (client as any).resolveTradeMode('BTCUSDT');

      const positionCallList = mockInstance.get.mock.calls.filter(([url]: [string]) => url === '/api/v5/account/positions');

      expect(positionCallList).toHaveLength(1);
    });

    it('shares one request between callers that ask at the same time', async () => {
      const { client, mockInstance } = createClient();
      await loadInstruments(client, mockInstance);
      mockInstance.get.mockResolvedValue(okxSuccess([{ ...OKX_RAW_POSITION_NET_LONG, mgnMode: 'isolated' }]));

      const modeList = await Promise.all([
        (client as any).resolveTradeMode('BTCUSDT'),
        (client as any).resolveTradeMode('BTCUSDT'),
      ]);

      expect(modeList).toEqual(['isolated', 'isolated']);
      const positionCallList = mockInstance.get.mock.calls.filter(([url]: [string]) => url === '/api/v5/account/positions');
      expect(positionCallList).toHaveLength(1);
    });

    it('stays with cross and warns when the exchange cannot be asked', async () => {
      const { client, mockInstance } = createClient();
      await loadInstruments(client, mockInstance);
      const logger = (client as any).logger;
      mockInstance.get.mockRejectedValue(buildConnectionFailure('network down'));

      await expect((client as any).resolveTradeMode('BTCUSDT')).resolves.toBe('cross');
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Could not read the margin mode of BTCUSDT'));
    });

    it('does not remember a failed read, so the next order asks again', async () => {
      const { client, mockInstance } = createClient();
      await loadInstruments(client, mockInstance);
      mockInstance.get.mockRejectedValueOnce(buildConnectionFailure('network down'));
      mockInstance.get.mockResolvedValue(okxSuccess([{ ...OKX_RAW_POSITION_NET_LONG, mgnMode: 'isolated' }]));

      await expect((client as any).resolveTradeMode('BTCUSDT')).resolves.toBe('cross');
      await expect((client as any).resolveTradeMode('BTCUSDT')).resolves.toBe('isolated');
    });

    it('treats an instrument without an open position as cross', async () => {
      const { client, mockInstance } = createClient();
      await loadInstruments(client, mockInstance);
      mockInstance.get.mockResolvedValue(okxSuccess([{ ...OKX_RAW_POSITION_NET_LONG, mgnMode: 'isolated', pos: '0' }]));

      await expect((client as any).resolveTradeMode('BTCUSDT')).resolves.toBe('cross');
    });

    it('lets an explicit choice made during the read win over the answer of the exchange', async () => {
      const { client, mockInstance } = createClient();
      await loadInstruments(client, mockInstance);
      mockInstance.get.mockResolvedValue(okxSuccess([{ ...OKX_RAW_POSITION_NET_LONG, mgnMode: 'isolated' }]));

      const lookup = (client as any).resolveTradeMode('BTCUSDT');
      (client as any).marginModeBySymbol.set('BTCUSDT', MarginModeEnum.Cross);

      await expect(lookup).resolves.toBe('cross');
    });

    it('keeps the mode the caller chose instead of the one read from the exchange', async () => {
      const { client, mockInstance } = createClient();
      await loadInstruments(client, mockInstance);
      mockInstance.get.mockResolvedValue(okxSuccess([]));

      await client.setMarginMode(MarginModeEnum.Isolated, 'BTCUSDT');

      await expect((client as any).resolveTradeMode('BTCUSDT')).resolves.toBe('isolated');
    });

    it('reads the positions of the whole account once, not once per instrument', async () => {
      const { client, mockInstance } = createClient();
      await loadInstruments(client, mockInstance);
      mockInstance.get.mockResolvedValue(okxSuccess([
        { ...OKX_RAW_POSITION_NET_LONG, instId: 'BTC-USDT-SWAP', mgnMode: 'isolated' },
        { ...OKX_RAW_POSITION_NET_LONG, instId: 'ETH-USDT-SWAP', mgnMode: 'cross' },
      ]));

      // Заявки пачкой собираются ПО ОДНОЙ, поэтому память, заполняемая по инструменту, давала бы
      // столько последовательных запросов позиций, сколько символов в пачке, — до отправки.
      const modeList = [];

      for (const symbol of ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT']) {
        modeList.push(await (client as any).resolveTradeMode(symbol));
      }

      expect(modeList).toEqual(['isolated', 'cross', 'cross', 'cross']);

      const positionCallList = mockInstance.get.mock.calls.filter(([url]: [string]) => url === '/api/v5/account/positions');

      expect(positionCallList).toHaveLength(1);
      expect(positionCallList[0][1].params.instId).toBeUndefined();
    });

    it('asks again after a failed read, once for the whole account', async () => {
      const { client, mockInstance } = createClient();
      await loadInstruments(client, mockInstance);
      mockInstance.get.mockRejectedValueOnce(buildConnectionFailure('network down'));
      mockInstance.get.mockResolvedValue(okxSuccess([{ ...OKX_RAW_POSITION_NET_LONG, mgnMode: 'isolated' }]));

      await expect((client as any).resolveTradeMode('BTCUSDT')).resolves.toBe('cross');
      await expect((client as any).resolveTradeMode('ETHUSDT')).resolves.toBe('cross');
      await expect((client as any).resolveTradeMode('BTCUSDT')).resolves.toBe('isolated');

      const positionCallList = mockInstance.get.mock.calls.filter(([url]: [string]) => url === '/api/v5/account/positions');

      expect(positionCallList).toHaveLength(2);
    });
  });

  describe('fetchPositionSnapshot', () => {
    it('returns null when there are no positions', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue(okxSuccess([]));

      await expect(client.fetchPositionSnapshot('BTCUSDT')).resolves.toBeNull();
    });

    it('throws when called without positionIdx while the symbol is in hedge mode', async () => {
      const { client, mockInstance } = createClient();
      (client as any).contractValueBySymbol.set('BTCUSDT', '0.01');
      mockInstance.get.mockResolvedValue(okxSuccess([OKX_RAW_POSITION_HEDGE_SHORT]));

      await expect(client.fetchPositionSnapshot('BTCUSDT')).rejects.toThrow(/hedge mode/);
    });

    it('reports the only net position when no positionIdx is given', async () => {
      const { client, mockInstance } = createClient();
      await loadInstruments(client, mockInstance);
      mockInstance.get.mockResolvedValue(okxSuccess([OKX_RAW_POSITION_NET_LONG]));

      const position = await client.fetchPositionSnapshot('BTCUSDT');

      expect(position?.symbol).toBe('BTCUSDT');
      expect(position?.contracts).toBe(0.05);
    });

    it('returns the matching entry for a given positionIdx', async () => {
      const { client, mockInstance } = createClient();
      (client as any).contractValueBySymbol.set('BTCUSDT', '0.01');
      mockInstance.get.mockResolvedValue(okxSuccess([OKX_RAW_POSITION_HEDGE_SHORT]));

      const position = await client.fetchPositionSnapshot('BTCUSDT', 2);

      expect(position).not.toBeNull();
      expect(position!.side).toBe(PositionSideEnum.Short);
    });

    it('returns null when positionIdx does not match any entry', async () => {
      const { client, mockInstance } = createClient();
      (client as any).contractValueBySymbol.set('BTCUSDT', '0.01');
      mockInstance.get.mockResolvedValue(okxSuccess([OKX_RAW_POSITION_HEDGE_SHORT]));

      await expect(client.fetchPositionSnapshot('BTCUSDT', 1)).resolves.toBeNull();
    });

    it('throws for a positionIdx outside 0/1/2', async () => {
      const { client, mockInstance } = createClient();
      (client as any).contractValueBySymbol.set('BTCUSDT', '0.01');
      mockInstance.get.mockResolvedValue(okxSuccess([OKX_RAW_POSITION_HEDGE_SHORT]));

      await expect(client.fetchPositionSnapshot('BTCUSDT', 3)).rejects.toThrow(
        'Invalid positionIdx 3 for BTCUSDT: expected 0 (net), 1 (long) or 2 (short)',
      );
    });
  });

  describe('fetchAllPositions', () => {
    it('filters out positions with zero size', async () => {
      const { client, mockInstance } = createClient();
      (client as any).symbolMap.register({ symbol: 'BTCUSDT', instId: 'BTC-USDT-SWAP', baseAsset: 'BTC', quoteAsset: 'USDT', isSwap: true });
      (client as any).contractValueBySymbol.set('BTCUSDT', '0.01');
      mockInstance.get.mockResolvedValue(
        okxSuccess([OKX_RAW_POSITION_NET_LONG, { ...OKX_RAW_POSITION_NET_LONG, instId: 'ETH-USDT-SWAP', pos: '0' }]),
      );

      const positionList = await client.fetchAllPositions();

      expect(positionList).toHaveLength(1);
      expect(positionList[0].symbol).toBe('BTCUSDT');
    });

    it('skips a position whose instrument name cannot be read at all and keeps the rest', async () => {
      const { client, mockInstance } = createClient();
      const logger = (client as any).logger;
      (client as any).symbolMap.register({ symbol: 'BTCUSDT', instId: 'BTC-USDT-SWAP', baseAsset: 'BTC', quoteAsset: 'USDT', isSwap: true });
      (client as any).contractValueBySymbol.set('BTCUSDT', '0.01');
      mockInstance.get.mockResolvedValue(
        okxSuccess([OKX_RAW_POSITION_NET_LONG, { ...OKX_RAW_POSITION_NET_LONG, instId: 'NONSENSE', pos: '5' }]),
      );

      const positionList = await client.fetchAllPositions();

      expect(positionList).toHaveLength(1);
      expect(positionList[0].symbol).toBe('BTCUSDT');
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Cannot resolve symbol for instId NONSENSE'));
    });

    it('skips a position for an instrument outside the loaded map and keeps the rest', async () => {
      const { client, mockInstance } = createClient();
      const logger = (client as any).logger;
      (client as any).symbolMap.register({ symbol: 'BTCUSDT', instId: 'BTC-USDT-SWAP', baseAsset: 'BTC', quoteAsset: 'USDT', isSwap: true });
      (client as any).contractValueBySymbol.set('BTCUSDT', '0.01');
      mockInstance.get.mockResolvedValue(
        okxSuccess([OKX_RAW_POSITION_NET_LONG, { ...OKX_RAW_POSITION_NET_LONG, instId: 'BTC-USD-SWAP', pos: '5' }]),
      );

      const positionList = await client.fetchAllPositions();

      expect(positionList).toHaveLength(1);
      expect(positionList[0].symbol).toBe('BTCUSDT');
      expect(logger.warn).toHaveBeenCalledTimes(1);
    });
  });

  describe('fetchPosition', () => {
    it('asks the positions endpoint for one instrument and reports the size in coins', async () => {
      const { client, mockInstance } = createClient();
      await loadInstruments(client, mockInstance);
      mockInstance.get.mockResolvedValue(okxSuccess([OKX_RAW_POSITION_NET_LONG]));

      const position = await client.fetchPosition('BTCUSDT');

      const [url, options] = mockInstance.get.mock.calls[0];
      expect(url).toBe('/api/v5/account/positions');
      expect(options.params).toEqual({ instType: 'SWAP', instId: 'BTC-USDT-SWAP' });
      expect(position.symbol).toBe('BTCUSDT');
      expect(position.contracts).toBe(0.05);
      expect(position.marginMode).toBe(MarginModeEnum.Isolated);
    });

    it('throws when the exchange knows no position for the symbol', async () => {
      const { client, mockInstance } = createClient();
      await loadInstruments(client, mockInstance);
      mockInstance.get.mockResolvedValue(okxSuccess([]));

      await expect(client.fetchPosition('BTCUSDT')).rejects.toThrow('Position not found for BTCUSDT');
    });
  });

  describe('fetchPositionList', () => {
    it('reports every leg of the instrument, each sized in coins', async () => {
      const { client, mockInstance } = createClient();
      await loadInstruments(client, mockInstance);
      mockInstance.get.mockResolvedValue(okxSuccess([OKX_RAW_POSITION_NET_LONG, OKX_RAW_POSITION_HEDGE_SHORT]));

      const positionList = await client.fetchPositionList('BTCUSDT');

      const [url, options] = mockInstance.get.mock.calls[0];
      expect(url).toBe('/api/v5/account/positions');
      expect(options.params).toEqual({ instType: 'SWAP', instId: 'BTC-USDT-SWAP' });
      expect(positionList).toHaveLength(2);
      expect(positionList[0].contracts).toBe(0.05);
      expect(positionList[1].contracts).toBe(0.05);
    });

    it('returns an empty list when the instrument has no positions', async () => {
      const { client, mockInstance } = createClient();
      await loadInstruments(client, mockInstance);
      mockInstance.get.mockResolvedValue(okxSuccess([]));

      await expect(client.fetchPositionList('BTCUSDT')).resolves.toEqual([]);
    });
  });

  describe('fetchFundingInfo', () => {
    it('asks the funding rate endpoint for one instrument', async () => {
      const { client, mockInstance } = createClient();
      await loadInstruments(client, mockInstance);
      mockInstance.get.mockResolvedValue(okxSuccess([OKX_RAW_FUNDING_RATE]));

      const fundingInfoList = await client.fetchFundingInfo('BTCUSDT');

      const [url, options] = mockInstance.get.mock.calls[0];
      expect(url).toBe('/api/v5/public/funding-rate');
      expect(options.params).toEqual({ instId: 'BTC-USDT-SWAP' });
      expect(fundingInfoList).toHaveLength(1);
      expect(fundingInfoList[0].symbol).toBe('BTCUSDT');
      expect(fundingInfoList[0].fundingIntervalHours).toBe(8);
      expect(fundingInfoList[0].adjustedFundingRateCap).toBe(0.00375);
      expect(fundingInfoList[0].adjustedFundingRateFloor).toBe(-0.00375);
    });

    it('asks for every instrument and keeps only the loaded ones', async () => {
      const { client, mockInstance } = createClient();
      await loadInstruments(client, mockInstance);
      mockInstance.get.mockResolvedValue(
        okxSuccess([OKX_RAW_FUNDING_RATE, { ...OKX_RAW_FUNDING_RATE, instId: 'ETH-USDT-SWAP' }]),
      );

      const fundingInfoList = await client.fetchFundingInfo();

      const [, options] = mockInstance.get.mock.calls[0];
      expect(options.params).toEqual({ instId: 'ANY' });
      expect(fundingInfoList).toHaveLength(1);
      expect(fundingInfoList[0].symbol).toBe('BTCUSDT');
    });

    it('keeps every instrument while nothing is loaded', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue(
        okxSuccess([OKX_RAW_FUNDING_RATE, { ...OKX_RAW_FUNDING_RATE, instId: 'ETH-USDT-SWAP' }]),
      );

      await expect(client.fetchFundingInfo()).resolves.toHaveLength(2);
    });
  });

  describe('fetchOpenInterest', () => {
    it('reports open interest in coins and names the symbol the caller asked for', async () => {
      const { client, mockInstance } = createClient();
      await loadInstruments(client, mockInstance);
      mockInstance.get.mockResolvedValue(okxSuccess([OKX_RAW_OPEN_INTEREST]));

      const openInterest = await client.fetchOpenInterest('BTCUSDT');

      const [url, options] = mockInstance.get.mock.calls[0];
      expect(url).toBe('/api/v5/public/open-interest');
      expect(options.params).toEqual({ instType: 'SWAP', instId: 'BTC-USDT-SWAP' });
      expect(openInterest.symbol).toBe('BTCUSDT');
      expect(openInterest.openInterest).toBe(555.55);
      expect(openInterest.timestamp).toBe(1597026383085);
    });

    it('refuses an empty open interest answer instead of reporting a zero', async () => {
      const { client, mockInstance } = createClient();
      await loadInstruments(client, mockInstance);
      mockInstance.get.mockResolvedValue(okxSuccess([]));

      await expect(client.fetchOpenInterest('BTCUSDT')).rejects.toMatchObject({ code: 'OKX_OPEN_INTEREST_EMPTY' });
    });
  });

  describe('loadTradeSymbols name collisions', () => {
    it('says out loud when two instruments claim the same common name', async () => {
      const { client, mockInstance, logger } = createClient();
      const twinInstrument = {
        ...OKX_RAW_INSTRUMENT_SWAP,
        instId: 'BTCUS-DT-SWAP',
        uly: 'BTCUS-DT',
        instFamily: 'BTCUS-DT',
        settleCcy: 'USDT',
      };
      mockInstance.get.mockImplementation((url: string) => {
        if (url === '/api/v5/public/instruments') {
          return Promise.resolve(okxSuccess([OKX_RAW_INSTRUMENT_SWAP, twinInstrument]));
        }

        return Promise.resolve(okxSuccess([]));
      });

      await client.loadTradeSymbols();

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Instrument BTCUS-DT-SWAP takes the common name BTCUSDT away from another instrument'),
      );
    });
  });

  describe('loadTradeSymbols funding', () => {
    it('asks the funding-rate endpoint once for every instrument and fills TradeSymbol.funding', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockImplementation((url: string) => {
        if (url === '/api/v5/public/instruments') {
          return Promise.resolve(okxSuccess([OKX_RAW_INSTRUMENT_SWAP]));
        }

        return Promise.resolve(okxSuccess([OKX_RAW_FUNDING_RATE]));
      });

      const tradeSymbols = await client.loadTradeSymbols();

      const fundingCallList = mockInstance.get.mock.calls.filter(([url]: [string]) => url === '/api/v5/public/funding-rate');

      expect(fundingCallList).toHaveLength(1);
      expect(fundingCallList[0][1].params.instId).toBe('ANY');
      expect(tradeSymbols.get('BTCUSDT')?.funding).toEqual({
        fundingIntervalMinutes: 480,
        upperFundingRate: '0.00375',
        lowerFundingRate: '-0.00375',
      });
    });

    it('still loads the instruments when the funding-rate endpoint fails', async () => {
      const { client, mockInstance, logger } = createClient();
      mockInstance.get.mockImplementation((url: string) => {
        if (url === '/api/v5/public/instruments') {
          return Promise.resolve(okxSuccess([OKX_RAW_INSTRUMENT_SWAP]));
        }

        return Promise.reject(buildConnectionFailure('funding unreachable'));
      });

      const tradeSymbols = await client.loadTradeSymbols();

      expect(tradeSymbols.get('BTCUSDT')?.funding).toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Could not read funding info while loading instruments'));
    });
  });

  describe('fetchTickers', () => {
    it('leaves out an inverse contract, so tickers, instruments and mark price agree', async () => {
      const { client, mockInstance } = createClient();
      await loadInstruments(client, mockInstance);
      mockInstance.get.mockResolvedValue(okxSuccess([
        { ...OKX_RAW_TICKER_LIST[1], instId: 'BTC-USDT-SWAP' },
        { ...OKX_RAW_TICKER_LIST[0], instId: 'LTC-USD-SWAP' },
      ]));

      const tickerBySymbol = await client.fetchTickers();

      expect(tickerBySymbol.has('LTCUSD')).toBe(false);
      expect(tickerBySymbol.has('BTCUSDT')).toBe(true);
      expect(client.tradeSymbols.has('LTCUSD')).toBe(false);
    });
  });

  describe('fetchOrderHistory', () => {
    function plainOrderRaw(ordId: string, cTime: string) {
      return { ...OKX_RAW_ORDER_LIVE_POST_ONLY, instId: 'BTC-USDT-SWAP', instType: 'SWAP', ordId, cTime, uTime: cTime, sz: '1', tgtCcy: '' };
    }

    function algoOrderRaw(algoId: string, cTime: string, state: string) {
      return { ...OKX_RAW_ALGO_ORDER_STOP_MARKET, algoId, cTime, uTime: cTime, state };
    }

    function answerHistory(mockInstance: Record<string, jest.Mock>, plainPageList: unknown[][], algoRawList: unknown[]): void {
      let plainPageIndex = 0;
      let algoAnswered = false;

      mockInstance.get.mockImplementation((url: string) => {
        if (url.includes('orders-algo-history')) {
          const page = algoAnswered ? [] : algoRawList;
          algoAnswered = true;

          return Promise.resolve(okxSuccess(page));
        }

        if (url.includes('orders-history')) {
          const page = plainPageList[plainPageIndex] ?? [];
          plainPageIndex += 1;

          return Promise.resolve(okxSuccess(page));
        }

        return Promise.resolve(okxSuccess([]));
      });
    }

    it('reads past a full page instead of stopping silently at a hundred', async () => {
      const { client, mockInstance } = createClient();
      await loadInstruments(client, mockInstance);
      const firstPage = Array.from({ length: OKX_ORDER_PAGE_LIMIT }, (_entry, index) => plainOrderRaw(`plain-${index}`, '1724733617998'));
      answerHistory(mockInstance, [firstPage, [plainOrderRaw('plain-tail', '1724733617998')]], []);

      const orderList = await client.fetchOrderHistory('BTCUSDT', { limit: OKX_ORDER_PAGE_LIMIT + 1 });

      const historyCallList = mockInstance.get.mock.calls.filter(([url]: [string]) => url === '/api/v5/trade/orders-history');
      expect(historyCallList).toHaveLength(2);
      expect(historyCallList[1][1].params.after).toBe(`plain-${OKX_ORDER_PAGE_LIMIT - 1}`);
      expect(orderList).toHaveLength(OKX_ORDER_PAGE_LIMIT + 1);
    });

    it('includes the conditional orders the algo service keeps, so a fired stop is visible', async () => {
      const { client, mockInstance } = createClient();
      await loadInstruments(client, mockInstance);
      answerHistory(mockInstance, [[plainOrderRaw('plain-1', '1724733617998')]], [algoOrderRaw('algo-1', '1724751378980', 'effective')]);

      const orderList = await client.fetchOrderHistory('BTCUSDT');

      expect(orderList.map((order) => order.id)).toEqual(['algo-1', 'plain-1']);
    });

    it('asks the algo service for every terminal state of every conditional order type', async () => {
      const { client, mockInstance } = createClient();
      await loadInstruments(client, mockInstance);
      answerHistory(mockInstance, [[]], []);

      await client.fetchOrderHistory('BTCUSDT');

      const algoCallList = mockInstance.get.mock.calls.filter(([url]: [string]) => url === '/api/v5/trade/orders-algo-history');
      const askedList = algoCallList.map(([, options]: [string, any]) => `${options.params.ordType}/${options.params.state}`);

      expect(askedList).toEqual([
        'conditional,oco/effective',
        'conditional,oco/canceled',
        'conditional,oco/order_failed',
        'move_order_stop/effective',
        'move_order_stop/canceled',
        'move_order_stop/order_failed',
      ]);
    });

    it('sorts the two services into one list, newest first', async () => {
      const { client, mockInstance } = createClient();
      await loadInstruments(client, mockInstance);
      answerHistory(
        mockInstance,
        [[plainOrderRaw('plain-old', '1000'), plainOrderRaw('plain-new', '3000')]],
        [algoOrderRaw('algo-middle', '2000', 'canceled')],
      );

      const orderList = await client.fetchOrderHistory('BTCUSDT');

      expect(orderList.map((order) => order.id)).toEqual(['plain-new', 'algo-middle', 'plain-old']);
    });

    it('keeps out the conditional orders outside the asked window, which the algo service cannot filter', async () => {
      const { client, mockInstance } = createClient();
      await loadInstruments(client, mockInstance);
      answerHistory(
        mockInstance,
        [[]],
        [algoOrderRaw('algo-inside', '2000', 'effective'), algoOrderRaw('algo-outside', '500', 'effective')],
      );

      const orderList = await client.fetchOrderHistory('BTCUSDT', { startTime: 1000, endTime: 3000 });

      expect(orderList.map((order) => order.id)).toEqual(['algo-inside']);
    });

    it('returns no more rows than the caller asked for', async () => {
      const { client, mockInstance } = createClient();
      await loadInstruments(client, mockInstance);
      answerHistory(
        mockInstance,
        [[plainOrderRaw('plain-1', '1000'), plainOrderRaw('plain-2', '2000')]],
        [algoOrderRaw('algo-1', '3000', 'effective')],
      );

      const orderList = await client.fetchOrderHistory('BTCUSDT', { limit: 2 });

      expect(orderList.map((order) => order.id)).toEqual(['algo-1', 'plain-2']);
    });

    it('reports a fired stop as closed with its actual fill instead of open with zero', async () => {
      const { client, mockInstance } = createClient();
      await loadInstruments(client, mockInstance);
      const firedRaw = { ...algoOrderRaw('algo-fired', '2000', 'effective'), ordIdList: ['spawned-1'] };
      const spawnedRaw = {
        ...OKX_RAW_ORDER_FILLED,
        instId: 'BTC-USDT-SWAP',
        instType: 'SWAP',
        ordId: 'spawned-1',
        state: 'filled',
        accFillSz: '10',
        avgPx: '59980',
        tgtCcy: '',
      };

      mockInstance.get.mockImplementation((url: string) => {
        if (url === '/api/v5/trade/order') {
          return Promise.resolve(okxSuccess([spawnedRaw]));
        }

        if (url === '/api/v5/trade/orders-algo-history') {
          return Promise.resolve(okxSuccess(mockInstance.get.mock.calls.filter(([path]: [string]) => path === url).length === 1 ? [firedRaw] : []));
        }

        return Promise.resolve(okxSuccess([]));
      });

      const orderList = await client.fetchOrderHistory('BTCUSDT');

      expect(orderList).toHaveLength(1);
      expect(orderList[0].status).toBe('closed');
      expect(orderList[0].avgPrice).toBe(59980);
      expect(orderList[0].filledAmount).toBeCloseTo(0.1);
    });

    it('reads back nothing for a cancelled conditional order, which never fired', async () => {
      const { client, mockInstance } = createClient();
      await loadInstruments(client, mockInstance);
      answerHistory(mockInstance, [[]], [{ ...algoOrderRaw('algo-cancelled', '2000', 'canceled'), ordIdList: ['never-1'] }]);

      const orderList = await client.fetchOrderHistory('BTCUSDT');

      expect(orderList[0].status).toBe('canceled');
      expect(mockInstance.get.mock.calls.filter(([url]: [string]) => url === '/api/v5/trade/order')).toHaveLength(0);
    });

    it('stops reading back after the limit and says so instead of firing a request per row', async () => {
      const { client, mockInstance, logger } = createClient();
      await loadInstruments(client, mockInstance);
      const firedRawList = Array.from(
        { length: OKX_HISTORY_TRIGGERED_ORDER_READ_LIMIT + 3 },
        (_entry, index) => ({ ...algoOrderRaw(`algo-fired-${index}`, String(2000 + index), 'effective'), ordIdList: [`spawned-${index}`] }),
      );

      let algoAnswered = false;
      mockInstance.get.mockImplementation((url: string) => {
        if (url === '/api/v5/trade/orders-algo-history') {
          const page = algoAnswered ? [] : firedRawList;
          algoAnswered = true;

          return Promise.resolve(okxSuccess(page));
        }

        return Promise.resolve(okxSuccess([]));
      });

      await client.fetchOrderHistory('BTCUSDT');

      expect(mockInstance.get.mock.calls.filter(([url]: [string]) => url === '/api/v5/trade/order'))
        .toHaveLength(OKX_HISTORY_TRIGGERED_ORDER_READ_LIMIT);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ triggeredOrderCount: OKX_HISTORY_TRIGGERED_ORDER_READ_LIMIT + 3 }),
        expect.stringContaining('triggered conditional orders'),
      );
    });

    it('reads the archive book when only the window end is older than the recent retention', async () => {
      const { client, mockInstance } = createClient();
      await loadInstruments(client, mockInstance);
      answerHistory(mockInstance, [[]], []);

      await client.fetchOrderHistory('BTCUSDT', { endTime: 1700000000000 - OKX_RECENT_HISTORY_RETENTION_MS - 1 });

      const archiveCallList = mockInstance.get.mock.calls.filter(([url]: [string]) => url === '/api/v5/trade/orders-history-archive');

      expect(archiveCallList).toHaveLength(1);
    });

    it('reads the archive book for a window older than the recent retention', async () => {
      const { client, mockInstance } = createClient();
      await loadInstruments(client, mockInstance);
      answerHistory(mockInstance, [[]], []);

      await client.fetchOrderHistory('BTCUSDT', { startTime: 1700000000000 - OKX_RECENT_HISTORY_RETENTION_MS - 1 });

      const archiveCallList = mockInstance.get.mock.calls.filter(([url]: [string]) => url === '/api/v5/trade/orders-history-archive');
      expect(archiveCallList).toHaveLength(1);
      expect(archiveCallList[0][1].params.begin).toBe(String(1700000000000 - OKX_RECENT_HISTORY_RETENTION_MS - 1));
    });
  });

  describe('fetchIncome', () => {
    it('maps incomeType to the OKX bill type filter', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue(okxSuccess([OKX_RAW_BILL_FUNDING_EXPENSE]));

      await client.fetchIncome({ incomeType: 'funding' });

      const [, options] = mockInstance.get.mock.calls[0];

      expect(options.params.type).toBe(OKX_INCOME_BILL_TYPE.funding);
    });

    it('uses pnl (not balChg) as the income for realizedPnl, via the dedicated builder', async () => {
      const { client, mockInstance } = createClient();
      await loadInstruments(client, mockInstance);
      mockInstance.get.mockResolvedValue(okxSuccess([OKX_RAW_BILL_TRADE_CLOSE]));

      const [income] = await client.fetchIncome({ incomeType: 'realizedPnl' });

      expect(income.incomeType).toBe('REALIZED_PNL');
      expect(income.income).toBeCloseTo(15.5);
    });

    it('uses fee (not balChg) as the income for commission, via the dedicated builder', async () => {
      const { client, mockInstance } = createClient();
      await loadInstruments(client, mockInstance);
      mockInstance.get.mockResolvedValue(okxSuccess([OKX_RAW_BILL_TRADE_CLOSE]));

      const [income] = await client.fetchIncome({ incomeType: 'commission' });

      expect(income.incomeType).toBe('COMMISSION');
      expect(income.income).toBeCloseTo(-0.02022168);
    });

    it('splits an unfiltered trade bill into gross realized PnL and its commission', async () => {
      const { client, mockInstance } = createClient();
      await loadInstruments(client, mockInstance);
      mockInstance.get.mockResolvedValue(okxSuccess([OKX_RAW_BILL_TRADE_CLOSE]));

      const incomeList = await client.fetchIncome();

      expect(incomeList.map((income) => income.kind)).toEqual(['realizedPnl', 'commission']);
      expect(incomeList[0].income).toBeCloseTo(15.5);
      expect(incomeList[1].income).toBeCloseTo(-0.02022168);
    });

    it('skips a swap bill it cannot measure instead of losing the whole journal', async () => {
      const { client, mockInstance, logger } = createClient();
      mockInstance.get.mockResolvedValue(okxSuccess([OKX_RAW_BILL_TRADE_CLOSE]));

      await expect(client.fetchIncome()).resolves.toEqual([]);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('fetchIncome: entry 0 on BTC-USDT-SWAP is not in the loaded instrument map'),
      );
    });

    it('keeps the rows it can measure and drops only the delisted one', async () => {
      const { client, mockInstance } = createClient();
      await loadInstruments(client, mockInstance);
      mockInstance.get.mockResolvedValue(okxSuccess([
        { ...OKX_RAW_BILL_TRADE_CLOSE, instId: 'GONE-USDT-SWAP' },
        OKX_RAW_BILL_TRADE_CLOSE,
      ]));

      const incomeList = await client.fetchIncome();

      expect(incomeList.every((entry) => entry.symbol === 'BTCUSDT')).toBe(true);
      expect(incomeList.length).toBeGreaterThan(0);
    });

    it('keeps a bill without a size even when its instrument is unknown', async () => {
      const { client, mockInstance } = createClient();
      await loadInstruments(client, mockInstance);
      mockInstance.get.mockResolvedValue(okxSuccess([
        { ...OKX_RAW_BILL_FUNDING_EXPENSE, instId: 'GONE-USDT-SWAP', sz: '' },
      ]));

      const incomeList = await client.fetchIncome();

      expect(incomeList).toHaveLength(1);
      expect(incomeList[0].quantity).toBeUndefined();
    });

    it('uses the archive endpoint for an old startTime', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue(okxSuccess([]));

      await client.fetchIncome({ startTime: Date.now() - OKX_RECENT_HISTORY_RETENTION_MS - 1000 });

      const [url] = mockInstance.get.mock.calls[0];

      expect(url).toBe('/api/v5/account/bills-archive');
    });

    it('reads the archive when only the window end is older than the recent retention', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue(okxSuccess([]));

      await client.fetchIncome({ endTime: 1700000000000 - OKX_RECENT_HISTORY_RETENTION_MS - 1000 });

      const [url] = mockInstance.get.mock.calls[0];

      expect(url).toBe('/api/v5/account/bills-archive');
    });

    it('stays on the recent endpoint when only the window end is inside the retention', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue(okxSuccess([]));

      await client.fetchIncome({ endTime: 1700000000000 - 1000 });

      const [url] = mockInstance.get.mock.calls[0];

      expect(url).toBe('/api/v5/account/bills');
    });

    it('uses the recent endpoint by default', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue(okxSuccess([]));

      await client.fetchIncome();

      const [url] = mockInstance.get.mock.calls[0];

      expect(url).toBe('/api/v5/account/bills');
    });

    it('rejects a full page when a limit was explicitly requested', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue(okxSuccess(new Array(5).fill(OKX_RAW_BILL_TRADE_OPEN)));

      await expect(client.fetchIncome({ limit: 5 })).rejects.toThrow('full page');
    });

    it('rejects a full default page as well: the answer would be silently cut to the page size', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue(okxSuccess(new Array(OKX_BILLS_PAGE_LIMIT).fill(OKX_RAW_BILL_TRADE_OPEN)));

      await expect(client.fetchIncome()).rejects.toThrow('full page');
    });

    it('returns the entries when the page is not full', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue(okxSuccess(new Array(OKX_BILLS_PAGE_LIMIT - 1).fill(OKX_RAW_BILL_TRADE_OPEN)));

      await expect(client.fetchIncome()).resolves.toHaveLength(OKX_BILLS_PAGE_LIMIT - 1);
    });
  });

  describe('fetchClosedPnl', () => {
    it('normalizes closed PnL history', async () => {
      const { client, mockInstance } = createClient();
      await loadInstruments(client, mockInstance);
      mockInstance.get.mockResolvedValue(
        okxSuccess(OKX_RAW_POSITION_HISTORY_LIST.map((raw) => ({ ...raw, instId: 'BTC-USDT-SWAP' }))),
      );

      const result = await client.fetchClosedPnl('BTCUSDT');

      expect(result).toHaveLength(OKX_RAW_POSITION_HISTORY_LIST.length);
    });

    it('skips a closed position it cannot measure instead of losing the whole report', async () => {
      const { client, mockInstance, logger } = createClient();
      mockInstance.get.mockResolvedValue(okxSuccess(OKX_RAW_POSITION_HISTORY_LIST));

      await expect(client.fetchClosedPnl('BTCUSDT')).resolves.toEqual([]);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('fetchClosedPnl: entry 0 on BTC-USD-SWAP is not in the loaded instrument map'),
      );
    });

    it('keeps the closed positions it can measure and drops only the delisted one', async () => {
      const { client, mockInstance, logger } = createClient();
      await loadInstruments(client, mockInstance);
      mockInstance.get.mockResolvedValue(okxSuccess([
        { ...OKX_RAW_POSITION_HISTORY_LIST[0], instId: 'ETH-USDT-SWAP', posId: 'delisted' },
        { ...OKX_RAW_POSITION_HISTORY_LIST[0], instId: 'BTC-USDT-SWAP', posId: 'alive' },
      ]));

      const closedPnlList = await client.fetchClosedPnl();

      expect(closedPnlList.map((entry) => entry.orderId)).toEqual(['alive']);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('fetchClosedPnl: entry 0 on ETH-USDT-SWAP is not in the loaded instrument map'),
      );
    });

    it('reads past a full page instead of stopping silently at a hundred', async () => {
      const { client, mockInstance } = createClient();
      await loadInstruments(client, mockInstance);
      const firstPage = Array.from({ length: OKX_POSITIONS_HISTORY_PAGE_LIMIT }, (_entry, index) => ({
        ...OKX_RAW_POSITION_HISTORY_LIST[0],
        instId: 'BTC-USDT-SWAP',
        posId: `pos-${index}`,
        uTime: String(2000000 - index),
      }));
      mockInstance.get
        .mockResolvedValueOnce(okxSuccess(firstPage))
        .mockResolvedValue(okxSuccess([{ ...OKX_RAW_POSITION_HISTORY_LIST[0], instId: 'BTC-USDT-SWAP', posId: 'pos-tail', uTime: '1000000' }]));

      const closedPnlList = await client.fetchClosedPnl('BTCUSDT', { limit: OKX_POSITIONS_HISTORY_PAGE_LIMIT + 1 });

      expect(mockInstance.get).toHaveBeenCalledTimes(2);
      expect(mockInstance.get.mock.calls[1][1].params.after).toBe(String(2000000 - (OKX_POSITIONS_HISTORY_PAGE_LIMIT - 1)));
      expect(closedPnlList).toHaveLength(OKX_POSITIONS_HISTORY_PAGE_LIMIT + 1);
    });

    it('returns no more rows than the caller asked for', async () => {
      const { client, mockInstance } = createClient();
      await loadInstruments(client, mockInstance);
      mockInstance.get.mockResolvedValue(
        okxSuccess(OKX_RAW_POSITION_HISTORY_LIST.map((raw) => ({ ...raw, instId: 'BTC-USDT-SWAP' }))),
      );

      await expect(client.fetchClosedPnl('BTCUSDT', { limit: 1 })).resolves.toHaveLength(1);
    });

    it('shifts the window bounds by ±1 ms, matching the exclusive after/before semantics', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue(okxSuccess([]));

      await client.fetchClosedPnl('BTCUSDT', { startTime: 1000, endTime: 2000, limit: 50 });

      const [, options] = mockInstance.get.mock.calls[0];

      expect(options.params.after).toBe('2001');
      expect(options.params.before).toBe('999');
      expect(options.params.limit).toBe(String(OKX_POSITIONS_HISTORY_PAGE_LIMIT));
    });
  });

  describe('fetchMarkPrice', () => {
    function answerMarkPrice(mockInstance: Record<string, jest.Mock>, indexList: unknown[]): void {
      mockInstance.get.mockImplementation((url: string) => {
        if (url === '/api/v5/public/mark-price') {
          return Promise.resolve(okxSuccess(OKX_RAW_MARK_PRICE_LIST));
        }

        if (url === '/api/v5/public/funding-rate') {
          return Promise.resolve(okxSuccess([OKX_RAW_FUNDING_RATE]));
        }

        if (url === '/api/v5/market/index-tickers') {
          return Promise.resolve(okxSuccess(indexList));
        }

        return Promise.resolve(okxSuccess([]));
      });
    }

    it('merges mark price with funding rate data', async () => {
      const { client, mockInstance } = createClient();
      answerMarkPrice(mockInstance, []);

      const result = await client.fetchMarkPrice('BTCUSDT');

      expect(result).toHaveLength(1);
      expect(result[0].markPrice).toBe(200);
      expect(result[0].lastFundingRate).toBeCloseTo(0.0000182221218054);
    });

    it('fills the index price from the index endpoint, addressed without the -SWAP suffix', async () => {
      const { client, mockInstance } = createClient();
      answerMarkPrice(mockInstance, OKX_RAW_INDEX_TICKER_LIST);

      const result = await client.fetchMarkPrice('BTCUSDT');

      expect(result[0].indexPrice).toBe(43350);

      const indexCall = mockInstance.get.mock.calls.find((call: any[]) => call[0] === '/api/v5/market/index-tickers');

      expect(indexCall[1].params.instId).toBe('BTC-USDT');
    });

    it('leaves the index price empty rather than faking a zero when the exchange has none', async () => {
      const { client, mockInstance } = createClient();
      answerMarkPrice(mockInstance, []);

      const result = await client.fetchMarkPrice('BTCUSDT');

      expect(result[0].indexPrice).toBeUndefined();
    });

    it('asks for every settle currency at once when no symbol is given', async () => {
      const { client, mockInstance } = createClient();
      answerMarkPrice(mockInstance, OKX_RAW_INDEX_TICKER_LIST);

      await client.fetchMarkPrice();

      const quoteCcyList = mockInstance.get.mock.calls
        .filter((call: any[]) => call[0] === '/api/v5/market/index-tickers')
        .map((call: any[]) => call[1].params.quoteCcy);

      expect(quoteCcyList).toEqual(['USDT', 'USDC']);
    });

    it('still reports the mark price when the index endpoint fails', async () => {
      const { client, mockInstance, logger } = createClient();
      mockInstance.get.mockImplementation((url: string) => {
        if (url === '/api/v5/market/index-tickers') {
          return Promise.reject(buildConnectionFailure('index unreachable'));
        }

        if (url === '/api/v5/public/mark-price') {
          return Promise.resolve(okxSuccess(OKX_RAW_MARK_PRICE_LIST));
        }

        return Promise.resolve(okxSuccess([OKX_RAW_FUNDING_RATE]));
      });

      const result = await client.fetchMarkPrice('BTCUSDT');

      expect(result[0].markPrice).toBe(200);
      expect(result[0].indexPrice).toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Could not read index prices'));
    });
  });

  describe('fetchMarkPrice filtering', () => {
    it('drops an instrument that is not in the loaded map', async () => {
      const { client, mockInstance } = createClient();
      await loadInstruments(client, mockInstance);
      mockInstance.get.mockImplementation((url: string) => {
        if (url === '/api/v5/public/mark-price') {
          return Promise.resolve(okxSuccess([
            ...OKX_RAW_MARK_PRICE_LIST,
            { instType: 'SWAP', instId: 'ETH-USDT-SWAP', markPx: '3000', ts: '1597026383085' },
          ]));
        }

        if (url === '/api/v5/public/funding-rate') {
          return Promise.resolve(okxSuccess([OKX_RAW_FUNDING_RATE]));
        }

        return Promise.resolve(okxSuccess([]));
      });

      const markPriceList = await client.fetchMarkPrice();

      expect(markPriceList).toHaveLength(1);
      expect(markPriceList[0].symbol).toBe('BTCUSDT');
    });
  });

  describe('getOrderRateLimit', () => {
    it('returns the documented OKX order rate limit', async () => {
      const { client } = createClient();

      await expect(client.getOrderRateLimit()).resolves.toEqual({
        writeRequestsPerSecond: OKX_ORDER_RATE_LIMIT_RPS,
        source: 'okx-documented',
      });
    });
  });

  describe('close', () => {
    it('closes the public stream and disconnects the trade stream', async () => {
      const { client } = createClient();

      await client.close();

      const publicStream = (client as any).publicStream;
      const tradeStream = (client as any).tradeStream;

      expect(publicStream.close).toHaveBeenCalled();
      expect(tradeStream.disconnect).toHaveBeenCalled();
    });
  });
});
