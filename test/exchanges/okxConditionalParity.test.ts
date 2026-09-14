import axios from 'axios';
import { OkxSwap } from '../../src/exchanges/OkxSwap';
import { createMockLogger } from '../fixtures/mockLogger';
import { createMockAxiosInstance } from '../fixtures/mockAxios';
import { OKX_RAW_INSTRUMENT_SWAP } from '../fixtures/okxRaw';
import { OrderSideEnum, OrderTypeEnum, PositionSideEnum, TriggerByEnum } from '../../src/types/common';

jest.mock('axios');
jest.mock('../../src/ws/OkxPublicStream');
jest.mock('../../src/ws/OkxTradeStream');
jest.mock('../../src/ws/OkxPrivateStream');

const mockedAxios = axios as jest.Mocked<typeof axios>;

function okxSuccess<T>(dataList: T[]): { data: { code: string; msg: string; data: T[] } } {
  return { data: { code: '0', msg: '', data: dataList } };
}

async function buildAlgoParams(args: Record<string, unknown>, posMode = 'long_short_mode'): Promise<Record<string, unknown>> {
  const mockInstance = createMockAxiosInstance();
  mockedAxios.create.mockReturnValue(mockInstance as any);

  const client = new OkxSwap({ config: { apiKey: 'k', secret: 's', passphrase: 'p' }, logger: createMockLogger() });

  mockInstance.get.mockResolvedValueOnce(okxSuccess([OKX_RAW_INSTRUMENT_SWAP]));
  await client.loadTradeSymbols();

  mockInstance.get.mockResolvedValue(okxSuccess([{ uid: '1', acctLv: '2', posMode }]));

  return (client as unknown as { buildOkxAlgoOrderParams: (a: unknown) => Promise<Record<string, unknown>> })
    .buildOkxAlgoOrderParams(args as never);
}

/**
 * ЭТАЛОН ПАРИТЕТА. OKX не принимает сторону подхода к уровню отдельным полем — направление
 * срабатывания биржа выводит сама из того, какая нога заполнена (`sl*` или `tp*`) и с какой
 * стороны стоит заявка. Таблица закрепляет ровно это соответствие: если хоть одна строка
 * поедет, защита на боевом счёте сработает не тогда или не сработает вовсе.
 */
const PARITY_CASE_LIST = [
  { name: 'хедж, стоп по лонгу', type: OrderTypeEnum.StopMarket, side: OrderSideEnum.Sell, positionSide: PositionSideEnum.Long, triggerField: 'slTriggerPx', priceField: 'slOrdPx', posSide: 'long' },
  { name: 'хедж, стоп по шорту', type: OrderTypeEnum.StopMarket, side: OrderSideEnum.Buy, positionSide: PositionSideEnum.Short, triggerField: 'slTriggerPx', priceField: 'slOrdPx', posSide: 'short' },
  { name: 'хедж, тейк по лонгу', type: OrderTypeEnum.TakeProfitMarket, side: OrderSideEnum.Sell, positionSide: PositionSideEnum.Long, triggerField: 'tpTriggerPx', priceField: 'tpOrdPx', posSide: 'long' },
  { name: 'хедж, тейк по шорту', type: OrderTypeEnum.TakeProfitMarket, side: OrderSideEnum.Buy, positionSide: PositionSideEnum.Short, triggerField: 'tpTriggerPx', priceField: 'tpOrdPx', posSide: 'short' },
];

describe('OKX conditional orders — wire parity', () => {
  PARITY_CASE_LIST.forEach((testCase) => {
    it(`${testCase.name}: срабатывание записано в ${testCase.triggerField}, сторона позиции ${testCase.posSide}`, async () => {
      const params = await buildAlgoParams({
        symbol: 'BTCUSDT',
        type: testCase.type,
        side: testCase.side,
        amount: 0.05,
        price: 0,
        stopPrice: 60000,
        reduceOnly: true,
        triggerBy: TriggerByEnum.MarkPrice,
        positionSide: testCase.positionSide,
      });

      expect(params.ordType).toBe('conditional');
      expect(params[testCase.triggerField]).toBe('60000');
      expect(params[testCase.priceField]).toBe('-1');
      expect(params.posSide).toBe(testCase.posSide);
      expect(params.side).toBe(testCase.side === OrderSideEnum.Buy ? 'buy' : 'sell');
      expect(params.sz).toBe('5');
      expect(params.reduceOnly).toBeUndefined();
    });
  });

  it('одностороннний режим: сторона позиции не отправляется, «только уменьшение» отправляется', async () => {
    const params = await buildAlgoParams(
      {
        symbol: 'BTCUSDT',
        type: OrderTypeEnum.StopMarket,
        side: OrderSideEnum.Sell,
        amount: 0.05,
        stopPrice: 60000,
        reduceOnly: true,
      },
      'net_mode',
    );

    expect(params.posSide).toBeUndefined();
    expect(params.reduceOnly).toBe(true);
  });

  it('лимитная защитная заявка несёт свою цену исполнения вместо рыночного «-1»', async () => {
    const params = await buildAlgoParams(
      {
        symbol: 'BTCUSDT',
        type: OrderTypeEnum.StopLimit,
        side: OrderSideEnum.Sell,
        amount: 0.05,
        price: 59900,
        stopPrice: 60000,
      },
      'net_mode',
    );

    expect(params.slTriggerPx).toBe('60000');
    expect(params.slOrdPx).toBe('59900');
  });

  it('сторона подхода к уровню из аргументов на провод не уходит — её выводит сама биржа', async () => {
    const params = await buildAlgoParams(
      {
        symbol: 'BTCUSDT',
        type: OrderTypeEnum.StopMarket,
        side: OrderSideEnum.Sell,
        amount: 0.05,
        stopPrice: 60000,
        triggerDirection: 1,
      },
      'net_mode',
    );

    expect(params.triggerDirection).toBeUndefined();
  });
});
