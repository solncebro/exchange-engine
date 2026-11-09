import { OrderSideEnum, OrderTypeEnum, PositionModeEnum, PositionSideEnum } from '../../src/types/common';
import type { Order, Position } from '../../src/types/common';
import type { CreateOrderWebSocketArgs, ExchangeClient } from '../../src/types/exchange';
import { sleep } from '../../src/utils/sleep';
import { describeError } from './liveError';
import type {
  BuildMarketOrderArgs,
  CloseOwnPositionArgs,
  CloseOwnPositionReport,
  OpenOwnMarketPositionArgs,
  OwnMarketOpening,
  OwnPositionEntry,
  ReadOrderFilledAmountArgs,
  ResolveMinimalOrderAmountArgs,
} from './liveOrder.types';

const NOTIONAL_SAFETY_RATIO = 1.2;
const FILL_POLL_INTERVAL_MS = 500;
const FILL_POLL_ATTEMPT_COUNT = 10;
const OPEN_ORDER_STATUS = 'open';
const AMOUNT_EPSILON = 1e-12;

export function resolveMinimalOrderAmount(args: ResolveMinimalOrderAmountArgs): number {
  const { client, symbol, notionalPrice } = args;
  const minNotional = client.getMinNotional(symbol);
  const notionalAmount = minNotional > 0 && notionalPrice > 0 ? (minNotional * NOTIONAL_SAFETY_RATIO) / notionalPrice : 0;
  const requestedAmount = Math.max(client.getMinOrderQty(symbol), notionalAmount);

  return client.amountToPrecision(symbol, requestedAmount, 'up');
}

export async function readFreshLastPrice(client: ExchangeClient, symbol: string): Promise<number> {
  const tickerBySymbol = await client.fetchTickers();

  return tickerBySymbol.get(symbol)?.lastPrice ?? 0;
}

export function buildMarketOrderArgs(args: BuildMarketOrderArgs): CreateOrderWebSocketArgs {
  const { symbol, side, amount, clientOrderId, positionSide, isReducing } = args;
  const orderArgs: CreateOrderWebSocketArgs = { symbol, type: OrderTypeEnum.Market, side, amount, clientOrderId };

  if (positionSide !== PositionSideEnum.Both) {
    orderArgs.positionSide = positionSide;

    return orderArgs;
  }

  if (isReducing) {
    orderArgs.reduceOnly = true;
  }

  return orderArgs;
}

export async function readOpenPositionList(client: ExchangeClient, symbol: string): Promise<Position[]> {
  const positionList = await client.fetchPositionList(symbol);

  return positionList.filter((position) => position.symbol === symbol && position.contracts > 0);
}

function resolveOpeningPositionSide(positionMode: PositionModeEnum | undefined, side: OrderSideEnum): PositionSideEnum {
  if (positionMode !== PositionModeEnum.Hedge) {
    return PositionSideEnum.Both;
  }

  return side === OrderSideEnum.Buy ? PositionSideEnum.Long : PositionSideEnum.Short;
}

function resolveSignedAmount(positionSide: PositionSideEnum, side: OrderSideEnum, amount: number): number {
  if (positionSide !== PositionSideEnum.Both) {
    return amount;
  }

  return side === OrderSideEnum.Buy ? amount : -amount;
}

function resolveClosingSide(entry: OwnPositionEntry): OrderSideEnum {
  if (entry.positionSide === PositionSideEnum.Long) {
    return OrderSideEnum.Sell;
  }

  if (entry.positionSide === PositionSideEnum.Short) {
    return OrderSideEnum.Buy;
  }

  return entry.signedAmount > 0 ? OrderSideEnum.Sell : OrderSideEnum.Buy;
}

async function readOrderFilledAmount(args: ReadOrderFilledAmountArgs): Promise<number | null> {
  const { client, symbol, readOrder } = args;

  for (let attempt = 1; attempt <= FILL_POLL_ATTEMPT_COUNT; attempt++) {
    const order = await readOrder(client, symbol).catch(() => null);

    if (order !== null && order.status !== OPEN_ORDER_STATUS) {
      return order.filledAmount;
    }

    await sleep(FILL_POLL_INTERVAL_MS);
  }

  return null;
}

export class OwnPositionLedger {
  readonly symbol: string;
  private readonly amountByPositionSide = new Map<PositionSideEnum, number>();
  private exclusiveTail: Promise<void> = Promise.resolve();

  constructor(symbol: string) {
    this.symbol = symbol;
  }

  recordFill(positionSide: PositionSideEnum, signedAmount: number): void {
    const nextAmount = (this.amountByPositionSide.get(positionSide) ?? 0) + signedAmount;

    if (Math.abs(nextAmount) <= AMOUNT_EPSILON) {
      this.amountByPositionSide.delete(positionSide);

      return;
    }

    this.amountByPositionSide.set(positionSide, nextAmount);
  }

  readOpenEntryList(): OwnPositionEntry[] {
    return [...this.amountByPositionSide.entries()].map(([positionSide, signedAmount]) => ({ positionSide, signedAmount }));
  }

  describe(): string {
    const entryList = this.readOpenEntryList();

    if (entryList.length === 0) {
      return 'своего объёма нет';
    }

    return entryList.map((entry) => `${entry.positionSide} ${entry.signedAmount}`).join(', ');
  }

  runExclusive<T>(task: () => Promise<T>): Promise<T> {
    const result = this.exclusiveTail.then(task);

    this.exclusiveTail = result.then(
      () => undefined,
      () => undefined,
    );

    return result;
  }
}

export async function openOwnMarketPosition(args: OpenOwnMarketPositionArgs): Promise<OwnMarketOpening> {
  const { client, ledger, side, amount, positionMode, clientOrderId } = args;
  const { symbol } = ledger;
  const positionSide = resolveOpeningPositionSide(positionMode, side);
  const orderArgs = buildMarketOrderArgs({ symbol, side, amount, clientOrderId, positionSide, isReducing: false });

  let order: Order;

  try {
    order = await client.createOrderWebSocket(orderArgs);
  } catch (error) {
    const uncertainFilledAmount = await readOrderFilledAmount({
      client,
      symbol,
      readOrder: (orderClient, orderSymbol) => orderClient.getOrderByClientOrderId(orderSymbol, clientOrderId),
    });

    if (uncertainFilledAmount !== null && uncertainFilledAmount > 0) {
      ledger.recordFill(positionSide, resolveSignedAmount(positionSide, side, uncertainFilledAmount));
    }

    throw error;
  }

  ledger.recordFill(positionSide, resolveSignedAmount(positionSide, side, amount));

  const filledAmount = await readOrderFilledAmount({
    client,
    symbol,
    readOrder: (orderClient, orderSymbol) => orderClient.getOrder(orderSymbol, order.id),
  });

  if (filledAmount !== null && filledAmount !== amount) {
    ledger.recordFill(positionSide, resolveSignedAmount(positionSide, side, filledAmount - amount));
  }

  return { order, positionSide, filledAmount: filledAmount ?? amount, isFillConfirmed: filledAmount !== null };
}

export async function closeOwnPosition(args: CloseOwnPositionArgs): Promise<CloseOwnPositionReport> {
  const { client, ledger, buildClientOrderId } = args;
  const { symbol } = ledger;

  return ledger.runExclusive(async () => {
    const closingOrderList: Order[] = [];
    const failureList: string[] = [];

    for (const entry of ledger.readOpenEntryList()) {
      const side = resolveClosingSide(entry);
      const amount = client.amountToPrecision(symbol, Math.abs(entry.signedAmount));
      const orderArgs = buildMarketOrderArgs({ symbol, side, amount, clientOrderId: buildClientOrderId(), positionSide: entry.positionSide, isReducing: true });

      try {
        const order = await client.createOrderWebSocket(orderArgs);
        const filledAmount = await readOrderFilledAmount({
          client,
          symbol,
          readOrder: (orderClient, orderSymbol) => orderClient.getOrder(orderSymbol, order.id),
        });

        closingOrderList.push(order);

        if (filledAmount === null) {
          failureList.push(`закрывающая заявка ${order.id} на ${amount} монет принята, но исполнение не прочиталось — свой объём в реестре оставлен`);
          continue;
        }

        ledger.recordFill(entry.positionSide, -Math.sign(entry.signedAmount) * filledAmount);
      } catch (error) {
        failureList.push(`свой объём ${amount} монет (${entry.positionSide}) закрыть не удалось: ${describeError(error)}`);
      }
    }

    return { closingOrderList, failureList, remainingOwnText: ledger.describe(), hasOwnRemainder: ledger.readOpenEntryList().length > 0 };
  });
}
