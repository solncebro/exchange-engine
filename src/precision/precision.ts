import type { TradeSymbol } from '../types/common';

export function countDecimalPlaces(step: string): number {
  const parts = step.split('.');

  if (parts.length === 1) {
    return 0;
  }

  return parts[1].replace(/0+$/, '').length;
}

export function roundToStep(value: number, step: string): number {
  const stepValue = parseFloat(step);

  if (stepValue === 0 || Number.isNaN(stepValue)) {
    return value;
  }

  const decimals = countDecimalPlaces(step);
  const rounded = Math.round(value / stepValue) * stepValue;

  return parseFloat(rounded.toFixed(decimals));
}

export function amountToPrecision(tradeSymbol: TradeSymbol, amount: number): number {
  return roundToStep(amount, tradeSymbol.filter.stepSize);
}

export function priceToPrecision(tradeSymbol: TradeSymbol, price: number): number {
  return roundToStep(price, tradeSymbol.filter.tickSize);
}
