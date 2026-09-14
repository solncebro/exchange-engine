import type { ExchangeLogger } from '../types/common';

export interface BaseHttpClientArgs {
  baseUrl: string;
  apiKey: string;
  logger: ExchangeLogger;
  timeout?: number;
  httpsAgent?: unknown;
}

export interface HttpErrorResponseData {
  code?: unknown;
  msg?: unknown;
}

export interface HttpRecord {
  [key: string]: unknown;
}

/**
 * Тело POST-запроса — объект или, для пакетных операций (например, OKX batch-orders), массив
 * объектов: биржа ожидает JSON-массив, а не объект-обёртку.
 */
export type HttpPostBody = HttpRecord | HttpRecord[];

export interface HttpQueryParams {
  [key: string]: string | number | boolean;
}

export interface HttpHeaders {
  [key: string]: string;
}

/**
 * Параметры запроса — готовые ИЛИ функция, которая их строит. Функция нужна подписанным запросам:
 * подпись обязана рождаться в момент отправки, а не заранее, потому что биржа меряет возраст
 * отметки времени на приёме (см. `BaseHttpClient.get`).
 */
export type HttpQueryParamsSource = HttpQueryParams | (() => HttpQueryParams);

export type HttpHeadersSource = HttpHeaders | (() => HttpHeaders);
