import { isBinanceNumericOrderId, serializeBinanceOrderIdList } from '../../src/utils/binanceOrderId';

describe('isBinanceNumericOrderId', () => {
  it('accepts digit-only ids', () => {
    expect(isBinanceNumericOrderId('1')).toBe(true);
    expect(isBinanceNumericOrderId('1870270071')).toBe(true);
    expect(isBinanceNumericOrderId('007')).toBe(true);
  });

  it('rejects anything that is not digits only', () => {
    expect(isBinanceNumericOrderId('')).toBe(false);
    expect(isBinanceNumericOrderId('order-1')).toBe(false);
    expect(isBinanceNumericOrderId('12.3')).toBe(false);
    expect(isBinanceNumericOrderId('-5')).toBe(false);
    expect(isBinanceNumericOrderId('1e3')).toBe(false);
    expect(isBinanceNumericOrderId('NaN')).toBe(false);
    expect(isBinanceNumericOrderId(' 11 ')).toBe(false);
  });
});

describe('serializeBinanceOrderIdList', () => {
  it('serializes ids as a JSON array of numbers without quotes', () => {
    expect(serializeBinanceOrderIdList(['111', '222'])).toBe('[111,222]');
  });

  it('serializes an empty list', () => {
    expect(serializeBinanceOrderIdList([])).toBe('[]');
  });

  it('keeps precision of ids beyond the safe integer range', () => {
    expect(serializeBinanceOrderIdList(['9007199254740993'])).toBe('[9007199254740993]');
  });

  it('throws on a non-numeric id instead of sending a broken payload', () => {
    expect(() => serializeBinanceOrderIdList(['111', 'order-x'])).toThrow(
      'Binance orderIdList expects numeric ids, received "order-x"',
    );
  });
});
