import type { OrderBookLevel, OrderBookRawLevel } from '../types/common';

export function parseOrderBookLevel(level: string[]): OrderBookLevel {
  return { price: parseFloat(level[0]), quantity: parseFloat(level[1]) };
}

export function toOrderBookRawLevelList(rawList: string[][]): OrderBookRawLevel[] {
  return rawList.map((level): OrderBookRawLevel => [level[0], level[1]]);
}

/** Пустая строка и отсутствие поля — ноль: так биржи пишут «ничего нет», а не «неизвестно». */
export function parseAmountOrZero(value: string | undefined): number {
  const parsed = parseFloat(value ?? '0');

  return Number.isFinite(parsed) ? parsed : 0;
}
