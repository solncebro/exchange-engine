import type { TradeSymbol } from '../types/common';

const MAX_PRICE_DECIMAL_PLACES = 8;

function countDecimalPlaces(step: string): number {
  const parts = step.split('.');

  if (parts.length === 1) {
    return 0;
  }

  return parts[1].replace(/0+$/, '').length;
}

function roundToStep(value: number, step: string): number {
  const stepValue = parseFloat(step);

  if (stepValue === 0 || Number.isNaN(stepValue)) {
    return value;
  }

  const decimals = countDecimalPlaces(step);
  const rounded = Math.round(value / stepValue) * stepValue;

  return parseFloat(rounded.toFixed(decimals));
}

export function amountToPrecision(tradeSymbol: TradeSymbol, amount: number): number {
  const stepValue = parseFloat(tradeSymbol.filter.stepSize);

  if (stepValue === 0 || Number.isNaN(stepValue)) {
    return Math.floor(amount);
  }

  return roundToStep(amount, tradeSymbol.filter.stepSize);
}

export function priceToPrecision(tradeSymbol: TradeSymbol, price: number): number {
  const stepValue = parseFloat(tradeSymbol.filter.tickSize);

  if (stepValue === 0 || Number.isNaN(stepValue)) {
    return parseFloat(price.toFixed(MAX_PRICE_DECIMAL_PLACES));
  }

  return roundToStep(price, tradeSymbol.filter.tickSize);
}
