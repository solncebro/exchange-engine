import { countDecimalPlaces, roundToStep, amountToPrecision, priceToPrecision } from '../../src/precision/precision';
import { BTCUSDT_TRADE_SYMBOL, ETHUSDT_TRADE_SYMBOL } from '../fixtures/mockTradeSymbol';

describe('countDecimalPlaces', () => {
  it('returns 0 for integer step "1"', () => {
    expect(countDecimalPlaces('1')).toBe(0);
  });

  it('returns 2 for "0.01"', () => {
    expect(countDecimalPlaces('0.01')).toBe(2);
  });

  it('returns 1 for "0.10" (trailing zeros stripped)', () => {
    expect(countDecimalPlaces('0.10')).toBe(1);
  });

  it('returns 8 for "0.00000001"', () => {
    expect(countDecimalPlaces('0.00000001')).toBe(8);
  });

  it('returns 0 for "10"', () => {
    expect(countDecimalPlaces('10')).toBe(0);
  });
});

describe('roundToStep', () => {
  it('rounds to nearest step', () => {
    expect(roundToStep(65432.15, '0.10')).toBe(65432.2);
  });

  it('rounds down correctly', () => {
    expect(roundToStep(0.1234, '0.001')).toBe(0.123);
  });

  it('handles integer step', () => {
    expect(roundToStep(1234.5, '1')).toBe(1235);
  });

  it('returns value as fallback when step is "0"', () => {
    expect(roundToStep(123.456, '0')).toBe(123.456);
  });

  it('returns value as fallback when step is NaN', () => {
    expect(roundToStep(123.456, 'abc')).toBe(123.456);
  });

  it('handles step with many decimals', () => {
    expect(roundToStep(0.123456789, '0.00000001')).toBe(0.12345679);
  });

  it('rounds to 2 decimal places with step "0.01"', () => {
    expect(roundToStep(3456.789, '0.01')).toBe(3456.79);
  });
});

describe('amountToPrecision', () => {
  it('rounds amount using market stepSize', () => {
    const result = amountToPrecision(BTCUSDT_TRADE_SYMBOL, 0.1234);

    expect(result).toBe(0.123);
  });

  it('uses ETHUSDT stepSize', () => {
    const result = amountToPrecision(ETHUSDT_TRADE_SYMBOL, 1.567);

    expect(result).toBe(1.57);
  });
});

describe('priceToPrecision', () => {
  it('rounds price using market tickSize', () => {
    const result = priceToPrecision(BTCUSDT_TRADE_SYMBOL, 65432.15);

    expect(result).toBe(65432.2);
  });

  it('uses ETHUSDT tickSize', () => {
    const result = priceToPrecision(ETHUSDT_TRADE_SYMBOL, 3456.789);

    expect(result).toBe(3456.79);
  });
});
