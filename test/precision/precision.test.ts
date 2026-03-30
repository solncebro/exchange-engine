import { amountToPrecision, priceToPrecision } from '../../src/precision/precision';
import {
  BTCUSDT_TRADE_SYMBOL,
  ETHUSDT_TRADE_SYMBOL,
  MISSING_FILTER_TRADE_SYMBOL,
} from '../fixtures/mockTradeSymbol';

describe('amountToPrecision', () => {
  it('rounds amount using market stepSize', () => {
    const result = amountToPrecision(BTCUSDT_TRADE_SYMBOL, 0.1234);

    expect(result).toBe(0.123);
  });

  it('uses ETHUSDT stepSize', () => {
    const result = amountToPrecision(ETHUSDT_TRADE_SYMBOL, 1.567);

    expect(result).toBe(1.57);
  });

  it('floors to integer when stepSize is "0"', () => {
    const result = amountToPrecision(MISSING_FILTER_TRADE_SYMBOL, 120155.49534691955);

    expect(result).toBe(120155);
  });

  it('floors to integer when stepSize is empty string', () => {
    const symbol = {
      ...MISSING_FILTER_TRADE_SYMBOL,
      filter: { ...MISSING_FILTER_TRADE_SYMBOL.filter, stepSize: '' },
    };

    expect(amountToPrecision(symbol, 999.99)).toBe(999);
  });

  it('floors to 0 when amount is less than 1 and stepSize is invalid', () => {
    const result = amountToPrecision(MISSING_FILTER_TRADE_SYMBOL, 0.5);

    expect(result).toBe(0);
  });

  it('handles integer step', () => {
    const symbol = {
      ...BTCUSDT_TRADE_SYMBOL,
      filter: { ...BTCUSDT_TRADE_SYMBOL.filter, stepSize: '1' },
    };

    expect(amountToPrecision(symbol, 1234.5)).toBe(1235);
  });

  it('handles step with many decimals', () => {
    const symbol = {
      ...BTCUSDT_TRADE_SYMBOL,
      filter: { ...BTCUSDT_TRADE_SYMBOL.filter, stepSize: '0.00000001' },
    };

    expect(amountToPrecision(symbol, 0.123456789)).toBe(0.12345679);
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

  it('rounds to 8 decimal places when tickSize is "0"', () => {
    const result = priceToPrecision(MISSING_FILTER_TRADE_SYMBOL, 0.123456789012345);

    expect(result).toBe(0.12345679);
  });

  it('rounds to 8 decimal places when tickSize is empty string', () => {
    const symbol = {
      ...MISSING_FILTER_TRADE_SYMBOL,
      filter: { ...MISSING_FILTER_TRADE_SYMBOL.filter, tickSize: '' },
    };

    expect(priceToPrecision(symbol, 65432.123456789012)).toBe(65432.12345679);
  });

  it('handles step "0.10" correctly', () => {
    const symbol = {
      ...BTCUSDT_TRADE_SYMBOL,
      filter: { ...BTCUSDT_TRADE_SYMBOL.filter, tickSize: '0.10' },
    };

    expect(priceToPrecision(symbol, 65432.15)).toBe(65432.2);
  });

  it('handles step "0.01" correctly', () => {
    const symbol = {
      ...BTCUSDT_TRADE_SYMBOL,
      filter: { ...BTCUSDT_TRADE_SYMBOL.filter, tickSize: '0.01' },
    };

    expect(priceToPrecision(symbol, 3456.789)).toBe(3456.79);
  });
});
