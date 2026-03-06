import type { TradeSymbol } from '../types/common';

export function countDecimalPlaces(step: string): number {
  const parts = step.split('.');

  if (parts.length === 1) {
    return 0;
  }

  return parts[1].replace(/0+$/, '').length;
}

export function roundToStep(value: number, step: string): string {
  const stepValue = parseFloat(step);

  if (stepValue === 0 || Number.isNaN(stepValue)) {
    return String(value);
  }

  const decimals = countDecimalPlaces(step);
  const rounded = Math.round(value / stepValue) * stepValue;

  return rounded.toFixed(decimals);
}

export function amountToPrecision(tradeSymbol: TradeSymbol, amount: number): string {
  return roundToStep(amount, tradeSymbol.filter.stepSize);
}

export function priceToPrecision(tradeSymbol: TradeSymbol, price: number): string {
  return roundToStep(price, tradeSymbol.filter.tickSize);
}
