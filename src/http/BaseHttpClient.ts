import axios, { AxiosInstance, AxiosError, AxiosResponse } from 'axios';
import { HttpsAgent as KeepAliveHttpsAgent } from 'agentkeepalive';

import type { ExchangeLogger } from '../types/common';
import type { BaseHttpClientArgs, HttpErrorResponseData, HttpHeaders, HttpQueryParams, HttpRecord } from './BaseHttpClient.types';

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
      return parseInt(String(retryAfterRaw), 10) * 1000;
    }
  }

  return RETRY_BASE_DELAY_MILLISECONDS * Math.pow(2, attempt);
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
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
    });
  }

  protected async get<T>(
    url: string,
    params?: HttpQueryParams,
    headers?: HttpHeaders
  ): Promise<T> {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        this.logger.debug({ url, params }, `GET ${url}`);
        const response = await this.axiosInstance.get<T>(url, { params, headers });
        this.logger.debug({ url, response: response.data as HttpRecord }, `GET ${url} response`);

        return response.data;
      } catch (error) {
        const axiosError = error as AxiosError;
        this.handleError(axiosError);


        if (!isRetryable(axiosError) || attempt === MAX_RETRIES) {
          throw error;
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
    data?: HttpRecord,
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

  private async executeRequest<T>(
    label: string,
    requestFunction: () => Promise<AxiosResponse<T>>,
  ): Promise<T> {
    try {
      this.logger.debug(label);
      const response = await requestFunction();
      this.logger.debug({ response: response.data as HttpRecord }, `${label} response`);

      return response.data;
    } catch (error) {
      this.handleError(error as AxiosError);

      throw error;
    }
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
