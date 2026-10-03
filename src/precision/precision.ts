import type { TradeSymbol } from '../types/common';

export const MAX_PRICE_DECIMAL_PLACES = 8;

export function countDecimalPlaces(step: string): number {
  const normalizedStep = step.toLowerCase();

  if (normalizedStep.includes('e')) {
    const [mantissa, exponentString] = normalizedStep.split('e');
    const exponent = parseInt(exponentString, 10);
    const mantissaDecimals = (mantissa.split('.')[1] ?? '').replace(/0+$/, '').length;

    return Math.max(0, mantissaDecimals - exponent);
  }

  const parts = step.split('.');

  if (parts.length === 1) {
    return 0;
  }

  return parts[1].replace(/0+$/, '').length;
}

/** Which way a value moves onto the grid: to the closest point, to the smallest point >= value, or the largest <= value. */
export type StepRounding = 'nearest' | 'up' | 'down';

/** A value this close to a grid point (as a share of the step) already sits on it: float noise, not a real offset. */
const GRID_NOISE_SHARE = 1e-9;

/** The one place of grid math: every price/amount rounding goes through here. */
function roundToStep(value: number, step: string, rounding: StepRounding = 'nearest'): number {
  const stepValue = parseFloat(step);

  if (stepValue === 0 || Number.isNaN(stepValue)) {
    return value;
  }

  const decimals = countDecimalPlaces(step);
  const stepCount = value / stepValue;
  const nearestCount = Math.round(stepCount);
  // 2.96151 / 0.0001 can come out as 29615.099999999996; an on-grid value must not hop a whole step.
  // The division's own float error grows with the step count (above ~2^23 steps it exceeds a fixed
  // tolerance), so the tolerance scales with the magnitude.
  const isOnGrid = Math.abs(stepCount - nearestCount) <= GRID_NOISE_SHARE + Math.abs(stepCount) * 4 * Number.EPSILON;
  let gridCount = nearestCount;

  if (!isOnGrid && rounding === 'up') {
    gridCount = Math.ceil(stepCount);
  } else if (!isOnGrid && rounding === 'down') {
    gridCount = Math.floor(stepCount);
  }

  return parseFloat((gridCount * stepValue).toFixed(decimals));
}

export function amountToPrecision(tradeSymbol: TradeSymbol, amount: number, rounding: StepRounding = 'nearest'): number {
  const stepValue = parseFloat(tradeSymbol.filter.stepSize);

  if (stepValue === 0 || Number.isNaN(stepValue)) {
    return Math.floor(amount);
  }

  return roundToStep(amount, tradeSymbol.filter.stepSize, rounding);
}

export function priceToPrecision(tradeSymbol: TradeSymbol, price: number, rounding: StepRounding = 'nearest'): number {
  const stepValue = parseFloat(tradeSymbol.filter.tickSize);

  if (stepValue === 0 || Number.isNaN(stepValue)) {
    return parseFloat(price.toFixed(MAX_PRICE_DECIMAL_PLACES));
  }

  return roundToStep(price, tradeSymbol.filter.tickSize, rounding);
}
