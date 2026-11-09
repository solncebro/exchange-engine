import { buildBinanceClosedPnlList } from '../../src/normalizers/binanceNormalizer';
import type { BinanceUserTradeRaw } from '../../src/normalizers/binanceNormalizer';
import { PositionSideEnum } from '../../src/types/common';

function buildTrade(overrides: Partial<BinanceUserTradeRaw>): BinanceUserTradeRaw {
  return {
    id: 1,
    orderId: 1,
    symbol: 'BTCUSDT',
    side: 'BUY',
    positionSide: 'LONG',
    price: '100',
    qty: '1',
    quoteQty: '100',
    realizedPnl: '0',
    commission: '1',
    commissionAsset: 'USDT',
    time: 1,
    ...overrides,
  };
}

describe('Binance closing commissions', () => {
  it('isolates symbols and order identifiers that collide across symbols', () => {
    const result = buildBinanceClosedPnlList([
      buildTrade({ commission: '1' }),
      buildTrade({ symbol: 'ETHUSDT', commission: '10', id: 2, time: 2 }),
      buildTrade({ side: 'SELL', realizedPnl: '20', commission: '2', id: 3, orderId: 9, time: 3 }),
      buildTrade({ symbol: 'ETHUSDT', side: 'SELL', realizedPnl: '30', commission: '3', id: 4, orderId: 9, time: 4 }),
    ]);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ symbol: 'BTCUSDT', orderId: '9', closedPnl: 17, isTradingFeeComplete: true });
    expect(result[1]).toMatchObject({ symbol: 'ETHUSDT', orderId: '9', closedPnl: 17, isTradingFeeComplete: true });
  });

  it('isolates simultaneous long and short positions on one symbol', () => {
    const result = buildBinanceClosedPnlList([
      buildTrade({ commission: '1' }),
      buildTrade({ side: 'SELL', positionSide: 'SHORT', commission: '10', id: 2, time: 2 }),
      buildTrade({ side: 'BUY', positionSide: 'SHORT', realizedPnl: '30', commission: '3', id: 3, orderId: 3, time: 3 }),
      buildTrade({ side: 'SELL', realizedPnl: '20', commission: '2', id: 4, orderId: 4, time: 4 }),
    ]);

    expect(result[0]).toMatchObject({ positionSide: PositionSideEnum.Short, closedPnl: 17, isTradingFeeComplete: true });
    expect(result[1]).toMatchObject({ positionSide: PositionSideEnum.Long, closedPnl: 17, isTradingFeeComplete: true });
  });

  it('allocates entry fees across partial fills and partial closing orders', () => {
    const result = buildBinanceClosedPnlList([
      buildTrade({ qty: '4', commission: '8' }),
      buildTrade({ side: 'SELL', realizedPnl: '10', commission: '1', id: 2, orderId: 2, time: 2 }),
      buildTrade({ side: 'SELL', realizedPnl: '0', commission: '1', id: 3, orderId: 2, time: 3 }),
      buildTrade({ side: 'SELL', qty: '2', realizedPnl: '20', commission: '2', id: 4, orderId: 3, time: 4 }),
    ]);

    expect(result[0]).toMatchObject({ quantity: 2, closedPnl: 4, isTradingFeeComplete: true });
    expect(result[1]).toMatchObject({ quantity: 2, closedPnl: 14, isTradingFeeComplete: true });
  });

  it('marks missing entry history and partially known entry fees', () => {
    const result = buildBinanceClosedPnlList([
      buildTrade({ qty: '1', commission: '2' }),
      buildTrade({ side: 'SELL', qty: '2', realizedPnl: '10', commission: '1', id: 2, orderId: 2, time: 2 }),
      buildTrade({ side: 'SELL', realizedPnl: '10', commission: '1', id: 3, orderId: 3, time: 3 }),
    ]);

    expect(result[0]).toMatchObject({ closedPnl: 7, isTradingFeeComplete: false });
    expect(result[1]).toMatchObject({ closedPnl: 9, isTradingFeeComplete: false });
  });

  it('does not treat a known hedge close at zero profit as an opening', () => {
    const result = buildBinanceClosedPnlList([
      buildTrade({ side: 'SELL', commission: '2' }),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ closedPnl: -2, isTradingFeeComplete: false });
  });

  it('keeps one-way long and short entry pools separate across reversals', () => {
    const result = buildBinanceClosedPnlList([
      buildTrade({ positionSide: 'BOTH', commission: '1' }),
      buildTrade({ positionSide: 'BOTH', side: 'SELL', qty: '2', realizedPnl: '10', commission: '2', id: 2, orderId: 2, time: 2 }),
      buildTrade({ positionSide: 'BOTH', side: 'SELL', commission: '4', id: 3, orderId: 3, time: 3 }),
      buildTrade({ positionSide: 'BOTH', side: 'BUY', realizedPnl: '20', commission: '1', id: 4, orderId: 4, time: 4 }),
    ]);

    expect(result[0]).toMatchObject({ closedPnl: 7, isTradingFeeComplete: false });
    expect(result[1]).toMatchObject({ closedPnl: 15, isTradingFeeComplete: true });
  });

  it('recognizes zero-profit one-way closure from the known opposite pool', () => {
    const result = buildBinanceClosedPnlList([
      buildTrade({ positionSide: 'BOTH', commission: '2' }),
      buildTrade({ positionSide: 'BOTH', side: 'SELL', commission: '1', id: 2, orderId: 2, time: 2 }),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ closedPnl: -3, isTradingFeeComplete: true });
  });

  it('keeps fee completeness through decimal quantity subtraction', () => {
    const result = buildBinanceClosedPnlList([
      buildTrade({ qty: '0.3', commission: '3' }),
      buildTrade({ side: 'SELL', qty: '0.1', realizedPnl: '1', id: 2, orderId: 2, time: 2 }),
      buildTrade({ side: 'SELL', qty: '0.2', realizedPnl: '2', id: 3, orderId: 3, time: 3 }),
    ]);

    expect(result[0].isTradingFeeComplete).toBe(true);
    expect(result[1].isTradingFeeComplete).toBe(true);
    expect(result[1].closedPnl).toBeCloseTo(-1, 9);
  });

  it('subtracts only known USDT fees from mixed commission currencies', () => {
    const result = buildBinanceClosedPnlList([
      buildTrade({ commission: '2' }),
      buildTrade({ commission: '10', commissionAsset: 'BNB', id: 2, orderId: 2, time: 2 }),
      buildTrade({ side: 'SELL', realizedPnl: '10', commission: '3', id: 3, orderId: 3, time: 3 }),
      buildTrade({ side: 'SELL', realizedPnl: '20', commission: '30', commissionAsset: 'BNB', id: 4, orderId: 4, time: 4 }),
    ]);

    expect(result[0]).toMatchObject({ closedPnl: 6, isTradingFeeComplete: false });
    expect(result[1]).toMatchObject({ closedPnl: 19, isTradingFeeComplete: false });
  });

  it('subtracts the dollar credit BNFCR fees of a Futures Credits account as complete', () => {
    const result = buildBinanceClosedPnlList([
      buildTrade({ commission: '2', commissionAsset: 'BNFCR' }),
      buildTrade({ side: 'SELL', realizedPnl: '10', commission: '3', commissionAsset: 'BNFCR', id: 2, orderId: 2, time: 2 }),
    ]);

    expect(result[0]).toMatchObject({ closedPnl: 5, isTradingFeeComplete: true });
  });

  it.each(['', 'unknown', undefined])('marks an unavailable entry commission asset %s as incomplete', (commissionAsset) => {
    const result = buildBinanceClosedPnlList([
      buildTrade({ commissionAsset, commission: '10' }),
      buildTrade({ side: 'SELL', realizedPnl: '20', commission: '2', id: 2, orderId: 2, time: 2 }),
    ]);

    expect(result[0]).toMatchObject({ closedPnl: 18, isTradingFeeComplete: false });
  });

  it.each(['', 'unknown', undefined])('marks an unavailable closing commission asset %s as incomplete', (commissionAsset) => {
    const result = buildBinanceClosedPnlList([
      buildTrade({ commission: '2' }),
      buildTrade({ side: 'SELL', realizedPnl: '20', commissionAsset, commission: '10', id: 2, orderId: 2, time: 2 }),
    ]);

    expect(result[0]).toMatchObject({ closedPnl: 18, isTradingFeeComplete: false });
  });

  it.each(['', 'unknown'])('marks an unreadable USDT fee %s as incomplete without poisoning the result', (commission) => {
    const result = buildBinanceClosedPnlList([
      buildTrade({ commission }),
      buildTrade({ side: 'SELL', realizedPnl: '20', commission: '2', id: 2, orderId: 2, time: 2 }),
    ]);

    expect(result[0]).toMatchObject({ closedPnl: 18, isTradingFeeComplete: false });
  });

  it('clears incomplete fee knowledge after the known position has closed completely', () => {
    const result = buildBinanceClosedPnlList([
      buildTrade({ commissionAsset: 'BNB', commission: '5' }),
      buildTrade({ side: 'SELL', realizedPnl: '20', commission: '2', id: 2, orderId: 2, time: 2 }),
      buildTrade({ commission: '3', id: 3, orderId: 3, time: 3 }),
      buildTrade({ side: 'SELL', realizedPnl: '30', commission: '4', id: 4, orderId: 4, time: 4 }),
    ]);

    expect(result[0]).toMatchObject({ closedPnl: 18, isTradingFeeComplete: false });
    expect(result[1]).toMatchObject({ closedPnl: 23, isTradingFeeComplete: true });
  });

  it.each(['', 'unknown'])('marks an unreadable closing USDT fee %s as incomplete', (commission) => {
    const result = buildBinanceClosedPnlList([
      buildTrade({ commission: '2' }),
      buildTrade({ side: 'SELL', realizedPnl: '20', commission, id: 2, orderId: 2, time: 2 }),
    ]);

    expect(result[0]).toMatchObject({ closedPnl: 18, isTradingFeeComplete: false });
  });
});
