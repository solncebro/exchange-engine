import type { OrderBookLevel } from '../../src/types/common';
import { formatNumber, joinViolationSample } from './checkSupport';
import type { LiveCheck, LiveCheckContext, LiveCheckOutcome } from './liveCheck.types';

const TIMEOUT_MS = 60_000;
const MAX_TOP_LEVEL_NOTIONAL = 50_000_000;

function collectSideViolations(levelList: OrderBookLevel[], sideLabel: string, isDescending: boolean): string[] {
  const violationList: string[] = [];

  if (levelList.length === 0) {
    violationList.push(`${sideLabel}: сторона пуста`);

    return violationList;
  }

  for (const [index, level] of levelList.entries()) {
    if (!Number.isFinite(level.price) || level.price <= 0) {
      violationList.push(`${sideLabel} ${index}: цена ${formatNumber(level.price)}`);
    }

    if (!Number.isFinite(level.quantity) || level.quantity <= 0) {
      violationList.push(`${sideLabel} ${index}: количество ${formatNumber(level.quantity)}`);
    }

    const previous = index === 0 ? null : levelList[index - 1];

    if (previous !== null) {
      const isOrdered = isDescending ? level.price < previous.price : level.price > previous.price;

      if (!isOrdered) {
        violationList.push(`${sideLabel} ${index}: цена ${formatNumber(level.price)} нарушает порядок после ${formatNumber(previous.price)}`);
      }
    }
  }

  return violationList;
}

async function checkOrderBookContract(context: LiveCheckContext): Promise<LiveCheckOutcome> {
  const client = context.exchange.futures;
  const symbol = context.settings.futuresSymbol;

  await client.loadTradeSymbols();

  const orderBook = await client.fetchOrderBook(symbol, context.settings.orderBookDepth);
  const violationList = [
    ...collectSideViolations(orderBook.bidList, 'покупка', true),
    ...collectSideViolations(orderBook.askList, 'продажа', false),
  ];

  if (orderBook.bidList.length === 0 || orderBook.askList.length === 0) {
    return { status: 'diverged', fact: `${symbol}: ${joinViolationSample(violationList)}` };
  }

  const topBid = orderBook.bidList[0];
  const topAsk = orderBook.askList[0];

  if (topBid.price >= topAsk.price) {
    violationList.push(`лучшая покупка ${formatNumber(topBid.price)} не ниже лучшей продажи ${formatNumber(topAsk.price)}`);
  }

  const topBidNotional = topBid.price * topBid.quantity;

  if (topBidNotional > MAX_TOP_LEVEL_NOTIONAL) {
    violationList.push(
      `верх стакана на покупку весит ${formatNumber(topBidNotional)} котируемой валюты — похоже, количество отдано в контрактах, а не в монетах`,
    );
  }

  const tickerBySymbol = await context.readFuturesTickers();
  const ticker = tickerBySymbol.get(symbol);
  const tradeSymbol = client.tradeSymbols.get(symbol);
  const tickerSizeText = ticker?.bid1Size === undefined ? 'биржа его не отдаёт' : formatNumber(ticker.bid1Size);
  const contractSizeText = tradeSymbol === undefined ? 'неизвестен' : formatNumber(tradeSymbol.contractSize);
  const summaryText =
    `${symbol}: уровней ${orderBook.bidList.length}/${orderBook.askList.length}, лучшая пара ` +
    `${formatNumber(topBid.price)} × ${formatNumber(topBid.quantity)} против ${formatNumber(topAsk.price)} × ${formatNumber(topAsk.quantity)}; ` +
    `верх стакана весит ${formatNumber(topBidNotional)} котируемой валюты при потолке ${MAX_TOP_LEVEL_NOTIONAL}; ` +
    `размер лучшей покупки в тикере — ${tickerSizeText}; размер контракта ${contractSizeText}, ` +
    `наименьший объём ${formatNumber(client.getMinOrderQty(symbol))}`;

  if (violationList.length > 0) {
    return { status: 'diverged', fact: `${summaryText}; нарушений ${violationList.length}: ${joinViolationSample(violationList)}` };
  }

  return { status: 'confirmed', fact: summaryText };
}

export const orderBookCheck: LiveCheck = {
  title: 'Стакан (контракты): стороны отсортированы, спред положителен, количества в монетах',
  timeoutMs: TIMEOUT_MS,
  isCredentialsRequired: false,
  isOrdersRequired: false,
  run: checkOrderBookContract,
};
