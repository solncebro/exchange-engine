import { normalizeBybitBalances } from '../../src/normalizers/bybitNormalizer';
import { normalizeBinanceFuturesBalances } from '../../src/normalizers/binanceNormalizer';
import { normalizeOkxBalances } from '../../src/normalizers/okxNormalizer';
import { AccountBalances } from '../../src/types/common';
import { BYBIT_RAW_WALLET_BALANCE, BYBIT_RAW_WALLET_BALANCE_NO_TOTALS } from '../fixtures/bybitRaw';
import { BINANCE_RAW_FUTURES_ACCOUNT, BINANCE_RAW_FUTURES_ACCOUNT_WITH_POSITION } from '../fixtures/binanceRaw';
import {
  OKX_RAW_BALANCE,
  OKX_RAW_BALANCE_FLOATING_PROFIT,
  OKX_RAW_BALANCE_FUTURES_MODE,
  OKX_RAW_BALANCE_ISOLATED_POSITION,
  OKX_RAW_BALANCE_PENDING_ORDER,
  OKX_RAW_BALANCE_SPOT_MODE,
} from '../fixtures/okxRaw';

/**
 * Инвариант счёта, общий для всех бирж. Он держит ровно тот дефект, который 29.08.2026 показал на
 * экране «занято −1$»: свободных средств оказалось больше, чем есть на счёте, потому что остатки
 * разных монет сложили как одно число. Такое расхождение потребитель превращает в отрицательное
 * «занято» — величину, которой не существует.
 *
 * Сверять свободные надо с КАПИТАЛОМ счёта (`totalMarginBalance`), а не с кошельком: кошелёк во
 * всей библиотеке — остаток БЕЗ плавающего итога, а свободные средства биржа считает от капитала,
 * куда плавающая прибыль входит. Позиция в плюсе законно даёт свободных больше, чем в кошельке
 * (заготовка `OKX_RAW_BALANCE_FLOATING_PROFIT`), и подгонять под кошелёк число, названное самой
 * биржей, недопустимо. Там, где кошелёк и есть капитал (Bybit), сравнение от этого не слабеет:
 * `totalMarginBalance` там равен кошельку.
 */
function resolveAccountEquity(balances: AccountBalances): number {
  return balances.totalMarginBalance ?? balances.totalWalletBalance;
}

const CASE_LIST: Array<{ name: string; balances: AccountBalances }> = [
  { name: 'bybit, сводные поля пришли', balances: normalizeBybitBalances(BYBIT_RAW_WALLET_BALANCE) },
  { name: 'bybit, сводные поля пустые', balances: normalizeBybitBalances(BYBIT_RAW_WALLET_BALANCE_NO_TOTALS) },
  { name: 'binance, счёт без позиции', balances: normalizeBinanceFuturesBalances(BINANCE_RAW_FUTURES_ACCOUNT) },
  { name: 'binance, счёт с позицией', balances: normalizeBinanceFuturesBalances(BINANCE_RAW_FUTURES_ACCOUNT_WITH_POSITION) },
  { name: 'okx, режим 3 (availEq пришло)', balances: normalizeOkxBalances(OKX_RAW_BALANCE) },
  { name: 'okx, Futures mode (только курс монеты)', balances: normalizeOkxBalances(OKX_RAW_BALANCE_FUTURES_MODE) },
  { name: 'okx, Spot mode (плавать нечему)', balances: normalizeOkxBalances(OKX_RAW_BALANCE_SPOT_MODE) },
  { name: 'okx, изолированная позиция', balances: normalizeOkxBalances(OKX_RAW_BALANCE_ISOLATED_POSITION) },
  { name: 'okx, плавающая прибыль (availEq выше кошелька)', balances: normalizeOkxBalances(OKX_RAW_BALANCE_FLOATING_PROFIT) },
  { name: 'okx, висящая заявка (её маржа лежит и в imr, и в ordFrozen)', balances: normalizeOkxBalances(OKX_RAW_BALANCE_PENDING_ORDER) },
];

describe('account balance invariants', () => {
  it.each(CASE_LIST)('never reports more free money than the account holds ($name)', ({ balances }) => {
    expect(balances.totalAvailableBalance).toBeLessThanOrEqual(resolveAccountEquity(balances));
  });

  it.each(CASE_LIST)('never reports negative margin in use ($name)', ({ balances }) => {
    expect(resolveAccountEquity(balances) - balances.totalAvailableBalance).toBeGreaterThanOrEqual(0);

    if (balances.totalInitialMargin !== undefined) {
      expect(balances.totalInitialMargin).toBeGreaterThanOrEqual(0);
    }
  });

  it.each(CASE_LIST)('always names where the free money came from ($name)', ({ balances }) => {
    expect(['exchange', 'derived', 'unknown']).toContain(balances.availableBalanceSource);
  });
});
