import axios from 'axios';
import { OkxSpot } from '../../src/exchanges/OkxSpot';
import { createMockLogger } from '../fixtures/mockLogger';
import { createMockAxiosInstance } from '../fixtures/mockAxios';
import {
  OKX_RAW_INSTRUMENT_SPOT,
  OKX_RAW_TICKER_LIST,
  OKX_RAW_BALANCE,
  OKX_RAW_FEE_RATE,
  OKX_RAW_PUBLIC_TRADE_LIST,
} from '../fixtures/okxRaw';
import { OrderSideEnum, OrderTypeEnum } from '../../src/types/common';
import { ExchangeError } from '../../src/errors/ExchangeError';
import { OKX_ORDER_RATE_LIMIT_RPS } from '../../src/constants/okx';

jest.mock('axios');
jest.mock('../../src/ws/OkxPublicStream');
jest.mock('../../src/ws/OkxTradeStream');
jest.mock('../../src/ws/OkxPrivateStream');

const mockedAxios = axios as jest.Mocked<typeof axios>;

function okxSuccess<T>(data: T[]): { data: { code: string; msg: string; data: T[] } } {
  return { data: { code: '0', msg: '', data } };
}

function createClient(passphrase = 'testPassphrase') {
  const mockInstance = createMockAxiosInstance();
  mockedAxios.create.mockReturnValue(mockInstance as any);

  const client = new OkxSpot({
    config: { apiKey: 'testKey', secret: 'testSecret', passphrase },
    logger: createMockLogger(),
  });

  return { client, mockInstance };
}

describe('OkxSpot', () => {
  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(1700000000000);
  });

  describe('constructor', () => {
    it('throws OKX_PASSPHRASE_REQUIRED when passphrase is missing', () => {
      const mockInstance = createMockAxiosInstance();
      mockedAxios.create.mockReturnValue(mockInstance as any);

      let thrown: unknown;

      try {
        new OkxSpot({ config: { apiKey: 'k', secret: 's' }, logger: createMockLogger() });
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(ExchangeError);
      expect((thrown as ExchangeError).code).toBe('OKX_PASSPHRASE_REQUIRED');
    });
  });

  describe('createOrderWebSocket', () => {
    it('places a market order over REST and states the amount unit explicitly', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue(okxSuccess([OKX_RAW_INSTRUMENT_SPOT]));
      await client.loadTradeSymbols();
      mockInstance.post.mockResolvedValue(okxSuccess([{ ordId: 'spot-1', clOrdId: '', tag: '', ts: '1', sCode: '0', sMsg: '' }]));

      const order = await client.createOrderWebSocket({
        symbol: 'BTCUSDT',
        type: OrderTypeEnum.Market,
        side: OrderSideEnum.Buy,
        amount: 0.5,
      });

      const [path, body] = mockInstance.post.mock.calls[0];

      expect(path).toBe('/api/v5/trade/order');
      expect(body).toMatchObject({ instId: 'BTC-USDT', tdMode: 'cash', side: 'buy', ordType: 'market', sz: '0.5', tgtCcy: 'base_ccy' });
      expect(order.id).toBe('spot-1');
    });
  });

  describe('futures-only methods', () => {
    it('fetchPosition throws "Not supported for spot market"', async () => {
      const { client } = createClient();

      await expect(client.fetchPosition('BTCUSDT')).rejects.toThrow('Not supported for spot market');
    });
  });

  describe('loadTradeSymbols', () => {
    it('fetches and normalizes spot trade symbols', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue(okxSuccess([OKX_RAW_INSTRUMENT_SPOT]));

      const tradeSymbolBySymbol = await client.loadTradeSymbols();

      expect(tradeSymbolBySymbol.get('BTCUSDT')).toBeDefined();
      expect(tradeSymbolBySymbol.get('BTCUSDT')!.baseAsset).toBe('BTC');
    });

    it('resolves every tradeSymbols key back to its original instId through symbolMap', async () => {
      const { client, mockInstance } = createClient();
      const instrumentInstIdList = ['BTC-USDT', 'RENDER-USDT'];
      mockInstance.get.mockResolvedValue(
        okxSuccess([
          OKX_RAW_INSTRUMENT_SPOT,
          { ...OKX_RAW_INSTRUMENT_SPOT, instId: 'RENDER-USDT', baseCcy: 'RNDR', quoteCcy: 'USDT' },
        ]),
      );

      const tradeSymbolBySymbol = await client.loadTradeSymbols();

      expect(tradeSymbolBySymbol.size).toBe(instrumentInstIdList.length);

      for (const symbol of tradeSymbolBySymbol.keys()) {
        const instId = (client as any).symbolMap.resolveInstId(symbol);

        expect(instrumentInstIdList).toContain(instId);
      }
    });
  });

  describe('fetchTrades', () => {
    it('resolves the spot contract value as an empty string, even before loadTradeSymbols', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue(okxSuccess(OKX_RAW_PUBLIC_TRADE_LIST));

      await expect(client.fetchTrades('BTCUSDT')).resolves.toHaveLength(OKX_RAW_PUBLIC_TRADE_LIST.length);
    });
  });

  describe('fetchTickers', () => {
    it('fetches and normalizes spot tickers', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue(okxSuccess(OKX_RAW_TICKER_LIST));

      const tickerBySymbol = await client.fetchTickers();

      expect(tickerBySymbol.size).toBeGreaterThan(0);
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
  });

  describe('fetchFeeRate', () => {
    it('throws FEE_RATE_SYMBOL_REQUIRED without a symbol', async () => {
      const { client } = createClient();

      await expect(client.fetchFeeRate()).rejects.toMatchObject({ code: 'FEE_RATE_SYMBOL_REQUIRED' });
    });

    it('requests trade-fee with instId (not instFamily) for a spot symbol', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue(okxSuccess([OKX_RAW_FEE_RATE]));

      await client.fetchFeeRate('BTCUSDT');

      const [, options] = mockInstance.get.mock.calls[0];

      expect(options.params.instId).toBe('BTC-USDT');
      expect(options.params.instFamily).toBeUndefined();
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
