import axios, { AxiosInstance, AxiosError } from 'axios';
import { ExchangeLogger } from '../types/common';

export abstract class BaseHttpClient {
  protected readonly axiosInstance: AxiosInstance;
  protected readonly logger: ExchangeLogger;
  protected readonly apiKey: string;

  constructor(baseURL: string, apiKey: string, logger: ExchangeLogger, timeout?: number) {
    this.apiKey = apiKey;
    this.logger = logger;
    this.axiosInstance = axios.create({
      baseURL,
      timeout: timeout || 30000,
    });
  }

  protected async get<T>(
    url: string,
    params?: Record<string, string | number | boolean>,
    headers?: Record<string, string>
  ): Promise<T> {
    try {
      this.logger.debug(`GET ${url} with params: ${JSON.stringify(params)}`);
      const response = await this.axiosInstance.get<T>(url, { params, headers });
      return response.data;
    } catch (error) {
      this.handleError(error as AxiosError);
      throw error;
    }
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
