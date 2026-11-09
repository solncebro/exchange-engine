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

  it('handles a scientific-notation stepSize without truncating to zero', () => {
    const symbol = {
      ...BTCUSDT_TRADE_SYMBOL,
      filter: { ...BTCUSDT_TRADE_SYMBOL.filter, stepSize: '1e-8' },
    };

    expect(amountToPrecision(symbol, 0.00000005)).toBeCloseTo(0.00000005, 10);
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

describe('step rounding direction', () => {
  const withTick = (tickSize: string) => ({
    ...BTCUSDT_TRADE_SYMBOL,
    filter: { ...BTCUSDT_TRADE_SYMBOL.filter, tickSize },
  });
  const withStep = (stepSize: string) => ({
    ...BTCUSDT_TRADE_SYMBOL,
    filter: { ...BTCUSDT_TRADE_SYMBOL.filter, stepSize },
  });

  it('prices: nearest, up and down differ for an off-grid value', () => {
    const symbol = withTick('0.0001');

    expect(priceToPrecision(symbol, 2.96151, 'nearest')).toBeCloseTo(2.9615, 9);
    expect(priceToPrecision(symbol, 2.96151, 'up')).toBeCloseTo(2.9616, 9);
    expect(priceToPrecision(symbol, 2.96151, 'down')).toBeCloseTo(2.9615, 9);
    expect(priceToPrecision(symbol, 2.96158, 'down')).toBeCloseTo(2.9615, 9);
    expect(priceToPrecision(symbol, 2.96158)).toBeCloseTo(2.9616, 9);
  });

  it('amounts: nearest, up and down differ for an off-grid value', () => {
    const symbol = withStep('0.01');

    expect(priceToPrecision(withTick('0.01'), 1.234, 'up')).toBeCloseTo(1.24, 9);
    expect(amountToPrecision(symbol, 1.231, 'nearest')).toBeCloseTo(1.23, 9);
    expect(amountToPrecision(symbol, 1.231, 'up')).toBeCloseTo(1.24, 9);
    expect(amountToPrecision(symbol, 1.239, 'down')).toBeCloseTo(1.23, 9);
  });

  it('keeps a value already on the grid in every mode', () => {
    const symbol = withTick('0.0001');

    expect(priceToPrecision(symbol, 2.9616, 'up')).toBeCloseTo(2.9616, 9);
    expect(priceToPrecision(symbol, 2.9616, 'down')).toBeCloseTo(2.9616, 9);
    expect(priceToPrecision(symbol, 0.3, 'up')).toBeCloseTo(0.3, 9);
    expect(priceToPrecision(withTick('0.1'), 0.30000000000000004, 'down')).toBeCloseTo(0.3, 9);
    expect(priceToPrecision(withTick('0.1'), 0.3 + 1e-13, 'up')).toBeCloseTo(0.3, 9);
  });

  it('handles a sub-cent tick', () => {
    const symbol = withTick('0.0000001');

    expect(priceToPrecision(symbol, 0.00001234, 'up')).toBeCloseTo(0.0000124, 12);
    expect(priceToPrecision(symbol, 0.00001234, 'down')).toBeCloseTo(0.0000123, 12);
    expect(priceToPrecision(symbol, 0.0000123, 'up')).toBeCloseTo(0.0000123, 12);
  });

  it('keeps the zero-step fallbacks whatever the direction', () => {
    expect(priceToPrecision(MISSING_FILTER_TRADE_SYMBOL, 1.123456789012, 'up')).toBe(1.12345679);
    expect(amountToPrecision(MISSING_FILTER_TRADE_SYMBOL, 9.7, 'up')).toBe(9);
  });
});

describe('on-grid guard at large step counts', () => {
  const withTick = (tickSize: string) => ({
    ...BTCUSDT_TRADE_SYMBOL,
    filter: { ...BTCUSDT_TRADE_SYMBOL.filter, tickSize },
  });

  it('keeps on-grid values above 2^23 steps exact in both directions', () => {
    expect(priceToPrecision(withTick('0.01'), 111848.68, 'down')).toBe(111848.68);
    expect(priceToPrecision(withTick('0.01'), 111848.68, 'up')).toBe(111848.68);
    expect(priceToPrecision(withTick('0.000001'), 10.238625, 'up')).toBe(10.238625);
    expect(priceToPrecision(withTick('0.000001'), 10.238625, 'down')).toBe(10.238625);
    expect(priceToPrecision(withTick('0.0001'), 1022.6148, 'down')).toBe(1022.6148);
    expect(priceToPrecision(withTick('0.0001'), 1022.6148, 'up')).toBe(1022.6148);
    expect(priceToPrecision(withTick('0.1'), 987654321.3, 'up')).toBe(987654321.3);
    expect(priceToPrecision(withTick('0.1'), 987654321.3, 'down')).toBe(987654321.3);
  });

  it('still rounds a value just off the grid in the right direction', () => {
    expect(priceToPrecision(withTick('0.01'), 111848.681, 'up')).toBe(111848.69);
    expect(priceToPrecision(withTick('0.01'), 111848.681, 'down')).toBe(111848.68);
    expect(priceToPrecision(withTick('0.01'), 111848.689, 'down')).toBe(111848.68);
  });
});


describe('nearest half-step stability', () => {
  it('rounds the same planned HYPER stop identically for its actual fills and one recovered position', () => {
    const symbol = {
      ...BTCUSDT_TRADE_SYMBOL,
      filter: { ...BTCUSDT_TRADE_SYMBOL.filter, tickSize: '0.00001' },
    };
    const quantityList = [
    8464, 4333, 19306, 1928, 1928, 82, 82, 82, 3957, 1638, 82, 82,
    3859, 2405, 82, 8426, 82, 1638, 82, 240, 82, 82, 2405, 85,
    2774, 3719, 498, 27886, 1550, 82, 169, 82, 349, 82, 619, 4545,
    1126, 23499, 1287, 559, 1033, 82, 82, 2405, 82, 82, 2035, 82,
    2405, 82, 3974, 4557, 4557, 4163, 4636, 386, 321, 321, 321, 321,
    321, 321, 321, 321, 4761, 24388, 32103, 802, 1605, 981, 28715, 891,
    268, 161, 82, 1289, 453, 268, 82, 82, 82, 82, 82, 2405,
    82, 81, 4630, 82, 82, 2247, 600, 82, 2405, 2035, 82, 82,
    1019, 82, 2247, 82, 2405, 82, 82, 1753, 82, 2035, 82, 2247,
    1186,
    ];
    const entryPrice = 0.0623;
    const amountUsdList = quantityList.map((quantity) => quantity * entryPrice);
    const totalAmountUsd = amountUsdList.reduce((total, amountUsd) => total + amountUsd, 0);
    const weightedPrice = amountUsdList.reduce((total, amountUsd) => total + entryPrice * amountUsd, 0) / totalAmountUsd;
    const recoveredAmountUsd = 288925 * entryPrice;
    const recoveredPrice = entryPrice * recoveredAmountUsd / recoveredAmountUsd;

    expect(quantityList).toHaveLength(109);
    expect(quantityList.reduce((total, quantity) => total + quantity, 0)).toBe(288925);
    expect(priceToPrecision(symbol, weightedPrice * 1.15)).toBe(0.07165);
    expect(priceToPrecision(symbol, recoveredPrice * 1.15)).toBe(0.07165);
    expect(priceToPrecision(symbol, entryPrice * 1.15)).toBe(0.07165);
  });

  it.each([
    { tickSize: '0.00000001', halfStepCount: 7164.5, lowerPrice: 0.00007164, upperPrice: 0.00007165 },
    { tickSize: '0.00001', halfStepCount: 7164.5, lowerPrice: 0.07164, upperPrice: 0.07165 },
    { tickSize: '0.1', halfStepCount: 987654321.5, lowerPrice: 98765432.1, upperPrice: 98765432.2 },
    { tickSize: '1', halfStepCount: 7164.5, lowerPrice: 7164, upperPrice: 7165 },
  ])('keeps nearest halves stable for tick $tickSize without changing directed rounding', ({ tickSize, halfStepCount, lowerPrice, upperPrice }) => {
    const symbol = {
      ...BTCUSDT_TRADE_SYMBOL,
      filter: { ...BTCUSDT_TRADE_SYMBOL.filter, tickSize },
    };
    const tick = Number(tickSize);
    const halfPrice = halfStepCount * tick;

    for (const value of [halfPrice * (1 - Number.EPSILON), halfPrice, halfPrice * (1 + Number.EPSILON)]) {
      expect(priceToPrecision(symbol, value)).toBe(upperPrice);
      expect(priceToPrecision(symbol, value, 'up')).toBe(upperPrice);
      expect(priceToPrecision(symbol, value, 'down')).toBe(lowerPrice);
    }

    expect(priceToPrecision(symbol, (halfStepCount - 0.001) * tick)).toBe(lowerPrice);
    expect(priceToPrecision(symbol, (halfStepCount + 0.001) * tick)).toBe(upperPrice);
  });

  it.each([
    { price: 0.071645, tickSize: '0.00001', expected: 0.07165 },
    { price: 0.07164499999999999, tickSize: '0.00001', expected: 0.07165 },
    { price: 0.00007164499999999998, tickSize: '0.00000001', expected: 0.00007165 },
    { price: 98765432.14999999, tickSize: '0.1', expected: 98765432.2 },
    { price: 7164.499999999998, tickSize: '1', expected: 7165 },
  ])('rounds the exact changelog half-step value $price at tick $tickSize up to $expected', ({ price, tickSize, expected }) => {
    const symbol = {
      ...BTCUSDT_TRADE_SYMBOL,
      filter: { ...BTCUSDT_TRADE_SYMBOL.filter, tickSize },
    };

    expect(priceToPrecision(symbol, price)).toBe(expected);
  });

  it.each([
    { price: 0.071645, tickSize: '0.00001', lowerPrice: 0.07164, upperPrice: 0.07165 },
    { price: 0.07164499999999999, tickSize: '0.00001', lowerPrice: 0.07164, upperPrice: 0.07165 },
    { price: 0.00007164499999999998, tickSize: '0.00000001', lowerPrice: 0.00007164, upperPrice: 0.00007165 },
    { price: 98765432.14999999, tickSize: '0.1', lowerPrice: 98765432.1, upperPrice: 98765432.2 },
    { price: 7164.499999999998, tickSize: '1', lowerPrice: 7164, upperPrice: 7165 },
  ])('keeps directed rounding of $price at tick $tickSize on the neighbouring grid points', ({ price, tickSize, lowerPrice, upperPrice }) => {
    const symbol = {
      ...BTCUSDT_TRADE_SYMBOL,
      filter: { ...BTCUSDT_TRADE_SYMBOL.filter, tickSize },
    };

    expect(priceToPrecision(symbol, price, 'up')).toBe(upperPrice);
    expect(priceToPrecision(symbol, price, 'down')).toBe(lowerPrice);
  });

  it('preserves nearest rounding toward positive infinity at negative halves', () => {
    const symbol = {
      ...BTCUSDT_TRADE_SYMBOL,
      filter: { ...BTCUSDT_TRADE_SYMBOL.filter, tickSize: '0.00001' },
    };
    const halfPrice = -0.0623 * 1.15;

    expect(priceToPrecision(symbol, halfPrice * (1 + Number.EPSILON))).toBe(-0.07164);
    expect(priceToPrecision(symbol, halfPrice)).toBe(-0.07164);
    expect(priceToPrecision(symbol, halfPrice * (1 - Number.EPSILON))).toBe(-0.07164);
    expect(priceToPrecision(symbol, halfPrice, 'up')).toBe(-0.07164);
    expect(priceToPrecision(symbol, halfPrice, 'down')).toBe(-0.07165);
  });

  it('does not promote a quarter step when large step counts make the noise allowance overlap', () => {
    const symbol = {
      ...BTCUSDT_TRADE_SYMBOL,
      filter: { ...BTCUSDT_TRADE_SYMBOL.filter, tickSize: '1' },
    };

    expect(priceToPrecision(symbol, 1e15 + 0.25)).toBe(1e15);
    expect(priceToPrecision(symbol, 1e15)).toBe(1e15);
    expect(priceToPrecision(symbol, 1e15 + 0.75)).toBe(1e15 + 1);
  });
});
