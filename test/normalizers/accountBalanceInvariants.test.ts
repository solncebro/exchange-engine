import { normalizeBybitBalances } from '../../src/normalizers/bybitNormalizer';
import { normalizeBinanceFuturesBalances } from '../../src/normalizers/binanceNormalizer';
import { AccountBalances } from '../../src/types/common';
import { BYBIT_RAW_WALLET_BALANCE, BYBIT_RAW_WALLET_BALANCE_NO_TOTALS } from '../fixtures/bybitRaw';
import { BINANCE_RAW_FUTURES_ACCOUNT, BINANCE_RAW_FUTURES_ACCOUNT_WITH_POSITION } from '../fixtures/binanceRaw';

/**
 * Инвариант счёта, общий для всех бирж. Он держит ровно тот дефект, который 29.08.2026 показал на
 * экране «занято −1$»: свободных средств оказалось больше, чем есть на счёте, потому что остатки
 * разных монет сложили как одно число. Такое расхождение потребитель превращает в отрицательное
 * «занято» — величину, которой не существует.
 */
const CASE_LIST: Array<{ name: string; balances: AccountBalances }> = [
  { name: 'bybit, сводные поля пришли', balances: normalizeBybitBalances(BYBIT_RAW_WALLET_BALANCE) },
  { name: 'bybit, сводные поля пустые', balances: normalizeBybitBalances(BYBIT_RAW_WALLET_BALANCE_NO_TOTALS) },
  { name: 'binance, счёт без позиции', balances: normalizeBinanceFuturesBalances(BINANCE_RAW_FUTURES_ACCOUNT) },
  { name: 'binance, счёт с позицией', balances: normalizeBinanceFuturesBalances(BINANCE_RAW_FUTURES_ACCOUNT_WITH_POSITION) },
];

describe('account balance invariants', () => {
  it.each(CASE_LIST)('never reports more free money than the account holds ($name)', ({ balances }) => {
    expect(balances.totalAvailableBalance).toBeLessThanOrEqual(balances.totalWalletBalance);
  });

  it.each(CASE_LIST)('never reports negative margin in use ($name)', ({ balances }) => {
    expect(balances.totalWalletBalance - balances.totalAvailableBalance).toBeGreaterThanOrEqual(0);

    if (balances.totalInitialMargin !== undefined) {
      expect(balances.totalInitialMargin).toBeGreaterThanOrEqual(0);
    }
  });

  it.each(CASE_LIST)('always names where the free money came from ($name)', ({ balances }) => {
    expect(['exchange', 'derived', 'unknown']).toContain(balances.availableBalanceSource);
  });
});
