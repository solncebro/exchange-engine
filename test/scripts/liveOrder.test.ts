import { closeOwnPosition, openOwnMarketPosition, OwnPositionLedger, resolveMinimalOrderAmount } from '../../scripts/live-support/liveOrder';
import { OrderSideEnum, PositionModeEnum, PositionSideEnum } from '../../src/types/common';
import type { Order } from '../../src/types/common';
import type { CreateOrderWebSocketArgs, ExchangeClient } from '../../src/types/exchange';
import * as sleepModule from '../../src/utils/sleep';

function makeOrder(id: string, filledAmount: number, status = 'closed'): Order {
  return { id, filledAmount, status } as Order;
}

function createClient() {
  let orderCounter = 0;
  const filledAmountByOrderId = new Map<string, number>();
  const client = {
    amountToPrecision: jest.fn((_symbol: string, amount: number) => Number(amount.toFixed(3))),
    getMinNotional: jest.fn(() => 20),
    getMinOrderQty: jest.fn(() => 0.001),
    createOrderWebSocket: jest.fn(async (args: CreateOrderWebSocketArgs) => {
      orderCounter += 1;
      filledAmountByOrderId.set(String(orderCounter), args.amount);

      return makeOrder(String(orderCounter), 0, 'open');
    }),
    getOrder: jest.fn(async (_symbol: string, orderId: string) => makeOrder(orderId, filledAmountByOrderId.get(orderId) ?? 0)),
    getOrderByClientOrderId: jest.fn(async () => makeOrder('lost', 0.01)),
  };

  return { client, exchangeClient: client as unknown as ExchangeClient };
}

describe('own position ledger of the live check', () => {
  beforeEach(() => {
    jest.spyOn(sleepModule, 'sleep').mockResolvedValue(undefined);
  });

  it('rounds the minimal amount up through the library instead of an own step copy', () => {
    const { client, exchangeClient } = createClient();

    resolveMinimalOrderAmount({ client: exchangeClient, symbol: 'ETHUSDT', notionalPrice: 2400 });

    expect(client.amountToPrecision).toHaveBeenCalledWith('ETHUSDT', 0.01, 'up');
  });

  it('closes only the own filled amount with reduce-only, never the amount of the whole position', async () => {
    const { client, exchangeClient } = createClient();
    const ledger = new OwnPositionLedger('ETHUSDT');

    await openOwnMarketPosition({ client: exchangeClient, ledger, side: OrderSideEnum.Buy, amount: 0.01, positionMode: PositionModeEnum.OneWay, clientOrderId: 'elc1' });

    const report = await closeOwnPosition({ client: exchangeClient, ledger, buildClientOrderId: () => 'elc2' });
    const closingArgs = client.createOrderWebSocket.mock.calls[1][0];

    expect(closingArgs).toMatchObject({ symbol: 'ETHUSDT', side: OrderSideEnum.Sell, amount: 0.01, reduceOnly: true });
    expect(closingArgs.positionSide).toBeUndefined();
    expect(report.hasOwnRemainder).toBe(false);
    expect(report.closingOrderList).toHaveLength(1);
  });

  it('closes a hedge long by its side without reduce-only', async () => {
    const { client, exchangeClient } = createClient();
    const ledger = new OwnPositionLedger('ETHUSDT');

    await openOwnMarketPosition({ client: exchangeClient, ledger, side: OrderSideEnum.Buy, amount: 0.02, positionMode: PositionModeEnum.Hedge, clientOrderId: 'elc1' });
    await closeOwnPosition({ client: exchangeClient, ledger, buildClientOrderId: () => 'elc2' });

    expect(client.createOrderWebSocket.mock.calls[0][0]).toMatchObject({ side: OrderSideEnum.Buy, positionSide: PositionSideEnum.Long });
    expect(client.createOrderWebSocket.mock.calls[1][0]).toMatchObject({ side: OrderSideEnum.Sell, amount: 0.02, positionSide: PositionSideEnum.Long });
    expect(client.createOrderWebSocket.mock.calls[1][0].reduceOnly).toBeUndefined();
    expect(ledger.readOpenEntryList()).toEqual([]);
  });

  it('records the confirmed fill, not the requested amount', async () => {
    const { client, exchangeClient } = createClient();
    const ledger = new OwnPositionLedger('ETHUSDT');
    client.getOrder.mockResolvedValueOnce(makeOrder('1', 0.004));

    const opening = await openOwnMarketPosition({ client: exchangeClient, ledger, side: OrderSideEnum.Buy, amount: 0.01, positionMode: PositionModeEnum.OneWay, clientOrderId: 'elc1' });

    expect(opening.filledAmount).toBe(0.004);
    expect(ledger.readOpenEntryList()).toEqual([{ positionSide: PositionSideEnum.Both, signedAmount: 0.004 }]);
  });

  it('keeps the own amount in the ledger when the closing order is refused', async () => {
    const { client, exchangeClient } = createClient();
    const ledger = new OwnPositionLedger('ETHUSDT');

    await openOwnMarketPosition({ client: exchangeClient, ledger, side: OrderSideEnum.Buy, amount: 0.01, positionMode: PositionModeEnum.OneWay, clientOrderId: 'elc1' });
    client.createOrderWebSocket.mockRejectedValueOnce(new Error('refused'));

    const report = await closeOwnPosition({ client: exchangeClient, ledger, buildClientOrderId: () => 'elc2' });

    expect(report.hasOwnRemainder).toBe(true);
    expect(report.failureList[0]).toContain('refused');
    expect(ledger.readOpenEntryList()).toEqual([{ positionSide: PositionSideEnum.Both, signedAmount: 0.01 }]);
  });

  it('records a fill of an order whose placement answer was lost', async () => {
    const { client, exchangeClient } = createClient();
    const ledger = new OwnPositionLedger('ETHUSDT');
    client.createOrderWebSocket.mockRejectedValueOnce(new Error('timeout'));

    await expect(openOwnMarketPosition({ client: exchangeClient, ledger, side: OrderSideEnum.Buy, amount: 0.01, positionMode: PositionModeEnum.OneWay, clientOrderId: 'elc1' }))
      .rejects.toThrow('timeout');
    expect(client.getOrderByClientOrderId).toHaveBeenCalledWith('ETHUSDT', 'elc1');
    expect(ledger.readOpenEntryList()).toEqual([{ positionSide: PositionSideEnum.Both, signedAmount: 0.01 }]);
  });

  it('serializes two concurrent closes so the own amount is closed once', async () => {
    const { client, exchangeClient } = createClient();
    const ledger = new OwnPositionLedger('ETHUSDT');

    await openOwnMarketPosition({ client: exchangeClient, ledger, side: OrderSideEnum.Buy, amount: 0.01, positionMode: PositionModeEnum.OneWay, clientOrderId: 'elc1' });
    await Promise.all([
      closeOwnPosition({ client: exchangeClient, ledger, buildClientOrderId: () => 'elc2' }),
      closeOwnPosition({ client: exchangeClient, ledger, buildClientOrderId: () => 'elc3' }),
    ]);

    expect(client.createOrderWebSocket).toHaveBeenCalledTimes(2);
  });
});
