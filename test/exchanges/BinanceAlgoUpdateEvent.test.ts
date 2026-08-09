import axios from 'axios';
import { BinanceFutures } from '../../src/exchanges/BinanceFutures';
import { BinanceUserDataStream } from '../../src/ws/BinanceUserDataStream';
import type { OrderUpdateEvent } from '../../src/types/common';
import { OrderSideEnum } from '../../src/types/common';
import { createMockLogger } from '../fixtures/mockLogger';
import { createMockAxiosInstance } from '../fixtures/mockAxios';

jest.mock('axios');
jest.mock('../../src/ws/BinanceTradeStream');
jest.mock('../../src/ws/BinanceFuturesPublicStream');
jest.mock('../../src/ws/BinanceUserDataStream');

const mockedAxios = axios as jest.Mocked<typeof axios>;
const MockedUserDataStream = BinanceUserDataStream as jest.MockedClass<typeof BinanceUserDataStream>;

/** Полезная часть события ALGO_UPDATE — имена полей взяты из описания биржи. */
function buildAlgoEventBody(overrides: Record<string, unknown> = {}) {
  return {
    e: 'ALGO_UPDATE',
    T: 1750515742297,
    E: 1750515742303,
    o: {
      caid: 'rbr_abc1',
      aid: 3000002125564507,
      at: 'CONDITIONAL',
      o: 'STOP_MARKET',
      s: 'XAIUSDT',
      S: 'BUY',
      ps: 'SHORT',
      f: 'GTE_GTC',
      q: '377452',
      X: 'NEW',
      ai: '',
      ap: '0.00000',
      aq: '0.00000',
      tp: '0.009191',
      p: '0',
      wt: 'CONTRACT_PRICE',
      cp: true,
      pP: false,
      R: true,
      tt: 0,
      gtd: 0,
      rm: '',
      ...overrides,
    },
  };
}

async function captureOrderUpdate(eventBody: Record<string, unknown>): Promise<OrderUpdateEvent[]> {
  const mockInstance = createMockAxiosInstance();
  mockedAxios.create.mockReturnValue(mockInstance as any);
  mockInstance.post.mockResolvedValue({ data: { listenKey: 'lk' } });

  const client = new BinanceFutures({
    config: { apiKey: 'k', secret: 's', isDemoMode: false },
    logger: createMockLogger(),
  });

  const capturedList: OrderUpdateEvent[] = [];
  await client.connectUserDataStream({
    onOrderUpdate: (event) => capturedList.push(event),
    onPositionUpdate: () => undefined,
  });

  const onMessage = MockedUserDataStream.mock.calls[MockedUserDataStream.mock.calls.length - 1][0].onMessage;
  onMessage(eventBody as never);

  // Иначе таймер поддержания потока остаётся жить и прогон не завершается.
  client.disconnectUserDataStream();

  return capturedList;
}

describe('ALGO_UPDATE — the lifecycle of a conditional order', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Date, 'now').mockReturnValue(1700000000000);
  });

  it('reports the conditional order under its OWN id, not the triggered one', async () => {
    // Вызывающий помнит номер условной заявки — по нему он и узнаёт свой стоп.
    const [event] = await captureOrderUpdate(buildAlgoEventBody({ X: 'FINISHED', ai: '8389765001', aq: '377452', ap: '0.00921' }));

    expect(event.orderId).toBe('3000002125564507');
    expect(event.triggeredOrderId).toBe('8389765001');
    expect(event.isConditional).toBe(true);
  });

  it('carries the actual fill of a completed stop', async () => {
    const [event] = await captureOrderUpdate(buildAlgoEventBody({ X: 'FINISHED', ai: '8389765001', aq: '377452', ap: '0.00921' }));

    expect(event.status).toBe('closed');
    expect(event.filledAmount).toBe(377452);
    expect(event.avgPrice).toBeCloseTo(0.00921, 9);
  });

  it('keeps a fired but still filling order non-terminal', async () => {
    // Завершить сделку на этом состоянии — значит записать выход раньше, чем он случился.
    const [triggering] = await captureOrderUpdate(buildAlgoEventBody({ X: 'TRIGGERING' }));
    const [triggered] = await captureOrderUpdate(buildAlgoEventBody({ X: 'TRIGGERED' }));

    expect(triggering.status).toBe('open');
    expect(triggered.status).toBe('open');
  });

  it('surfaces the reason when the stop was refused AT trigger time', async () => {
    // Биржа проверяет маржу только в момент срабатывания: отказ здесь означает, что
    // позиция осталась без защиты, и об этом обязан узнать человек.
    const [event] = await captureOrderUpdate(
      buildAlgoEventBody({ X: 'REJECTED', rm: 'Margin is insufficient' }),
    );

    expect(event.status).toBe('rejected');
    expect(event.rejectReason).toBe('Margin is insufficient');
  });

  it('maps cancellation and system expiry alike', async () => {
    const [canceled] = await captureOrderUpdate(buildAlgoEventBody({ X: 'CANCELED' }));
    const [expired] = await captureOrderUpdate(buildAlgoEventBody({ X: 'EXPIRED' }));

    expect(canceled.status).toBe('canceled');
    expect(expired.status).toBe('canceled');
  });

  it('reads a fresh order without inventing a triggered order id', async () => {
    const [event] = await captureOrderUpdate(buildAlgoEventBody());

    expect(event.status).toBe('open');
    expect(event.triggeredOrderId).toBeUndefined();
    expect(event.filledAmount).toBe(0);
    expect(event.side).toBe(OrderSideEnum.Buy);
    expect(event.clientOrderId).toBe('rbr_abc1');
  });

  it('does not throw on an event without a body', async () => {
    await expect(captureOrderUpdate({ e: 'ALGO_UPDATE', T: 1, E: 1 })).resolves.toEqual([]);
  });

  it('leaves plain order updates byte-identical', async () => {
    const capturedList = await captureOrderUpdate({
      e: 'ORDER_TRADE_UPDATE',
      T: 1750515742297,
      o: { s: 'BTCUSDT', i: 123, c: 'plain1', S: 'SELL', X: 'FILLED', p: '100', ap: '101', q: '2', z: '2' },
    });

    expect(capturedList[0]).toEqual({
      symbol: 'BTCUSDT',
      orderId: '123',
      clientOrderId: 'plain1',
      side: OrderSideEnum.Sell,
      status: 'closed',
      price: 100,
      avgPrice: 101,
      amount: 2,
      filledAmount: 2,
      timestamp: 1750515742297,
    });
  });
});
