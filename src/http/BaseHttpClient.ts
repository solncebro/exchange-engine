import axios, { AxiosInstance, AxiosError } from 'axios';
import { HttpsAgent as KeepAliveHttpsAgent } from 'agentkeepalive';
import { ExchangeLogger } from '../types/common';

const DEFAULT_HTTPS_AGENT = new KeepAliveHttpsAgent({
  maxSockets: 100,
  maxFreeSockets: 10,
  timeout: 60000,
  freeSocketTimeout: 30000,
  keepAlive: true,
});

const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 1000;

function isRetryable(error: AxiosError): boolean {
  if (!error.response) {
    return true;
  }

  const status = error.response.status;

  return status === 429 || status >= 500;
}

function getRetryDelayMs(error: AxiosError, attempt: number): number {
  if (error.response?.status === 429) {
    const retryAfterRaw = error.response.headers['retry-after'];

    if (retryAfterRaw) {
      return parseInt(String(retryAfterRaw), 10) * 1000;
    }
  }

  return RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface BaseHttpClientArgs {
  baseUrl: string;
  apiKey: string;
  logger: ExchangeLogger;
  timeout?: number;
  httpsAgent?: unknown;
}

export abstract class BaseHttpClient {
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
    params?: Record<string, string | number | boolean>,
    headers?: Record<string, string>
  ): Promise<T> {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        this.logger.debug(`GET ${url} with params: ${JSON.stringify(params)}`);
        const response = await this.axiosInstance.get<T>(url, { params, headers });

        return response.data;
      } catch (error) {
        const axiosError = error as AxiosError;
        this.handleError(axiosError);

        if (!isRetryable(axiosError) || attempt === MAX_RETRIES) {
          throw error;
        }

        const delayMs = getRetryDelayMs(axiosError, attempt);
        this.logger.warn(`GET ${url} failed, retrying (${attempt + 1}/${MAX_RETRIES}) in ${delayMs}ms`);
        await sleep(delayMs);
      }
    }

    throw new Error('Unreachable');
  }

  protected async post<T>(
    url: string,
    data?: Record<string, unknown>,
    headers?: Record<string, string>
  ): Promise<T> {
    try {
      this.logger.debug(`POST ${url} with data: ${JSON.stringify(data)}`);
      const response = await this.axiosInstance.post<T>(url, data, { headers });

      return response.data;
    } catch (error) {
      this.handleError(error as AxiosError);

      throw error;
    }
  }

  protected async postWithParams<T>(
    url: string,
    params?: Record<string, string | number | boolean>,
    headers?: Record<string, string>
  ): Promise<T> {
    try {
      this.logger.debug(`POST ${url} with params: ${JSON.stringify(params)}`);
      const response = await this.axiosInstance.post<T>(url, null, { params, headers });

      return response.data;
    } catch (error) {
      this.handleError(error as AxiosError);

      throw error;
    }
  }

  protected async put<T>(
    url: string,
    data?: Record<string, unknown>,
    headers?: Record<string, string>
  ): Promise<T> {
    try {
      this.logger.debug(`PUT ${url} with data: ${JSON.stringify(data)}`);
      const response = await this.axiosInstance.put<T>(url, data, { headers });

      return response.data;
    } catch (error) {
      this.handleError(error as AxiosError);

      throw error;
    }
  }

  protected async putWithParams<T>(
    url: string,
    params?: Record<string, string | number | boolean>,
    headers?: Record<string, string>
  ): Promise<T> {
    try {
      this.logger.debug(`PUT ${url} with params: ${JSON.stringify(params)}`);
      const response = await this.axiosInstance.put<T>(url, null, { params, headers });

      return response.data;
    } catch (error) {
      this.handleError(error as AxiosError);

      throw error;
    }
  }

  protected async delete<T>(
    url: string,
    params?: Record<string, string | number | boolean>,
    headers?: Record<string, string>
  ): Promise<T> {
    try {
      this.logger.debug(`DELETE ${url} with params: ${JSON.stringify(params)}`);
      const response = await this.axiosInstance.delete<T>(url, { params, headers });

      return response.data;
    } catch (error) {
      this.handleError(error as AxiosError);

      throw error;
    }
  }

  private handleError(error: AxiosError): void {
    if (error.response) {
      this.logger.error(
        `HTTP ${error.response.status}: ${JSON.stringify(error.response.data)}`
      );
    } else if (error.request) {
      this.logger.error(`No response: ${error.message}`);
    } else {
      this.logger.error(`Request error: ${error.message}`);
    }
  }
}
