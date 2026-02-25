import { ExchangeLogger } from '../types/common';
import { buildBinanceSignedParams, buildBinanceAuthHeaders } from '../auth/binanceAuth';
import { BINANCE_FUTURES_BASE_URL, BINANCE_REQUEST_TIMEOUT } from '../constants/binance';
import { BaseHttpClient } from './BaseHttpClient';

export class BinanceFuturesHttpClient extends BaseHttpClient {
  private readonly secret: string;

  constructor(apiKey: string, secret: string, logger: ExchangeLogger) {
    super(BINANCE_FUTURES_BASE_URL, apiKey, logger, BINANCE_REQUEST_TIMEOUT);
    this.secret = secret;
  }

  async fetchExchangeInfo(): Promise<Record<string, unknown>> {
    return this.get<Record<string, unknown>>('/fapi/v1/exchangeInfo');
  }

  async fetchTickers(): Promise<Array<Record<string, unknown>>> {
    return this.get<Array<Record<string, unknown>>>('/fapi/v1/ticker/24hr');
  }

  async fetchOrderBook(symbol: string, limit?: number): Promise<Record<string, unknown>> {
    const params: Record<string, string | number | boolean> = { symbol };

    if (limit !== undefined) {
      params.limit = limit;
    }

    return this.get<Record<string, unknown>>('/fapi/v1/depth', params);
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

    return this.get<Array<unknown[]>>('/fapi/v1/klines', params);
  }

  async fetchTrades(symbol: string, limit?: number): Promise<Array<Record<string, unknown>>> {
    const params: Record<string, string | number | boolean> = { symbol };

    if (limit !== undefined) {
      params.limit = limit;
    }

    return this.get<Array<Record<string, unknown>>>('/fapi/v1/trades', params);
  }

  async fetchMarkPrice(
    symbol?: string
  ): Promise<Record<string, unknown> | Array<Record<string, unknown>>> {
    const params: Record<string, string | number | boolean> = {};

    if (symbol !== undefined) {
      params.symbol = symbol;
    }

    return this.get<Record<string, unknown> | Array<Record<string, unknown>>>(
      '/fapi/v1/premiumIndex',
      params
    );
  }

  async fetchFundingRate(
    symbol?: string,
    options?: { startTime?: number; endTime?: number; limit?: number }
  ): Promise<Array<Record<string, unknown>>> {
    const params: Record<string, string | number | boolean> = {};

    if (symbol !== undefined) {
      params.symbol = symbol;
    }

    if (options?.startTime !== undefined) {
      params.startTime = options.startTime;
    }

    if (options?.endTime !== undefined) {
      params.endTime = options.endTime;
    }

    if (options?.limit !== undefined) {
      params.limit = options.limit;
    }

    return this.get<Array<Record<string, unknown>>>('/fapi/v1/fundingRate', params);
  }

  async fetchOpenInterest(symbol: string): Promise<Record<string, unknown>> {
    return this.get<Record<string, unknown>>('/fapi/v1/openInterest', { symbol });
  }

  async createOrder(params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const signedParams = buildBinanceSignedParams({
      params: params as Record<string, string | number | boolean>,
      secret: this.secret,
    });
    const headers = buildBinanceAuthHeaders(this.apiKey);

    return this.post<Record<string, unknown>>(
      '/fapi/v1/order',
      signedParams as Record<string, unknown>,
      headers
    );
  }

  async modifyOrder(params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const signedParams = buildBinanceSignedParams({
      params: params as Record<string, string | number | boolean>,
      secret: this.secret,
    });
    const headers = buildBinanceAuthHeaders(this.apiKey);

    return this.put<Record<string, unknown>>(
      '/fapi/v1/order',
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
      '/fapi/v1/order',
      signedParams as Record<string, string | number | boolean>,
      headers
    );
  }

  async cancelAllOrders(symbol: string): Promise<Array<Record<string, unknown>>> {
    const signedParams = buildBinanceSignedParams({
      params: { symbol },
      secret: this.secret,
    });
    const headers = buildBinanceAuthHeaders(this.apiKey);

    return this.delete<Array<Record<string, unknown>>>(
      '/fapi/v1/allOpenOrders',
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
      '/fapi/v1/order',
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
      '/fapi/v1/openOrders',
      signedParams as Record<string, string | number | boolean>,
      headers
    );
  }

  async getAllOrders(
    symbol: string,
    options?: { startTime?: number; endTime?: number; limit?: number }
  ): Promise<Array<Record<string, unknown>>> {
    const rawParams: Record<string, string | number | boolean> = { symbol };

    if (options?.startTime !== undefined) {
      rawParams.startTime = options.startTime;
    }

    if (options?.endTime !== undefined) {
      rawParams.endTime = options.endTime;
    }

    if (options?.limit !== undefined) {
      rawParams.limit = options.limit;
    }

    const signedParams = buildBinanceSignedParams({ params: rawParams, secret: this.secret });
    const headers = buildBinanceAuthHeaders(this.apiKey);

    return this.get<Array<Record<string, unknown>>>(
      '/fapi/v1/allOrders',
      signedParams as Record<string, string | number | boolean>,
      headers
    );
  }

  async createBatchOrders(
    orderList: Array<Record<string, unknown>>
  ): Promise<Array<Record<string, unknown>>> {
    const signedParams = buildBinanceSignedParams({
      params: { batchOrders: JSON.stringify(orderList) },
      secret: this.secret,
    });
    const headers = buildBinanceAuthHeaders(this.apiKey);

    return this.post<Array<Record<string, unknown>>>(
      '/fapi/v1/batchOrders',
      signedParams as Record<string, unknown>,
      headers
    );
  }

  async cancelBatchOrders(
    symbol: string,
    orderIdList: string[]
  ): Promise<Array<Record<string, unknown>>> {
    const signedParams = buildBinanceSignedParams({
      params: { symbol, orderIdList: JSON.stringify(orderIdList) },
      secret: this.secret,
    });
    const headers = buildBinanceAuthHeaders(this.apiKey);

    return this.delete<Array<Record<string, unknown>>>(
      '/fapi/v1/batchOrders',
      signedParams as Record<string, string | number | boolean>,
      headers
    );
  }

  async fetchAccount(): Promise<Record<string, unknown>> {
    const signedParams = buildBinanceSignedParams({ params: {}, secret: this.secret });
    const headers = buildBinanceAuthHeaders(this.apiKey);

    return this.get<Record<string, unknown>>(
      '/fapi/v2/account',
      signedParams as Record<string, string | number | boolean>,
      headers
    );
  }

  async fetchPositionRisk(symbol?: string): Promise<Array<Record<string, unknown>>> {
    const rawParams: Record<string, string | number | boolean> = {};

    if (symbol !== undefined) {
      rawParams.symbol = symbol;
    }

    const signedParams = buildBinanceSignedParams({ params: rawParams, secret: this.secret });
    const headers = buildBinanceAuthHeaders(this.apiKey);

    return this.get<Array<Record<string, unknown>>>(
      '/fapi/v2/positionRisk',
      signedParams as Record<string, string | number | boolean>,
      headers
    );
  }

  async fetchCommissionRate(symbol: string): Promise<Record<string, unknown>> {
    const signedParams = buildBinanceSignedParams({
      params: { symbol },
      secret: this.secret,
    });
    const headers = buildBinanceAuthHeaders(this.apiKey);

    return this.get<Record<string, unknown>>(
      '/fapi/v1/commissionRate',
      signedParams as Record<string, string | number | boolean>,
      headers
    );
  }

  async fetchIncome(
    options?: { startTime?: number; endTime?: number; limit?: number }
  ): Promise<Array<Record<string, unknown>>> {
    const rawParams: Record<string, string | number | boolean> = {};

    if (options?.startTime !== undefined) {
      rawParams.startTime = options.startTime;
    }

    if (options?.endTime !== undefined) {
      rawParams.endTime = options.endTime;
    }

    if (options?.limit !== undefined) {
      rawParams.limit = options.limit;
    }

    const signedParams = buildBinanceSignedParams({ params: rawParams, secret: this.secret });
    const headers = buildBinanceAuthHeaders(this.apiKey);

    return this.get<Array<Record<string, unknown>>>(
      '/fapi/v1/income',
      signedParams as Record<string, string | number | boolean>,
      headers
    );
  }

  async setLeverage(symbol: string, leverage: number): Promise<Record<string, unknown>> {
    const signedParams = buildBinanceSignedParams({
      params: { symbol, leverage },
      secret: this.secret,
    });
    const headers = buildBinanceAuthHeaders(this.apiKey);

    return this.post<Record<string, unknown>>(
      '/fapi/v1/leverage',
      signedParams as Record<string, unknown>,
      headers
    );
  }

  async setMarginType(symbol: string, marginType: string): Promise<Record<string, unknown>> {
    const signedParams = buildBinanceSignedParams({
      params: { symbol, marginType },
      secret: this.secret,
    });
    const headers = buildBinanceAuthHeaders(this.apiKey);

    return this.post<Record<string, unknown>>(
      '/fapi/v1/marginType',
      signedParams as Record<string, unknown>,
      headers
    );
  }

  async setPositionMode(dualSidePosition: boolean): Promise<Record<string, unknown>> {
    const signedParams = buildBinanceSignedParams({
      params: { dualSidePosition },
      secret: this.secret,
    });
    const headers = buildBinanceAuthHeaders(this.apiKey);

    return this.post<Record<string, unknown>>(
      '/fapi/v1/positionSide/dual',
      signedParams as Record<string, unknown>,
      headers
    );
  }

  async modifyPositionMargin(
    symbol: string,
    amount: number,
    type: number
  ): Promise<Record<string, unknown>> {
    const signedParams = buildBinanceSignedParams({
      params: { symbol, amount, type },
      secret: this.secret,
    });
    const headers = buildBinanceAuthHeaders(this.apiKey);

    return this.post<Record<string, unknown>>(
      '/fapi/v1/positionMargin',
      signedParams as Record<string, unknown>,
      headers
    );
  }

  async createListenKey(): Promise<{ listenKey: string }> {
    const headers = buildBinanceAuthHeaders(this.apiKey);

    return this.post<{ listenKey: string }>('/fapi/v1/listenKey', {}, headers);
  }

  async keepAliveListenKey(listenKey: string): Promise<void> {
    const headers = buildBinanceAuthHeaders(this.apiKey);

    await this.put<unknown>('/fapi/v1/listenKey', { listenKey }, headers);
  }

  async deleteListenKey(listenKey: string): Promise<void> {
    const headers = buildBinanceAuthHeaders(this.apiKey);

    await this.delete<unknown>(
      '/fapi/v1/listenKey',
      { listenKey } as Record<string, string | number | boolean>,
      headers
    );
  }
}
