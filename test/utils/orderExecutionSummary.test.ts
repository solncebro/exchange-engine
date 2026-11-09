import { buildOrderExecutionWindowList, summarizeOrderExecutionList } from '../../src/utils/orderExecutionSummary';

describe('order execution summary', () => {
  const args = { symbol: 'BTCUSDT', orderId: '77', startTime: 1000, endTime: 2000 };
  const entry = { id: 'fill', symbol: 'BTCUSDT', orderId: '77', amount: 0.1, timeMs: 1500, price: 100, quoteAmount: 10, feeAmount: 0.01, feeAsset: 'USDT' };

  it('rejects conflicting duplicates instead of guessing the executed amount', () => {
    expect(() => summarizeOrderExecutionList({ ...args, executionList: [entry, { ...entry, amount: 0.2 }] })).toThrow('Conflicting');
  });

  it.each([
    { ...entry, symbol: 'ETHUSDT' },
    { ...entry, orderId: 'other' },
    { ...entry, amount: Number.NaN },
    { ...entry, amount: -1 },
    { ...entry, timeMs: 3000 },
    { ...entry, timeMs: Number.NaN },
  ])('rejects unconfirmed execution data %j', invalidEntry => {
    expect(() => summarizeOrderExecutionList({ ...args, executionList: [invalidEntry] })).toThrow('Unconfirmed');
  });

  it('returns unknown time when the complete window has no records', () => {
    expect(summarizeOrderExecutionList({ ...args, executionList: [] })).toMatchObject({ filledAmount: 0, firstFillTimeMs: null, lastFillTimeMs: null, executionList: [], quoteAmount: 0, averagePrice: null, feeAmountByAsset: {} });
  });

  it('does not carry an unconditional completeness mark: an incomplete read throws instead', () => {
    expect(summarizeOrderExecutionList({ ...args, executionList: [entry] })).not.toHaveProperty('isComplete');
  });

  it('keeps the first and last actual fill across unordered and repeated execution records', () => {
    const executionList = [
      { ...entry, id: 'last', timeMs: 2000 },
      { ...entry, id: 'first', timeMs: 1000 },
      entry,
      { ...entry, id: 'first', timeMs: 1000 },
    ];
    const result = summarizeOrderExecutionList({ ...args, executionList });

    expect(result.filledAmount).toBeCloseTo(0.3, 9);
    expect(result).toMatchObject({ firstFillTimeMs: 1000, lastFillTimeMs: 2000 });
  });

  it('rejects an invalid history window before making requests', () => {
    expect(() => buildOrderExecutionWindowList({ ...args, endTime: 999 })).toThrow('Invalid');
    expect(() => buildOrderExecutionWindowList({ ...args, orderId: '' })).toThrow('Invalid');
  });
});

it('aggregates actual prices and fees per currency without inventing missing fees', () => {
  const result = summarizeOrderExecutionList({ symbol: 'BTCUSDT', orderId: '77', startTime: 0, endTime: 3, executionList: [
    { id: '1', orderId: '77', symbol: 'BTCUSDT', amount: 1, price: 10, quoteAmount: 10, feeAmount: 0.1, feeAsset: 'USDT', timeMs: 1 },
    { id: '2', orderId: '77', symbol: 'BTCUSDT', amount: 2, price: 20, quoteAmount: 40, feeAmount: null, feeAsset: null, timeMs: 2 },
  ] });
  expect(result).toMatchObject({ filledAmount: 3, quoteAmount: 50, averagePrice: 50 / 3, feeAmountByAsset: { USDT: 0.1 } });
  expect(result.executionList?.[1]).toMatchObject({ executionId: '2', feeAmount: null, feeAsset: null });
});
