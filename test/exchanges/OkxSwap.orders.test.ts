import axios from 'axios';
import { OkxSwap } from '../../src/exchanges/OkxSwap';
import { createMockLogger } from '../fixtures/mockLogger';
import { createMockAxiosInstance } from '../fixtures/mockAxios';
import {
  OKX_RAW_ALGO_ORDER_EFFECTIVE,
  OKX_RAW_ALGO_ORDER_OCO,
  OKX_RAW_ALGO_ORDER_OCO_TAKE_PROFIT_FIRED,
  OKX_RAW_ALGO_ORDER_STOP_MARKET,
  OKX_RAW_ALGO_ORDER_TAKE_PROFIT_LIMIT,
  OKX_RAW_ALGO_ORDER_TRAILING,
  OKX_RAW_ALGO_ORDER_TRIGGER,
  OKX_RAW_BALANCE,
  OKX_RAW_INSTRUMENT_SWAP,
  OKX_RAW_ORDER_FILLED,
  OKX_RAW_ORDER_LIVE_POST_ONLY,
  OKX_RAW_POSITION_NET_LONG,
} from '../fixtures/okxRaw';
import {
  MarginModeEnum,
  MarketUnitEnum,
  OrderSideEnum,
  OrderTypeEnum,
  PositionSideEnum,
  TimeInForceEnum,
  TriggerByEnum,
  WorkingTypeEnum,
} from '../../src/types/common';
import type { CreateOrderWebSocketArgs } from '../../src/types/exchange';
import { ExchangeError } from '../../src/errors/ExchangeError';
import { OKX_ALGO_CANCEL_BATCH_CHUNK_SIZE, OKX_ORDER_BATCH_CHUNK_SIZE, OKX_ORDER_PAGE_LIMIT } from '../../src/constants/okx';

jest.mock('axios');
jest.mock('../../src/ws/OkxPublicStream');
jest.mock('../../src/ws/OkxTradeStream');
jest.mock('../../src/ws/OkxPrivateStream');

const mockedAxios = axios as jest.Mocked<typeof axios>;

const SWAP_INSTRUMENT_LIST = [
  OKX_RAW_INSTRUMENT_SWAP,
  { ...OKX_RAW_INSTRUMENT_SWAP, instId: 'ETH-USDT-SWAP', uly: 'ETH-USDT', instFamily: 'ETH-USDT', ctVal: '0.1', lotSz: '1', ctValCcy: 'ETH' },
];

const SWAP_ORDER_RAW = { ...OKX_RAW_ORDER_LIVE_POST_ONLY, instId: 'BTC-USDT-SWAP', instType: 'SWAP', ordId: 'plain-1', sz: '3', tgtCcy: '' };
const SWAP_ORDER_FILLED_RAW = { ...OKX_RAW_ORDER_FILLED, instId: 'BTC-USDT-SWAP', instType: 'SWAP', ordId: 'triggered-1', sz: '10', accFillSz: '10', tgtCcy: '' };

function okxSuccess<T>(dataList: T[]): { data: { code: string; msg: string; data: T[] } } {
  return { data: { code: '0', msg: '', data: dataList } };
}

function okxBatch<T>(code: string, dataList: T[]): { data: { code: string; msg: string; data: T[] } } {
  return { data: { code, msg: '', data: dataList } };
}

function okxOrderResult(ordId: string, sCode = '0', sMsg = ''): Record<string, string> {
  return { ordId, clOrdId: '', tag: '', ts: '1', sCode, sMsg };
}

async function createLoadedClient(posMode = 'net_mode') {
  const mockInstance = createMockAxiosInstance();
  mockedAxios.create.mockReturnValue(mockInstance as any);
  const logger = createMockLogger();

  const client = new OkxSwap({
    config: { apiKey: 'testKey', secret: 'testSecret', passphrase: 'testPassphrase' },
    logger,
  });

  mockInstance.get.mockResolvedValueOnce(okxSuccess(SWAP_INSTRUMENT_LIST));
  await client.loadTradeSymbols();

  mockInstance.get.mockResolvedValueOnce(okxSuccess([{ uid: '1', acctLv: '2', posMode }]));
  await client.fetchPositionMode();

  mockInstance.get.mockResolvedValueOnce(okxSuccess([]));
  await (client as any).ensureMarginMode('BTCUSDT');

  mockInstance.get.mockReset();
  mockInstance.post.mockReset();

  return { client, mockInstance, logger };
}

function enableOrderStream(client: OkxSwap): Record<string, jest.Mock> {
  const tradeStream = (client as any).tradeStream as Record<string, jest.Mock>;
  tradeStream.isConnected.mockReturnValue(true);
  tradeStream.isOrderChannelUsable.mockReturnValue(true);

  return tradeStream;
}

function buildOrderParams(client: OkxSwap, args: Partial<CreateOrderWebSocketArgs>): Promise<Record<string, unknown>> {
  const fullArgs = { symbol: 'BTCUSDT', type: OrderTypeEnum.Limit, side: OrderSideEnum.Buy, amount: 1, ...args };

  return (client as any).buildOkxOrderParams(fullArgs);
}

function buildAlgoParams(client: OkxSwap, args: Partial<CreateOrderWebSocketArgs>): Promise<Record<string, unknown>> {
  const fullArgs = { symbol: 'BTCUSDT', type: OrderTypeEnum.StopMarket, side: OrderSideEnum.Sell, amount: 1, ...args };

  return (client as any).buildOkxAlgoOrderParams(fullArgs);
}

/** Отказ связи, который HTTP-слой НЕ повторяет: ответ есть, но код не из повторяемых. */
function buildConnectionFailure(message: string): Error & { response: { status: number; data: unknown } } {
  return Object.assign(new Error(message), { response: { status: 400, data: {} } });
}

describe('OkxSwap orders', () => {
  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(1700000000000);
  });

  describe('buildOkxOrderParams', () => {
    it('maps a GTC limit order to ordType limit with a price', async () => {
      const { client } = await createLoadedClient();

      const params = await buildOrderParams(client, { type: OrderTypeEnum.Limit, price: 50000, amount: 0.05 });

      expect(params.instId).toBe('BTC-USDT-SWAP');
      expect(params.ordType).toBe('limit');
      expect(params.side).toBe('buy');
      expect(params.px).toBe('50000');
      expect(params.tdMode).toBe('cross');
    });

    it('maps PostOnly / Ioc / Fok to their own ordType values', async () => {
      const { client } = await createLoadedClient();

      await expect(buildOrderParams(client, { price: 1, timeInForce: TimeInForceEnum.PostOnly })).resolves.toMatchObject({ ordType: 'post_only' });
      await expect(buildOrderParams(client, { price: 1, timeInForce: TimeInForceEnum.Ioc })).resolves.toMatchObject({ ordType: 'ioc' });
      await expect(buildOrderParams(client, { price: 1, timeInForce: TimeInForceEnum.Fok })).resolves.toMatchObject({ ordType: 'fok' });
    });

    it('sends a market order without a price even when one is supplied', async () => {
      const { client } = await createLoadedClient();

      const params = await buildOrderParams(client, { type: OrderTypeEnum.Market, price: 50000 });

      expect(params.ordType).toBe('market');
      expect(params.px).toBeUndefined();
    });

    it('converts coins to contracts using the instrument contract value and lot size', async () => {
      const { client } = await createLoadedClient();

      const params = await buildOrderParams(client, { type: OrderTypeEnum.Market, amount: 0.035 });

      expect(params.sz).toBe('3');
    });

    it('refuses an amount below one lot instead of sending a zero-size order', async () => {
      const { client } = await createLoadedClient();

      await expect(buildOrderParams(client, { type: OrderTypeEnum.Market, amount: 0.001 }))
        .rejects.toMatchObject({ code: 'AMOUNT_BELOW_LOT' });
    });

    it('takes tdMode from the margin mode remembered by setMarginMode', async () => {
      const { client, mockInstance } = await createLoadedClient();
      mockInstance.get.mockResolvedValue(okxSuccess([]));
      await client.setMarginMode(MarginModeEnum.Isolated, 'BTCUSDT');

      const params = await buildOrderParams(client, { price: 1 });

      expect(params.tdMode).toBe('isolated');
    });

    it('sends reduceOnly and no posSide in net mode', async () => {
      const { client } = await createLoadedClient('net_mode');

      const params = await buildOrderParams(client, { type: OrderTypeEnum.Market, reduceOnly: true });

      expect(params.reduceOnly).toBe(true);
      expect(params.posSide).toBeUndefined();
    });

    it('sends posSide and no reduceOnly in long/short mode', async () => {
      const { client } = await createLoadedClient('long_short_mode');

      const params = await buildOrderParams(client, {
        type: OrderTypeEnum.Market,
        reduceOnly: true,
        positionSide: PositionSideEnum.Short,
      });

      expect(params.posSide).toBe('short');
      expect(params.reduceOnly).toBeUndefined();
    });

    it('refuses a long/short mode order without a position side', async () => {
      const { client } = await createLoadedClient('long_short_mode');

      await expect(buildOrderParams(client, { type: OrderTypeEnum.Market }))
        .rejects.toMatchObject({ code: 'OKX_POSITION_SIDE_REQUIRED' });
    });

    it('refuses a conditional type: it belongs to the algo service', async () => {
      const { client } = await createLoadedClient();

      await expect(buildOrderParams(client, { type: OrderTypeEnum.StopMarket, stopPrice: 100 }))
        .rejects.toMatchObject({ code: 'CONDITIONAL_ORDER_WRONG_ENDPOINT' });
    });

    it('refuses a trailing stop: it belongs to the algo service', async () => {
      const { client } = await createLoadedClient();

      await expect(buildOrderParams(client, { type: OrderTypeEnum.TrailingStop, callbackRate: 2 }))
        .rejects.toMatchObject({ code: 'CONDITIONAL_ORDER_WRONG_ENDPOINT' });
    });

    it('refuses a client order id with a dash before any request leaves', async () => {
      const { client, mockInstance } = await createLoadedClient();

      await expect(
        client.createOrderWebSocket({
          symbol: 'BTCUSDT',
          type: OrderTypeEnum.Market,
          side: OrderSideEnum.Buy,
          amount: 0.05,
          clientOrderId: 'my-order-1',
        }),
      ).rejects.toMatchObject({ code: 'OKX_CLIENT_ORDER_ID_INVALID' });

      expect(mockInstance.post).not.toHaveBeenCalled();
    });

    it('passes a valid client order id as clOrdId', async () => {
      const { client } = await createLoadedClient();

      const params = await buildOrderParams(client, { type: OrderTypeEnum.Market, clientOrderId: 'ladder01' });

      expect(params.clOrdId).toBe('ladder01');
    });
  });

  describe('buildOkxAlgoOrderParams', () => {
    it('builds a market stop with slTriggerPx and slOrdPx -1', async () => {
      const { client } = await createLoadedClient();

      const params = await buildAlgoParams(client, { type: OrderTypeEnum.StopMarket, stopPrice: 60000, amount: 0.05 });

      expect(params.ordType).toBe('conditional');
      expect(params.slTriggerPx).toBe('60000');
      expect(params.slOrdPx).toBe('-1');
      expect(params.slTriggerPxType).toBe('last');
      expect(params.sz).toBe('5');
    });

    it('builds a limit stop with slOrdPx taken from the price', async () => {
      const { client } = await createLoadedClient();

      const params = await buildAlgoParams(client, { type: OrderTypeEnum.StopLimit, stopPrice: 60000, price: 59900 });

      expect(params.slTriggerPx).toBe('60000');
      expect(params.slOrdPx).toBe('59900');
    });

    it('builds a take profit on the tp side', async () => {
      const { client } = await createLoadedClient();

      const params = await buildAlgoParams(client, { type: OrderTypeEnum.TakeProfitMarket, stopPrice: 70000 });

      expect(params.tpTriggerPx).toBe('70000');
      expect(params.tpOrdPx).toBe('-1');
      expect(params.slTriggerPx).toBeUndefined();
    });

    it('refuses a conditional order without a stop price', async () => {
      const { client } = await createLoadedClient();

      await expect(buildAlgoParams(client, { type: OrderTypeEnum.StopMarket }))
        .rejects.toMatchObject({ code: 'STOP_PRICE_REQUIRED' });
    });

    it('takes the trigger price type from triggerBy', async () => {
      const { client } = await createLoadedClient();

      const params = await buildAlgoParams(client, { stopPrice: 60000, triggerBy: TriggerByEnum.MarkPrice });

      expect(params.slTriggerPxType).toBe('mark');
    });

    it('takes the trigger price type from workingType when triggerBy is absent', async () => {
      const { client } = await createLoadedClient();

      const params = await buildAlgoParams(client, { stopPrice: 60000, workingType: WorkingTypeEnum.MarkPrice });

      expect(params.slTriggerPxType).toBe('mark');
    });

    it('closes the whole position with closeFraction and reduceOnly in net mode', async () => {
      const { client } = await createLoadedClient('net_mode');

      const params = await buildAlgoParams(client, { stopPrice: 60000, closePosition: true });

      expect(params.closeFraction).toBe('1');
      expect(params.sz).toBeUndefined();
      expect(params.reduceOnly).toBe(true);
    });

    it('refuses to close the whole position with a limit conditional order', async () => {
      const { client } = await createLoadedClient();

      await expect(buildAlgoParams(client, { type: OrderTypeEnum.StopLimit, stopPrice: 60000, price: 59900, closePosition: true }))
        .rejects.toMatchObject({ code: 'OKX_CLOSE_POSITION_MARKET_ONLY' });
    });

    it('refuses to close the whole position in the long/short mode instead of sending a request the exchange rejects', async () => {
      const { client, mockInstance } = await createLoadedClient('long_short_mode');

      await expect(buildAlgoParams(client, {
        stopPrice: 60000,
        closePosition: true,
        positionSide: PositionSideEnum.Long,
      })).rejects.toMatchObject({ code: 'OKX_CLOSE_POSITION_ONE_WAY_ONLY' });
      expect(mockInstance.post).not.toHaveBeenCalled();
    });

    it('states the trailing offset as a ratio, converting from the library percent', async () => {
      const { client } = await createLoadedClient();

      const params = await buildAlgoParams(client, {
        type: OrderTypeEnum.TrailingStop,
        callbackRate: 2,
        activationPrice: 63000,
        amount: 0.05,
      });

      expect(params.ordType).toBe('move_order_stop');
      expect(params.callbackRatio).toBe('0.02');
      expect(params.activePx).toBe('63000');
      expect(params.sz).toBe('5');
    });

    it('refuses a trailing stop without a callback rate', async () => {
      const { client } = await createLoadedClient();

      await expect(buildAlgoParams(client, { type: OrderTypeEnum.TrailingStop }))
        .rejects.toMatchObject({ code: 'TRAILING_STOP_CALLBACK_REQUIRED' });
    });
  });

  /**
   * Единица объёма и сумма в котируемой валюте — спотовые понятия. У бессрочного контракта поле
   * объёма означает ЧИСЛО КОНТРАКТОВ, поэтому сумма в долларах, попавшая туда, была бы прочитана
   * биржей как количество контрактов: сто долларов превратились бы в сто контрактов.
   */
  describe('perpetual sizing never borrows the spot units', () => {
    it('leaves the size unit off a market order', async () => {
      const { client } = await createLoadedClient();

      const params = await buildOrderParams(client, { type: OrderTypeEnum.Market, amount: 0.05 });

      expect(params.sz).toBe('5');
      expect(params.tgtCcy).toBeUndefined();
    });

    it('leaves the size unit off a market conditional order', async () => {
      const { client } = await createLoadedClient();

      const params = await buildAlgoParams(client, { type: OrderTypeEnum.StopMarket, stopPrice: 60000, amount: 0.05 });

      expect(params.sz).toBe('5');
      expect(params.tgtCcy).toBeUndefined();
    });

    it('sizes a market order in contracts even when a quote amount is passed', async () => {
      const { client } = await createLoadedClient();

      const params = await buildOrderParams(client, { type: OrderTypeEnum.Market, amount: 0.05, quoteOrderQty: 100 });

      expect(params.sz).toBe('5');
      expect(params.tgtCcy).toBeUndefined();
    });

    it('sizes a market order in contracts even when the quote unit is asked for', async () => {
      const { client } = await createLoadedClient();

      const params = await buildOrderParams(client, {
        type: OrderTypeEnum.Market,
        amount: 0.05,
        marketUnit: MarketUnitEnum.QuoteCoin,
      });

      expect(params.sz).toBe('5');
      expect(params.tgtCcy).toBeUndefined();
    });

    it('sizes a market conditional order in contracts even when a quote amount is passed', async () => {
      const { client } = await createLoadedClient();

      const params = await buildAlgoParams(client, {
        type: OrderTypeEnum.StopMarket,
        stopPrice: 60000,
        amount: 0.05,
        quoteOrderQty: 100,
      });

      expect(params.sz).toBe('5');
      expect(params.tgtCcy).toBeUndefined();
    });

    it('sizes a market conditional order in contracts even when the quote unit is asked for', async () => {
      const { client } = await createLoadedClient();

      const params = await buildAlgoParams(client, {
        type: OrderTypeEnum.StopMarket,
        stopPrice: 60000,
        amount: 0.05,
        marketUnit: MarketUnitEnum.QuoteCoin,
      });

      expect(params.sz).toBe('5');
      expect(params.tgtCcy).toBeUndefined();
    });

    it('keeps a quote amount out of a limit order too', async () => {
      const { client } = await createLoadedClient();

      const params = await buildOrderParams(client, {
        type: OrderTypeEnum.Limit,
        price: 50000,
        amount: 0.05,
        quoteOrderQty: 100,
      });

      expect(params.sz).toBe('5');
      expect(params.tgtCcy).toBeUndefined();
    });
  });

  /**
   * Проверка размера снаружи и то, что реально уходит на биржу, обязаны быть ОДНИМ числом:
   * иначе вызывающий проверяет одну заявку, а ставит другую.
   */
  describe('the size check outside and the size on the wire are one number', () => {
    it('rounds an amount up to whole contracts only when asked to', async () => {
      const { client } = await createLoadedClient();

      expect(client.amountToPrecision('BTCUSDT', 0.0157, 'up')).toBeCloseTo(0.02);
      expect(client.amountToPrecision('BTCUSDT', 0.02, 'up')).toBeCloseTo(0.02);
      expect(client.amountToPrecision('BTCUSDT', 0.0157, 'down')).toBeCloseTo(0.01);
      expect(client.amountToPrecision('BTCUSDT', 0.0157, 'nearest')).toBeCloseTo(0.01);
    });

    it('rounds an amount down to whole contracts, the way the wire does', async () => {
      const { client } = await createLoadedClient();

      expect(client.amountToPrecision('BTCUSDT', 0.0157)).toBeCloseTo(0.01);
      expect(client.amountToPrecision('BTCUSDT', 0.019)).toBeCloseTo(0.01);
      expect(client.amountToPrecision('BTCUSDT', 0.029)).toBeCloseTo(0.02);
    });

    it('agrees with the size that actually goes on the wire', async () => {
      const { client } = await createLoadedClient();

      for (const amount of [0.0157, 0.019, 0.029, 0.05, 0.1234]) {
        const params = await buildOrderParams(client, { type: OrderTypeEnum.Market, amount });
        const contractCount = parseFloat(String(params.sz));

        expect(client.amountToPrecision('BTCUSDT', amount)).toBeCloseTo(contractCount * 0.01);
      }
    });

    it('reports an amount below one contract as zero instead of as the minimum', async () => {
      const { client } = await createLoadedClient();

      expect(client.amountToPrecision('BTCUSDT', 0.0099)).toBe(0);
      expect(client.getMinOrderQty('BTCUSDT')).toBeCloseTo(0.01);
    });

    it('gives the created order the size that was sent, not the size that was asked for', async () => {
      const { client, mockInstance } = await createLoadedClient();
      mockInstance.post.mockResolvedValue(okxSuccess([okxOrderResult('sized-1')]));

      const order = await client.createOrderWebSocket({
        symbol: 'BTCUSDT',
        type: OrderTypeEnum.Market,
        side: OrderSideEnum.Buy,
        amount: 0.0157,
      });

      const [, body] = mockInstance.post.mock.calls[0];

      expect(body.sz).toBe('1');
      expect(order.amount).toBeCloseTo(0.01);
    });

    it('gives a created conditional order the size that was sent too', async () => {
      const { client, mockInstance } = await createLoadedClient();
      mockInstance.post.mockResolvedValue(okxSuccess([{ algoId: 'sized-2', clOrdId: '', algoClOrdId: '', sCode: '0', sMsg: '' }]));

      const order = await client.createOrderWebSocket({
        symbol: 'BTCUSDT',
        type: OrderTypeEnum.StopMarket,
        side: OrderSideEnum.Sell,
        amount: 0.0157,
        stopPrice: 60000,
      });

      expect(order.amount).toBeCloseTo(0.01);
    });

    it('gives every order of a batch the size that was sent', async () => {
      const { client, mockInstance } = await createLoadedClient();
      mockInstance.post.mockResolvedValue(okxSuccess([okxOrderResult('batch-1'), okxOrderResult('batch-2')]));

      const resultList = await client.createBatchOrders([
        { symbol: 'BTCUSDT', type: OrderTypeEnum.Market, side: OrderSideEnum.Buy, amount: 0.0157 },
        { symbol: 'BTCUSDT', type: OrderTypeEnum.Market, side: OrderSideEnum.Buy, amount: 0.029 },
      ]);

      expect(resultList[0].order?.amount).toBeCloseTo(0.01);
      expect(resultList[1].order?.amount).toBeCloseTo(0.02);
    });
  });

  describe('trailing stop callback rate on the wire', () => {
    it('sends an exact decimal fraction, never a floating-point tail', async () => {
      const { client } = await createLoadedClient();

      for (const [callbackRate, expected] of [[1.1, '0.011'], [1.3, '0.013'], [2.9, '0.029'], [3.7, '0.037'], [12.3, '0.123']] as const) {
        const params = await buildAlgoParams(client, { type: OrderTypeEnum.TrailingStop, amount: 0.05, callbackRate });

        expect(params.callbackRatio).toBe(expected);
      }
    });

    it('puts no long floating-point number on the wire at all', async () => {
      const { client } = await createLoadedClient();
      const params = await buildAlgoParams(client, { type: OrderTypeEnum.TrailingStop, amount: 0.05, callbackRate: 1.1 });

      expect(String(params.callbackRatio)).not.toMatch(/\.\d{6,}/);
    });
  });

  describe('createOrderWebSocket', () => {
    it('places a plain order over the order channel when it is connected and usable', async () => {
      const { client, mockInstance } = await createLoadedClient();
      const tradeStream = enableOrderStream(client);
      tradeStream.createOrder.mockResolvedValue({ id: 'ws-1', clientOrderId: '' });

      const order = await client.createOrderWebSocket({
        symbol: 'BTCUSDT',
        type: OrderTypeEnum.Market,
        side: OrderSideEnum.Buy,
        amount: 0.05,
      });

      expect(order.id).toBe('ws-1');
      expect(tradeStream.createOrder).toHaveBeenCalled();
      expect(mockInstance.post).not.toHaveBeenCalled();
    });

    it('falls back to REST when the order channel is connected but unusable', async () => {
      const { client, mockInstance } = await createLoadedClient();
      const tradeStream = (client as any).tradeStream as Record<string, jest.Mock>;
      tradeStream.isConnected.mockReturnValue(true);
      tradeStream.isOrderChannelUsable.mockReturnValue(false);
      mockInstance.post.mockResolvedValue(okxSuccess([okxOrderResult('rest-1')]));

      const order = await client.createOrderWebSocket({
        symbol: 'BTCUSDT',
        type: OrderTypeEnum.Market,
        side: OrderSideEnum.Buy,
        amount: 0.05,
      });

      expect(order.id).toBe('rest-1');
      expect(tradeStream.createOrder).not.toHaveBeenCalled();

      const [path] = mockInstance.post.mock.calls[0];

      expect(path).toBe('/api/v5/trade/order');
    });

    it('places a plain order over REST when the order channel is not connected', async () => {
      const { client, mockInstance } = await createLoadedClient();
      const tradeStream = (client as any).tradeStream as Record<string, jest.Mock>;
      tradeStream.isConnected.mockReturnValue(false);
      mockInstance.post.mockResolvedValue(okxSuccess([okxOrderResult('rest-2')]));

      const order = await client.createOrderWebSocket({
        symbol: 'BTCUSDT',
        type: OrderTypeEnum.Market,
        side: OrderSideEnum.Buy,
        amount: 0.05,
      });

      expect(order.id).toBe('rest-2');
      expect(tradeStream.createOrder).not.toHaveBeenCalled();
      expect((client as any).conditionalOrderRegistry.lookup('BTCUSDT', 'rest-2')).toBe('plain');
    });

    it('places the order over REST once when the channel refuses to address the instrument', async () => {
      const { client, mockInstance } = await createLoadedClient();
      const tradeStream = enableOrderStream(client);
      tradeStream.createOrder.mockRejectedValue(
        new ExchangeError('OKX order error 50014: Parameter instIdCode can not be empty.', 50014, 'OKX'),
      );
      mockInstance.post.mockResolvedValue(okxSuccess([okxOrderResult('rest-50014')]));

      const order = await client.createOrderWebSocket({
        symbol: 'BTCUSDT',
        type: OrderTypeEnum.Market,
        side: OrderSideEnum.Buy,
        amount: 0.05,
      });

      expect(order.id).toBe('rest-50014');
      expect(tradeStream.createOrder).toHaveBeenCalledTimes(1);
      expect(mockInstance.post).toHaveBeenCalledTimes(1);
      expect(mockInstance.post.mock.calls[0][0]).toBe('/api/v5/trade/order');
    });

    it('places the order over REST once when the channel has no numeric code for the instrument', async () => {
      const { client, mockInstance } = await createLoadedClient();
      const tradeStream = enableOrderStream(client);
      tradeStream.createOrder.mockRejectedValue(
        new ExchangeError('OKX instrument code for symbol BTCUSDT cannot be resolved', 'OKX_SYMBOL_UNRESOLVED', 'OKX'),
      );
      mockInstance.post.mockResolvedValue(okxSuccess([okxOrderResult('rest-unresolved')]));

      const order = await client.createOrderWebSocket({
        symbol: 'BTCUSDT',
        type: OrderTypeEnum.Market,
        side: OrderSideEnum.Buy,
        amount: 0.05,
      });

      expect(order.id).toBe('rest-unresolved');
      expect(mockInstance.post).toHaveBeenCalledTimes(1);
    });

    it('never repeats an order the exchange could have accepted: any other channel refusal goes out as is', async () => {
      const { client, mockInstance } = await createLoadedClient();
      const tradeStream = enableOrderStream(client);
      tradeStream.createOrder.mockRejectedValue(new ExchangeError('OKX order error 51008: insufficient balance', 51008, 'OKX'));

      await expect(client.createOrderWebSocket({
        symbol: 'BTCUSDT',
        type: OrderTypeEnum.Market,
        side: OrderSideEnum.Buy,
        amount: 0.05,
      })).rejects.toMatchObject({ code: 51008 });

      expect(mockInstance.post).not.toHaveBeenCalled();
    });

    it('places a conditional order through the algo endpoint and remembers its origin', async () => {
      const { client, mockInstance } = await createLoadedClient();
      mockInstance.post.mockResolvedValue(okxSuccess([{ algoId: 'algo-1', clOrdId: '', algoClOrdId: 'stopone', sCode: '0', sMsg: '' }]));

      const order = await client.createOrderWebSocket({
        symbol: 'BTCUSDT',
        type: OrderTypeEnum.StopMarket,
        side: OrderSideEnum.Sell,
        amount: 0.05,
        stopPrice: 60000,
        clientOrderId: 'stopone',
      });

      const [path] = mockInstance.post.mock.calls[0];

      expect(path).toBe('/api/v5/trade/order-algo');
      expect(order.id).toBe('algo-1');
      expect(order.clientOrderId).toBe('stopone');
      expect(order.isConditional).toBe(true);
      expect((client as any).conditionalOrderRegistry.lookup('BTCUSDT', 'algo-1')).toBe('conditional');
    });
  });

  describe('getOrder', () => {
    it('asks only the algo service for an order it placed as conditional', async () => {
      const { client, mockInstance } = await createLoadedClient();
      mockInstance.post.mockResolvedValue(okxSuccess([{ algoId: 'algo-1', clOrdId: '', algoClOrdId: '', sCode: '0', sMsg: '' }]));
      await client.createOrderWebSocket({
        symbol: 'BTCUSDT',
        type: OrderTypeEnum.StopMarket,
        side: OrderSideEnum.Sell,
        amount: 0.05,
        stopPrice: 60000,
      });

      mockInstance.get.mockResolvedValue(okxSuccess([{ ...OKX_RAW_ALGO_ORDER_STOP_MARKET, algoId: 'algo-1' }]));
      const order = await client.getOrder('BTCUSDT', 'algo-1');

      expect(mockInstance.get).toHaveBeenCalledTimes(1);

      const [path] = mockInstance.get.mock.calls[0];

      expect(path).toBe('/api/v5/trade/order-algo');
      expect(order.id).toBe('algo-1');
    });

    it('asks both services for an order of unknown origin and remembers the answer', async () => {
      const { client, mockInstance } = await createLoadedClient();
      mockInstance.get.mockImplementation((path: string) => {
        if (path === '/api/v5/trade/order') {
          return Promise.resolve(okxSuccess([]));
        }

        return Promise.resolve(okxSuccess([{ ...OKX_RAW_ALGO_ORDER_STOP_MARKET, algoId: 'algo-2' }]));
      });

      const order = await client.getOrder('BTCUSDT', 'algo-2');

      expect(mockInstance.get).toHaveBeenCalledTimes(2);
      expect(order.isConditional).toBe(true);
      expect((client as any).conditionalOrderRegistry.lookup('BTCUSDT', 'algo-2')).toBe('conditional');
    });

    it('refuses to choose when both services answer for the same id', async () => {
      const { client, mockInstance } = await createLoadedClient();
      mockInstance.get.mockImplementation((path: string) => {
        if (path === '/api/v5/trade/order') {
          return Promise.resolve(okxSuccess([SWAP_ORDER_RAW]));
        }

        return Promise.resolve(okxSuccess([OKX_RAW_ALGO_ORDER_STOP_MARKET]));
      });

      await expect(client.getOrder('BTCUSDT', 'both-1')).rejects.toMatchObject({ code: 'CONDITIONAL_ORDER_ID_AMBIGUOUS' });
    });

    it('reports the order as missing when neither service knows it', async () => {
      const { client, mockInstance } = await createLoadedClient();
      mockInstance.get.mockResolvedValue(okxSuccess([]));

      await expect(client.getOrder('BTCUSDT', 'ghost-1')).rejects.toMatchObject({ code: 51603 });
    });

    it('reports a connection failure as a connection failure, not as a missing order', async () => {
      const { client, mockInstance, logger } = await createLoadedClient();
      mockInstance.get.mockImplementation((path: string) => {
        if (path === '/api/v5/trade/order') {
          return Promise.resolve(okxSuccess([]));
        }

        return Promise.reject(buildConnectionFailure('socket hang up'));
      });

      await expect(client.getOrder('BTCUSDT', 'algo-777')).rejects.toThrow('socket hang up');
      expect(logger.warn).toHaveBeenCalled();
    });

    it('reports a connection failure of the plain service the same way', async () => {
      const { client, mockInstance } = await createLoadedClient();
      mockInstance.get.mockImplementation((path: string) => {
        if (path === '/api/v5/trade/order') {
          return Promise.reject(buildConnectionFailure('ECONNRESET'));
        }

        return Promise.resolve(okxSuccess([]));
      });

      await expect(client.getOrder('BTCUSDT', 'plain-777')).rejects.toThrow('ECONNRESET');
    });

    it('still reports a missing order when the conditional service answers "no such order"', async () => {
      const { client, mockInstance } = await createLoadedClient();
      mockInstance.get.mockImplementation((path: string) => {
        if (path === '/api/v5/trade/order') {
          return Promise.resolve(okxSuccess([]));
        }

        return Promise.resolve({ data: { code: '51603', msg: 'Order does not exist', data: [] } });
      });

      await expect(client.getOrder('BTCUSDT', 'ghost-2')).rejects.toMatchObject({ code: 51603 });
    });

    it('writes the reason of a failed lookup into the log even when the other service answered', async () => {
      const { client, mockInstance, logger } = await createLoadedClient();
      mockInstance.get.mockImplementation((path: string) => {
        if (path === '/api/v5/trade/order') {
          return Promise.resolve(okxSuccess([SWAP_ORDER_RAW]));
        }

        return Promise.reject(buildConnectionFailure('gateway timeout'));
      });

      const order = await client.getOrder('BTCUSDT', SWAP_ORDER_RAW.ordId);

      expect(order.isConditional).toBe(false);
      expect(logger.warn).not.toHaveBeenCalledWith(expect.anything(), expect.stringContaining('gateway timeout'));
    });

    it('merges the triggered order fill into a conditional order that has already fired', async () => {
      const { client, mockInstance } = await createLoadedClient();
      (client as any).conditionalOrderRegistry.record('BTCUSDT', 'algo-3', 'conditional');
      mockInstance.get.mockImplementation((path: string) => {
        if (path === '/api/v5/trade/order-algo') {
          return Promise.resolve(okxSuccess([{ ...OKX_RAW_ALGO_ORDER_EFFECTIVE, algoId: 'algo-3' }]));
        }

        return Promise.resolve(okxSuccess([SWAP_ORDER_FILLED_RAW]));
      });

      const order = await client.getOrder('BTCUSDT', 'algo-3');

      expect(order.filledAmount).toBeCloseTo(0.1);
      expect(order.avgPrice).toBe(51858);
    });
  });

  describe('reading a conditional order checks the instrument it came back on', () => {
    const FOREIGN_ALGO_RAW = { ...OKX_RAW_ALGO_ORDER_STOP_MARKET, algoId: '777', instId: 'BTC-USDT-SWAP', sz: '10' };

    it('reports the order as missing when only the conditional service answers, and about another instrument', async () => {
      const { client, mockInstance } = await createLoadedClient();
      mockInstance.get.mockImplementation((path: string) => {
        if (path === '/api/v5/trade/order') {
          return Promise.resolve(okxSuccess([]));
        }

        return Promise.resolve(okxSuccess([FOREIGN_ALGO_RAW]));
      });

      await expect(client.getOrder('ETHUSDT', '777')).rejects.toMatchObject({ code: 51603 });
      expect((client as any).conditionalOrderRegistry.lookup('ETHUSDT', '777')).toBeNull();
    });

    it('reports the order as missing when the remembered conditional id answers about another instrument', async () => {
      const { client, mockInstance } = await createLoadedClient();
      (client as any).conditionalOrderRegistry.record('ETHUSDT', '777', 'conditional');
      mockInstance.get.mockResolvedValue(okxSuccess([FOREIGN_ALGO_RAW]));

      await expect(client.getOrder('ETHUSDT', '777')).rejects.toMatchObject({ code: 51603 });
    });

    it('returns the plain order instead of refusing to choose when the conditional answer is foreign', async () => {
      const { client, mockInstance } = await createLoadedClient();
      mockInstance.get.mockImplementation((path: string) => {
        if (path === '/api/v5/trade/order') {
          return Promise.resolve(okxSuccess([{ ...SWAP_ORDER_RAW, ordId: '777' }]));
        }

        return Promise.resolve(okxSuccess([{ ...FOREIGN_ALGO_RAW, instId: 'ETH-USDT-SWAP' }]));
      });

      const order = await client.getOrder('BTCUSDT', '777');

      expect(order.isConditional).toBe(false);
      expect(order.symbol).toBe('BTCUSDT');
      expect((client as any).conditionalOrderRegistry.lookup('BTCUSDT', '777')).toBe('plain');
    });

    it('reports the order as missing when the conditional service answers a client id about another instrument', async () => {
      const { client, mockInstance } = await createLoadedClient();
      mockInstance.get.mockImplementation((path: string) => {
        if (path === '/api/v5/trade/order') {
          return Promise.resolve(okxSuccess([]));
        }

        return Promise.resolve(okxSuccess([{ ...FOREIGN_ALGO_RAW, algoClOrdId: 'guard01' }]));
      });

      await expect(client.getOrderByClientOrderId('ETHUSDT', 'guard01')).rejects.toMatchObject({ code: 51603 });
      expect((client as any).conditionalOrderRegistry.lookup('ETHUSDT', '777')).toBeNull();
    });
  });

  describe('getOrderByClientOrderId', () => {
    it('reads a plain order by the client id and remembers its origin', async () => {
      const { client, mockInstance } = await createLoadedClient();
      mockInstance.get.mockResolvedValue(okxSuccess([SWAP_ORDER_RAW]));

      const order = await client.getOrderByClientOrderId('BTCUSDT', 'ladder01');

      const [path, options] = mockInstance.get.mock.calls[0];

      expect(path).toBe('/api/v5/trade/order');
      expect(options.params.clOrdId).toBe('ladder01');
      expect(order.id).toBe('plain-1');
      expect((client as any).conditionalOrderRegistry.lookup('BTCUSDT', 'plain-1')).toBe('plain');
    });

    it('falls back to the algo service when the plain book has nothing under that client id', async () => {
      const { client, mockInstance } = await createLoadedClient();
      mockInstance.get.mockImplementation((path: string) => {
        if (path === '/api/v5/trade/order') {
          return Promise.resolve(okxSuccess([]));
        }

        return Promise.resolve(okxSuccess([{ ...OKX_RAW_ALGO_ORDER_STOP_MARKET, algoId: 'algo-cl' }]));
      });

      const order = await client.getOrderByClientOrderId('BTCUSDT', 'stopone');

      expect(order.id).toBe('algo-cl');
      expect(order.isConditional).toBe(true);
      expect((client as any).conditionalOrderRegistry.lookup('BTCUSDT', 'algo-cl')).toBe('conditional');
    });

    it('falls back to the algo service when the plain book answers 51603 for the client id', async () => {
      const { client, mockInstance } = await createLoadedClient();
      mockInstance.get.mockImplementation((path: string) => {
        if (path === '/api/v5/trade/order') {
          return Promise.resolve({ data: { code: '51603', msg: 'Order does not exist', data: [] } });
        }

        return Promise.resolve(okxSuccess([{ ...OKX_RAW_ALGO_ORDER_STOP_MARKET, algoId: 'algo-cl2' }]));
      });

      const order = await client.getOrderByClientOrderId('BTCUSDT', 'stoptwo');

      expect(order.id).toBe('algo-cl2');
      expect(order.isConditional).toBe(true);
    });

    it('reports the client id as unknown when neither service knows it', async () => {
      const { client, mockInstance } = await createLoadedClient();
      mockInstance.get.mockResolvedValue(okxSuccess([]));

      await expect(client.getOrderByClientOrderId('BTCUSDT', 'ghost')).rejects.toMatchObject({ code: 51603 });
    });
  });

  describe('cancelOrder', () => {
    it('cancels a known conditional order through the algo endpoint only', async () => {
      const { client, mockInstance } = await createLoadedClient();
      (client as any).conditionalOrderRegistry.record('BTCUSDT', 'algo-4', 'conditional');
      mockInstance.post.mockResolvedValue(okxSuccess([{ algoId: 'algo-4', clOrdId: '', algoClOrdId: '', sCode: '0', sMsg: '' }]));
      mockInstance.get.mockResolvedValue(okxSuccess([{ ...OKX_RAW_ALGO_ORDER_STOP_MARKET, algoId: 'algo-4', state: 'canceled' }]));

      const order = await client.cancelOrder('BTCUSDT', 'algo-4');

      const [path, body] = mockInstance.post.mock.calls[0];

      expect(path).toBe('/api/v5/trade/cancel-algos');
      expect(body).toEqual([{ algoId: 'algo-4', instId: 'BTC-USDT-SWAP' }]);
      expect(order.status).toBe('canceled');
    });

    it('falls back to the algo cancel when the plain book answers 51400 for an unknown id', async () => {
      const { client, mockInstance } = await createLoadedClient();
      mockInstance.post.mockImplementation((path: string) => {
        if (path === '/api/v5/trade/cancel-order') {
          return Promise.resolve({ data: { code: '1', msg: '', data: [{ ordId: '', clOrdId: '', tag: '', ts: '1', sCode: '51400', sMsg: 'Order cancellation failed as the order has been filled, cancelled or does not exist' }] } });
        }

        return Promise.resolve(okxSuccess([{ algoId: 'algo-5', clOrdId: '', algoClOrdId: '', sCode: '0', sMsg: '' }]));
      });
      mockInstance.get.mockResolvedValue(okxSuccess([{ ...OKX_RAW_ALGO_ORDER_STOP_MARKET, algoId: 'algo-5', state: 'canceled' }]));

      const order = await client.cancelOrder('BTCUSDT', 'algo-5');

      expect(order.id).toBe('algo-5');
      expect(mockInstance.post.mock.calls[1][0]).toBe('/api/v5/trade/cancel-algos');
    });

    it('rethrows the plain-book error when the algo fallback fails too', async () => {
      const { client, mockInstance } = await createLoadedClient();
      mockInstance.post.mockImplementation((path: string) => {
        if (path === '/api/v5/trade/cancel-order') {
          return Promise.resolve({ data: { code: '1', msg: '', data: [{ ordId: '', clOrdId: '', tag: '', ts: '1', sCode: '51400', sMsg: 'plain book says gone' }] } });
        }

        return Promise.resolve({ data: { code: '1', msg: '', data: [{ algoId: '', clOrdId: '', algoClOrdId: '', sCode: '51603', sMsg: 'algo says gone' }] } });
      });

      await expect(client.cancelOrder('BTCUSDT', 'ghost-2')).rejects.toThrow('plain book says gone');
    });

    it('reports a connection failure of the algo service as a connection failure, not as a missing order', async () => {
      const { client, mockInstance } = await createLoadedClient();
      mockInstance.post.mockImplementation((path: string) => {
        if (path === '/api/v5/trade/cancel-order') {
          return Promise.resolve({ data: { code: '1', msg: '', data: [{ ordId: '', clOrdId: '', tag: '', ts: '1', sCode: '51400', sMsg: 'plain book says gone' }] } });
        }

        return Promise.reject(buildConnectionFailure('socket hang up'));
      });

      await expect(client.cancelOrder('BTCUSDT', 'ghost-3')).rejects.toThrow('socket hang up');
    });

    it('writes the reason of every refused cancel into the log', async () => {
      const { client, mockInstance, logger } = await createLoadedClient();
      mockInstance.post.mockImplementation((path: string) => {
        if (path === '/api/v5/trade/cancel-order') {
          return Promise.resolve({ data: { code: '1', msg: '', data: [{ ordId: '', clOrdId: '', tag: '', ts: '1', sCode: '51400', sMsg: 'plain book says gone' }] } });
        }

        return Promise.reject(buildConnectionFailure('socket hang up'));
      });

      await expect(client.cancelOrder('BTCUSDT', 'ghost-3')).rejects.toThrow('socket hang up');
      // Ожидаемое «заявки уже нет» — уровнем сведений, настоящий отказ связи — предупреждением.
      expect(logger.info).toHaveBeenCalledWith(expect.anything(), expect.stringContaining('plain book says gone'));
      expect(logger.warn).toHaveBeenCalledWith(expect.anything(), expect.stringContaining('socket hang up'));
      expect(logger.warn).not.toHaveBeenCalledWith(expect.anything(), expect.stringContaining('plain book says gone'));
    });

    it('cancels a plain order over the order channel when it is up', async () => {
      const { client, mockInstance } = await createLoadedClient();
      const tradeStream = enableOrderStream(client);
      (client as any).conditionalOrderRegistry.record('BTCUSDT', 'plain-ws', 'plain');
      tradeStream.cancelOrder.mockResolvedValue(okxOrderResult('plain-ws'));
      mockInstance.get.mockResolvedValue(okxSuccess([{ ...SWAP_ORDER_RAW, ordId: 'plain-ws', state: 'canceled' }]));

      const order = await client.cancelOrder('BTCUSDT', 'plain-ws');

      expect(tradeStream.cancelOrder).toHaveBeenCalledWith({ instId: 'BTC-USDT-SWAP', ordId: 'plain-ws' });
      expect(mockInstance.post).not.toHaveBeenCalled();
      expect(order.status).toBe('canceled');
    });

    it('reads the order back after a successful plain cancel', async () => {
      const { client, mockInstance } = await createLoadedClient();
      (client as any).conditionalOrderRegistry.record('BTCUSDT', 'plain-1', 'plain');
      mockInstance.post.mockResolvedValue(okxSuccess([okxOrderResult('plain-1')]));
      mockInstance.get.mockResolvedValue(okxSuccess([{ ...SWAP_ORDER_RAW, state: 'canceled' }]));

      const order = await client.cancelOrder('BTCUSDT', 'plain-1');

      expect(order.status).toBe('canceled');
    });

    it('remembers a cancelled order of unknown origin as plain so the read back asks one service only', async () => {
      const { client, mockInstance } = await createLoadedClient();
      mockInstance.post.mockResolvedValue(okxSuccess([okxOrderResult('plain-m1')]));
      mockInstance.get.mockResolvedValue(okxSuccess([{ ...SWAP_ORDER_RAW, ordId: 'plain-m1', state: 'canceled' }]));

      await client.cancelOrder('BTCUSDT', 'plain-m1');

      expect(mockInstance.get.mock.calls.map((call: unknown[]) => call[0])).toEqual(['/api/v5/trade/order']);
      expect((client as any).conditionalOrderRegistry.lookup('BTCUSDT', 'plain-m1')).toBe('plain');
    });

    it('refuses to invent a conditional order when the exchange confirmed the cancel but the read back found nothing', async () => {
      const { client, mockInstance, logger } = await createLoadedClient();
      (client as any).conditionalOrderRegistry.record('BTCUSDT', 'algo-gone', 'conditional');
      mockInstance.post.mockResolvedValue(okxSuccess([{ algoId: 'algo-gone', clOrdId: '', algoClOrdId: '', sCode: '0', sMsg: '' }]));
      mockInstance.get.mockResolvedValue(okxSuccess([]));

      await expect(client.cancelOrder('BTCUSDT', 'algo-gone')).rejects.toMatchObject({
        code: 'OKX_CANCELLED_ORDER_UNREADABLE',
      });
      expect(logger.warn).toHaveBeenCalled();
    });

    it('fails with the reason instead of an order that says side Buy and nothing filled', async () => {
      const { client, mockInstance, logger } = await createLoadedClient();
      (client as any).conditionalOrderRegistry.record('BTCUSDT', 'plain-2', 'plain');
      mockInstance.post.mockResolvedValue(okxSuccess([okxOrderResult('plain-2')]));
      // Отказ биржи, а не обрыв сети: сетевую ошибку слой запросов повторяет с нарастающей
      // паузой, и проверка меряла бы эти паузы, а не поведение отмены.
      mockInstance.get.mockResolvedValue({ data: { code: '51603', msg: 'read back failed', data: [] } });

      await expect(client.cancelOrder('BTCUSDT', 'plain-2')).rejects.toMatchObject({
        code: 'OKX_CANCELLED_ORDER_UNREADABLE',
      });
      expect(logger.warn).toHaveBeenCalled();
    });

    it('says in the error that the cancel itself went through, so the caller does not repeat it', async () => {
      const { client, mockInstance } = await createLoadedClient();
      (client as any).conditionalOrderRegistry.record('BTCUSDT', 'plain-9', 'plain');
      mockInstance.post.mockResolvedValue(okxSuccess([okxOrderResult('plain-9')]));
      mockInstance.get.mockResolvedValue({ data: { code: '51603', msg: 'read back failed', data: [] } });

      await expect(client.cancelOrder('BTCUSDT', 'plain-9')).rejects.toThrow(/was cancelled, but reading its final state failed/);
    });

    it('never reports a half-filled sell as an untouched Buy of zero', async () => {
      const { client, mockInstance } = await createLoadedClient();
      (client as any).conditionalOrderRegistry.record('BTCUSDT', 'plain-half', 'plain');
      mockInstance.post.mockResolvedValue(okxSuccess([okxOrderResult('plain-half')]));
      mockInstance.get.mockResolvedValue({ data: { code: '51603', msg: 'read back failed', data: [] } });

      const outcome = await client.cancelOrder('BTCUSDT', 'plain-half').then(
        (order) => ({ order, error: null }),
        (error) => ({ order: null, error }),
      );

      expect(outcome.order).toBeNull();
      expect(outcome.error).toBeInstanceOf(ExchangeError);
    });
  });

  describe('modifyOrder', () => {
    it('sends the new full size in contracts, not the remaining amount', async () => {
      const { client, mockInstance } = await createLoadedClient();
      (client as any).conditionalOrderRegistry.record('BTCUSDT', 'plain-3', 'plain');
      mockInstance.post.mockResolvedValue(okxSuccess([okxOrderResult('plain-3')]));
      mockInstance.get.mockResolvedValue(okxSuccess([SWAP_ORDER_RAW]));

      await client.modifyOrder({ symbol: 'BTCUSDT', orderId: 'plain-3', amount: 0.05, price: 51000 });

      const [path, body] = mockInstance.post.mock.calls[0];

      expect(path).toBe('/api/v5/trade/amend-order');
      expect(body.newSz).toBe('5');
      expect(body.newPx).toBe('51000');
      expect(body.ordId).toBe('plain-3');
    });

    it('amends a plain order over the order channel when it is up', async () => {
      const { client, mockInstance } = await createLoadedClient();
      const tradeStream = enableOrderStream(client);
      (client as any).conditionalOrderRegistry.record('BTCUSDT', 'plain-ws2', 'plain');
      tradeStream.amendOrder.mockResolvedValue(okxOrderResult('plain-ws2'));
      mockInstance.get.mockResolvedValue(okxSuccess([SWAP_ORDER_RAW]));

      await client.modifyOrder({ symbol: 'BTCUSDT', orderId: 'plain-ws2', price: 51000 });

      expect(tradeStream.amendOrder).toHaveBeenCalledWith({ instId: 'BTC-USDT-SWAP', ordId: 'plain-ws2', newPx: '51000' });
      expect(mockInstance.post).not.toHaveBeenCalled();
    });

    it('refuses a modification that changes nothing', async () => {
      const { client } = await createLoadedClient();
      (client as any).conditionalOrderRegistry.record('BTCUSDT', 'plain-4', 'plain');

      await expect(client.modifyOrder({ symbol: 'BTCUSDT', orderId: 'plain-4' }))
        .rejects.toMatchObject({ code: 'MODIFY_NOTHING_TO_CHANGE' });
    });

    it('refuses a zero trigger price without sending anything, OKX reads that zero as "delete the stop"', async () => {
      const { client, mockInstance } = await createLoadedClient();
      (client as any).conditionalOrderRegistry.record('BTCUSDT', 'algo-9', 'conditional');

      await expect(client.modifyOrder({ symbol: 'BTCUSDT', orderId: 'algo-9', triggerPrice: 0 }))
        .rejects.toMatchObject({ code: 'STOP_PRICE_REQUIRED' });

      expect(mockInstance.post).not.toHaveBeenCalled();
      expect(mockInstance.get).not.toHaveBeenCalled();
    });

    it('refuses a negative trigger price the same way', async () => {
      const { client, mockInstance } = await createLoadedClient();

      await expect(client.modifyOrder({ symbol: 'BTCUSDT', orderId: 'algo-9', triggerPrice: -1 }))
        .rejects.toMatchObject({ code: 'STOP_PRICE_REQUIRED' });

      expect(mockInstance.post).not.toHaveBeenCalled();
    });

    it('refuses a trigger price that the tick size rounds down to zero, it reaches the wire as the same zero', async () => {
      const { client, mockInstance } = await createLoadedClient();

      await expect(client.modifyOrder({ symbol: 'BTCUSDT', orderId: 'algo-9', triggerPrice: 0.04 }))
        .rejects.toMatchObject({ code: 'STOP_PRICE_REQUIRED' });

      expect(mockInstance.post).not.toHaveBeenCalled();
    });

    it('amends a conditional order on the side the exchange actually filled', async () => {
      const { client, mockInstance } = await createLoadedClient();
      (client as any).conditionalOrderRegistry.record('BTCUSDT', 'algo-6', 'conditional');
      mockInstance.get.mockResolvedValue(okxSuccess([{ ...OKX_RAW_ALGO_ORDER_TAKE_PROFIT_LIMIT, algoId: 'algo-6' }]));
      mockInstance.post.mockResolvedValue(okxSuccess([{ algoId: 'algo-6', clOrdId: '', algoClOrdId: '', sCode: '0', sMsg: '' }]));

      await client.modifyOrder({ symbol: 'BTCUSDT', orderId: 'algo-6', triggerPrice: 64000 });

      const [path, body] = mockInstance.post.mock.calls[0];

      expect(path).toBe('/api/v5/trade/amend-algos');
      expect(body.newTpTriggerPx).toBe('64000');
      expect(body.newSlTriggerPx).toBeUndefined();
      expect(body.algoId).toBe('algo-6');
    });

    it('moves the very leg that reading the same order reports, when both legs are filled', async () => {
      const { client, mockInstance } = await createLoadedClient();
      (client as any).conditionalOrderRegistry.record('BTCUSDT', 'oco-1', 'conditional');
      mockInstance.get.mockResolvedValue(okxSuccess([{ ...OKX_RAW_ALGO_ORDER_OCO, algoId: 'oco-1' }]));
      mockInstance.post.mockResolvedValue(okxSuccess([{ algoId: 'oco-1', clOrdId: '', algoClOrdId: '', sCode: '0', sMsg: '' }]));

      const readOrder = await client.getOrder('BTCUSDT', 'oco-1');

      expect(readOrder.stopPrice).toBe(60000);

      await client.modifyOrder({ symbol: 'BTCUSDT', orderId: 'oco-1', triggerPrice: 62000 });

      const [path, body] = mockInstance.post.mock.calls[0];

      expect(path).toBe('/api/v5/trade/amend-algos');
      expect(body.newSlTriggerPx).toBe('62000');
      expect(body.newTpTriggerPx).toBeUndefined();
    });

    it('moves the take-profit leg when that is the leg the exchange says fired', async () => {
      const { client, mockInstance } = await createLoadedClient();
      (client as any).conditionalOrderRegistry.record('BTCUSDT', 'oco-2', 'conditional');
      mockInstance.get.mockResolvedValue(okxSuccess([{ ...OKX_RAW_ALGO_ORDER_OCO_TAKE_PROFIT_FIRED, algoId: 'oco-2' }]));
      mockInstance.post.mockResolvedValue(okxSuccess([{ algoId: 'oco-2', clOrdId: '', algoClOrdId: '', sCode: '0', sMsg: '' }]));

      await client.modifyOrder({ symbol: 'BTCUSDT', orderId: 'oco-2', triggerPrice: 72000 });

      const [, body] = mockInstance.post.mock.calls[0];

      expect(body.newTpTriggerPx).toBe('72000');
      expect(body.newSlTriggerPx).toBeUndefined();
    });

    it('refuses to amend a trailing stop instead of sending it a stop-loss leg it does not have', async () => {
      const { client, mockInstance } = await createLoadedClient();
      (client as any).conditionalOrderRegistry.record('BTCUSDT', 'tr-1', 'conditional');
      mockInstance.get.mockResolvedValue(okxSuccess([{ ...OKX_RAW_ALGO_ORDER_TRAILING, algoId: 'tr-1' }]));

      await expect(client.modifyOrder({ symbol: 'BTCUSDT', orderId: 'tr-1', triggerPrice: 62000 }))
        .rejects.toMatchObject({ code: 'OKX_TRAILING_STOP_AMEND_UNSUPPORTED' });
      expect(mockInstance.post).not.toHaveBeenCalled();
    });

    it('sends both prices of a plain trigger order, as the exchange demands', async () => {
      const { client, mockInstance } = await createLoadedClient();
      (client as any).conditionalOrderRegistry.record('BTCUSDT', 'trig-1', 'conditional');
      mockInstance.get.mockResolvedValue(okxSuccess([{ ...OKX_RAW_ALGO_ORDER_TRIGGER, algoId: 'trig-1' }]));
      mockInstance.post.mockResolvedValue(okxSuccess([{ algoId: 'trig-1', clOrdId: '', algoClOrdId: '', sCode: '0', sMsg: '' }]));

      await client.modifyOrder({ symbol: 'BTCUSDT', orderId: 'trig-1', triggerPrice: 57000 });

      const [, body] = mockInstance.post.mock.calls[0];

      expect(body.newTriggerPx).toBe('57000');
      expect(body.newOrdPx).toBe('-1');
      expect(body.newSlTriggerPx).toBeUndefined();
    });

    it('falls back to the conditional service when a size-only amendment finds nothing in the plain book', async () => {
      const { client, mockInstance } = await createLoadedClient();
      mockInstance.post.mockImplementation((path: string) => {
        if (path === '/api/v5/trade/amend-order') {
          return Promise.resolve({ data: { code: '1', msg: '', data: [{ sCode: '51503', sMsg: 'Order amendment failed as the order does not exist' }] } });
        }

        return Promise.resolve(okxSuccess([{ algoId: 'algo-restart', clOrdId: '', algoClOrdId: '', sCode: '0', sMsg: '' }]));
      });
      mockInstance.get.mockResolvedValue(okxSuccess([{ ...OKX_RAW_ALGO_ORDER_STOP_MARKET, algoId: 'algo-restart' }]));

      await client.modifyOrder({ symbol: 'BTCUSDT', orderId: 'algo-restart', amount: 0.05 });

      const algoCall = mockInstance.post.mock.calls.find((call: unknown[]) => call[0] === '/api/v5/trade/amend-algos');

      expect(algoCall).toBeDefined();
      expect((algoCall as unknown[])[1]).toMatchObject({ algoId: 'algo-restart', newSz: '5' });
      expect((client as any).conditionalOrderRegistry.lookup('BTCUSDT', 'algo-restart')).toBe('conditional');
    });

    it('reports a connection failure of the algo service as a connection failure, not as a missing order', async () => {
      const { client, mockInstance } = await createLoadedClient();
      mockInstance.post.mockImplementation((path: string) => {
        if (path === '/api/v5/trade/amend-order') {
          return Promise.resolve({ data: { code: '1', msg: '', data: [{ sCode: '51503', sMsg: 'plain book says gone' }] } });
        }

        return Promise.resolve(okxSuccess([]));
      });
      mockInstance.get.mockRejectedValue(buildConnectionFailure('gateway timeout'));

      await expect(client.modifyOrder({ symbol: 'BTCUSDT', orderId: 'algo-restart', amount: 0.05 }))
        .rejects.toThrow('gateway timeout');
    });

    it('writes the reason of every refused amendment into the log', async () => {
      const { client, mockInstance, logger } = await createLoadedClient();
      mockInstance.post.mockImplementation((path: string) => {
        if (path === '/api/v5/trade/amend-order') {
          return Promise.resolve({ data: { code: '1', msg: '', data: [{ sCode: '51503', sMsg: 'plain book says gone' }] } });
        }

        return Promise.resolve(okxSuccess([]));
      });
      mockInstance.get.mockRejectedValue(buildConnectionFailure('gateway timeout'));

      await expect(client.modifyOrder({ symbol: 'BTCUSDT', orderId: 'algo-restart', amount: 0.05 }))
        .rejects.toThrow('gateway timeout');
      expect(logger.info).toHaveBeenCalledWith(expect.anything(), expect.stringContaining('plain book says gone'));
      expect(logger.warn).toHaveBeenCalledWith(expect.anything(), expect.stringContaining('gateway timeout'));
    });

    it('still reports the missing order when both services answer "no such order" to an amendment', async () => {
      const { client, mockInstance } = await createLoadedClient();
      mockInstance.post.mockImplementation((path: string) => {
        if (path === '/api/v5/trade/amend-order') {
          return Promise.resolve({ data: { code: '1', msg: '', data: [{ sCode: '51503', sMsg: 'plain book says gone' }] } });
        }

        return Promise.resolve(okxSuccess([]));
      });
      mockInstance.get.mockResolvedValue(okxSuccess([]));

      await expect(client.modifyOrder({ symbol: 'BTCUSDT', orderId: 'ghost-4', amount: 0.05 }))
        .rejects.toThrow('plain book says gone');
    });
  });

  describe('modifyOrder of a conditional order', () => {
    it('sends the new conditional size in contracts and keeps the market execution price', async () => {
      const { client, mockInstance } = await createLoadedClient();
      (client as any).conditionalOrderRegistry.record('BTCUSDT', 'algo-sz', 'conditional');
      mockInstance.get.mockResolvedValue(okxSuccess([{ ...OKX_RAW_ALGO_ORDER_STOP_MARKET, algoId: 'algo-sz' }]));
      mockInstance.post.mockResolvedValue(okxSuccess([{ algoId: 'algo-sz', clOrdId: '', algoClOrdId: '', sCode: '0', sMsg: '' }]));

      await client.modifyOrder({ symbol: 'BTCUSDT', orderId: 'algo-sz', amount: 0.05 });

      const [path, body] = mockInstance.post.mock.calls[0];

      expect(path).toBe('/api/v5/trade/amend-algos');
      expect(body.newSz).toBe('5');
      expect(body.newSlOrdPx).toBe('-1');
    });
  });

  describe('fetchOpenOrders', () => {
    it('normalizes pending orders and remembers them as plain', async () => {
      const { client, mockInstance } = await createLoadedClient();
      mockInstance.get.mockResolvedValue(okxSuccess([SWAP_ORDER_RAW]));

      const orderList = await client.fetchOpenOrders('BTCUSDT');

      expect(orderList).toHaveLength(1);
      expect(orderList[0].amount).toBeCloseTo(0.03);
      expect((client as any).conditionalOrderRegistry.lookup('BTCUSDT', 'plain-1')).toBe('plain');
    });

    it('skips an order on an instrument outside the loaded map instead of losing the whole list', async () => {
      const { client, mockInstance, logger } = await createLoadedClient();
      mockInstance.get.mockResolvedValue(okxSuccess([
        { ...SWAP_ORDER_RAW, ordId: 'fresh-listing', instId: 'NEW-USDT-SWAP' },
        SWAP_ORDER_RAW,
      ]));

      const orderList = await client.fetchOpenOrders();

      expect(orderList.map((order) => order.id)).toEqual(['plain-1']);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Instrument NEW-USDT-SWAP is not in the loaded instrument map — skipping in fetchOpenOrders'),
      );
    });

    it('answers with an empty list instead of failing when instruments were never loaded', async () => {
      const mockInstance = createMockAxiosInstance();
      mockedAxios.create.mockReturnValue(mockInstance as any);
      const client = new OkxSwap({
        config: { apiKey: 'testKey', secret: 'testSecret', passphrase: 'testPassphrase' },
        logger: createMockLogger(),
      });
      mockInstance.get.mockResolvedValue(okxSuccess([SWAP_ORDER_RAW]));

      await expect(client.fetchOpenOrders('BTCUSDT')).resolves.toEqual([]);
    });
  });

  describe('fetchOpenConditionalOrders', () => {
    it('asks the algo service for every order type and keeps only the requested settle currency', async () => {
      const { client, mockInstance } = await createLoadedClient();
      mockInstance.get.mockImplementation((_path: string, options: any) => {
        if (options.params.ordType === 'move_order_stop') {
          return Promise.resolve(okxSuccess([{ ...OKX_RAW_ALGO_ORDER_TRAILING, algoId: 'algo-trail' }]));
        }

        if (options.params.ordType === 'conditional,oco') {
          return Promise.resolve(okxSuccess([
            { ...OKX_RAW_ALGO_ORDER_STOP_MARKET, algoId: 'algo-usdt' },
            { ...OKX_RAW_ALGO_ORDER_STOP_MARKET, algoId: 'algo-other', instId: 'BTC-USD-SWAP' },
          ]));
        }

        return Promise.resolve(okxSuccess([]));
      });

      const orderList = await client.fetchOpenConditionalOrders('USDT');

      expect(mockInstance.get).toHaveBeenCalledTimes(7);
      expect(orderList.map((order) => order.id)).toEqual(['algo-usdt', 'algo-trail']);
      expect((client as any).conditionalOrderRegistry.lookup('BTCUSDT', 'algo-usdt')).toBe('conditional');
    });

    it('says out loud that a conditional order was dropped for an instrument outside the loaded map', async () => {
      const { client, mockInstance, logger } = await createLoadedClient();
      mockInstance.get.mockImplementation((_path: string, options: any) => {
        if (options.params.ordType !== 'conditional,oco') {
          return Promise.resolve(okxSuccess([]));
        }

        return Promise.resolve(okxSuccess([
          { ...OKX_RAW_ALGO_ORDER_STOP_MARKET, algoId: 'algo-unknown', instId: 'NEW-USDT-SWAP' },
        ]));
      });

      const orderList = await client.fetchOpenConditionalOrders('USDT');

      expect(orderList).toHaveLength(0);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Conditional order algo-unknown on NEW-USDT-SWAP is not in the loaded instrument map'),
      );
    });

    it('reads the next page instead of stopping at a full one and reporting fewer stops than there are', async () => {
      const { client, mockInstance } = await createLoadedClient();
      const fullPageRawList = Array.from(
        { length: OKX_ORDER_PAGE_LIMIT },
        (_value, index) => ({ ...OKX_RAW_ALGO_ORDER_STOP_MARKET, algoId: `page1-${index}` }),
      );
      mockInstance.get.mockImplementation((_path: string, options: any) => {
        if (options.params.ordType !== 'conditional,oco') {
          return Promise.resolve(okxSuccess([]));
        }

        if (options.params.after === undefined) {
          return Promise.resolve(okxSuccess(fullPageRawList));
        }

        return Promise.resolve(okxSuccess([{ ...OKX_RAW_ALGO_ORDER_STOP_MARKET, algoId: 'page2-0' }]));
      });

      const orderList = await client.fetchOpenConditionalOrders('USDT');

      const conditionalCallList = mockInstance.get.mock.calls
        .filter((call: any[]) => call[1].params.ordType === 'conditional,oco');

      expect(conditionalCallList).toHaveLength(2);
      expect(conditionalCallList[1][1].params.after).toBe(`page1-${OKX_ORDER_PAGE_LIMIT - 1}`);
      expect(orderList).toHaveLength(OKX_ORDER_PAGE_LIMIT + 1);
    });
  });

  describe('fetchOpenConditionalOrders without instruments', () => {
    it('refuses to answer before the instruments are loaded instead of reporting no stops at all', async () => {
      const mockInstance = createMockAxiosInstance();
      mockedAxios.create.mockReturnValue(mockInstance as any);
      const client = new OkxSwap({
        config: { apiKey: 'testKey', secret: 'testSecret', passphrase: 'testPassphrase' },
        logger: createMockLogger(),
      });

      await expect(client.fetchOpenConditionalOrders('USDT')).rejects.toMatchObject({ code: 'OKX_INSTRUMENTS_NOT_LOADED' });
      expect(mockInstance.get).not.toHaveBeenCalled();
    });

    it('lists a plan order (ordType trigger) the library itself never places', async () => {
      const { client, mockInstance } = await createLoadedClient();
      mockInstance.get.mockImplementation((_path: string, options: any) => {
        if (options.params.ordType === 'trigger') {
          return Promise.resolve(okxSuccess([{ ...OKX_RAW_ALGO_ORDER_TRIGGER, algoId: 'human-trigger-2' }]));
        }

        return Promise.resolve(okxSuccess([]));
      });

      const orderList = await client.fetchOpenConditionalOrders('USDT');

      expect(orderList.map((order) => order.id)).toEqual(['human-trigger-2']);
    });
  });

  describe('cancelAllOrders', () => {
    it('cancels plain orders in chunks of the batch size and algo orders in chunks of their own', async () => {
      const { client, mockInstance } = await createLoadedClient();
      const plainCount = OKX_ORDER_BATCH_CHUNK_SIZE + 1;
      const algoCount = OKX_ALGO_CANCEL_BATCH_CHUNK_SIZE + 1;

      const plainRawList = Array.from({ length: plainCount }, (_value, index) => ({ ...SWAP_ORDER_RAW, ordId: `p${index}` }));
      const algoRawList = Array.from({ length: algoCount }, (_value, index) => ({ ...OKX_RAW_ALGO_ORDER_STOP_MARKET, algoId: `a${index}` }));

      mockInstance.get.mockImplementation((path: string, options: any) => {
        if (path === '/api/v5/trade/orders-pending') {
          return Promise.resolve(okxSuccess(plainRawList));
        }

        if (options.params.ordType === 'conditional,oco') {
          return Promise.resolve(okxSuccess(algoRawList));
        }

        return Promise.resolve(okxSuccess([]));
      });
      mockInstance.post.mockImplementation((_path: string, body: any) =>
        Promise.resolve(okxSuccess((body as unknown[]).map(() => okxOrderResult('x')))));

      await client.cancelAllOrders('BTCUSDT');

      const pathList = mockInstance.post.mock.calls.map((call: unknown[]) => call[0]);

      expect(pathList).toEqual([
        '/api/v5/trade/cancel-batch-orders',
        '/api/v5/trade/cancel-batch-orders',
        '/api/v5/trade/cancel-algos',
        '/api/v5/trade/cancel-algos',
      ]);
      expect((mockInstance.post.mock.calls[0][1] as unknown[]).length).toBe(OKX_ORDER_BATCH_CHUNK_SIZE);
      expect((mockInstance.post.mock.calls[2][1] as unknown[]).length).toBe(OKX_ALGO_CANCEL_BATCH_CHUNK_SIZE);
    });

    it('warns about an order the exchange refused to cancel instead of failing the whole sweep', async () => {
      const { client, mockInstance, logger } = await createLoadedClient();
      mockInstance.get.mockImplementation((path: string) => {
        if (path === '/api/v5/trade/orders-pending') {
          return Promise.resolve(okxSuccess([SWAP_ORDER_RAW]));
        }

        return Promise.resolve(okxSuccess([]));
      });
      mockInstance.post.mockResolvedValue(okxBatch('1', [okxOrderResult('', '51400', 'gone')]));

      await client.cancelAllOrders('BTCUSDT');

      expect(logger.warn).toHaveBeenCalled();
    });

    it('reads every page of conditional orders before cancelling them', async () => {
      const { client, mockInstance } = await createLoadedClient();
      const fullPageRawList = Array.from(
        { length: OKX_ORDER_PAGE_LIMIT },
        (_value, index) => ({ ...OKX_RAW_ALGO_ORDER_STOP_MARKET, algoId: `page1-${index}` }),
      );
      mockInstance.get.mockImplementation((path: string, options: any) => {
        if (path === '/api/v5/trade/orders-pending' || options.params.ordType !== 'conditional,oco') {
          return Promise.resolve(okxSuccess([]));
        }

        if (options.params.after === undefined) {
          return Promise.resolve(okxSuccess(fullPageRawList));
        }

        return Promise.resolve(okxSuccess([{ ...OKX_RAW_ALGO_ORDER_STOP_MARKET, algoId: 'page2-0' }]));
      });
      mockInstance.post.mockImplementation((_path: string, body: any) =>
        Promise.resolve(okxSuccess((body as unknown[]).map(() => okxOrderResult('x')))));

      await client.cancelAllOrders('BTCUSDT');

      const cancelledIdList = mockInstance.post.mock.calls
        .flatMap((call: any[]) => (call[1] as Array<{ algoId: string }>).map((entry) => entry.algoId));

      expect(cancelledIdList).toHaveLength(OKX_ORDER_PAGE_LIMIT + 1);
      expect(cancelledIdList).toContain('page2-0');
    });

    it('sends no cancel requests when nothing is open', async () => {
      const { client, mockInstance } = await createLoadedClient();
      mockInstance.get.mockResolvedValue(okxSuccess([]));

      await client.cancelAllOrders('BTCUSDT');

      expect(mockInstance.post).not.toHaveBeenCalled();
    });

    it('asks the exchange for every conditional order type it can answer with', async () => {
      const { client, mockInstance } = await createLoadedClient();
      mockInstance.get.mockResolvedValue(okxSuccess([]));

      await client.cancelAllOrders('BTCUSDT');

      const askedOrdTypeList = mockInstance.get.mock.calls
        .filter((call: any[]) => call[0] === '/api/v5/trade/orders-algo-pending')
        .map((call: any[]) => call[1].params.ordType);

      expect(askedOrdTypeList).toEqual([
        'conditional,oco',
        'move_order_stop',
        'trigger',
        'iceberg',
        'twap',
        'smart_iceberg',
        'chase',
      ]);
    });

    it('cancels a plan order (ordType trigger) placed by a human in the OKX app', async () => {
      const { client, mockInstance } = await createLoadedClient();
      mockInstance.get.mockImplementation((path: string, options: any) => {
        if (path === '/api/v5/trade/orders-algo-pending' && options.params.ordType === 'trigger') {
          return Promise.resolve(okxSuccess([{ ...OKX_RAW_ALGO_ORDER_TRIGGER, algoId: 'human-trigger-1' }]));
        }

        return Promise.resolve(okxSuccess([]));
      });
      mockInstance.post.mockImplementation((_path: string, body: any) =>
        Promise.resolve(okxSuccess((body as unknown[]).map(() => okxOrderResult('x')))));

      await client.cancelAllOrders('BTCUSDT');

      const cancelledIdList = mockInstance.post.mock.calls
        .filter((call: any[]) => call[0] === '/api/v5/trade/cancel-algos')
        .flatMap((call: any[]) => (call[1] as Array<{ algoId: string }>).map((entry) => entry.algoId));

      expect(cancelledIdList).toEqual(['human-trigger-1']);
    });

    it('cancels an iceberg and a twap order in the same sweep', async () => {
      const { client, mockInstance } = await createLoadedClient();
      mockInstance.get.mockImplementation((path: string, options: any) => {
        if (path !== '/api/v5/trade/orders-algo-pending') {
          return Promise.resolve(okxSuccess([]));
        }

        if (options.params.ordType === 'iceberg') {
          return Promise.resolve(okxSuccess([{ ...OKX_RAW_ALGO_ORDER_TRIGGER, algoId: 'iceberg-1' }]));
        }

        if (options.params.ordType === 'twap') {
          return Promise.resolve(okxSuccess([{ ...OKX_RAW_ALGO_ORDER_TRIGGER, algoId: 'twap-1' }]));
        }

        return Promise.resolve(okxSuccess([]));
      });
      mockInstance.post.mockImplementation((_path: string, body: any) =>
        Promise.resolve(okxSuccess((body as unknown[]).map(() => okxOrderResult('x')))));

      await client.cancelAllOrders('BTCUSDT');

      const cancelledIdList = mockInstance.post.mock.calls
        .flatMap((call: any[]) => (call[1] as Array<{ algoId: string }>).map((entry) => entry.algoId));

      expect(cancelledIdList).toEqual(['iceberg-1', 'twap-1']);
    });

    it('cancels everything it can when one conditional kind is refused, then reports what was left out', async () => {
      const { client, mockInstance, logger } = await createLoadedClient();
      mockInstance.get.mockImplementation((path: string, options: any) => {
        if (path === '/api/v5/trade/orders-pending') {
          return Promise.resolve(okxSuccess([SWAP_ORDER_RAW]));
        }

        if (options.params.ordType === 'trigger') {
          return Promise.resolve({ data: { code: '51000', msg: 'Parameter ordType error', data: [] } });
        }

        if (options.params.ordType === 'conditional,oco') {
          return Promise.resolve(okxSuccess([{ ...OKX_RAW_ALGO_ORDER_STOP_MARKET, algoId: 'stop-1' }]));
        }

        if (options.params.ordType === 'twap') {
          return Promise.resolve(okxSuccess([{ ...OKX_RAW_ALGO_ORDER_TRIGGER, algoId: 'twap-1' }]));
        }

        return Promise.resolve(okxSuccess([]));
      });
      mockInstance.post.mockImplementation((_path: string, body: any) =>
        Promise.resolve(okxSuccess((body as unknown[]).map(() => okxOrderResult('x')))));

      await expect(client.cancelAllOrders('BTCUSDT')).rejects.toMatchObject({ code: 'OKX_CANCEL_ALL_INCOMPLETE' });

      const askedOrdTypeList = mockInstance.get.mock.calls
        .filter((call: any[]) => call[0] === '/api/v5/trade/orders-algo-pending')
        .map((call: any[]) => call[1].params.ordType);

      expect(askedOrdTypeList).toEqual([
        'conditional,oco',
        'move_order_stop',
        'trigger',
        'iceberg',
        'twap',
        'smart_iceberg',
        'chase',
      ]);

      const cancelledIdList = mockInstance.post.mock.calls
        .flatMap((call: any[]) => (call[1] as Array<{ algoId?: string; ordId?: string }>)
          .map((entry) => entry.algoId ?? entry.ordId));

      expect(cancelledIdList).toEqual(['plain-1', 'stop-1', 'twap-1']);
      expect(logger.warn).toHaveBeenCalled();
    });

    it('names the kind that was not swept in the error it throws', async () => {
      const { client, mockInstance } = await createLoadedClient();
      mockInstance.get.mockImplementation((path: string, options: any) => {
        if (path === '/api/v5/trade/orders-algo-pending' && options.params.ordType === 'twap') {
          return Promise.resolve({ data: { code: '51000', msg: 'Parameter ordType error', data: [] } });
        }

        return Promise.resolve(okxSuccess([]));
      });

      await expect(client.cancelAllOrders('BTCUSDT')).rejects.toThrow(/twap/);
    });
  });

  describe('createBatchOrders', () => {
    it('keeps the input order, sends conditional orders one by one and plain ones as a batch', async () => {
      const { client, mockInstance } = await createLoadedClient();
      mockInstance.post.mockImplementation((path: string) => {
        if (path === '/api/v5/trade/order-algo') {
          return Promise.resolve(okxSuccess([{ algoId: 'algo-b', clOrdId: '', algoClOrdId: '', sCode: '0', sMsg: '' }]));
        }

        return Promise.resolve(okxSuccess([okxOrderResult('plain-a'), okxOrderResult('plain-c')]));
      });

      const resultList = await client.createBatchOrders([
        { symbol: 'BTCUSDT', type: OrderTypeEnum.Market, side: OrderSideEnum.Buy, amount: 0.05 },
        { symbol: 'BTCUSDT', type: OrderTypeEnum.StopMarket, side: OrderSideEnum.Sell, amount: 0.05, stopPrice: 60000 },
        { symbol: 'BTCUSDT', type: OrderTypeEnum.Market, side: OrderSideEnum.Buy, amount: 0.05 },
      ]);

      expect(resultList).toHaveLength(3);
      expect(resultList[0].order?.id).toBe('plain-a');
      expect(resultList[1].order?.id).toBe('algo-b');
      expect(resultList[2].order?.id).toBe('plain-c');
      expect((client as any).conditionalOrderRegistry.lookup('BTCUSDT', 'plain-a')).toBe('plain');
    });

    it('rejects an entry whose params cannot be built without sending it', async () => {
      const { client, mockInstance } = await createLoadedClient();
      mockInstance.post.mockResolvedValue(okxSuccess([okxOrderResult('plain-ok')]));

      const resultList = await client.createBatchOrders([
        { symbol: 'BTCUSDT', type: OrderTypeEnum.Market, side: OrderSideEnum.Buy, amount: 0.0001 },
        { symbol: 'BTCUSDT', type: OrderTypeEnum.Market, side: OrderSideEnum.Buy, amount: 0.05 },
      ]);

      expect(resultList[0].isSuccess).toBe(false);
      expect(resultList[1].order?.id).toBe('plain-ok');
      expect((mockInstance.post.mock.calls[0][1] as unknown[]).length).toBe(1);
    });

    it('sends a plain batch over the order channel when it is up', async () => {
      const { client, mockInstance } = await createLoadedClient();
      const tradeStream = enableOrderStream(client);
      tradeStream.createBatchOrders.mockResolvedValue([
        { order: { id: 'ws-b', symbol: 'BTCUSDT' }, isSuccess: true, errorCode: null, errorText: null },
      ]);

      const resultList = await client.createBatchOrders([
        { symbol: 'BTCUSDT', type: OrderTypeEnum.Market, side: OrderSideEnum.Buy, amount: 0.05 },
      ]);

      expect(resultList[0].order?.id).toBe('ws-b');
      expect(mockInstance.post).not.toHaveBeenCalled();
      expect((client as any).conditionalOrderRegistry.lookup('BTCUSDT', 'ws-b')).toBe('plain');
    });

    it('sends no request at all for an empty batch of any kind', async () => {
      const { client, mockInstance } = await createLoadedClient();

      await expect(client.createBatchOrders([])).resolves.toEqual([]);
      await expect(client.cancelBatchOrders('BTCUSDT', [])).resolves.toEqual([]);
      await expect(client.modifyBatchOrders([])).resolves.toEqual([]);

      expect(mockInstance.post).not.toHaveBeenCalled();
    });

    it('reports a per-order rejection from a partially accepted batch', async () => {
      const { client, mockInstance } = await createLoadedClient();
      mockInstance.post.mockResolvedValue(okxBatch('2', [okxOrderResult('plain-ok'), okxOrderResult('', '51008', 'Insufficient balance')]));

      const resultList = await client.createBatchOrders([
        { symbol: 'BTCUSDT', type: OrderTypeEnum.Market, side: OrderSideEnum.Buy, amount: 0.05 },
        { symbol: 'BTCUSDT', type: OrderTypeEnum.Market, side: OrderSideEnum.Buy, amount: 0.05 },
      ]);

      expect(resultList[0].isSuccess).toBe(true);
      expect(resultList[1].isSuccess).toBe(false);
      expect(resultList[1].errorCode).toBe(51008);
    });
  });

  describe('cancelBatchOrders', () => {
    it('splits known conditional ids from the rest and keeps the input order', async () => {
      const { client, mockInstance } = await createLoadedClient();
      (client as any).conditionalOrderRegistry.record('BTCUSDT', 'algo-x', 'conditional');
      (client as any).conditionalOrderRegistry.record('BTCUSDT', 'plain-y', 'plain');
      mockInstance.post.mockImplementation((path: string, body: any) => {
        if (path === '/api/v5/trade/cancel-algos') {
          return Promise.resolve(okxSuccess([{ algoId: 'algo-x', clOrdId: '', algoClOrdId: '', sCode: '0', sMsg: '' }]));
        }

        return Promise.resolve(okxSuccess((body as unknown[]).map(() => okxOrderResult('plain-y'))));
      });

      const resultList = await client.cancelBatchOrders('BTCUSDT', ['plain-y', 'algo-x']);

      expect(resultList.map((entry) => entry.orderId)).toEqual(['plain-y', 'algo-x']);
      expect(resultList.every((entry) => entry.isSuccess)).toBe(true);
    });

    it('sends a plain batch cancel over the order channel when it is up', async () => {
      const { client, mockInstance } = await createLoadedClient();
      const tradeStream = enableOrderStream(client);
      tradeStream.cancelBatchOrders.mockResolvedValue([
        { orderId: 'plain-w', isSuccess: true, errorCode: null, errorText: null },
      ]);

      const resultList = await client.cancelBatchOrders('BTCUSDT', ['plain-w']);

      expect(resultList[0].isSuccess).toBe(true);
      expect(tradeStream.cancelBatchOrders).toHaveBeenCalled();
      expect(mockInstance.post).not.toHaveBeenCalled();
    });

    it('retries an unknown id as a conditional cancel when the plain book says it is gone', async () => {
      const { client, mockInstance } = await createLoadedClient();
      mockInstance.post.mockImplementation((path: string) => {
        if (path === '/api/v5/trade/cancel-batch-orders') {
          return Promise.resolve(okxBatch('1', [okxOrderResult('', '51400', 'gone')]));
        }

        return Promise.resolve(okxSuccess([{ algoId: 'algo-z', clOrdId: '', algoClOrdId: '', sCode: '0', sMsg: '' }]));
      });

      const resultList = await client.cancelBatchOrders('BTCUSDT', ['algo-z']);

      expect(resultList[0].isSuccess).toBe(true);
      expect(resultList[0].orderId).toBe('algo-z');
    });
  });

  describe('modifyBatchOrders', () => {
    it('amends plain orders as a batch and conditional ones one by one', async () => {
      const { client, mockInstance } = await createLoadedClient();
      (client as any).conditionalOrderRegistry.record('BTCUSDT', 'algo-m', 'conditional');
      mockInstance.get.mockResolvedValue(okxSuccess([{ ...OKX_RAW_ALGO_ORDER_STOP_MARKET, algoId: 'algo-m' }]));
      mockInstance.post.mockImplementation((path: string, body: any) => {
        if (path === '/api/v5/trade/amend-algos') {
          return Promise.resolve(okxSuccess([{ algoId: 'algo-m', clOrdId: '', algoClOrdId: '', sCode: '0', sMsg: '' }]));
        }

        return Promise.resolve(okxSuccess((body as unknown[]).map(() => okxOrderResult('plain-m'))));
      });

      const resultList = await client.modifyBatchOrders([
        { symbol: 'BTCUSDT', orderId: 'plain-m', side: OrderSideEnum.Buy, price: 51000 },
        { symbol: 'BTCUSDT', orderId: 'algo-m', side: OrderSideEnum.Sell, triggerPrice: 59000 },
      ]);

      expect(resultList.map((entry) => entry.orderId)).toEqual(['plain-m', 'algo-m']);
      expect(resultList.every((entry) => entry.isSuccess)).toBe(true);

      const amendBatchCall = mockInstance.post.mock.calls.find((call: unknown[]) => call[0] === '/api/v5/trade/amend-batch-orders');

      expect((amendBatchCall as unknown[])[1]).toEqual([{ instId: 'BTC-USDT-SWAP', ordId: 'plain-m', newPx: '51000' }]);
    });

    it('sends both the order id and the client order id, so the order id decides which order is amended', async () => {
      const { client, mockInstance } = await createLoadedClient();
      mockInstance.post.mockImplementation((_path: string, body: any) =>
        Promise.resolve(okxSuccess((body as unknown[]).map(() => okxOrderResult('plain-both')))));

      await client.modifyBatchOrders([
        { symbol: 'BTCUSDT', orderId: 'plain-both', clientOrderId: 'ladder01', side: OrderSideEnum.Buy, price: 51000 },
      ]);

      expect(mockInstance.post.mock.calls[0][1]).toEqual([
        { instId: 'BTC-USDT-SWAP', ordId: 'plain-both', clOrdId: 'ladder01', newPx: '51000' },
      ]);
    });

    it('refuses a zero trigger price in a batch, OKX reads that zero as "delete the stop"', async () => {
      const { client, mockInstance } = await createLoadedClient();
      (client as any).conditionalOrderRegistry.record('BTCUSDT', 'algo-zero', 'conditional');
      mockInstance.get.mockResolvedValue(okxSuccess([{ ...OKX_RAW_ALGO_ORDER_STOP_MARKET, algoId: 'algo-zero' }]));
      mockInstance.post.mockResolvedValue(okxSuccess([{ algoId: 'algo-zero', clOrdId: '', algoClOrdId: '', sCode: '0', sMsg: '' }]));

      const resultList = await client.modifyBatchOrders([
        { symbol: 'BTCUSDT', orderId: 'algo-zero', side: OrderSideEnum.Sell, triggerPrice: 0 },
      ]);

      expect(resultList).toEqual([
        {
          orderId: 'algo-zero',
          isSuccess: false,
          errorCode: null,
          errorText: 'OKX conditional order requires a stop price above zero',
        },
      ]);
      expect(mockInstance.post).not.toHaveBeenCalled();
    });

    it('refuses a batch trigger price that the tick size rounds down to zero, it reaches the wire as the same zero', async () => {
      const { client, mockInstance } = await createLoadedClient();
      mockInstance.get.mockResolvedValue(okxSuccess([{ ...OKX_RAW_ALGO_ORDER_STOP_MARKET, algoId: 'algo-dust' }]));
      mockInstance.post.mockResolvedValue(okxSuccess([{ algoId: 'algo-dust', clOrdId: '', algoClOrdId: '', sCode: '0', sMsg: '' }]));

      const resultList = await client.modifyBatchOrders([
        { symbol: 'BTCUSDT', orderId: 'algo-dust', side: OrderSideEnum.Sell, triggerPrice: 0.04 },
      ]);

      expect(resultList[0].isSuccess).toBe(false);
      expect(resultList[0].errorText).toContain('stop price above zero');
      expect(mockInstance.post).not.toHaveBeenCalled();
    });

    it('rejects only the zero-trigger entry and still amends the rest of the batch', async () => {
      const { client, mockInstance } = await createLoadedClient();
      mockInstance.get.mockResolvedValue(okxSuccess([{ ...OKX_RAW_ALGO_ORDER_STOP_MARKET, algoId: 'algo-zero' }]));
      mockInstance.post.mockImplementation((path: string, body: any) => {
        if (path === '/api/v5/trade/amend-algos') {
          return Promise.resolve(okxSuccess([{ algoId: 'algo-zero', clOrdId: '', algoClOrdId: '', sCode: '0', sMsg: '' }]));
        }

        return Promise.resolve(okxSuccess((body as unknown[]).map(() => okxOrderResult('plain-alive'))));
      });

      const resultList = await client.modifyBatchOrders([
        { symbol: 'BTCUSDT', orderId: 'algo-zero', side: OrderSideEnum.Sell, triggerPrice: 0 },
        { symbol: 'BTCUSDT', orderId: 'plain-alive', side: OrderSideEnum.Buy, price: 51000 },
      ]);

      expect(resultList.map((entry) => entry.isSuccess)).toEqual([false, true]);

      const amendAlgoCall = mockInstance.post.mock.calls.find((call: unknown[]) => call[0] === '/api/v5/trade/amend-algos');

      expect(amendAlgoCall).toBeUndefined();
      expect(mockInstance.post.mock.calls[0][0]).toBe('/api/v5/trade/amend-batch-orders');
    });
  });

  describe('modifyBatchOrders over the order channel', () => {
    it('amends a plain batch over the order channel when it is up', async () => {
      const { client, mockInstance } = await createLoadedClient();
      const tradeStream = enableOrderStream(client);
      tradeStream.modifyBatchOrders.mockResolvedValue([
        { orderId: 'plain-m', isSuccess: true, errorCode: null, errorText: null },
      ]);

      const resultList = await client.modifyBatchOrders([
        { symbol: 'BTCUSDT', orderId: 'plain-m', side: OrderSideEnum.Buy, price: 51000 },
      ]);

      expect(resultList[0].isSuccess).toBe(true);
      expect(tradeStream.modifyBatchOrders).toHaveBeenCalled();
      expect(mockInstance.post).not.toHaveBeenCalled();
    });

    it('reports a refused conditional amendment as a failed entry instead of losing the whole batch', async () => {
      const { client, mockInstance } = await createLoadedClient();
      (client as any).conditionalOrderRegistry.record('BTCUSDT', 'algo-f', 'conditional');
      mockInstance.get.mockResolvedValue(okxSuccess([]));

      const resultList = await client.modifyBatchOrders([
        { symbol: 'BTCUSDT', orderId: 'algo-f', side: OrderSideEnum.Sell, triggerPrice: 59000 },
      ]);

      expect(resultList[0].isSuccess).toBe(false);
      expect(resultList[0].errorCode).toBe(51603);
    });
  });

  describe('modifyBatchOrders after a restart', () => {
    it('recognises a conditional order by its trigger price when the registry knows nothing about it', async () => {
      const { client, mockInstance } = await createLoadedClient();
      mockInstance.get.mockResolvedValue(okxSuccess([{ ...OKX_RAW_ALGO_ORDER_STOP_MARKET, algoId: 'algo-restart' }]));
      mockInstance.post.mockResolvedValue(okxSuccess([{ algoId: 'algo-restart', clOrdId: '', algoClOrdId: '', sCode: '0', sMsg: '' }]));

      const resultList = await client.modifyBatchOrders([
        { symbol: 'BTCUSDT', orderId: 'algo-restart', side: OrderSideEnum.Sell, triggerPrice: 59000 },
      ]);

      const [path, body] = mockInstance.post.mock.calls[0];

      expect(path).toBe('/api/v5/trade/amend-algos');
      expect(body.newSlTriggerPx).toBe('59000');
      expect(resultList[0].isSuccess).toBe(true);
    });

    it('rejects an entry that changes nothing instead of sending an empty amendment', async () => {
      const { client, mockInstance } = await createLoadedClient();
      mockInstance.post.mockResolvedValue(okxSuccess([okxOrderResult('plain-n2')]));

      const resultList = await client.modifyBatchOrders([
        { symbol: 'BTCUSDT', orderId: 'plain-n1', side: OrderSideEnum.Buy },
        { symbol: 'BTCUSDT', orderId: 'plain-n2', side: OrderSideEnum.Buy, price: 51000 },
      ]);

      expect(resultList[0].isSuccess).toBe(false);
      expect(resultList[0].errorText).toContain('must change the price');
      expect(resultList[1].isSuccess).toBe(true);
      expect(mockInstance.post.mock.calls[0][1]).toEqual([{ instId: 'BTC-USDT-SWAP', ordId: 'plain-n2', newPx: '51000' }]);
    });
  });

  describe('close', () => {
    it('says in the log that the account streams were disconnected, exactly as disconnectUserDataStream does', async () => {
      const { client, logger } = await createLoadedClient();
      await client.connectUserDataStream({ onOrderUpdate: jest.fn(), onPositionUpdate: jest.fn() });
      const privateStream = (client as any).privateStream;
      const algoPrivateStream = (client as any).algoPrivateStream;

      await client.close();

      expect(privateStream.close).toHaveBeenCalled();
      expect(algoPrivateStream.close).toHaveBeenCalled();
      expect((client as any).privateStream).toBeNull();
      expect((client as any).algoPrivateStream).toBeNull();
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('User data stream disconnected'));
    });
  });

  describe('cancelBatchOrders retry in the conditional service', () => {
    it('retries in the conditional service on every expected code, as the single cancel does', async () => {
      const { client, mockInstance } = await createLoadedClient();
      mockInstance.post.mockImplementation((path: string) => {
        if (path === '/api/v5/trade/cancel-batch-orders') {
          return Promise.resolve({
            data: { code: '1', msg: '', data: [{ ordId: '', clOrdId: '', tag: '', ts: '1', sCode: '51603', sMsg: 'no such order' }] },
          });
        }

        return Promise.resolve(okxSuccess([{ algoId: 'unknown-1', clOrdId: '', algoClOrdId: '', sCode: '0', sMsg: '' }]));
      });

      const resultList = await client.cancelBatchOrders('BTCUSDT', ['unknown-1']);

      expect(resultList[0].isSuccess).toBe(true);
      expect(mockInstance.post.mock.calls.map((call: unknown[]) => call[0])).toEqual([
        '/api/v5/trade/cancel-batch-orders',
        '/api/v5/trade/cancel-algos',
      ]);
    });
  });

  describe('an order without an id is not an order', () => {
    it('refuses a plain order the exchange accepted without giving it an id', async () => {
      const { client, mockInstance } = await createLoadedClient();
      mockInstance.post.mockResolvedValue(okxSuccess([okxOrderResult('')]));

      await expect(client.createOrderWebSocket({
        symbol: 'BTCUSDT',
        type: OrderTypeEnum.Market,
        side: OrderSideEnum.Buy,
        amount: 0.05,
      })).rejects.toMatchObject({ code: 'OKX_EMPTY_ORDER_ID' });
    });

    it('refuses a conditional order without an id and keeps it out of the origin registry', async () => {
      const { client, mockInstance } = await createLoadedClient();
      mockInstance.post.mockResolvedValue(okxSuccess([{ algoId: '', clOrdId: '', algoClOrdId: '', sCode: '0', sMsg: '' }]));

      await expect(client.createOrderWebSocket({
        symbol: 'BTCUSDT',
        type: OrderTypeEnum.StopMarket,
        side: OrderSideEnum.Sell,
        amount: 0.05,
        stopPrice: 60000,
      })).rejects.toMatchObject({ code: 'OKX_EMPTY_ORDER_ID' });
      expect((client as any).conditionalOrderRegistry.lookup('BTCUSDT', '')).toBeNull();
    });
  });

  describe('amending a conditional order checks the instrument it came back on', () => {
    it('refuses to amend when the algo service answered about another instrument', async () => {
      const { client, mockInstance } = await createLoadedClient();
      (client as any).conditionalOrderRegistry.record('ETHUSDT', 'algo-x', 'conditional');
      mockInstance.get.mockResolvedValue(okxSuccess([{ ...OKX_RAW_ALGO_ORDER_STOP_MARKET, algoId: 'algo-x' }]));

      await expect(client.modifyOrder({ symbol: 'ETHUSDT', orderId: 'algo-x', triggerPrice: 3000 }))
        .rejects.toMatchObject({ code: 51603 });
      expect(mockInstance.post).not.toHaveBeenCalled();
    });

    it('reports a foreign instrument as a failed entry in a batch amendment, without sending it', async () => {
      const { client, mockInstance } = await createLoadedClient();
      (client as any).conditionalOrderRegistry.record('ETHUSDT', 'algo-y', 'conditional');
      mockInstance.get.mockResolvedValue(okxSuccess([{ ...OKX_RAW_ALGO_ORDER_STOP_MARKET, algoId: 'algo-y' }]));

      const resultList = await client.modifyBatchOrders([
        { symbol: 'ETHUSDT', orderId: 'algo-y', side: OrderSideEnum.Sell, triggerPrice: 3000 },
      ]);

      expect(resultList[0].isSuccess).toBe(false);
      expect(resultList[0].errorCode).toBe(51603);
      expect(mockInstance.post).not.toHaveBeenCalled();
    });
  });

  describe('modifyBatchOrders client order id', () => {
    it('keeps the exchange id on the wire next to the client id, as Bybit does', async () => {
      const { client, mockInstance } = await createLoadedClient();
      mockInstance.post.mockResolvedValue(okxSuccess([okxOrderResult('plain-c')]));

      await client.modifyBatchOrders([
        { symbol: 'BTCUSDT', orderId: 'plain-c', side: OrderSideEnum.Buy, clientOrderId: 'ladder01', amount: 0.05 },
      ]);

      const [, body] = mockInstance.post.mock.calls[0];

      expect(body).toEqual([{ instId: 'BTC-USDT-SWAP', ordId: 'plain-c', clOrdId: 'ladder01', newSz: '5' }]);
    });
  });

  describe('user data stream', () => {
    it('opens the private and the business connection with their own channels', async () => {
      const { client } = await createLoadedClient();
      const handler = { onOrderUpdate: jest.fn(), onPositionUpdate: jest.fn(), onBalanceUpdate: jest.fn() };

      await client.connectUserDataStream(handler);

      const privateStream = (client as any).privateStream;
      const algoPrivateStream = (client as any).algoPrivateStream;
      const MockedPrivateStream = jest.requireMock('../../src/ws/OkxPrivateStream').OkxPrivateStream as jest.Mock;
      const [privateArgs, algoArgs] = MockedPrivateStream.mock.calls.slice(-2).map((call: unknown[]) => call[0] as any);

      expect(privateArgs.subscriptionArgList).toEqual([
        { channel: 'orders', instType: 'SWAP' },
        { channel: 'positions', instType: 'SWAP' },
        { channel: 'account' },
      ]);
      expect(algoArgs.subscriptionArgList).toEqual([{ channel: 'orders-algo', instType: 'SWAP' }]);
      expect(algoArgs.url).toContain('/business');
      expect(privateStream.connect).toHaveBeenCalled();
      expect(algoPrivateStream.connect).toHaveBeenCalled();
    });

    it('reports order, position and balance events in coins', async () => {
      const { client } = await createLoadedClient();
      const handler = { onOrderUpdate: jest.fn(), onPositionUpdate: jest.fn(), onBalanceUpdate: jest.fn() };
      await client.connectUserDataStream(handler);

      const handlePrivateMessage = (message: unknown) => (client as any).handlePrivateMessage(message, handler);

      handlePrivateMessage({ arg: { channel: 'orders', instType: 'SWAP' }, data: [SWAP_ORDER_RAW] });
      handlePrivateMessage({ arg: { channel: 'positions', instType: 'SWAP' }, data: [OKX_RAW_POSITION_NET_LONG] });
      handlePrivateMessage({ arg: { channel: 'account' }, data: [OKX_RAW_BALANCE] });

      expect(handler.onOrderUpdate).toHaveBeenCalledWith(expect.objectContaining({ orderId: 'plain-1', amount: 0.03 }));
      expect(handler.onPositionUpdate).toHaveBeenCalledWith(expect.objectContaining({ symbol: 'BTCUSDT', size: 0.05 }));
      expect(handler.onBalanceUpdate).toHaveBeenCalledTimes(1);
    });

    it('ignores a position record that is not a swap position', async () => {
      const { client } = await createLoadedClient();
      const handler = { onOrderUpdate: jest.fn(), onPositionUpdate: jest.fn() };
      await client.connectUserDataStream(handler);

      (client as any).handlePrivateMessage(
        { arg: { channel: 'positions', instType: 'SWAP' }, data: [{ ...OKX_RAW_POSITION_NET_LONG, instType: 'MARGIN' }] },
        handler,
      );

      expect(handler.onPositionUpdate).not.toHaveBeenCalled();
    });

    it('marks an algo channel event as conditional and remembers its origin', async () => {
      const { client } = await createLoadedClient();
      const handler = { onOrderUpdate: jest.fn(), onPositionUpdate: jest.fn() };
      await client.connectUserDataStream(handler);

      (client as any).handleAlgoPrivateMessage(
        { arg: { channel: 'orders-algo', instType: 'SWAP' }, data: [{ ...OKX_RAW_ALGO_ORDER_STOP_MARKET, algoId: 'algo-evt' }] },
        handler,
      );

      expect(handler.onOrderUpdate).toHaveBeenCalledWith(expect.objectContaining({ orderId: 'algo-evt', isConditional: true }));
      expect((client as any).conditionalOrderRegistry.lookup('BTCUSDT', 'algo-evt')).toBe('conditional');
    });

    it('names the instrument of an event it cannot resolve, instead of losing it silently', async () => {
      const { client, logger } = await createLoadedClient();
      const handler = { onOrderUpdate: jest.fn(), onPositionUpdate: jest.fn() };
      await client.connectUserDataStream(handler);

      (client as any).handlePrivateMessage(
        {
          arg: { channel: 'orders', instType: 'SWAP' },
          data: [{ ...SWAP_ORDER_RAW, instId: 'FRESH-USDT-SWAP' }, SWAP_ORDER_RAW],
        },
        handler,
      );

      // Свежий листинг после последней загрузки инструментов: событие по нему до вызывающего не
      // дойдёт, и он обязан узнать ПО КАКОМУ инструменту, а не прочитать «handler failed».
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('FRESH-USDT-SWAP'));
      expect(logger.error).not.toHaveBeenCalled();
      expect(handler.onOrderUpdate).toHaveBeenCalledTimes(1);
    });

    it('names the instrument of a position event it cannot resolve', async () => {
      const { client, logger } = await createLoadedClient();
      const handler = { onOrderUpdate: jest.fn(), onPositionUpdate: jest.fn() };
      await client.connectUserDataStream(handler);

      (client as any).handlePrivateMessage(
        {
          arg: { channel: 'positions', instType: 'SWAP' },
          data: [{ ...OKX_RAW_POSITION_NET_LONG, instId: 'FRESH-USDT-SWAP' }],
        },
        handler,
      );

      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('FRESH-USDT-SWAP'));
      expect(handler.onPositionUpdate).not.toHaveBeenCalled();
    });

    it('names the instrument of a conditional order event it cannot resolve', async () => {
      const { client, logger } = await createLoadedClient();
      const handler = { onOrderUpdate: jest.fn(), onPositionUpdate: jest.fn() };
      await client.connectUserDataStream(handler);

      (client as any).handleAlgoPrivateMessage(
        {
          arg: { channel: 'orders-algo', instType: 'SWAP' },
          data: [{ ...OKX_RAW_ALGO_ORDER_STOP_MARKET, algoId: 'algo-fresh', instId: 'FRESH-USDT-SWAP' }],
        },
        handler,
      );

      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('FRESH-USDT-SWAP'));
      expect(handler.onOrderUpdate).not.toHaveBeenCalled();
    });

    it('logs a failing handler and keeps reporting the rest of the batch', async () => {
      const { client, logger } = await createLoadedClient();
      const handler = {
        onOrderUpdate: jest.fn().mockImplementationOnce(() => {
          throw new Error('handler blew up');
        }),
        onPositionUpdate: jest.fn(),
      };
      await client.connectUserDataStream(handler);

      (client as any).handlePrivateMessage(
        { arg: { channel: 'orders', instType: 'SWAP' }, data: [SWAP_ORDER_RAW, SWAP_ORDER_RAW] },
        handler,
      );

      expect(logger.error).toHaveBeenCalled();
      expect(handler.onOrderUpdate).toHaveBeenCalledTimes(2);
    });

    it('does not open a second pair of connections on a repeated call', async () => {
      const { client, logger } = await createLoadedClient();
      const handler = { onOrderUpdate: jest.fn(), onPositionUpdate: jest.fn() };
      await client.connectUserDataStream(handler);
      const firstPrivateStream = (client as any).privateStream;

      await client.connectUserDataStream(handler);

      expect((client as any).privateStream).toBe(firstPrivateStream);
      expect(logger.warn).toHaveBeenCalled();
    });

    it('reports connected only while both connections are up, and clears both on disconnect', async () => {
      const { client } = await createLoadedClient();
      const handler = { onOrderUpdate: jest.fn(), onPositionUpdate: jest.fn() };
      await client.connectUserDataStream(handler);

      const privateStream = (client as any).privateStream as Record<string, jest.Mock>;
      const algoPrivateStream = (client as any).algoPrivateStream as Record<string, jest.Mock>;

      privateStream.isConnected.mockReturnValue(true);
      algoPrivateStream.isConnected.mockReturnValue(false);

      expect(client.isUserDataStreamConnected()).toBe(false);

      algoPrivateStream.isConnected.mockReturnValue(true);

      expect(client.isUserDataStreamConnected()).toBe(true);

      client.disconnectUserDataStream();

      expect((client as any).privateStream).toBeNull();
      expect((client as any).algoPrivateStream).toBeNull();
    });
  });

  describe('batch limits of the exchange', () => {
    it('keeps the OKX batch limits at the numbers the exchange documents', () => {
      expect(OKX_ORDER_BATCH_CHUNK_SIZE).toBe(20);
      expect(OKX_ALGO_CANCEL_BATCH_CHUNK_SIZE).toBe(10);
    });

    it('splits a plain create batch into chunks of twenty', async () => {
      const { client, mockInstance } = await createLoadedClient();
      mockInstance.post.mockImplementation((_path: string, body: any) =>
        Promise.resolve(okxSuccess((body as unknown[]).map((_entry, index) => okxOrderResult(`created-${index}`)))));

      const resultList = await client.createBatchOrders(Array.from({ length: 21 }, () => ({
        symbol: 'BTCUSDT',
        type: OrderTypeEnum.Market,
        side: OrderSideEnum.Buy,
        amount: 0.05,
      })));

      expect(mockInstance.post.mock.calls.map((call: any[]) => (call[1] as unknown[]).length)).toEqual([20, 1]);
      expect(resultList).toHaveLength(21);
    });

    it('splits a plain cancel batch into chunks of twenty', async () => {
      const { client, mockInstance } = await createLoadedClient();
      mockInstance.post.mockImplementation((_path: string, body: any) =>
        Promise.resolve(okxSuccess((body as unknown[]).map((_entry, index) => okxOrderResult(`cancelled-${index}`)))));

      const orderIdList = Array.from({ length: 21 }, (_value, index) => `plain-${index}`);
      orderIdList.forEach((orderId) => (client as any).conditionalOrderRegistry.record('BTCUSDT', orderId, 'plain'));

      await client.cancelBatchOrders('BTCUSDT', orderIdList);

      expect(mockInstance.post.mock.calls.map((call: any[]) => (call[1] as unknown[]).length)).toEqual([20, 1]);
    });

    it('splits a conditional cancel batch into chunks of ten', async () => {
      const { client, mockInstance } = await createLoadedClient();
      mockInstance.post.mockImplementation((_path: string, body: any) =>
        Promise.resolve(okxSuccess((body as unknown[]).map((_entry, index) => okxOrderResult(`cancelled-${index}`)))));

      const orderIdList = Array.from({ length: 11 }, (_value, index) => `algo-${index}`);
      orderIdList.forEach((orderId) => (client as any).conditionalOrderRegistry.record('BTCUSDT', orderId, 'conditional'));

      await client.cancelBatchOrders('BTCUSDT', orderIdList);

      expect(mockInstance.post.mock.calls.map((call: any[]) => call[0])).toEqual([
        '/api/v5/trade/cancel-algos',
        '/api/v5/trade/cancel-algos',
      ]);
      expect(mockInstance.post.mock.calls.map((call: any[]) => (call[1] as unknown[]).length)).toEqual([10, 1]);
    });

    it('splits a plain amend batch into chunks of twenty', async () => {
      const { client, mockInstance } = await createLoadedClient();
      mockInstance.post.mockImplementation((_path: string, body: any) =>
        Promise.resolve(okxSuccess((body as unknown[]).map((_entry, index) => okxOrderResult(`amended-${index}`)))));

      await client.modifyBatchOrders(Array.from({ length: 21 }, (_value, index) => ({
        symbol: 'BTCUSDT',
        orderId: `plain-${index}`,
        side: OrderSideEnum.Buy,
        price: 51000,
      })));

      expect(mockInstance.post.mock.calls.map((call: any[]) => (call[1] as unknown[]).length)).toEqual([20, 1]);
    });
  });

  describe('cancelBatchOrders routing', () => {
    it('sends a known conditional id to the algo service and a plain one to the plain book', async () => {
      const { client, mockInstance } = await createLoadedClient();
      (client as any).conditionalOrderRegistry.record('BTCUSDT', 'algo-x', 'conditional');
      (client as any).conditionalOrderRegistry.record('BTCUSDT', 'plain-y', 'plain');
      mockInstance.post.mockImplementation((_path: string, body: any) =>
        Promise.resolve(okxSuccess((body as unknown[]).map(() => okxOrderResult('done')))));

      await client.cancelBatchOrders('BTCUSDT', ['plain-y', 'algo-x']);

      const bodyByPath = new Map<string, unknown>(
        mockInstance.post.mock.calls.map((call: any[]) => [call[0] as string, call[1]]),
      );

      expect(bodyByPath.get('/api/v5/trade/cancel-algos')).toEqual([{ algoId: 'algo-x', instId: 'BTC-USDT-SWAP' }]);
      expect(bodyByPath.get('/api/v5/trade/cancel-batch-orders')).toEqual([{ instId: 'BTC-USDT-SWAP', ordId: 'plain-y' }]);
    });

    it('does not retry a known plain id in the algo service when the plain book says it is gone', async () => {
      const { client, mockInstance } = await createLoadedClient();
      (client as any).conditionalOrderRegistry.record('BTCUSDT', 'plain-g', 'plain');
      mockInstance.post.mockResolvedValue(okxBatch('1', [okxOrderResult('', '51400', 'gone')]));

      const resultList = await client.cancelBatchOrders('BTCUSDT', ['plain-g']);

      expect(mockInstance.post.mock.calls.map((call: any[]) => call[0])).toEqual(['/api/v5/trade/cancel-batch-orders']);
      expect(resultList[0].isSuccess).toBe(false);
      expect(resultList[0].errorCode).toBe(51400);
    });
  });

  describe('client order id validation', () => {
    it('rejects an id longer than 32 characters', async () => {
      const { client } = await createLoadedClient();

      await expect(buildOrderParams(client, { type: OrderTypeEnum.Market, clientOrderId: 'a'.repeat(33) }))
        .rejects.toBeInstanceOf(ExchangeError);
    });
  });
});
