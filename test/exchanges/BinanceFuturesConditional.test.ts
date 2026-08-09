import axios from 'axios';
import { BinanceFutures } from '../../src/exchanges/BinanceFutures';
import { OrderSideEnum, OrderTypeEnum, TriggerByEnum } from '../../src/types/common';
import { createMockLogger } from '../fixtures/mockLogger';
import { createMockAxiosInstance } from '../fixtures/mockAxios';
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
      mockInstance.delete.mockResolvedValue({ data: { algoId: 3000000000003505, code: '200', msg: 'success' } });

      await client.cancelOrder('BTCUSDT', '3000000000003505');

      const deletedPathList = mockInstance.delete.mock.calls.map(([url]: [string]) => url);

      expect(deletedPathList).toContain('/fapi/v1/algoOrder');
      expect(deletedPathList).not.toContain('/fapi/v1/order');
    });

    it('keeps plain cancellation on the plain endpoint', async () => {
      const { client, mockInstance } = createFutures();
      routeGet(mockInstance, { '/fapi/v1/exchangeInfo': BINANCE_RAW_EXCHANGE_INFO });
      await client.loadTradeSymbols();
      mockInstance.delete.mockResolvedValue({ data: BINANCE_RAW_ORDER_RESPONSE });

      const order = await client.cancelOrder('BTCUSDT', '123456789');

      expect(order.id).toBe('123456789');
      expect(mockInstance.delete.mock.calls[0][0]).toBe('/fapi/v1/order');
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
