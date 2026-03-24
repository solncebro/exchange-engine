import type { OrderBookLevel } from '../types/common';

export function parseOrderBookLevel(level: string[]): OrderBookLevel {
  return { price: parseFloat(level[0]), quantity: parseFloat(level[1]) };
}
