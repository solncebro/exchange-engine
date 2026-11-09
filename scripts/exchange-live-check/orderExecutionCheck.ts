import { ExchangeNameEnum, OrderSideEnum } from '../../src/types/common';
import type { OrderExecutionSummary } from '../../src/types/common';
import { sleep } from '../../src/utils/sleep';
import { describeError } from '../live-support/liveError';
import { closeOwnPosition, openOwnMarketPosition, readFreshLastPrice, readOpenPositionList, resolveMinimalOrderAmount } from '../live-support/liveOrder';
import { printNote } from '../live-support/liveOutput';
import { describeLibraryRefusal, formatNumber, formatTimestamp, joinViolationSample } from './checkSupport';
import { checkExecutionSymbolIsFree } from './executionSymbolGuard';
import type { LiveCheck, LiveCheckContext, LiveCheckOutcome } from './liveCheck.types';
import type {
  AccountTradesReport,
  DescribeAccountTradesArgs,
  ReadExecutionSummaryArgs,
  VerifyExecutionSummaryArgs,
} from './orderExecutionCheck.types';

const TIMEOUT_MS = 180_000;
const WINDOW_LEAD_MS = 60_000;
const SUMMARY_POLL_INTERVAL_MS = 1_000;
const SUMMARY_POLL_ATTEMPT_COUNT = 15;
const RELATIVE_EPSILON = 1e-6;
const PRICE_DEVIATION_RATIO = 0.05;
const SUMMARY_SUPPORTED_EXCHANGE_LIST: ExchangeNameEnum[] = [ExchangeNameEnum.Binance, ExchangeNameEnum.Bybit];
const ACCOUNT_TRADES_SUPPORTED_EXCHANGE_LIST: ExchangeNameEnum[] = [ExchangeNameEnum.Binance];

function isAmountFilled(summary: OrderExecutionSummary, amount: number): boolean {
  return Math.abs(summary.filledAmount - amount) <= amount * RELATIVE_EPSILON;
}

async function readExecutionSummaryUntilFilled(args: ReadExecutionSummaryArgs): Promise<OrderExecutionSummary> {
  const { client, symbol, orderId, startTime, amount } = args;

  let summary = await client.fetchOrderExecutionSummary({ symbol, orderId, startTime, endTime: Date.now() });

  for (let attempt = 1; attempt < SUMMARY_POLL_ATTEMPT_COUNT && !isAmountFilled(summary, amount); attempt++) {
    await sleep(SUMMARY_POLL_INTERVAL_MS);
    summary = await client.fetchOrderExecutionSummary({ symbol, orderId, startTime, endTime: Date.now() });
  }

  return summary;
}

function formatFeeText(summary: OrderExecutionSummary): string {
  const feeEntryList = Object.entries(summary.feeAmountByAsset ?? {});

  if (feeEntryList.length === 0) {
    return 'комиссия не названа';
  }

  return `комиссия ${feeEntryList.map(([asset, feeAmount]) => `${formatNumber(feeAmount)} ${asset}`).join(', ')}`;
}

function verifyExecutionSummary(args: VerifyExecutionSummaryArgs): string[] {
  const { label, order, summary, amount, referencePrice, startTime } = args;
  const violationList: string[] = [];
  const executionList = summary.executionList ?? [];

  if (!isAmountFilled(summary, amount)) {
    violationList.push(`${label}: исполнено ${formatNumber(summary.filledAmount)}, а заявка была на ${formatNumber(amount)} монет`);
  }

  if (executionList.length === 0) {
    violationList.push(`${label}: список исполнений пуст`);
  }

  const foreignList = executionList.filter((execution) => execution.orderId !== order.id);

  if (foreignList.length > 0) {
    violationList.push(`${label}: исполнений чужих заявок ${foreignList.length} (${foreignList.map((execution) => execution.orderId).join(', ')})`);
  }

  const averagePrice = summary.averagePrice ?? Number.NaN;

  if (!Number.isFinite(averagePrice) || Math.abs(averagePrice - referencePrice) > referencePrice * PRICE_DEVIATION_RATIO) {
    violationList.push(`${label}: средняя цена ${formatNumber(averagePrice)} далека от рынка ${formatNumber(referencePrice)}`);
  }

  const lastFillTimeMs = summary.lastFillTimeMs ?? Number.NaN;

  if (!Number.isFinite(lastFillTimeMs) || lastFillTimeMs < startTime || lastFillTimeMs > Date.now()) {
    violationList.push(`${label}: время последнего исполнения ${formatTimestamp(lastFillTimeMs)} вне окна запроса`);
  }

  return violationList;
}

function describeSummary(label: string, orderId: string, summary: OrderExecutionSummary): string {
  return (
    `${label} №${orderId}: исполнений ${(summary.executionList ?? []).length}, исполнено ${formatNumber(summary.filledAmount)}, ` +
    `средняя ${formatNumber(summary.averagePrice ?? Number.NaN)}, ${formatFeeText(summary)}, ` +
    `последнее исполнение ${formatTimestamp(summary.lastFillTimeMs ?? Number.NaN)}`
  );
}

async function describeAccountTrades(args: DescribeAccountTradesArgs): Promise<AccountTradesReport> {
  const { exchangeName, client, symbol, startTime, executionIdList } = args;

  if (!ACCOUNT_TRADES_SUPPORTED_EXCHANGE_LIST.includes(exchangeName)) {
    try {
      await client.fetchAccountTrades(symbol, { startTime, endTime: Date.now() });
    } catch (error) {
      return { text: `сделки счёта библиотека у этой биржи не отдаёт: '${describeError(error)}'`, violationList: [] };
    }

    return { text: 'сделки счёта', violationList: ['матрица поддержки обещает отказ в сделках счёта, а метод ответил без исключения'] };
  }

  const accountTradeList = await client.fetchAccountTrades(symbol, { startTime, endTime: Date.now() });
  const accountTradeIdSet = new Set(accountTradeList.map((trade) => trade.id));
  const missingIdList = executionIdList.filter((executionId) => !accountTradeIdSet.has(executionId));
  const violationList = missingIdList.length === 0 ? [] : [`в сделках счёта нет исполнений ${missingIdList.join(', ')}`];

  return {
    text: `сделок счёта за окно ${accountTradeList.length}, из исполнений обеих заявок найдено ${executionIdList.length - missingIdList.length} из ${executionIdList.length}`,
    violationList,
  };
}

async function checkOrderExecutionSummary(context: LiveCheckContext, signal: AbortSignal): Promise<LiveCheckOutcome> {
  const client = context.exchange.futures;
  const symbol = context.settings.executionSymbol;
  const ledger = context.ownPositionLedger;

  if (!SUMMARY_SUPPORTED_EXCHANGE_LIST.includes(context.exchangeName)) {
    return describeLibraryRefusal(
      () => client.fetchOrderExecutionSummary({ symbol, orderId: '1', startTime: Date.now() - WINDOW_LEAD_MS, endTime: Date.now() }),
      'сводку исполнений заявки',
    );
  }

  await client.loadTradeSymbols();

  const occupiedOutcome = await checkExecutionSymbolIsFree(context);

  if (occupiedOutcome !== null) {
    return occupiedOutcome;
  }

  const positionMode = await client.fetchPositionMode();
  const referencePrice = await readFreshLastPrice(client, symbol);

  if (!(referencePrice > 0)) {
    return { status: 'incomplete', fact: `${symbol}: нет последней цены — не от чего считать наименьший объём` };
  }

  const amount = resolveMinimalOrderAmount({ client, symbol, notionalPrice: referencePrice });
  const startTime = Date.now() - WINDOW_LEAD_MS;

  try {
    signal.throwIfAborted();

    const opening = await openOwnMarketPosition({ client, ledger, side: OrderSideEnum.Buy, amount, positionMode, clientOrderId: context.buildClientOrderId() });

    signal.throwIfAborted();

    const closeReport = await closeOwnPosition({ client, ledger, buildClientOrderId: context.buildClientOrderId });
    const closeOrder = closeReport.closingOrderList[0];
    const violationList: string[] = [...closeReport.failureList];

    if (closeOrder === undefined) {
      violationList.push('закрывающая заявка своим объёмом не поставлена');

      return { status: 'diverged', fact: `${symbol}: открытие №${opening.order.id} на ${formatNumber(amount)} монет; нарушений ${violationList.length}: ${joinViolationSample(violationList)}` };
    }

    const openSummary = await readExecutionSummaryUntilFilled({ client, symbol, orderId: opening.order.id, startTime, amount });
    const closeSummary = await readExecutionSummaryUntilFilled({ client, symbol, orderId: closeOrder.id, startTime, amount });

    context.showEvidence('сводка исполнений открывающей заявки', openSummary);
    context.showEvidence('сводка исполнений закрывающей заявки', closeSummary);

    const executionIdList = [...(openSummary.executionList ?? []), ...(closeSummary.executionList ?? [])].map((execution) => execution.executionId);
    const accountTradesReport = await describeAccountTrades({ exchangeName: context.exchangeName, client, symbol, startTime, executionIdList });
    const remainingList = await readOpenPositionList(client, symbol);

    violationList.push(
      ...verifyExecutionSummary({ label: 'открытие', order: opening.order, summary: openSummary, amount, referencePrice, startTime }),
      ...verifyExecutionSummary({ label: 'закрытие', order: closeOrder, summary: closeSummary, amount, referencePrice, startTime }),
      ...accountTradesReport.violationList,
    );

    if (remainingList.length > 0 && !closeReport.hasOwnRemainder) {
      violationList.push(
        `свой объём закрыт, а на счёте позиция ${remainingList.map((position) => formatNumber(position.contracts)).join(', ')} монет — появилась чужая позиция, проба её не трогает`,
      );
    }

    const summaryText =
      `${symbol}: рыночные заявки на ${formatNumber(amount)} монет (рынок ${formatNumber(referencePrice)}, прочитан перед пробой), режим позиции '${String(positionMode)}'; ` +
      `${describeSummary('открытие', opening.order.id, openSummary)}; ${describeSummary('закрытие своим объёмом с признаком «только уменьшение»', closeOrder.id, closeSummary)}; ` +
      `${accountTradesReport.text}; своего объёма после закрытия: ${closeReport.remainingOwnText}; открытых позиций на счёте ${remainingList.length}`;

    if (violationList.length > 0) {
      return { status: 'diverged', fact: `${summaryText}; нарушений ${violationList.length}: ${joinViolationSample(violationList)}` };
    }

    return { status: 'confirmed', fact: summaryText };
  } finally {
    try {
      const closeReport = await closeOwnPosition({ client, ledger, buildClientOrderId: context.buildClientOrderId });

      printNote(`уборка после обещания: своим объёмом закрывающих заявок ${closeReport.closingOrderList.length}; в реестре: ${closeReport.remainingOwnText}`);

      for (const failureText of closeReport.failureList) {
        printNote(`уборка после обещания: ${failureText} — проверьте счёт руками`);
      }
    } catch (error) {
      printNote(`уборка после обещания не удалась — проверьте счёт руками: ${describeError(error)}`);
    }
  }
}

export const orderExecutionCheck: LiveCheck = {
  title: 'Сводка исполнений (контракты): рыночная заявка исполнена целиком, сводка и сделки счёта сходятся, позиция закрыта',
  timeoutMs: TIMEOUT_MS,
  isCredentialsRequired: true,
  isOrdersRequired: true,
  run: checkOrderExecutionSummary,
};
