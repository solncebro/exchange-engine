import { OrderSideEnum, OrderTypeEnum, PositionModeEnum, PositionSideEnum, TimeInForceEnum } from '../../src/types/common';
import type { CreateOrderWebSocketArgs } from '../../src/types/exchange';
import { describeError } from '../live-support/liveError';
import { printNote } from '../live-support/liveOutput';
import { formatNumber, joinViolationSample } from './checkSupport';
import type { LiveCheck, LiveCheckContext, LiveCheckOutcome } from './liveCheck.types';
import { cancelOwnOrders } from './orderCleanup';

const TIMEOUT_MS = 180_000;
const RESTING_PRICE_RATIO = 0.5;
const NOTIONAL_SAFETY_RATIO = 1.2;
const RELATIVE_EPSILON = 1e-6;
const CANCELED_STATUS = 'canceled';

function resolveOrderAmount(context: LiveCheckContext, lastPrice: number): number {
  const client = context.exchange.futures;
  const symbol = context.settings.futuresSymbol;
  const restingPrice = client.priceToPrecision(symbol, lastPrice * RESTING_PRICE_RATIO);
  const minNotional = client.getMinNotional(symbol);
  const notionalAmount = minNotional > 0 && restingPrice > 0 ? (minNotional * NOTIONAL_SAFETY_RATIO) / restingPrice : 0;
  const requestedAmount = Math.max(client.getMinOrderQty(symbol), notionalAmount);
  const roundedAmount = client.amountToPrecision(symbol, requestedAmount);

  if (roundedAmount >= requestedAmount) {
    return roundedAmount;
  }

  const stepSize = Number(client.tradeSymbols.get(symbol)?.filter.stepSize ?? '0');

  return client.amountToPrecision(symbol, requestedAmount + (Number.isFinite(stepSize) ? stepSize : 0));
}

async function checkOrderRoundTrip(context: LiveCheckContext): Promise<LiveCheckOutcome> {
  // Bybit was skipped here with a hard-coded "the key answers 10010" — without asking the exchange.
  // On 17.09.2026 the same run read the Bybit demo balance and position mode with that key, so the
  // reason was stale; a real 10010 now surfaces as a failure with the exchange's own words.
  const client = context.exchange.futures;
  const symbol = context.settings.futuresSymbol;

  await client.loadTradeSymbols();

  const tickerBySymbol = await context.readFuturesTickers();
  const ticker = tickerBySymbol.get(symbol);

  if (ticker === undefined || ticker.lastPrice <= 0) {
    return { status: 'incomplete', fact: `${symbol}: нет последней цены — не от чего считать цену вдали от рынка` };
  }

  const restingPrice = client.priceToPrecision(symbol, ticker.lastPrice * RESTING_PRICE_RATIO);
  const amount = resolveOrderAmount(context, ticker.lastPrice);
  const clientOrderId = context.buildClientOrderId();
  const positionMode = await client.fetchPositionMode();
  const orderArgs: CreateOrderWebSocketArgs = {
    symbol,
    type: OrderTypeEnum.Limit,
    side: OrderSideEnum.Buy,
    amount,
    price: restingPrice,
    timeInForce: TimeInForceEnum.Gtc,
    clientOrderId,
  };

  if (positionMode === PositionModeEnum.Hedge) {
    orderArgs.positionSide = PositionSideEnum.Long;
  }

  try {
    const violationList: string[] = [];
    const placedOrder = await client.createOrderWebSocket(orderArgs);

    context.showEvidence('поставленная заявка', placedOrder);

    if (placedOrder.id === '') {
      return { status: 'diverged', fact: `${symbol}: биржа приняла заявку, но номера не вернула` };
    }

    const expectedAmount = client.amountToPrecision(symbol, amount);

    if (Math.abs(placedOrder.amount - expectedAmount) > expectedAmount * RELATIVE_EPSILON) {
      violationList.push(`объём заявки ${formatNumber(placedOrder.amount)} не совпал с посаженным на шаг ${formatNumber(expectedAmount)}`);
    }

    const readOrder = await client.getOrder(symbol, placedOrder.id);

    if (Math.abs(readOrder.price - restingPrice) > restingPrice * RELATIVE_EPSILON) {
      violationList.push(`цена прочитанной заявки ${formatNumber(readOrder.price)} не равна поставленной на тиковой сетке ${formatNumber(restingPrice)}`);
    }

    if (Math.abs(readOrder.amount - expectedAmount) > expectedAmount * RELATIVE_EPSILON) {
      violationList.push(`объём прочитанной заявки ${formatNumber(readOrder.amount)} не равен поставленному ${formatNumber(expectedAmount)}`);
    }

    const openOrderList = await client.fetchOpenOrders(symbol);

    if (!openOrderList.some((order) => order.id === placedOrder.id)) {
      violationList.push('поставленной заявки нет в списке открытых');
    }

    const cancelledOrder = await client.cancelOrder(symbol, placedOrder.id);

    if (cancelledOrder.status !== CANCELED_STATUS) {
      violationList.push(`после отмены статус '${cancelledOrder.status}', а не '${CANCELED_STATUS}'`);
    }

    const remainingList = await client.fetchOpenOrders(symbol);

    if (remainingList.some((order) => order.id === placedOrder.id)) {
      violationList.push('снятая заявка всё ещё числится открытой');
    }

    const summaryText =
      `${symbol}: объём ${formatNumber(expectedAmount)} монет по цене ${formatNumber(restingPrice)} (рынок ${formatNumber(ticker.lastPrice)}), ` +
      `номер ${placedOrder.id}, клиентский номер ${clientOrderId}, режим позиции '${String(positionMode)}'; ` +
      `заявка вернулась объёмом ${formatNumber(placedOrder.amount)}, прочитана ценой ${formatNumber(readOrder.price)}, ` +
      `после отмены статус '${cancelledOrder.status}', открытых с этим номером ${remainingList.filter((order) => order.id === placedOrder.id).length}`;

    if (violationList.length > 0) {
      return { status: 'diverged', fact: `${summaryText}; нарушений ${violationList.length}: ${joinViolationSample(violationList)}` };
    }

    return { status: 'confirmed', fact: summaryText };
  } finally {
    try {
      const cancelledCount = await cancelOwnOrders(client, symbol, context.settings.clientOrderIdPrefix);

      printNote(`уборка после обещания: снято своих заявок ${cancelledCount}; позиции не трогались`);
    } catch (error) {
      printNote(`уборка после обещания не удалась — проверьте счёт руками: ${describeError(error)}`);
    }
  }
}

export const orderRoundTripCheck: LiveCheck = {
  title: 'Оборот заявки (контракты): объём в монетах, цена на тиковой сетке, чтение, отмена',
  timeoutMs: TIMEOUT_MS,
  isCredentialsRequired: true,
  isOrdersRequired: true,
  run: checkOrderRoundTrip,
};
