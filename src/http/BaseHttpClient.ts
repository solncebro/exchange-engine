import axios, { AxiosInstance, AxiosError, AxiosResponse } from 'axios';
import { HttpsAgent as KeepAliveHttpsAgent } from 'agentkeepalive';

import type { ExchangeLogger } from '../types/common';
import { ExchangeError } from '../errors/ExchangeError';
import { serializeQueryParams } from '../utils/serializeQueryParams';
import { toWireErrorCode } from '../utils/wireErrorCode';
import { sleep } from '../utils/sleep';
import { parseJsonPreservingLargeIntegers } from '../utils/parseJsonPreservingLargeIntegers';
import type {
  BaseHttpClientArgs,
  HttpErrorResponseData,
  HttpHeaders,
  HttpHeadersSource,
  HttpPostBody,
  HttpQueryParams,
  HttpQueryParamsSource,
  HttpRecord,
} from './BaseHttpClient.types';

const DEFAULT_HTTPS_AGENT = new KeepAliveHttpsAgent({
  maxSockets: 100,
  maxFreeSockets: 10,
  timeout: 60000,
  freeSocketTimeout: 30000,
  keepAlive: true,
});

const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MILLISECONDS = 1000;
const BINANCE_NOOP_ERROR_CODE_LIST = [-4059, -4046];
/** Binance answers the caller EXPECTS to get, so they belong in the log at info level, not as errors.
 *  -2013 "Order does not exist" is the routine one: an order id may live in the plain order service OR
 *  in the conditional (algo) one, and Binance offers no way to ask "which service owns this id" — so
 *  reading an order asks BOTH in parallel and keeps whichever recognises it (see BinanceFutures
 *  readOrderFromOwningService / getOrderByClientOrderId). The other service always answers -2013, by
 *  design: on a live bot that is dozens of scary ERROR lines a day sitting right next to a perfectly
 *  successful read. Only the LOG LEVEL changes here — the error object handed to the caller keeps its
 *  "[code] message" form, because callers match on that text (a cancel of an already-gone order is
 *  treated as done) and every caller that genuinely cares about a missing order reports it itself. */
const BINANCE_EXPECTED_ERROR_CODE_LIST = [-2013];

function isRetryable(error: AxiosError): boolean {
  if (!error.response) {
    return true;
  }

  const status = error.response.status;

  return status === 429 || status >= 500;
}

function getRetryDelayMilliseconds(error: AxiosError, attempt: number): number {
  if (error.response?.status === 429) {
    const retryAfterRaw = error.response.headers['retry-after'];

    if (retryAfterRaw) {
      const retryAfterSeconds = parseInt(String(retryAfterRaw), 10);

      if (Number.isFinite(retryAfterSeconds)) {
        return retryAfterSeconds * 1000;
      }
    }
  }

  return RETRY_BASE_DELAY_MILLISECONDS * Math.pow(2, attempt);
}

function resolveQueryParams(source: HttpQueryParamsSource | undefined): HttpQueryParams | undefined {
  return typeof source === 'function' ? source() : source;
}

function resolveHeaders(source: HttpHeadersSource | undefined): HttpHeaders | undefined {
  return typeof source === 'function' ? source() : source;
}

function isHttpErrorCode(value: unknown): value is number | string {
  return typeof value === 'number' || (typeof value === 'string' && value !== '');
}

function toStructuredErrorCode(code: number | string): number | string {
  return typeof code === 'number' ? code : toWireErrorCode(code);
}

function isBinanceNoopHttpError(data: unknown): data is HttpErrorResponseData {
  if (!data || typeof data !== 'object') {
    return false;
  }

  const record = data as HttpErrorResponseData;

  if (typeof record.code !== 'number') {
    return false;
  }

  return BINANCE_NOOP_ERROR_CODE_LIST.includes(record.code);
}

function isBinanceExpectedHttpError(data: unknown): data is HttpErrorResponseData {
  if (!data || typeof data !== 'object') {
    return false;
  }

  const record = data as HttpErrorResponseData;

  if (typeof record.code !== 'number') {
    return false;
  }

  return BINANCE_EXPECTED_ERROR_CODE_LIST.includes(record.code);
}

function parseBinanceNoopHttpErrorMessage(data: unknown): string | null {
  if (!data || typeof data !== 'object') {
    return null;
  }

  const record = data as HttpErrorResponseData;

  const message = record.msg;

  if (typeof message !== 'string') {
    return null;
  }

  return message;
}

function transformResponseData(data: unknown): unknown {
  if (typeof data !== 'string' || data.length === 0) {
    return data;
  }

  try {
    return parseJsonPreservingLargeIntegers(data);
  } catch {
    return data;
  }
}

abstract class BaseHttpClient {
  protected readonly axiosInstance: AxiosInstance;
  protected readonly logger: ExchangeLogger;
  protected readonly apiKey: string;

  constructor(args: BaseHttpClientArgs) {
    this.apiKey = args.apiKey;
    this.logger = args.logger;
    this.axiosInstance = axios.create({
      baseURL: args.baseUrl,
      timeout: args.timeout ?? 30000,
      httpsAgent: args.httpsAgent ?? DEFAULT_HTTPS_AGENT,
      transformResponse: transformResponseData,
      paramsSerializer: {
        serialize: serializeQueryParams,
      },
    });
  }

  protected async beforeRequest(): Promise<void> {}

  /** Тело нужно наравне с заголовками: настоящий срок запрета биржа называет в тексте ошибки. */
  protected onResponse(_status: number | undefined, _headers: unknown, _body?: unknown): void {}

  /**
   * Чтение с повторами. Параметры и заголовки могут приезжать функциями — тогда они строятся ЗДЕСЬ,
   * непосредственно перед отправкой, и заново на каждой попытке.
   *
   * Так устроено ради подписанных запросов: между сборкой и приёмом на бирже стоят ожидание по
   * лимиту веса (до двух секунд) и пауза перед повтором (до четырёх), а биржа меряет возраст отметки
   * времени в момент приёма и отвергает всё старше своего окна. Заранее подписанный запрос, дождавшись
   * своей очереди, приезжал протухшим.
   */
  protected async get<T>(
    url: string,
    params?: HttpQueryParamsSource,
    headers?: HttpHeadersSource
  ): Promise<T> {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      await this.beforeRequest();

      const effectiveParams = resolveQueryParams(params);
      const effectiveHeaders = resolveHeaders(headers);

      try {
        this.logger.debug({ url, params: effectiveParams }, `GET ${url}`);
        const response = await this.axiosInstance.get<T>(url, { params: effectiveParams, headers: effectiveHeaders });
        this.onResponse(response.status, response.headers, response.data);
        this.logger.debug({ url, response: response.data as HttpRecord }, `GET ${url} response`);

        return response.data;
      } catch (error) {
        const axiosError = error as AxiosError;
        this.onResponse(axiosError.response?.status, axiosError.response?.headers, axiosError.response?.data);
        this.handleError(axiosError);

        if (!isRetryable(axiosError) || attempt === MAX_RETRIES) {
          throw this.enrichError(axiosError);
        }

        const delayMilliseconds = getRetryDelayMilliseconds(axiosError, attempt);
        this.logger.warn(`GET ${url} failed, retrying (${attempt + 1}/${MAX_RETRIES}) in ${delayMilliseconds} milliseconds`);
        await sleep(delayMilliseconds);
      }
    }

    throw new Error('Unreachable');
  }

  protected post<T>(
    url: string,
    data?: HttpPostBody,
    headers?: HttpHeaders
  ): Promise<T> {
    return this.executeRequest(`POST ${url}`, () => this.axiosInstance.post<T>(url, data, { headers }));
  }

  protected postWithParams<T>(
    url: string,
    params?: HttpQueryParams,
    headers?: HttpHeaders
  ): Promise<T> {
    return this.executeRequest(`POST ${url}`, () => this.axiosInstance.post<T>(url, null, { params, headers }));
  }

  protected put<T>(
    url: string,
    data?: HttpRecord,
    headers?: HttpHeaders
  ): Promise<T> {
    return this.executeRequest(`PUT ${url}`, () => this.axiosInstance.put<T>(url, data, { headers }));
  }

  protected putWithParams<T>(
    url: string,
    params?: HttpQueryParams,
    headers?: HttpHeaders
  ): Promise<T> {
    return this.executeRequest(`PUT ${url}`, () => this.axiosInstance.put<T>(url, null, { params, headers }));
  }

  protected delete<T>(
    url: string,
    params?: HttpQueryParams,
    headers?: HttpHeaders
  ): Promise<T> {
    return this.executeRequest(`DELETE ${url}`, () => this.axiosInstance.delete<T>(url, { params, headers }));
  }

  /**
   * Запись без повторов: подпись ставится вызывающим и тут же уходит в сеть.
   *
   * Ожидание по лимиту соблюдается и здесь (07.09.2026). Раньше его знали только чтения — и пока
   * биржа держала адрес закрытым, постановка и отмена заявок продолжали стучаться, чем запрет и
   * продлевали. Ответ тоже разбирается: запрет часто виден именно на записи.
   */
  private async executeRequest<T>(
    label: string,
    requestFunction: () => Promise<AxiosResponse<T>>,
  ): Promise<T> {
    await this.beforeRequest();

    try {
      this.logger.debug(label);
      const response = await requestFunction();
      this.onResponse(response.status, response.headers, response.data);
      this.logger.debug({ response: response.data as HttpRecord }, `${label} response`);

      return response.data;
    } catch (error) {
      const axiosError = error as AxiosError;
      this.onResponse(axiosError.response?.status, axiosError.response?.headers, axiosError.response?.data);
      this.handleError(axiosError);

      throw this.enrichError(axiosError);
    }
  }

  /**
   * Обозначение биржи для ошибок транспорта. Наследник, который его не назвал, отдаёт пустое —
   * поле `exchange` тогда просто ни на что не указывает, а код ошибки всё равно сохраняется.
   */
  protected get errorExchangeLabel(): string {
    return '';
  }

  /**
   * Отказ, у которого биржа назвала СВОЙ код, отдаётся как `ExchangeError` с этим кодом, а не
   * обычной ошибкой с кодом, зашитым в текст. Иначе код терялся ровно там, где он нужнее всего:
   * тот же отказ, пришедший с кодом 200 в теле, вызывающий разбирал по полю `code`, а пришедший
   * с HTTP-статусом (например, предел частоты OKX 50011 отдаётся и как «200», и как «429») —
   * только разбором текста. `ExchangeError` наследует `Error`, поэтому для тех, кто читает
   * `message`, ничего не меняется: текст остался прежним.
   */
  private enrichError(error: AxiosError): Error {
    const responseData = error.response?.data;

    if (responseData && typeof responseData === 'object') {
      const data = responseData as Record<string, unknown>;

      if (isBinanceNoopHttpError(responseData)) {
        return error;
      }

      const structuredError = this.buildStructuredError(data);

      if (structuredError !== null) {
        return structuredError;
      }
    }

    if (error.response) {
      return new Error(`HTTP ${error.response.status}: ${error.message}`);
    }

    return error;
  }

  /** Код и текст биржи из тела ответа: `code`/`msg` у Binance и OKX, `retCode`/`retMsg` у Bybit. */
  private buildStructuredError(data: Record<string, unknown>): ExchangeError | null {
    if (isHttpErrorCode(data.code) && data.msg !== undefined) {
      return new ExchangeError(`[${data.code}] ${data.msg}`, toStructuredErrorCode(data.code), this.errorExchangeLabel);
    }

    if (isHttpErrorCode(data.retCode) && data.retMsg !== undefined) {
      return new ExchangeError(`[${data.retCode}] ${data.retMsg}`, toStructuredErrorCode(data.retCode), this.errorExchangeLabel);
    }

    return null;
  }

  private handleError(error: AxiosError): void {
    if (error.response) {
      if (isBinanceNoopHttpError(error.response.data)) {
        const noopMessage = parseBinanceNoopHttpErrorMessage(error.response.data);

        if (noopMessage !== null) {
          this.logger.info(noopMessage);

          return;
        }

        this.logger.info(`HTTP ${error.response.status}`);

        return;
      }

      if (isBinanceExpectedHttpError(error.response.data)) {
        this.logger.info(
          { status: error.response.status, data: error.response.data as HttpRecord },
          `HTTP ${error.response.status} (expected, handled by the caller)`,
        );

        return;
      }

      this.logger.error(
        { status: error.response.status, data: error.response.data as HttpRecord },
        `HTTP ${error.response.status}`,
      );
    } else if (error.request) {
      this.logger.error({ errorMessage: error.message }, `No response: ${error.message}`);
    } else {
      this.logger.error({ errorMessage: error.message }, `Request error: ${error.message}`);
    }
  }
}

export { BaseHttpClient };
