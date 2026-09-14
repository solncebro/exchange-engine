import type { OrderBookLevel, OrderBookRawLevel } from '../types/common';

export function parseOrderBookLevel(level: string[]): OrderBookLevel {
  return { price: parseFloat(level[0]), quantity: parseFloat(level[1]) };
}

export function toOrderBookRawLevelList(rawList: string[][]): OrderBookRawLevel[] {
  return rawList.map((level): OrderBookRawLevel => [level[0], level[1]]);
}
