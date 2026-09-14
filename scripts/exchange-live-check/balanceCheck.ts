import type { AccountBalances } from '../../src/types/common';
import { formatNumber, joinViolationSample } from './checkSupport';
import type { LiveCheck, LiveCheckContext, LiveCheckOutcome } from './liveCheck.types';

const TIMEOUT_MS = 60_000;
const SUM_TOLERANCE_RATIO = 0.01;
const COIN_EPSILON = 1e-8;
const KNOWN_SOURCE_LIST: readonly string[] = ['exchange', 'derived', 'unknown'];

/**
 * Долларовая оценка монеты объявлена НЕОБЯЗАТЕЛЬНОЙ (`Balance.usdValue?`), и фьючерсный ответ
 * Binance её не несёт ни по одной монете — взять её там неоткуда. Требовать её у такой биржи
 * значит красить обещание красным за то, что на ней невыполнимо в принципе. Поэтому «нет ни у
 * одной ненулевой монеты» — это «не применимо», а «есть у части монет» остаётся расхождением:
 * свод по монетам собирается либо целиком, либо никак.
 */
function isUsdValueUnavailable(balances: AccountBalances): boolean {
  const nonZeroList = [...balances.balanceByAsset.values()].filter((balance) => balance.total !== 0);

  return nonZeroList.length > 0 && nonZeroList.every((balance) => balance.usdValue === undefined);
}

function collectCoinViolations(balances: AccountBalances, hasUsdValue: boolean): string[] {
  const violationList: string[] = [];

  for (const [asset, balance] of balances.balanceByAsset) {
    if (balance.free > balance.total + COIN_EPSILON) {
      violationList.push(`${asset}: свободных ${formatNumber(balance.free)} больше капитала монеты ${formatNumber(balance.total)}`);
    }

    if (hasUsdValue && balance.total !== 0 && balance.usdValue === undefined) {
      violationList.push(`${asset}: остаток ${formatNumber(balance.total)} без долларовой оценки — свод по счёту не собрать`);
    }
  }

  return violationList;
}

async function checkBalanceContract(context: LiveCheckContext): Promise<LiveCheckOutcome> {
  const balances = await context.exchange.futures.fetchBalances();
  const isUsdValueMissingEverywhere = isUsdValueUnavailable(balances);
  const violationList = collectCoinViolations(balances, !isUsdValueMissingEverywhere);
  const capital = balances.totalMarginBalance ?? balances.totalWalletBalance;
  const capitalLabel = balances.totalMarginBalance === undefined ? 'кошелёк' : 'капитал';

  if (balances.totalAvailableBalance > capital + COIN_EPSILON) {
    violationList.push(`свободных ${formatNumber(balances.totalAvailableBalance)} больше, чем ${capitalLabel} ${formatNumber(capital)}`);
  }

  if (balances.availableBalanceSource === undefined || !KNOWN_SOURCE_LIST.includes(balances.availableBalanceSource)) {
    violationList.push(`источник свободных средств не назван: '${String(balances.availableBalanceSource)}'`);
  }

  const valuedList = [...balances.balanceByAsset.values()].filter((balance) => balance.usdValue !== undefined);
  const usdSum = valuedList.reduce((accumulator, balance) => accumulator + (balance.usdValue ?? 0), 0);
  // Долларовая оценка монеты у Bybit — её капитал (с нереализованным итогом открытой позиции),
  // поэтому сумму оценок можно сверять только с КАПИТАЛОМ счёта. Когда биржа капитал не отдаёт
  // (демо-счёт Bybit без сводных полей), сверять сумму с кошельком — сравнивать величины разного
  // смысла: при открытой позиции они законно расходятся ровно на её плавающий итог.
  const isSumComparable =
    valuedList.length === balances.balanceByAsset.size && balances.totalMarginBalance !== undefined && capital > 0;

  if (isSumComparable && Math.abs(usdSum - capital) > capital * SUM_TOLERANCE_RATIO) {
    violationList.push(`сумма долларовых оценок ${formatNumber(usdSum)} расходится с ${capitalLabel} ${formatNumber(capital)} больше чем на ${SUM_TOLERANCE_RATIO * 100} %`);
  }

  const summaryText =
    `монет ${balances.balanceByAsset.size}, кошелёк ${formatNumber(balances.totalWalletBalance)}, свободных ` +
    `${formatNumber(balances.totalAvailableBalance)} (источник '${String(balances.availableBalanceSource)}'), ` +
    `капитал ${balances.totalMarginBalance === undefined ? 'биржа его не отдаёт' : formatNumber(balances.totalMarginBalance)}, ` +
    `начальная маржа ${balances.totalInitialMargin === undefined ? 'не отдана' : formatNumber(balances.totalInitialMargin)}; ` +
    `с долларовой оценкой ${valuedList.length} монет, их сумма ${formatNumber(usdSum)}` +
    (balances.totalMarginBalance === undefined ? ' (с кошельком не сверяется: оценка несёт плавающий итог позиций)' : '');

  if (violationList.length > 0) {
    return { status: 'diverged', fact: `${summaryText}; нарушений ${violationList.length}: ${joinViolationSample(violationList)}` };
  }

  if (isUsdValueMissingEverywhere) {
    return {
      status: 'notApplicable',
      fact: `${summaryText}; долларовой оценки монеты биржа не отдаёт ни по одной ненулевой монете — свод по монетам на ней не проверить, остальные условия обещания выполнены`,
    };
  }

  return { status: 'confirmed', fact: summaryText };
}

export const balanceCheck: LiveCheck = {
  title: 'Баланс: свободных не больше капитала, источник назван, свод сходится с суммой по монетам',
  timeoutMs: TIMEOUT_MS,
  isCredentialsRequired: true,
  isOrdersRequired: false,
  run: checkBalanceContract,
};
