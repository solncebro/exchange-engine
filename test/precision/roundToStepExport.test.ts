import { roundToStep } from '../../src/index';
import type { StepRounding } from '../../src/index';
import { priceToPrecision } from '../../src/precision/precision';
import { BTCUSDT_TRADE_SYMBOL } from '../fixtures/mockTradeSymbol';

const TICK_LIST = ['0.1', '0.01', '0.0005', '0.00001', '1'];
const ROUNDING_LIST: StepRounding[] = ['nearest', 'up', 'down'];

function buildPriceList(tick: number): number[] {
  return [
    tick * 12345,
    tick * 12345 + tick * 0.3,
    tick * 12345 + tick * 0.5,
    tick * 12345 + tick * 0.7,
    tick * 12345 + tick * 1e-12,
    0.1 + 0.2,
    2.96151,
    2.9615999999999996,
    0.3 * 3,
  ];
}

describe('roundToStep root export', () => {
  it.each(TICK_LIST)('equals priceToPrecision of a symbol with tick %s for every rounding and price', (tick) => {
    const tradeSymbol = { ...BTCUSDT_TRADE_SYMBOL, filter: { ...BTCUSDT_TRADE_SYMBOL.filter, tickSize: tick } };

    for (const rounding of ROUNDING_LIST) {
      for (const price of buildPriceList(parseFloat(tick))) {
        expect(roundToStep(price, tick, rounding)).toBe(priceToPrecision(tradeSymbol, price, rounding));
      }
    }
  });

  it('keeps an on-grid price and moves a between-grid price in the requested direction', () => {
    expect(roundToStep(2.9616, '0.0001', 'up')).toBe(2.9616);
    expect(roundToStep(2.96151, '0.0001', 'up')).toBe(2.9616);
    expect(roundToStep(2.96159, '0.0001', 'down')).toBe(2.9615);
    expect(roundToStep(2.96155, '0.0001', 'nearest')).toBe(2.9616);
  });
});
