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

  it('matches JSON.parse for text without 16+ digit runs', () => {
    const text = '{"price":64908.60,"fraction":0.00007437,"exp":1e20,"list":[1,22,333],"safe":9007199254740991,"s":"abc"}';

    expect(parseJsonPreservingLargeIntegers(text)).toEqual(JSON.parse(text));
  });

  it('still returns a long order id as a string', () => {
    expect(parseJsonPreservingLargeIntegers('{"orderId":1234567890123456789}')).toEqual({ orderId: '1234567890123456789' });
  });

  it('keeps a long fraction as a number', () => {
    expect(parseJsonPreservingLargeIntegers('{"price":1234567890123456.5}')).toEqual({ price: 1234567890123456.5 });
  });

  it('keeps normal JSON syntax errors', () => {
    expect(() => parseJsonPreservingLargeIntegers('{bad')).toThrow(SyntaxError);
  });
});
