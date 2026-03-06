import type { ExchangeLogger } from '../types/common';
import type {
  BinanceExchangeInfoRaw,
  BinanceTicker24hrRaw,
  BinanceOrderResponseRaw,
  BinanceAccountRaw,
} from '../normalizers/binanceNormalizer';
import type { FetchPageWithLimitArgs } from '../types/exchange';
import { buildBinanceSignedParams, buildBinanceAuthHeaders } from '../auth/binanceAuth';
import { applyTimeRangeOptions } from '../utils/httpParams';
import { BaseHttpClient } from './BaseHttpClient';

export interface BinanceHttpClientArgs {
  baseUrl: string;
  apiKey: string;
  secret: string;
  logger: ExchangeLogger;
}

interface BinanceListenKeyResponse {
  listenKey: string;
}

interface BinanceEndpoints {
  exchangeInfo: string;
  ticker24hr: string;
  depth: string;
  klines: string;
  trades: string;
  order: string;
  openOrders: string;
  account: string;
  listenKey: string;
}

abstract class BinanceBaseHttpClient extends BaseHttpClient {
  protected readonly secret: string;
  protected abstract readonly endpoints: BinanceEndpoints;

  constructor(args: BinanceHttpClientArgs, timeout: number) {
    super({ baseUrl: args.baseUrl, apiKey: args.apiKey, logger: args.logger, timeout });
    this.secret = args.secret;
  }

  protected signedGet<T>(
    path: string,
    params: Record<string, string | number | boolean> = {},
  ): Promise<T> {
    const signedParams = buildBinanceSignedParams({ params, secret: this.secret });
    const headers = buildBinanceAuthHeaders(this.apiKey);

    return this.get<T>(path, signedParams as Record<string, string | number | boolean>, headers);
  }

  protected signedPost<T>(
    path: string,
    params: Record<string, string | number | boolean> = {},
  ): Promise<T> {
    const signedParams = buildBinanceSignedParams({ params, secret: this.secret });
    const headers = buildBinanceAuthHeaders(this.apiKey);

    return this.postWithParams<T>(path, signedParams as Record<string, string | number | boolean>, headers);
  }

  protected signedDelete<T>(
    path: string,
    params: Record<string, string | number | boolean> = {},
  ): Promise<T> {
    const signedParams = buildBinanceSignedParams({ params, secret: this.secret });
    const headers = buildBinanceAuthHeaders(this.apiKey);

    return this.delete<T>(path, signedParams as Record<string, string | number | boolean>, headers);
  }

  protected authHeaders(): Record<string, string> {
    return buildBinanceAuthHeaders(this.apiKey);
  }

  async fetchExchangeInfo(): Promise<BinanceExchangeInfoRaw> {
    return this.get<BinanceExchangeInfoRaw>(this.endpoints.exchangeInfo);
  }

  async fetchTickers(): Promise<BinanceTicker24hrRaw[]> {
    return this.get<BinanceTicker24hrRaw[]>(this.endpoints.ticker24hr);
  }

  async fetchOrderBook(symbol: string, limit?: number): Promise<Record<string, unknown>> {
    const params: Record<string, string | number | boolean> = { symbol };

    if (limit !== undefined) {
      params.limit = limit;
    }

    return this.get<Record<string, unknown>>(this.endpoints.depth, params);
  }

  async fetchKlines(
    symbol: string,
    interval: string,
    options?: FetchPageWithLimitArgs,
  ): Promise<unknown[][]> {
    const params: Record<string, string | number | boolean> = { symbol, interval };
    applyTimeRangeOptions(params, options);

    return this.get<unknown[][]>(this.endpoints.klines, params);
  }

  async fetchTrades(symbol: string, limit?: number): Promise<Record<string, unknown>[]> {
    const params: Record<string, string | number | boolean> = { symbol };

    if (limit !== undefined) {
      params.limit = limit;
    }

    return this.get<Record<string, unknown>[]>(this.endpoints.trades, params);
  }

  async createOrder(params: Record<string, unknown>): Promise<BinanceOrderResponseRaw> {
    return this.signedPost<BinanceOrderResponseRaw>(
      this.endpoints.order,
      params as Record<string, string | number | boolean>,
    );
  }

  async cancelOrder(symbol: string, orderId: string): Promise<Record<string, unknown>> {
    return this.signedDelete<Record<string, unknown>>(this.endpoints.order, { symbol, orderId });
  }

  async getOrder(symbol: string, orderId: string): Promise<Record<string, unknown>> {
    return this.signedGet<Record<string, unknown>>(this.endpoints.order, { symbol, orderId });
  }

  async getOpenOrders(symbol?: string): Promise<Record<string, unknown>[]> {
    const params: Record<string, string | number | boolean> = {};

    if (symbol !== undefined) {
      params.symbol = symbol;
    }

    return this.signedGet<Record<string, unknown>[]>(this.endpoints.openOrders, params);
  }

  async fetchAccount(): Promise<BinanceAccountRaw> {
    return this.signedGet<BinanceAccountRaw>(this.endpoints.account);
  }

  async createListenKey(): Promise<BinanceListenKeyResponse> {
    return this.post<BinanceListenKeyResponse>(this.endpoints.listenKey, {}, this.authHeaders());
  }

  async keepAliveListenKey(listenKey: string): Promise<void> {
    await this.put<unknown>(this.endpoints.listenKey, { listenKey }, this.authHeaders());
  }

  async deleteListenKey(listenKey: string): Promise<void> {
    await this.delete<unknown>(
      this.endpoints.listenKey,
      { listenKey } as Record<string, string | number | boolean>,
      this.authHeaders(),
    );
  }
}

export { BinanceBaseHttpClient };
export type { BinanceEndpoints, BinanceListenKeyResponse };
