import { parseJsonPreservingLargeIntegers } from '../../src/utils/parseJsonPreservingLargeIntegers';

describe('parseJsonPreservingLargeIntegers', () => {
  it('preserves only unsafe integer literals as their exact decimal strings', () => {
    const result = parseJsonPreservingLargeIntegers('{"orderId":633327759348341108,"negative":-9007199254740993,"safe":9007199254740991,"decimal":1.2345678901234567,"exponent":1e20}');

    expect(result).toEqual({
      orderId: '633327759348341108',
      negative: '-9007199254740993',
      safe: 9007199254740991,
      decimal: 1.2345678901234567,
      exponent: 1e20,
    });
  });

  it('leaves quoted strings and escaped content untouched', () => {
    const result = parseJsonPreservingLargeIntegers('{"quoted":"633327759348341108","escaped":"quote \\" and \\u0031","list":[633327759348341108]}');

    expect(result).toEqual({ quoted: '633327759348341108', escaped: 'quote " and 1', list: ['633327759348341108'] });
  });

  it('keeps normal JSON syntax errors', () => {
    expect(() => parseJsonPreservingLargeIntegers('{bad')).toThrow(SyntaxError);
  });
});
