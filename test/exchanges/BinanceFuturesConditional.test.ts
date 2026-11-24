import axios from 'axios';
import { BinanceFutures } from '../../src/exchanges/BinanceFutures';
import { OrderSideEnum, OrderTypeEnum, TriggerByEnum } from '../../src/types/common';
import { createMockLogger } from '../fixtures/mockLogger';
import { createMockAxiosInstance } from '../fixtures/mockAxios';
import { BTCUSDT_TRADE_SYMBOL } from '../fixtures/mockTradeSymbol';
import {
  BINANCE_RAW_EXCHANGE_INFO,
  BINANCE_RAW_ORDER_RESPONSE,
  BINANCE_RAW_ALGO_ORDER_RESPONSE,
} from '../fixtures/binanceRaw';

jest.mock('axios');
jest.mock('../../src/ws/BinanceTradeStream');
jest.mock('../../src/ws/BinanceFuturesPublicStream');
jest.mock('../../src/ws/BinanceUserDataStream');

const mockedAxios = axios as jest.Mocked<typeof axios>;

function createFutures() {
  const mockInstance = createMockAxiosInstance();
  mockedAxios.create.mockReturnValue(mockInstance as any);

  const client = new BinanceFutures({
    config: { apiKey: 'testKey', secret: 'testSecret', isDemoMode: false },
    logger: createMockLogger(),
  });

  return { client, mockInstance };
}

/**
 * Отказ в том виде, в каком его отдаёт биржа: с ответом и кодом. Ошибка без ответа
 * считается сетевой и честно повторяется слоем связи — в тесте это выглядело бы зависанием.
 */
function buildMissingOrderError(): unknown {
  return {
    isAxiosError: true,
    message: 'Request failed with status code 400',
    response: { status: 400, data: { code: -2013, msg: 'Order does not exist.' } },
  };
}

/** Отвечает по адресу: так видно, в какую именно службу ушёл запрос. */
function routeGet(mockInstance: Record<string, jest.Mock>, byPath: Record<string, unknown>) {
  mockInstance.get.mockImplementation(async (url: string) => {
    if (url in byPath) {
      return { data: byPath[url] };
    }

    throw buildMissingOrderError();
  });
}

describe('BinanceFutures — conditional orders live in their own service', () => {
  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(1700000000000);
  });

  describe('getOrder', () => {
    it('reads a remembered conditional order from the algo service in a single request', async () => {
      const { client, mockInstance } = createFutures();
      routeGet(mockInstance, { '/fapi/v1/exchangeInfo': BINANCE_RAW_EXCHANGE_INFO });
      await client.loadTradeSymbols();

      mockInstance.post.mockResolvedValue({ data: BINANCE_RAW_ALGO_ORDER_RESPONSE });
      await client.createOrderWebSocket({
        symbol: 'BTCUSDT',
        type: OrderTypeEnum.StopMarket,
        side: OrderSideEnum.Sell,
        amount: 0.1,
        stopPrice: 60000,
      });

      routeGet(mockInstance, { '/fapi/v1/algoOrder': BINANCE_RAW_ALGO_ORDER_RESPONSE });
      mockInstance.get.mockClear();

      const order = await client.getOrder('BTCUSDT', '3000000000003505');

      expect(order.isConditional).toBe(true);
      // Происхождение известно — обычную книгу не трогаем вовсе.
      expect(mockInstance.get).toHaveBeenCalledTimes(1);
      expect(mockInstance.get.mock.calls[0][0]).toBe('/fapi/v1/algoOrder');
    });

    it('asks both services when the id is unknown, and remembers the answer', async () => {
      const { client, mockInstance } = createFutures();
      routeGet(mockInstance, {
        '/fapi/v1/exchangeInfo': BINANCE_RAW_EXCHANGE_INFO,
        '/fapi/v1/algoOrder': BINANCE_RAW_ALGO_ORDER_RESPONSE,
      });
      await client.loadTradeSymbols();
      mockInstance.get.mockClear();

      const order = await client.getOrder('BTCUSDT', '3000000000003505');

      expect(order.isConditional).toBe(true);
      expect(mockInstance.get).toHaveBeenCalledTimes(2);

      mockInstance.get.mockClear();
      await client.getOrder('BTCUSDT', '3000000000003505');

      expect(mockInstance.get).toHaveBeenCalledTimes(1);
    });

    it('refuses to guess when the same id answers from both services', async () => {
      const { client, mockInstance } = createFutures();
      routeGet(mockInstance, {
        '/fapi/v1/exchangeInfo': BINANCE_RAW_EXCHANGE_INFO,
        '/fapi/v1/order': BINANCE_RAW_ORDER_RESPONSE,
        '/fapi/v1/algoOrder': BINANCE_RAW_ALGO_ORDER_RESPONSE,
      });
      await client.loadTradeSymbols();

      // Вернуть чужую заявку хуже, чем не вернуть ничего: её цена ушла бы в журнал
      // как цена закрытия чужой сделки.
      await expect(client.getOrder('BTCUSDT', '123456789')).rejects.toThrow(/exists in both/);
    });

    it('takes the fill from the triggered order, never from the requested size', async () => {
      const { client, mockInstance } = createFutures();
      routeGet(mockInstance, { '/fapi/v1/exchangeInfo': BINANCE_RAW_EXCHANGE_INFO });
      await client.loadTradeSymbols();

      // Ставим заявку, чтобы происхождение было известно: иначе опрос обеих служб увидел бы
      // ответ и там, и там (обычный ответ нужен для дочитывания порождённой) и справедливо
      // сообщил бы о неоднозначности.
      mockInstance.post.mockResolvedValue({ data: BINANCE_RAW_ALGO_ORDER_RESPONSE });
      await client.createOrderWebSocket({
        symbol: 'BTCUSDT',
        type: OrderTypeEnum.StopMarket,
        side: OrderSideEnum.Sell,
        amount: 0.1,
        stopPrice: 60000,
      });

      routeGet(mockInstance, {
        '/fapi/v1/algoOrder': {
          ...BINANCE_RAW_ALGO_ORDER_RESPONSE,
          algoStatus: 'FINISHED',
          actualOrderId: '123456789',
        },
        '/fapi/v1/order': { ...BINANCE_RAW_ORDER_RESPONSE, executedQty: '0.05', avgPrice: '59900.00' },
      });

      const order = await client.getOrder('BTCUSDT', '3000000000003505');

      expect(order.filledAmount).toBe(0.05);
      expect(order.avgPrice).toBe(59900);
      expect(order.id).toBe('3000000000003505');
    });
  });

  describe('a freshly placed order is not visible immediately', () => {
    it('waits it out instead of reporting our own live stop as missing', async () => {
      // Замерено на живом счёте: через 0 и 300 мс биржа отвечает «заявки не существует»,
      // через 1000 мс — успех. Принять этот ответ за отсутствие значит выбросить номер
      // живого стопа и оставить его на бирже безнадзорным.
      const { client, mockInstance } = createFutures();
      routeGet(mockInstance, { '/fapi/v1/exchangeInfo': BINANCE_RAW_EXCHANGE_INFO });
      await client.loadTradeSymbols();

      mockInstance.post.mockResolvedValue({ data: BINANCE_RAW_ALGO_ORDER_RESPONSE });
      await client.createOrderWebSocket({
        symbol: 'BTCUSDT',
        type: OrderTypeEnum.StopMarket,
        side: OrderSideEnum.Sell,
        amount: 0.1,
        stopPrice: 60000,
      });

      let attemptCount = 0;
      mockInstance.get.mockImplementation(async (url: string) => {
        if (url !== '/fapi/v1/algoOrder') throw buildMissingOrderError();

        attemptCount += 1;

        if (attemptCount < 3) throw buildMissingOrderError();

        return { data: BINANCE_RAW_ALGO_ORDER_RESPONSE };
      });

      const order = await client.getOrder('BTCUSDT', '3000000000003505');

      expect(order.id).toBe('3000000000003505');
      expect(attemptCount).toBe(3);
    });

    it('still gives up on an order that is genuinely gone', async () => {
      const { client, mockInstance } = createFutures();
      routeGet(mockInstance, { '/fapi/v1/exchangeInfo': BINANCE_RAW_EXCHANGE_INFO });
      await client.loadTradeSymbols();
      routeGet(mockInstance, {});

      // Происхождение неизвестно — выдержка не применяется, ошибка отдаётся сразу.
      await expect(client.getOrder('BTCUSDT', '3000000000009999')).rejects.toThrow();
    });
  });

  describe('trigger price source', () => {
    it('derives the exchange field from the neutral intent, so the caller never names it', async () => {
      const { client, mockInstance } = createFutures();
      routeGet(mockInstance, { '/fapi/v1/exchangeInfo': BINANCE_RAW_EXCHANGE_INFO });
      await client.loadTradeSymbols();
      mockInstance.post.mockResolvedValue({ data: BINANCE_RAW_ALGO_ORDER_RESPONSE });

      await client.createOrderWebSocket({
        symbol: 'BTCUSDT',
        type: OrderTypeEnum.StopMarket,
        side: OrderSideEnum.Sell,
        amount: 0.1,
        stopPrice: 60000,
        triggerBy: TriggerByEnum.LastPrice,
      });

      expect(mockInstance.post.mock.calls[0][2].params.workingType).toBe('CONTRACT_PRICE');
    });

    it('honours an explicitly given trigger price type', async () => {
      const { client, mockInstance } = createFutures();
      routeGet(mockInstance, { '/fapi/v1/exchangeInfo': BINANCE_RAW_EXCHANGE_INFO });
      await client.loadTradeSymbols();
      mockInstance.post.mockResolvedValue({ data: BINANCE_RAW_ALGO_ORDER_RESPONSE });

      await client.createOrderWebSocket({
        symbol: 'BTCUSDT',
        type: OrderTypeEnum.StopMarket,
        side: OrderSideEnum.Sell,
        amount: 0.1,
        stopPrice: 60000,
        triggerBy: TriggerByEnum.MarkPrice,
      });

      expect(mockInstance.post.mock.calls[0][2].params.workingType).toBe('MARK_PRICE');
    });
  });

  describe('cancelOrder', () => {
    it('cancels a remembered conditional order in the algo service only', async () => {
      const { client, mockInstance } = createFutures();
      routeGet(mockInstance, { '/fapi/v1/exchangeInfo': BINANCE_RAW_EXCHANGE_INFO });
      await client.loadTradeSymbols();

      mockInstance.post.mockResolvedValue({ data: BINANCE_RAW_ALGO_ORDER_RESPONSE });
      await client.createOrderWebSocket({
        symbol: 'BTCUSDT',
        type: OrderTypeEnum.StopMarket,
        side: OrderSideEnum.Sell,
        amount: 0.1,
        stopPrice: 60000,
      });

      routeGet(mockInstance, { '/fapi/v1/algoOrder': BINANCE_RAW_ALGO_ORDER_RESPONSE });
      mockInstance.get.mockClear();
      // Живой ответ демо 23.11.2026: условная служба на отмену отвечает только «успехом».
      mockInstance.delete.mockResolvedValue({ data: { algoId: 3000000000003505, clientAlgoId: 'myAlgo123', code: '200', msg: 'success' } });

      const outcome = await client.cancelOrder('BTCUSDT', '3000000000003505');

      const deletedPathList = mockInstance.delete.mock.calls.map(([url]: [string]) => url);

      expect(deletedPathList).toContain('/fapi/v1/algoOrder');
      expect(deletedPathList).not.toContain('/fapi/v1/order');
      expect(outcome).toEqual({ orderId: '3000000000003505', isCancelled: true, filledAmount: null });
      // Исход — ответ на саму отмену: заявку после неё не перечитываем.
      expect(mockInstance.get).not.toHaveBeenCalled();
    });

    it('keeps plain cancellation on the plain endpoint and takes the fill from its answer', async () => {
      const { client, mockInstance } = createFutures();
      routeGet(mockInstance, { '/fapi/v1/exchangeInfo': BINANCE_RAW_EXCHANGE_INFO });
      await client.loadTradeSymbols();
      mockInstance.get.mockClear();
      // Живой ответ демо 23.11.2026 на отмену обычной закрывающей лимитки (DOGEUSDT).
      mockInstance.delete.mockResolvedValue({
        data: {
          orderId: 2395886953, symbol: 'DOGEUSDT', status: 'CANCELED', clientOrderId: 'lchkmwteo0nn5', price: '0.049990', origQty: '103',
          executedQty: '0', cumQty: '0', timeInForce: 'GTC', type: 'LIMIT', reduceOnly: true, closePosition: false, side: 'BUY',
          positionSide: 'BOTH', stopPrice: '0.000000', workingType: 'CONTRACT_PRICE', priceProtect: false, origType: 'LIMIT',
          priceMatch: 'NONE', selfTradePreventionMode: 'EXPIRE_MAKER', goodTillDate: 0, updateTime: 1795446829255,
        },
      });

      const outcome = await client.cancelOrder('DOGEUSDT', '2395886953');

      expect(outcome).toEqual({ orderId: '2395886953', isCancelled: true, filledAmount: 0 });
      expect(mockInstance.delete.mock.calls[0][0]).toBe('/fapi/v1/order');
      expect(mockInstance.get).not.toHaveBeenCalled();
    });

    it('reports the part filled before the cancel when the answer carries it', async () => {
      const { client, mockInstance } = createFutures();
      routeGet(mockInstance, { '/fapi/v1/exchangeInfo': BINANCE_RAW_EXCHANGE_INFO });
      await client.loadTradeSymbols();
      mockInstance.delete.mockResolvedValue({ data: { ...BINANCE_RAW_ORDER_RESPONSE, status: 'CANCELED', origQty: '0.100', executedQty: '0.040' } });

      const outcome = await client.cancelOrder('BTCUSDT', '123456789');

      expect(outcome.filledAmount).toBeCloseTo(0.04, 9);
    });

    it('says the fill is unknown rather than zero when the answer has no executed amount', async () => {
      const { client, mockInstance } = createFutures();
      routeGet(mockInstance, { '/fapi/v1/exchangeInfo': BINANCE_RAW_EXCHANGE_INFO });
      await client.loadTradeSymbols();
      const { executedQty: _executedQty, ...answerWithoutFill } = BINANCE_RAW_ORDER_RESPONSE;
      mockInstance.delete.mockResolvedValue({ data: { ...answerWithoutFill, status: 'CANCELED' } });

      const outcome = await client.cancelOrder('BTCUSDT', '123456789');

      expect(outcome.filledAmount).toBeNull();
    });

    it('cancels an unknown conditional id through the algo service after the plain book says -2011, without a read back', async () => {
      const { client, mockInstance } = createFutures();
      routeGet(mockInstance, { '/fapi/v1/exchangeInfo': BINANCE_RAW_EXCHANGE_INFO });
      await client.loadTradeSymbols();
      mockInstance.get.mockClear();
      mockInstance.delete.mockImplementation(async (url: string) => {
        if (url === '/fapi/v1/order') {
          throw new Error('[-2011] Unknown order sent.');
        }

        return { data: { algoId: 1000000299367053, clientAlgoId: 'lchkmwteo0nn3', code: '200', msg: 'success' } };
      });

      const outcome = await client.cancelOrder('DOGEUSDT', '1000000299367053');

      expect(outcome).toEqual({ orderId: '1000000299367053', isCancelled: true, filledAmount: null });
      expect(mockInstance.get).not.toHaveBeenCalled();
    });

    it('preserves the original "order is already gone" answer when neither service has it', async () => {
      const { client, mockInstance } = createFutures();
      routeGet(mockInstance, { '/fapi/v1/exchangeInfo': BINANCE_RAW_EXCHANGE_INFO });
      await client.loadTradeSymbols();

      // Вызывающий отличает успешную отмену от настоящей ошибки именно по этому ответу.
      mockInstance.delete.mockRejectedValue(new Error('[-2011] Unknown order sent.'));

      await expect(client.cancelOrder('BTCUSDT', '999')).rejects.toThrow('-2011');
    });
  });

  describe('placement answer: accepted amount and status', () => {
    const DOGEUSDT_TRADE_SYMBOL = {
      ...BTCUSDT_TRADE_SYMBOL,
      symbol: 'DOGEUSDT',
      baseAsset: 'DOGE',
      filter: { tickSize: '0.00001', stepSize: '1', minQty: '1', maxQty: '1000000', minNotional: '5' },
    };

    // Живые ответы демо 23.11.2026 (односторонний режим, позиция SHORT 103 DOGE).
    const CLOSING_LIMIT_CUT_ANSWER = {
      orderId: 2395886996, symbol: 'DOGEUSDT', status: 'NEW', clientOrderId: 'lchkmwteo0nn6', price: '0.049990', origQty: '103',
      executedQty: '0', cumQty: '0', timeInForce: 'GTC', type: 'LIMIT', reduceOnly: true, closePosition: false, side: 'BUY',
      positionSide: 'BOTH', stopPrice: '0.000000', workingType: 'CONTRACT_PRICE', priceProtect: false, origType: 'LIMIT',
      priceMatch: 'NONE', selfTradePreventionMode: 'EXPIRE_MAKER', goodTillDate: 0, updateTime: 1795446829615,
    };
    const STOP_TWICE_POSITION_ANSWER = {
      algoId: 1000000299367053, clientAlgoId: 'lchkmwteo0nn3', algoType: 'CONDITIONAL', orderType: 'STOP_MARKET', symbol: 'DOGEUSDT',
      side: 'BUY', positionSide: 'BOTH', timeInForce: 'GTC', quantity: '206', algoStatus: 'NEW', triggerPrice: '0.079410',
      price: '0.000000', icebergQuantity: null, selfTradePreventionMode: 'EXPIRE_MAKER', workingType: 'CONTRACT_PRICE',
      priceMatch: 'NONE', closePosition: false, priceProtect: false, reduceOnly: true, createTime: 1795446825064,
      updateTime: 1795446825065, triggerTime: 0, goodTillDate: 0,
    };

    it('shows the closing limit cut to the position right in the placement answer', async () => {
      const { client, mockInstance } = createFutures();
      client.tradeSymbols.set('DOGEUSDT', DOGEUSDT_TRADE_SYMBOL);
      mockInstance.post.mockResolvedValue({ data: CLOSING_LIMIT_CUT_ANSWER });

      const order = await client.createOrderWebSocket({
        symbol: 'DOGEUSDT', type: OrderTypeEnum.Limit, side: OrderSideEnum.Buy, amount: 206, price: 0.04999, reduceOnly: true,
      });

      expect(order.acceptedAmount).toBe(103);
      expect(order.acceptedStatus).toBe('open');
    });

    it('takes the accepted amount and status of a conditional stop from the algo answer — no cut there', async () => {
      const { client, mockInstance } = createFutures();
      client.tradeSymbols.set('DOGEUSDT', DOGEUSDT_TRADE_SYMBOL);
      mockInstance.post.mockResolvedValue({ data: STOP_TWICE_POSITION_ANSWER });

      const order = await client.createOrderWebSocket({
        symbol: 'DOGEUSDT', type: OrderTypeEnum.StopMarket, side: OrderSideEnum.Buy, amount: 206, stopPrice: 0.07941, reduceOnly: true,
      });

      expect(order.acceptedAmount).toBe(206);
      expect(order.acceptedStatus).toBe('open');
    });

    it('carries the accepted amount of every plain order of a batch', async () => {
      const { client, mockInstance } = createFutures();
      client.tradeSymbols.set('DOGEUSDT', DOGEUSDT_TRADE_SYMBOL);
      mockInstance.post.mockResolvedValue({ data: [CLOSING_LIMIT_CUT_ANSWER] });

      const [outcome] = await client.createBatchOrders([
        { symbol: 'DOGEUSDT', type: OrderTypeEnum.Limit, side: OrderSideEnum.Buy, amount: 206, price: 0.04999, reduceOnly: true },
      ]);

      expect(outcome.order?.acceptedAmount).toBe(103);
      expect(outcome.order?.acceptedStatus).toBe('open');
    });

    it('marks only placements: a read order has no accepted fields', async () => {
      const { client, mockInstance } = createFutures();
      client.tradeSymbols.set('DOGEUSDT', DOGEUSDT_TRADE_SYMBOL);
      routeGet(mockInstance, { '/fapi/v1/order': CLOSING_LIMIT_CUT_ANSWER });

      const order = await client.getOrder('DOGEUSDT', '2395886996');

      expect(order.acceptedAmount).toBeUndefined();
      expect(order.acceptedStatus).toBeUndefined();
    });
  });

  describe('fetchOpenConditionalOrders', () => {
    it('reads the algo listing, not the plain one', async () => {
      const { client, mockInstance } = createFutures();
      routeGet(mockInstance, {
        '/fapi/v1/exchangeInfo': BINANCE_RAW_EXCHANGE_INFO,
        '/fapi/v1/openAlgoOrders': [BINANCE_RAW_ALGO_ORDER_RESPONSE],
      });
      await client.loadTradeSymbols();
      mockInstance.get.mockClear();

      const orderList = await client.fetchOpenConditionalOrders('USDT');

      expect(orderList).toHaveLength(1);
      expect(orderList[0].stopPrice).toBe(60000);
      expect(mockInstance.get.mock.calls.map(([url]: [string]) => url)).toEqual(['/fapi/v1/openAlgoOrders']);
      expect(mockInstance.get.mock.calls[0][1].params.symbol).toBeUndefined();
    });

    it('asks the exchange for the one symbol when it is given', async () => {
      const { client, mockInstance } = createFutures();
      routeGet(mockInstance, {
        '/fapi/v1/exchangeInfo': BINANCE_RAW_EXCHANGE_INFO,
        '/fapi/v1/openAlgoOrders': [BINANCE_RAW_ALGO_ORDER_RESPONSE],
      });
      await client.loadTradeSymbols();
      mockInstance.get.mockClear();

      const orderList = await client.fetchOpenConditionalOrders('USDT', 'BTCUSDT');

      expect(orderList).toHaveLength(1);
      expect(mockInstance.get).toHaveBeenCalledTimes(1);
      expect(mockInstance.get.mock.calls[0][0]).toBe('/fapi/v1/openAlgoOrders');
      expect(mockInstance.get.mock.calls[0][1].params.symbol).toBe('BTCUSDT');
    });

    it('remembers where the listed orders came from, so a restart can cancel them', async () => {
      const { client, mockInstance } = createFutures();
      routeGet(mockInstance, {
        '/fapi/v1/exchangeInfo': BINANCE_RAW_EXCHANGE_INFO,
        '/fapi/v1/openAlgoOrders': [BINANCE_RAW_ALGO_ORDER_RESPONSE],
        '/fapi/v1/algoOrder': BINANCE_RAW_ALGO_ORDER_RESPONSE,
      });
      await client.loadTradeSymbols();
      await client.fetchOpenConditionalOrders('USDT');
      mockInstance.get.mockClear();

      await client.getOrder('BTCUSDT', '3000000000003505');

      expect(mockInstance.get).toHaveBeenCalledTimes(1);
    });
  });

  describe('cancelAllOrders', () => {
    it('clears both services, since the plain sweep does not see conditional orders', async () => {
      const { client, mockInstance } = createFutures();
      routeGet(mockInstance, { '/fapi/v1/exchangeInfo': BINANCE_RAW_EXCHANGE_INFO });
      await client.loadTradeSymbols();
      mockInstance.delete.mockResolvedValue({ data: {} });

      await client.cancelAllOrders('BTCUSDT');

      const deletedPathList = mockInstance.delete.mock.calls.map(([url]: [string]) => url);

      expect(deletedPathList).toContain('/fapi/v1/allOpenOrders');
      expect(deletedPathList).toContain('/fapi/v1/algoOpenOrders');
    });
  });

  describe('modifyOrder', () => {
    it('refuses to modify a conditional order instead of silently cancelling and re-placing', async () => {
      const { client, mockInstance } = createFutures();
      routeGet(mockInstance, { '/fapi/v1/exchangeInfo': BINANCE_RAW_EXCHANGE_INFO });
      await client.loadTradeSymbols();

      await expect(
        client.modifyOrder({ symbol: 'BTCUSDT', orderId: '3000000000003505', triggerPrice: 61000 }),
      ).rejects.toThrow(/cannot be modified/);
    });
  });

  describe('createBatchOrders', () => {
    it('places conditional orders one by one — the algo service has no batch endpoint', async () => {
      const { client, mockInstance } = createFutures();
      routeGet(mockInstance, { '/fapi/v1/exchangeInfo': BINANCE_RAW_EXCHANGE_INFO });
      await client.loadTradeSymbols();

      mockInstance.post.mockImplementation(async (url: string) => ({
        data: url === '/fapi/v1/algoOrder' ? BINANCE_RAW_ALGO_ORDER_RESPONSE : [BINANCE_RAW_ORDER_RESPONSE],
      }));

      await client.createBatchOrders([
        { symbol: 'BTCUSDT', type: OrderTypeEnum.StopMarket, side: OrderSideEnum.Sell, amount: 0.1, stopPrice: 60000 },
        { symbol: 'BTCUSDT', type: OrderTypeEnum.Limit, side: OrderSideEnum.Buy, amount: 0.1, price: 65000 },
      ]);

      const postedPathList = mockInstance.post.mock.calls.map(([url]: [string]) => url);

      expect(postedPathList).toContain('/fapi/v1/algoOrder');
      expect(postedPathList).toContain('/fapi/v1/batchOrders');
    });
  });
});
