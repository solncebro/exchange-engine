import { normalizeBinancePosition, normalizeBinanceAccountTrade, normalizeBinanceIncomeList } from '../../src/normalizers/binanceNormalizer';
import type { BinanceUserTradeRaw } from '../../src/normalizers/binanceNormalizer';
import { normalizeBybitPosition, normalizeBybitIncomeList } from '../../src/normalizers/bybitNormalizer';
import { MarginModeEnum, OrderSideEnum, PositionSideEnum } from '../../src/types/common';
import { BINANCE_RAW_POSITION_RISK, BINANCE_RAW_INCOME_LIST } from '../fixtures/binanceRaw';
import { BYBIT_RAW_POSITION, BYBIT_RAW_TRANSACTION_LOG_SETTLEMENT } from '../fixtures/bybitRaw';

const ACCOUNT_TRADE: BinanceUserTradeRaw = {
  id: '9007199254740993',
  orderId: '1',
  symbol: 'BTCUSDT',
  side: 'BUY',
  positionSide: 'LONG',
  price: '100',
  qty: '2',
  quoteQty: '200',
  realizedPnl: '0',
  commission: '0.02',
  commissionAsset: 'USDT',
  time: 1000,
};

describe('position lifetime and account funding', () => {
  it('leaves the Bybit opening time unknown: the live position answer carries no such field', () => {
    expect(normalizeBybitPosition(BYBIT_RAW_POSITION, null).openedAtMs).toBeUndefined();
  });

  it('normalizes Binance update time without claiming an opening time', () => {
    const position = normalizeBinancePosition({ ...BINANCE_RAW_POSITION_RISK, updateTime: 2000 }, { leverage: 5, marginMode: MarginModeEnum.Isolated });

    expect(position.openedAtMs).toBeUndefined();
    expect(position.updatedAtMs).toBe(2000);
  });

  it.each(['funding', 'realizedPnl'] as const)('leaves the Bybit %s direction unknown: the live transaction log row carries no side', (kind) => {
    const [income] = normalizeBybitIncomeList([BYBIT_RAW_TRANSACTION_LOG_SETTLEMENT], kind);

    expect(income.positionSide).toBeUndefined();
  });

  it('leaves Binance funding direction unknown', () => {
    expect(normalizeBinanceIncomeList(BINANCE_RAW_INCOME_LIST).every((income) => income.positionSide === undefined)).toBe(true);
  });
});

describe('account trade normalization', () => {
  it('preserves exact identifiers and distinguishes trade side from position side', () => {
    expect(normalizeBinanceAccountTrade({ ...ACCOUNT_TRADE, side: 'SELL' })).toEqual({
      id: '9007199254740993', symbol: 'BTCUSDT', side: OrderSideEnum.Sell,
      positionSide: PositionSideEnum.Long, quantity: 2, price: 100, timestamp: 1000,
    });
  });

  it.each(['', 'unknown', '__proto__'])('does not guess a position side for %s', (positionSide) => {
    expect(normalizeBinanceAccountTrade({ ...ACCOUNT_TRADE, positionSide }).positionSide).toBeUndefined();
  });

  it('rejects unreadable execution quantities', () => {
    expect(() => normalizeBinanceAccountTrade({ ...ACCOUNT_TRADE, qty: 'invalid' })).toThrow('invalid execution data');
  });
});
