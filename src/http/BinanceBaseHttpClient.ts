import type {
  BinanceExchangeInfoRaw,
  BinanceTicker24hrRaw,
  BinanceOrderResponseRaw,
  BinanceAccountRaw,
  BinanceOrderBookRaw,
  BinancePublicTradeRaw,
} from '../normalizers/binanceNormalizer';
import type { FetchPageWithLimitArgs } from '../types/exchange';
import { buildBinanceSignedParams, buildBinanceAuthHeaders } from '../auth/binanceAuth';
import { ExchangeError } from '../errors/ExchangeError';
import { applyTimeRangeOptions } from '../utils/httpParams';
import { BaseHttpClient } from './BaseHttpClient';
import type {
  BinanceEndpoints,
  BinanceErrorResponse,
  BinanceHttpClientArgs,
  BinanceListenKeyResponse,
  SignRequestResult,
} from './BinanceBaseHttpClient.types';

abstract class BinanceBaseHttpClient extends BaseHttpClient {
  protected readonly secret: string;
  protected abstract readonly endpoints: BinanceEndpoints;

  constructor(args: BinanceHttpClientArgs, timeout: number) {
    super({ baseUrl: args.baseUrl, apiKey: args.apiKey, logger: args.logger, timeout, httpsAgent: args.httpsAgent });
    this.secret = args.secret;
  }

  protected async signedGet<T>(
    path: string,
    params: Record<string, string | number | boolean> = {},
  ): Promise<T> {
    return this.signedRequest(params, (signedParams, headers) =>
      this.get<T>(path, signedParams, headers),
    );
  }

  protected async signedPost<T>(
    path: string,
    params: Record<string, string | number | boolean> = {},
  ): Promise<T> {
    return this.signedRequest(params, (signedParams, headers) =>
      this.postWithParams<T>(path, signedParams, headers),
    );
  }

  protected async signedDelete<T>(
    path: string,
    params: Record<string, string | number | boolean> = {},
  ): Promise<T> {
    return this.signedRequest(params, (signedParams, headers) =>
      this.delete<T>(path, signedParams, headers),
    );
  }

  private async signedRequest<T>(
    params: Record<string, string | number | boolean>,
    execute: (
      signedParams: Record<string, string | number | boolean>,
      headers: Record<string, string>,
    ) => Promise<T>,
  ): Promise<T> {
    const { signedParams, headers } = this.signRequest(params);
    const response = await execute(signedParams, headers);

    this.validateResponse(response);

    return response;
  }

  private validateResponse(response: unknown): void {
    if (response && typeof response === 'object' && 'code' in response) {
      const { code, msg } = response as BinanceErrorResponse;

      if (code < 0) {
        throw new ExchangeError(`Binance API error ${code}: ${msg}`, code, 'binance');
      }
    }
  }

  private signRequest(params: Record<string, string | number | boolean>): SignRequestResult {
    return {
      signedParams: buildBinanceSignedParams({ params, secret: this.secret }) as Record<string, string | number | boolean>,
      headers: buildBinanceAuthHeaders(this.apiKey),
    };
  }

  protected authHeaders(): Record<string, string> {
    return buildBinanceAuthHeaders(this.apiKey);
  }

  protected buildOptionalSymbolParams(
    symbol?: string,
  ): Record<string, string | number | boolean> {
    const params: Record<string, string | number | boolean> = {};

    if (symbol !== undefined) {
      params.symbol = symbol;
    }

    return params;
  }

  async fetchExchangeInfo(): Promise<BinanceExchangeInfoRaw> {
    return this.get<BinanceExchangeInfoRaw>(this.endpoints.exchangeInfo);
  }

  async fetchTickers(): Promise<BinanceTicker24hrRaw[]> {
    return this.get<BinanceTicker24hrRaw[]>(this.endpoints.ticker24hr);
  }

  async fetchOrderBook(symbol: string, limit?: number): Promise<BinanceOrderBookRaw> {
    const params: Record<string, string | number | boolean> = { symbol };

    if (limit !== undefined) {
      params.limit = limit;
    }

    return this.get<BinanceOrderBookRaw>(this.endpoints.depth, params);
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

  async fetchTrades(symbol: string, limit?: number): Promise<BinancePublicTradeRaw[]> {
    const params: Record<string, string | number | boolean> = { symbol };

    if (limit !== undefined) {
      params.limit = limit;
    }

    return this.get<BinancePublicTradeRaw[]>(this.endpoints.trades, params);
  }

  async createOrder(params: Record<string, unknown>): Promise<BinanceOrderResponseRaw> {
    return this.signedPost<BinanceOrderResponseRaw>(
      this.endpoints.order,
      params as Record<string, string | number | boolean>,
    );
  }

  async cancelOrder(symbol: string, orderId: string): Promise<BinanceOrderResponseRaw> {
    return this.signedDelete<BinanceOrderResponseRaw>(this.endpoints.order, { symbol, orderId });
  }

  async getOrder(symbol: string, orderId: string): Promise<BinanceOrderResponseRaw> {
    return this.signedGet<BinanceOrderResponseRaw>(this.endpoints.order, { symbol, orderId });
  }

  async getOpenOrders(symbol?: string): Promise<BinanceOrderResponseRaw[]> {
    return this.signedGet<BinanceOrderResponseRaw[]>(this.endpoints.openOrders, this.buildOptionalSymbolParams(symbol));
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
export type { BinanceHttpClientArgs, BinanceEndpoints, BinanceListenKeyResponse } from './BinanceBaseHttpClient.types';
