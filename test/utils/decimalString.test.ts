import { multiplyDecimalStrings, convertCoinsToContracts, convertContractsToCoins, toDecimalNumberString } from '../../src/utils/decimalString';

describe('multiplyDecimalStrings', () => {
  it('multiplies two decimal strings exactly', () => {
    expect(multiplyDecimalStrings('1', '0.01')).toBe('0.01');
    expect(multiplyDecimalStrings('0.1', '0.001')).toBe('0.0001');
    expect(multiplyDecimalStrings('100', '0.001')).toBe('0.1');
    expect(multiplyDecimalStrings('3', '1')).toBe('3');
    expect(multiplyDecimalStrings('0.5', '2')).toBe('1');
    expect(multiplyDecimalStrings('12.50', '0.10')).toBe('1.25');
    expect(multiplyDecimalStrings('0', '0.01')).toBe('0');
    expect(multiplyDecimalStrings('-2', '0.5')).toBe('-1');
  });

  it('supports exponential notation', () => {
    expect(multiplyDecimalStrings('1e-3', '1')).toBe('0.001');
  });

  it('throws on non-decimal input', () => {
    expect(() => multiplyDecimalStrings('abc', '1')).toThrow('Invalid decimal string: abc');
  });
});

describe('convertCoinsToContracts', () => {
  it('converts an amount to a whole number of contracts', () => {
    expect(convertCoinsToContracts({ amount: 0.035, contractValue: '0.01', lotSize: '1' })).toBe('3');
  });

  it('tolerates floating point noise in the amount', () => {
    expect(convertCoinsToContracts({ amount: 0.03, contractValue: '0.01', lotSize: '1' })).toBe('3');
  });

  it('rounds down when short of a full contract', () => {
    expect(convertCoinsToContracts({ amount: 0.0299999, contractValue: '0.01', lotSize: '1' })).toBe('2');
  });

  it('snaps down to the lot size', () => {
    expect(convertCoinsToContracts({ amount: 0.00123, contractValue: '0.001', lotSize: '0.1' })).toBe('1.2');
  });

  it('returns 0 when the amount is under one lot', () => {
    expect(convertCoinsToContracts({ amount: 0.005, contractValue: '0.01', lotSize: '1' })).toBe('0');
  });

  it('treats an empty contractValue as a spot amount (1 unit per contract)', () => {
    expect(convertCoinsToContracts({ amount: 1.23456, contractValue: '', lotSize: '0.0001' })).toBe('1.2345');
  });

  it('returns 0 for a negative amount', () => {
    expect(convertCoinsToContracts({ amount: -1, contractValue: '0.01', lotSize: '1' })).toBe('0');
  });

  it('returns 0 for a NaN amount', () => {
    expect(convertCoinsToContracts({ amount: NaN, contractValue: '0.01', lotSize: '1' })).toBe('0');
  });

  it('never rounds the result above the requested amount', () => {
    expect(convertCoinsToContracts({ amount: 0.123456789, contractValue: '', lotSize: '0.00000001' })).toBe('0.12345678');
  });

  it('divides exactly with an integer lot size', () => {
    expect(convertCoinsToContracts({ amount: 1, contractValue: '3', lotSize: '1' })).toBe('0');
    expect(convertCoinsToContracts({ amount: 7, contractValue: '3', lotSize: '1' })).toBe('2');
  });

  it('supports exponential notation in the lot size', () => {
    expect(convertCoinsToContracts({ amount: 0.5, contractValue: '', lotSize: '1e-8' })).toBe('0.5');
  });

  it('supports exponential notation in the amount', () => {
    expect(convertCoinsToContracts({ amount: 1e-7, contractValue: '', lotSize: '0.00000001' })).toBe('0.0000001');
  });

  it('throws on an empty lot size', () => {
    expect(() => convertCoinsToContracts({ amount: 1234.5, contractValue: '', lotSize: '' })).toThrow('Invalid lot size: ');
  });

  it('throws on a non-numeric lot size', () => {
    expect(() => convertCoinsToContracts({ amount: 1234.5, contractValue: '', lotSize: 'abc' })).toThrow('Invalid lot size: abc');
  });

  it('throws on an invalid contract value', () => {
    expect(() => convertCoinsToContracts({ amount: 1, contractValue: 'abc', lotSize: '1' })).toThrow('Invalid contract value: abc');
  });

  it('throws on a zero contract value', () => {
    expect(() => convertCoinsToContracts({ amount: 1, contractValue: '0', lotSize: '1' })).toThrow('Invalid contract value: 0');
  });
});

describe('convertContractsToCoins', () => {
  it('converts a contract count to a coin amount', () => {
    expect(convertContractsToCoins('3', '0.01')).toBe(0.03);
    expect(convertContractsToCoins('1.2', '0.001')).toBe(0.0012);
  });

  it('treats an empty contractValue as a spot amount', () => {
    expect(convertContractsToCoins('5', '')).toBe(5);
  });

  it('returns 0 for an empty contracts string', () => {
    expect(convertContractsToCoins('', '0.01')).toBe(0);
  });

  it('supports exponential notation in the contracts count', () => {
    expect(convertContractsToCoins(String(1e-7), '0.01')).toBe(0.000000001);
  });
});

describe('toDecimalNumberString', () => {
  it('never lets a small number leave in exponential notation', () => {
    expect(toDecimalNumberString(0.0000001)).toBe('0.0000001');
    expect(toDecimalNumberString(1.5e-7)).toBe('0.00000015');
    expect(toDecimalNumberString(-2e-8)).toBe('-0.00000002');
  });

  it('leaves an ordinary number exactly as it reads', () => {
    expect(toDecimalNumberString(51000)).toBe('51000');
    expect(toDecimalNumberString(0.05)).toBe('0.05');
    expect(toDecimalNumberString(0)).toBe('0');
  });
});
