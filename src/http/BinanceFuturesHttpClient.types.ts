import type { FetchPageWithLimitArgs } from '../types/exchange';

/**
 * Адресация условной заявки в Algo-службе. Символ не передаётся — ни чтение, ни отмена
 * его не принимают, номер условной заявки адресует её сам по себе.
 * Нужен ровно один из двух ключей.
 */
export interface BinanceAlgoOrderLookupArgs {
  algoId?: string;
  clientAlgoId?: string;
}

/** Запрос собственных сделок: символ Binance требует обязательно, окно — необязательно. */
export interface BinanceUserTradeQueryArgs extends FetchPageWithLimitArgs {
  symbol?: string;
  /** Номер сделки, С КОТОРОГО отдавать страницу (по возрастанию) — ключ постраничного добора.
   *  Документация биржи запрещает сочетать его с `startTime`/`endTime`. */
  fromId?: number | string;
}
