import axios from 'axios';
import { OkxSpot } from '../../src/exchanges/OkxSpot';
import { createMockLogger } from '../fixtures/mockLogger';
import { createMockAxiosInstance } from '../fixtures/mockAxios';
import {
  OKX_RAW_ALGO_ORDER_SPOT_MARKET_QUOTE,
  OKX_RAW_INSTRUMENT_SPOT,
  OKX_RAW_ORDER_LIVE_POST_ONLY,
} from '../fixtures/okxRaw';
import {
  MarketUnitEnum,
  OrderSideEnum,
  OrderTypeEnum,
  PositionSideEnum,
  TriggerByEnum,
} from '../../src/types/common';
import type { CreateOrderWebSocketArgs } from '../../src/types/exchange';

jest.mock('axios');
jest.mock('../../src/ws/OkxPublicStream');
jest.mock('../../src/ws/OkxTradeStream');
jest.mock('../../src/ws/OkxPrivateStream');

const mockedAxios = axios as jest.Mocked<typeof axios>;

function okxSuccess<T>(dataList: T[]): { data: { code: string; msg: string; data: T[] } } {
  return { data: { code: '0', msg: '', data: dataList } };
}

async function createLoadedClient() {
  const mockInstance = createMockAxiosInstance();
  mockedAxios.create.mockReturnValue(mockInstance as any);
  const logger = createMockLogger();

  const client = new OkxSpot({
    config: { apiKey: 'testKey', secret: 'testSecret', passphrase: 'testPassphrase' },
    logger,
  });

  mockInstance.get.mockResolvedValueOnce(okxSuccess([OKX_RAW_INSTRUMENT_SPOT]));
  await client.loadTradeSymbols();

  mockInstance.get.mockReset();
  mockInstance.post.mockReset();

  return { client, mockInstance, logger };
}

function buildOrderParams(client: OkxSpot, args: Partial<CreateOrderWebSocketArgs>): Promise<Record<string, unknown>> {
  const fullArgs = { symbol: 'BTCUSDT', type: OrderTypeEnum.Limit, side: OrderSideEnum.Buy, amount: 1, ...args };

  return (client as any).buildOkxOrderParams(fullArgs);
}

function buildAlgoParams(client: OkxSpot, args: Partial<CreateOrderWebSocketArgs>): Promise<Record<string, unknown>> {
  const fullArgs = { symbol: 'BTCUSDT', type: OrderTypeEnum.StopMarket, side: OrderSideEnum.Sell, amount: 1, ...args };

  return (client as any).buildOkxAlgoOrderParams(fullArgs);
}

describe('OkxSpot orders', () => {
  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(1700000000000);
  });

  describe('buildOkxOrderParams', () => {
    it('trades spot in the cash mode and never speaks of positions', async () => {
      const { client } = await createLoadedClient();

      const params = await buildOrderParams(client, {
        price: 50000,
        positionSide: PositionSideEnum.Long,
        reduceOnly: true,
      });

      expect(params.tdMode).toBe('cash');
      expect(params.posSide).toBeUndefined();
      expect(params.reduceOnly).toBeUndefined();
    });

    it('states the unit explicitly on a market order sized in coins', async () => {
      const { client } = await createLoadedClient();

      const params = await buildOrderParams(client, { type: OrderTypeEnum.Market, amount: 0.5 });

      expect(params.tgtCcy).toBe('base_ccy');
      expect(params.sz).toBe('0.5');
    });

    it('sends the quote amount with the quote unit', async () => {
      const { client } = await createLoadedClient();

      const params = await buildOrderParams(client, { type: OrderTypeEnum.Market, amount: 0, quoteOrderQty: 100 });

      expect(params.tgtCcy).toBe('quote_ccy');
      expect(params.sz).toBe('100');
    });

    it('honours an explicitly requested quote unit', async () => {
      const { client } = await createLoadedClient();

      const params = await buildOrderParams(client, {
        type: OrderTypeEnum.Market,
        amount: 100,
        marketUnit: MarketUnitEnum.QuoteCoin,
      });

      expect(params.tgtCcy).toBe('quote_ccy');
      expect(params.sz).toBe('100');
    });

    it('refuses an amount in quote currency on a limit order', async () => {
      const { client } = await createLoadedClient();

      await expect(buildOrderParams(client, { type: OrderTypeEnum.Limit, price: 100, quoteOrderQty: 100 }))
        .rejects.toMatchObject({ code: 'QUOTE_AMOUNT_MARKET_ONLY' });
    });

    it('leaves a limit order without a unit field', async () => {
      const { client } = await createLoadedClient();

      const params = await buildOrderParams(client, { type: OrderTypeEnum.Limit, price: 50000 });

      expect(params.tgtCcy).toBeUndefined();
    });
  });

  describe('buildOkxAlgoOrderParams', () => {
    it('triggers on the last price only and warns about any other request', async () => {
      const { client, logger } = await createLoadedClient();

      const params = await buildAlgoParams(client, { stopPrice: 60000, triggerBy: TriggerByEnum.MarkPrice });

      expect(params.slTriggerPxType).toBe('last');
      expect(logger.warn).toHaveBeenCalled();
    });

    it('has no trailing stop at all', async () => {
      const { client } = await createLoadedClient();

      await expect(buildAlgoParams(client, { type: OrderTypeEnum.TrailingStop, callbackRate: 2 }))
        .rejects.toMatchObject({ code: 'TRAILING_STOP_UNSUPPORTED' });
    });

    it('sizes a spot conditional order in the base coin', async () => {
      const { client } = await createLoadedClient();

      const params = await buildAlgoParams(client, { stopPrice: 60000, amount: 0.25 });

      expect(params.sz).toBe('0.25');
      expect(params.tdMode).toBe('cash');
    });

    it('states the unit explicitly on a market conditional order sized in coins, on both sides', async () => {
      const { client } = await createLoadedClient();

      const buyParams = await buildAlgoParams(client, { side: OrderSideEnum.Buy, stopPrice: 70000, amount: 0.25 });
      const sellParams = await buildAlgoParams(client, { side: OrderSideEnum.Sell, stopPrice: 60000, amount: 0.25 });

      expect(buyParams.slOrdPx).toBe('-1');
      expect(buyParams.sz).toBe('0.25');
      expect(buyParams.tgtCcy).toBe('base_ccy');
      expect(sellParams.tgtCcy).toBe('base_ccy');
    });

    it('leaves a limit conditional order without a unit field', async () => {
      const { client } = await createLoadedClient();

      const params = await buildAlgoParams(client, { type: OrderTypeEnum.StopLimit, stopPrice: 60000, price: 59900, amount: 0.25 });

      expect(params.slOrdPx).toBe('59900');
      expect(params.sz).toBe('0.25');
      expect(params.tgtCcy).toBeUndefined();
    });

    it('sends a conditional amount in quote currency with the quote unit', async () => {
      const { client } = await createLoadedClient();

      const params = await buildAlgoParams(client, { side: OrderSideEnum.Buy, stopPrice: 70000, amount: 0, quoteOrderQty: 100 });

      expect(params.sz).toBe('100');
      expect(params.tgtCcy).toBe('quote_ccy');
    });

    it('honours an explicitly requested quote unit on a conditional order', async () => {
      const { client } = await createLoadedClient();

      const params = await buildAlgoParams(client, {
        side: OrderSideEnum.Buy,
        stopPrice: 70000,
        amount: 100,
        marketUnit: MarketUnitEnum.QuoteCoin,
      });

      expect(params.sz).toBe('100');
      expect(params.tgtCcy).toBe('quote_ccy');
    });

    it('refuses a conditional amount in quote currency when the execution is a limit one', async () => {
      const { client } = await createLoadedClient();

      await expect(buildAlgoParams(client, {
        type: OrderTypeEnum.StopLimit,
        stopPrice: 60000,
        price: 59900,
        quoteOrderQty: 100,
      })).rejects.toMatchObject({ code: 'QUOTE_AMOUNT_MARKET_ONLY' });
    });
  });

  describe('numbers on the wire', () => {
    it('sends a tiny price in decimal notation, never as 1e-7', async () => {
      const { client } = await createLoadedClient();
      const tinyInstrument = { ...OKX_RAW_INSTRUMENT_SPOT, instId: 'TINY-USDT', tickSz: '0.0000001', lotSz: '0.0000001', minSz: '0.0000001' };
      (client as any).tradeSymbols.set('TINYUSDT', {
        symbol: 'TINYUSDT',
        filter: { tickSize: '0.0000001', stepSize: '0.0000001', minQty: '0.0000001', maxQty: '1000', minNotional: '0' },
        info: tinyInstrument,
      });
      (client as any).symbolMap.register({ symbol: 'TINYUSDT', instId: 'TINY-USDT', baseAsset: 'TINY', quoteAsset: 'USDT', isSwap: false });

      const params = await buildOrderParams(client, { symbol: 'TINYUSDT', price: 0.0000001, amount: 0.0000002 });

      expect(params.px).toBe('0.0000001');
      expect(params.sz).toBe('0.0000002');
      expect(JSON.stringify(params)).not.toContain('e-');
    });
  });

  describe('fetchOpenConditionalOrders', () => {
    it('returns everything the algo service reports: spot has no settle currency', async () => {
      const { client, mockInstance } = await createLoadedClient();
      mockInstance.get.mockImplementation((_path: string, options: any) => {
        if (options.params.ordType === 'conditional,oco') {
          return Promise.resolve(okxSuccess([OKX_RAW_ALGO_ORDER_SPOT_MARKET_QUOTE]));
        }

        return Promise.resolve(okxSuccess([]));
      });

      const orderList = await client.fetchOpenConditionalOrders('USDT');

      expect(orderList).toHaveLength(1);
      expect(orderList[0].isConditional).toBe(true);
    });

    it('never asks spot for a chase order, which only contracts have', async () => {
      const { client, mockInstance } = await createLoadedClient();
      mockInstance.get.mockResolvedValue(okxSuccess([]));

      await client.fetchOpenConditionalOrders('USDT');

      const askedOrdTypeList = mockInstance.get.mock.calls.map((call: any[]) => call[1].params.ordType);

      expect(askedOrdTypeList).toEqual(['conditional,oco', 'move_order_stop', 'trigger', 'iceberg', 'twap', 'smart_iceberg']);
    });
  });

  describe('user data stream', () => {
    it('subscribes to orders and account but not to positions', async () => {
      const { client } = await createLoadedClient();
      const handler = { onOrderUpdate: jest.fn(), onPositionUpdate: jest.fn() };

      await client.connectUserDataStream(handler);

      const MockedPrivateStream = jest.requireMock('../../src/ws/OkxPrivateStream').OkxPrivateStream as jest.Mock;
      const [privateArgs] = MockedPrivateStream.mock.calls.slice(-2).map((call: unknown[]) => call[0] as any);

      expect(privateArgs.subscriptionArgList).toEqual([
        { channel: 'orders', instType: 'SPOT' },
        { channel: 'account' },
      ]);
    });

    it('reports a spot order event with the coin amount taken from the actual fill', async () => {
      const { client } = await createLoadedClient();
      const handler = { onOrderUpdate: jest.fn(), onPositionUpdate: jest.fn() };
      await client.connectUserDataStream(handler);

      (client as any).handlePrivateMessage(
        { arg: { channel: 'orders', instType: 'SPOT' }, data: [{ ...OKX_RAW_ORDER_LIVE_POST_ONLY, ordId: 'spot-1' }] },
        handler,
      );

      expect(handler.onOrderUpdate).toHaveBeenCalledWith(expect.objectContaining({ orderId: 'spot-1', amount: 0.001 }));
    });
  });

  describe('modifyOrder', () => {
    it('sends the new size in the base coin', async () => {
      const { client, mockInstance } = await createLoadedClient();
      (client as any).conditionalOrderRegistry.record('BTCUSDT', 'spot-2', 'plain');
      mockInstance.post.mockResolvedValue(okxSuccess([{ ordId: 'spot-2', clOrdId: '', tag: '', ts: '1', sCode: '0', sMsg: '' }]));
      mockInstance.get.mockResolvedValue(okxSuccess([{ ...OKX_RAW_ORDER_LIVE_POST_ONLY, ordId: 'spot-2' }]));

      await client.modifyOrder({ symbol: 'BTCUSDT', orderId: 'spot-2', amount: 0.25 });

      const [path, body] = mockInstance.post.mock.calls[0];

      expect(path).toBe('/api/v5/trade/amend-order');
      expect(body.newSz).toBe('0.25');
    });
  });
});
