import { ExchangeLogger } from '../types/common';
import { buildBinanceSignedParams, buildBinanceAuthHeaders } from '../auth/binanceAuth';
import { BINANCE_SPOT_BASE_URL, BINANCE_REQUEST_TIMEOUT } from '../constants/binance';
import { BaseHttpClient } from './BaseHttpClient';

export class BinanceSpotHttpClient extends BaseHttpClient {
  private readonly secret: string;

  constructor(apiKey: string, secret: string, logger: ExchangeLogger) {
    super(BINANCE_SPOT_BASE_URL, apiKey, logger, BINANCE_REQUEST_TIMEOUT);
    this.secret = secret;
  }

  async fetchExchangeInfo(): Promise<Record<string, unknown>> {
    return this.get<Record<string, unknown>>('/api/v3/exchangeInfo');
  }

  async fetchTickers(): Promise<Array<Record<string, unknown>>> {
    return this.get<Array<Record<string, unknown>>>('/api/v3/ticker/24hr');
  }

  async fetchOrderBook(symbol: string, limit?: number): Promise<Record<string, unknown>> {
    const params: Record<string, string | number | boolean> = { symbol };

    if (limit !== undefined) {
      params.limit = limit;
    }

    return this.get<Record<string, unknown>>('/api/v3/depth', params);
  }

  async fetchKlines(
    symbol: string,
    interval: string,
    options?: { startTime?: number; endTime?: number; limit?: number }
  ): Promise<Array<unknown[]>> {
    const params: Record<string, string | number | boolean> = { symbol, interval };

    if (options?.startTime !== undefined) {
      params.startTime = options.startTime;
    }

    if (options?.endTime !== undefined) {
      params.endTime = options.endTime;
    }

    if (options?.limit !== undefined) {
      params.limit = options.limit;
    }

    return this.get<Array<unknown[]>>('/api/v3/klines', params);
  }

  async fetchTrades(symbol: string, limit?: number): Promise<Array<Record<string, unknown>>> {
    const params: Record<string, string | number | boolean> = { symbol };

    if (limit !== undefined) {
      params.limit = limit;
    }

    return this.get<Array<Record<string, unknown>>>('/api/v3/trades', params);
  }

  async createOrder(params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const signedParams = buildBinanceSignedParams({
      params: params as Record<string, string | number | boolean>,
      secret: this.secret,
    });
    const headers = buildBinanceAuthHeaders(this.apiKey);

    return this.post<Record<string, unknown>>(
      '/api/v3/order',
      signedParams as Record<string, unknown>,
      headers
    );
  }

  async cancelOrder(symbol: string, orderId: string): Promise<Record<string, unknown>> {
    const signedParams = buildBinanceSignedParams({
      params: { symbol, orderId },
      secret: this.secret,
    });
    const headers = buildBinanceAuthHeaders(this.apiKey);

    return this.delete<Record<string, unknown>>(
      '/api/v3/order',
      signedParams as Record<string, string | number | boolean>,
      headers
    );
  }

  async getOrder(symbol: string, orderId: string): Promise<Record<string, unknown>> {
    const signedParams = buildBinanceSignedParams({
      params: { symbol, orderId },
      secret: this.secret,
    });
    const headers = buildBinanceAuthHeaders(this.apiKey);

    return this.get<Record<string, unknown>>(
      '/api/v3/order',
      signedParams as Record<string, string | number | boolean>,
      headers
    );
  }

  async getOpenOrders(symbol?: string): Promise<Array<Record<string, unknown>>> {
    const rawParams: Record<string, string | number | boolean> = {};

    if (symbol !== undefined) {
      rawParams.symbol = symbol;
    }

    const signedParams = buildBinanceSignedParams({ params: rawParams, secret: this.secret });
    const headers = buildBinanceAuthHeaders(this.apiKey);

    return this.get<Array<Record<string, unknown>>>(
      '/api/v3/openOrders',
      signedParams as Record<string, string | number | boolean>,
      headers
    );
  }

  async fetchAccount(): Promise<Record<string, unknown>> {
    const signedParams = buildBinanceSignedParams({ params: {}, secret: this.secret });
    const headers = buildBinanceAuthHeaders(this.apiKey);

    return this.get<Record<string, unknown>>(
      '/api/v3/account',
      signedParams as Record<string, string | number | boolean>,
      headers
    );
  }

  async createListenKey(): Promise<{ listenKey: string }> {
    const headers = buildBinanceAuthHeaders(this.apiKey);

    return this.post<{ listenKey: string }>('/api/v3/userDataStream', {}, headers);
  }

  async keepAliveListenKey(listenKey: string): Promise<void> {
    const headers = buildBinanceAuthHeaders(this.apiKey);

    await this.put<unknown>('/api/v3/userDataStream', { listenKey }, headers);
  }

  async deleteListenKey(listenKey: string): Promise<void> {
    const headers = buildBinanceAuthHeaders(this.apiKey);

    await this.delete<unknown>(
      '/api/v3/userDataStream',
      { listenKey } as Record<string, string | number | boolean>,
      headers
    );
  }
}
