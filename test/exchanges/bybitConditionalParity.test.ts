import axios from 'axios';
import { BybitLinear } from '../../src/exchanges/BybitLinear';
import { createMockLogger } from '../fixtures/mockLogger';
import { createMockAxiosInstance } from '../fixtures/mockAxios';
import { OrderSideEnum, OrderTypeEnum, PositionSideEnum, TriggerByEnum } from '../../src/types/common';

jest.mock('axios');
jest.mock('../../src/ws/BybitPublicStream');
jest.mock('../../src/ws/BybitTradeStream');

const mockedAxios = axios as jest.Mocked<typeof axios>;

function createBybitLinear(): BybitLinear {
  mockedAxios.create.mockReturnValue(createMockAxiosInstance() as any);

  return new BybitLinear({ config: { apiKey: 'k', secret: 's' }, logger: createMockLogger() });
}

function build(args: Record<string, unknown>): Record<string, unknown> {
  const client = createBybitLinear();

  return (client as unknown as { buildBybitOrderParams: (a: unknown) => Record<string, unknown> })
    .buildBybitOrderParams(args as never);
}

/**
 * ЭТАЛОН ПАРИТЕТА. До этой правки сторону подхода к уровню и признак «закрыть при
 * срабатывании» вычислял потребитель библиотеки; теперь их выводит сам слой Bybit.
 * Итоговый запрос к бирже обязан остаться прежним — таблица ниже снята с поведения ДО правки
 * и меняться не должна. Если хоть одна строка поедет, у боевого Bybit стоп сработает не тогда
 * или не сработает вовсе.
 */
const PARITY_CASE_LIST = [
  { name: 'хедж, стоп по лонгу',  type: OrderTypeEnum.StopMarket,       side: OrderSideEnum.Sell, positionSide: PositionSideEnum.Long,  triggerDirection: 2, positionIdx: 1 },
  { name: 'хедж, стоп по шорту',  type: OrderTypeEnum.StopMarket,       side: OrderSideEnum.Buy,  positionSide: PositionSideEnum.Short, triggerDirection: 1, positionIdx: 2 },
  { name: 'хедж, тейк по лонгу',  type: OrderTypeEnum.TakeProfitMarket, side: OrderSideEnum.Sell, positionSide: PositionSideEnum.Long,  triggerDirection: 1, positionIdx: 1 },
  { name: 'хедж, тейк по шорту',  type: OrderTypeEnum.TakeProfitMarket, side: OrderSideEnum.Buy,  positionSide: PositionSideEnum.Short, triggerDirection: 2, positionIdx: 2 },
  { name: 'односторонний, стоп по лонгу', type: OrderTypeEnum.StopMarket,       side: OrderSideEnum.Sell, positionSide: undefined, triggerDirection: 2, positionIdx: undefined },
  { name: 'односторонний, стоп по шорту', type: OrderTypeEnum.StopMarket,       side: OrderSideEnum.Buy,  positionSide: undefined, triggerDirection: 1, positionIdx: undefined },
  { name: 'односторонний, тейк по лонгу', type: OrderTypeEnum.TakeProfitMarket, side: OrderSideEnum.Sell, positionSide: undefined, triggerDirection: 1, positionIdx: undefined },
  { name: 'односторонний, тейк по шорту', type: OrderTypeEnum.TakeProfitMarket, side: OrderSideEnum.Buy,  positionSide: undefined, triggerDirection: 2, positionIdx: undefined },
];

describe('Bybit conditional orders — wire parity after the abstraction move', () => {
  PARITY_CASE_LIST.forEach((testCase) => {
    it(`${testCase.name}: сторона подхода ${testCase.triggerDirection}, закрытие при срабатывании`, () => {
      const params = build({
        symbol: 'BTCUSDT',
        type: testCase.type,
        side: testCase.side,
        amount: 1,
        price: 0,
        stopPrice: 100,
        reduceOnly: true,
        triggerBy: TriggerByEnum.MarkPrice,
        ...(testCase.positionSide === undefined ? {} : { positionSide: testCase.positionSide }),
      });

      expect(params.triggerDirection).toBe(testCase.triggerDirection);
      expect(params.closeOnTrigger).toBe(true);
      expect(params.reduceOnly).toBe(true);
      expect(params.triggerBy).toBe(TriggerByEnum.MarkPrice);
      expect(params.triggerPrice).toBe('100');
      expect(params.orderType).toBe('Market');
      expect(params.side).toBe(testCase.side === OrderSideEnum.Buy ? 'Buy' : 'Sell');
      expect(params.positionIdx).toBe(testCase.positionIdx);
    });
  });

  it('an explicitly given trigger direction still wins over the derived one', () => {
    const params = build({
      symbol: 'BTCUSDT',
      type: OrderTypeEnum.StopMarket,
      side: OrderSideEnum.Sell,
      amount: 1,
      price: 0,
      stopPrice: 100,
      reduceOnly: true,
      triggerDirection: 1,
    });

    expect(params.triggerDirection).toBe(1);
  });

  it('does not mark a plain order as close-on-trigger', () => {
    const params = build({
      symbol: 'BTCUSDT',
      type: OrderTypeEnum.Limit,
      side: OrderSideEnum.Sell,
      amount: 1,
      price: 100,
      reduceOnly: true,
    });

    expect(params.closeOnTrigger).toBeUndefined();
    expect(params.triggerDirection).toBeUndefined();
  });

  it('does not mark a position-opening conditional order as close-on-trigger', () => {
    // «Закрыть при срабатывании» относится только к защитным заявкам, которые уменьшают
    // позицию. Условная заявка на ОТКРЫТИЕ такого признака получить не должна.
    const params = build({
      symbol: 'BTCUSDT',
      type: OrderTypeEnum.StopMarket,
      side: OrderSideEnum.Sell,
      amount: 1,
      price: 0,
      stopPrice: 100,
    });

    expect(params.closeOnTrigger).toBeUndefined();
    expect(params.triggerDirection).toBe(2);
  });
});
