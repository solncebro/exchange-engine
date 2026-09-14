import { parseOrderBookLevel, toOrderBookRawLevelList } from '../../src/normalizers/normalizerUtils';

describe('parseOrderBookLevel', () => {
  it('parses price and quantity from a decimal-string pair', () => {
    const result = parseOrderBookLevel(['41006.8', '0.60038921']);

    expect(result).toEqual({ price: 41006.8, quantity: 0.60038921 });
  });
});

describe('toOrderBookRawLevelList', () => {
  it('keeps price and quantity as raw decimal strings', () => {
    const result = toOrderBookRawLevelList([
      ['8476.98', '415', '0', '13'],
      ['8477', '7', '0', '2'],
    ]);

    expect(result).toEqual([
      ['8476.98', '415'],
      ['8477', '7'],
    ]);
  });

  it('returns an empty list for an empty input', () => {
    const result = toOrderBookRawLevelList([]);

    expect(result).toEqual([]);
  });
});
