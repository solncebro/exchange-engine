import { ExchangeLogger } from '../types/common';
import { buildBybitAuthHeaders } from '../auth/bybitAuth';
import { BYBIT_BASE_URL, BYBIT_REQUEST_TIMEOUT } from '../constants/bybit';
import { BaseHttpClient } from './BaseHttpClient';

export class BybitHttpClient extends BaseHttpClient {
  private readonly secret: string;

  constructor(apiKey: string, secret: string, logger: ExchangeLogger) {
    super(BYBIT_BASE_URL, apiKey, logger, BYBIT_REQUEST_TIMEOUT);
    this.secret = secret;
  }

  private buildAuthHeaders(payload: string): Record<string, string> {
    return buildBybitAuthHeaders({
      apiKey: this.apiKey,
      secret: this.secret,
      timestamp: Date.now(),
      payload,
    });
  }

  private toQueryString(params: Record<string, string | number | boolean>): string {
    const urlParams = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      urlParams.append(k, String(v));
    }
    return urlParams.toString();
  }

  async fetchInstrumentsInfo(
    category: string,
    options?: { symbol?: string }
  ): Promise<{ result: { list: Array<Record<string, unknown>> } }> {
    const params: Record<string, string | number | boolean> = { category };

    if (options?.symbol !== undefined) {
      params.symbol = options.symbol;
    }

    const headers = this.buildAuthHeaders(this.toQueryString(params));
    return this.get('/v5/market/instruments-info', params, headers);
  }

  async fetchTickers(
    category: string,
    options?: { symbol?: string }
  ): Promise<{ result: { list: Array<Record<string, unknown>> } }> {
    const params: Record<string, string | number | boolean> = { category };

    if (options?.symbol !== undefined) {
      params.symbol = options.symbol;
    }

    const headers = this.buildAuthHeaders(this.toQueryString(params));
    return this.get('/v5/market/tickers', params, headers);
  }

  async fetchOrderBook(
    category: string,
    symbol: string,
    limit?: number
  ): Promise<{ result: { a: string[][]; b: string[][] } }> {
    const params: Record<string, string | number | boolean> = { category, symbol };

    if (limit !== undefined) {
      params.limit = limit;
    }

    const headers = this.buildAuthHeaders(this.toQueryString(params));

    return this.get('/v5/market/orderbook', params, headers);
  }

  async fetchKline(
    category: string,
    symbol: string,
    interval: string,
    options?: { startTime?: number; endTime?: number; limit?: number }
  ): Promise<{ result: { list: string[][] } }> {
    const params: Record<string, string | number | boolean> = { category, symbol, interval };

    if (options?.startTime !== undefined) {
      params.startTime = options.startTime;
    }

    if (options?.endTime !== undefined) {
      params.endTime = options.endTime;
    }

    if (options?.limit !== undefined) {
      params.limit = options.limit;
    }

    const headers = this.buildAuthHeaders(this.toQueryString(params));

    return this.get('/v5/market/kline', params, headers);
  }

  async fetchFundingHistory(
    category: string,
    symbol: string,
    options?: { startTime?: number; endTime?: number; limit?: number }
  ): Promise<{ result: { list: Array<Record<string, unknown>> } }> {
    const params: Record<string, string | number | boolean> = { category, symbol };

    if (options?.startTime !== undefined) {
      params.startTime = options.startTime;
    }

    if (options?.endTime !== undefined) {
      params.endTime = options.endTime;
    }

    if (options?.limit !== undefined) {
      params.limit = options.limit;
    }

    const headers = this.buildAuthHeaders(this.toQueryString(params));

    return this.get('/v5/market/funding/history', params, headers);
  }

  async fetchOpenInterest(
    category: string,
    symbol: string,
    options?: { period?: string; limit?: number }
  ): Promise<{ result: { list: Array<Record<string, unknown>> } }> {
    const params: Record<string, string | number | boolean> = { category, symbol };

    if (options?.period !== undefined) {
      params.period = options.period;
    }

    if (options?.limit !== undefined) {
      params.limit = options.limit;
    }

    const headers = this.buildAuthHeaders(this.toQueryString(params));

    return this.get('/v5/market/open-interest', params, headers);
  }

  async fetchRecentTrades(
    category: string,
    symbol: string,
    limit?: number
  ): Promise<{ result: { list: Array<Record<string, unknown>> } }> {
    const params: Record<string, string | number | boolean> = { category, symbol };

    if (limit !== undefined) {
      params.limit = limit;
    }

    const headers = this.buildAuthHeaders(this.toQueryString(params));

    return this.get('/v5/market/recent-trade', params, headers);
  }

  async createOrder(params: Record<string, unknown>): Promise<{ result: { orderId: string } }> {
    const body = params as Record<string, unknown>;
    const headers = this.buildAuthHeaders(JSON.stringify(body));
    return this.post('/v5/order/create', body, headers);
  }

  async amendOrder(params: Record<string, unknown>): Promise<{ result: Record<string, unknown> }> {
    const body = params as Record<string, unknown>;
    const headers = this.buildAuthHeaders(JSON.stringify(body));
    return this.post('/v5/order/amend', body, headers);
  }

  async cancelOrder(params: Record<string, unknown>): Promise<{ result: Record<string, unknown> }> {
    const body = params as Record<string, unknown>;
    const headers = this.buildAuthHeaders(JSON.stringify(body));
    return this.post('/v5/order/cancel', body, headers);
  }

  async cancelAllOrders(
    category: string,
    symbol?: string
  ): Promise<{ result: { list: Array<Record<string, unknown>> } }> {
    const body: Record<string, unknown> = { category };

    if (symbol !== undefined) {
      body.symbol = symbol;
    }

    const headers = this.buildAuthHeaders(JSON.stringify(body));

    return this.post('/v5/order/cancel-all', body, headers);
  }

  async getOpenOrders(
    category: string,
    options?: { symbol?: string; limit?: number }
  ): Promise<{ result: { list: Array<Record<string, unknown>> } }> {
    const params: Record<string, string | number | boolean> = { category };

    if (options?.symbol !== undefined) {
      params.symbol = options.symbol;
    }

    if (options?.limit !== undefined) {
      params.limit = options.limit;
    }

    const headers = this.buildAuthHeaders(this.toQueryString(params));

    return this.get('/v5/order/realtime', params, headers);
  }

  async getOrderHistory(
    category: string,
    options?: { symbol?: string; limit?: number }
  ): Promise<{ result: { list: Array<Record<string, unknown>> } }> {
    const params: Record<string, string | number | boolean> = { category };

    if (options?.symbol !== undefined) {
      params.symbol = options.symbol;
    }

    if (options?.limit !== undefined) {
      params.limit = options.limit;
    }

    const headers = this.buildAuthHeaders(this.toQueryString(params));

    return this.get('/v5/order/history', params, headers);
  }

  async createBatchOrders(
    category: string,
    requestList: Array<Record<string, unknown>>
  ): Promise<{ result: { list: Array<Record<string, unknown>> } }> {
    const body = { category, request: requestList };
    const headers = this.buildAuthHeaders(JSON.stringify(body));
    return this.post('/v5/order/create-batch', body, headers);
  }

  async cancelBatchOrders(
    category: string,
    requestList: Array<Record<string, unknown>>
  ): Promise<{ result: { list: Array<Record<string, unknown>> } }> {
    const body = { category, request: requestList };
    const headers = this.buildAuthHeaders(JSON.stringify(body));
    return this.post('/v5/order/cancel-batch', body, headers);
  }

  async getPositionList(
    category: string,
    options?: { symbol?: string; limit?: number }
  ): Promise<{ result: { list: Array<Record<string, unknown>> } }> {
    const params: Record<string, string | number | boolean> = { category };

    if (options?.symbol !== undefined) {
      params.symbol = options.symbol;
    }

    if (options?.limit !== undefined) {
      params.limit = options.limit;
    }

    const headers = this.buildAuthHeaders(this.toQueryString(params));

    return this.get('/v5/position/list', params, headers);
  }

  async setLeverage(
    category: string,
    symbol: string,
    buyLeverage: number,
    sellLeverage: number
  ): Promise<Record<string, unknown>> {
    const body = { category, symbol, buyLeverage: String(buyLeverage), sellLeverage: String(sellLeverage) };
    const headers = this.buildAuthHeaders(JSON.stringify(body));
    return this.post('/v5/position/set-leverage', body, headers);
  }

  async switchIsolated(
    category: string,
    symbol: string,
    tradeMode: number,
    buyLeverage: number,
    sellLeverage: number
  ): Promise<Record<string, unknown>> {
    const body = {
      category,
      symbol,
      tradeMode,
      buyLeverage: String(buyLeverage),
      sellLeverage: String(sellLeverage),
    };
    const headers = this.buildAuthHeaders(JSON.stringify(body));
    return this.post('/v5/position/switch-isolated', body, headers);
  }

  async setTradingStop(params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const body = params as Record<string, unknown>;
    const headers = this.buildAuthHeaders(JSON.stringify(body));
    return this.post('/v5/position/trading-stop', body, headers);
  }

  async getClosedPnl(
    category: string,
    options?: { symbol?: string; limit?: number }
  ): Promise<{ result: { list: Array<Record<string, unknown>> } }> {
    const params: Record<string, string | number | boolean> = { category };

    if (options?.symbol !== undefined) {
      params.symbol = options.symbol;
    }

    if (options?.limit !== undefined) {
      params.limit = options.limit;
    }

    const headers = this.buildAuthHeaders(this.toQueryString(params));

    return this.get('/v5/position/closed-pnl', params, headers);
  }

  async fetchWalletBalance(
    accountType: string
  ): Promise<{ result: { list: Array<Record<string, unknown>> } }> {
    const params: Record<string, string | number | boolean> = { accountType };
    const headers = this.buildAuthHeaders(this.toQueryString(params));
    return this.get('/v5/account/wallet-balance', params, headers);
  }

  async fetchAccountInfo(): Promise<{ result: Record<string, unknown> }> {
    const params: Record<string, string | number | boolean> = {};
    const headers = this.buildAuthHeaders(this.toQueryString(params));
    return this.get('/v5/account/info', params, headers);
  }

  async fetchFeeRate(
    category: string,
    options?: { symbol?: string }
  ): Promise<{ result: Record<string, unknown> }> {
    const params: Record<string, string | number | boolean> = { category };

    if (options?.symbol !== undefined) {
      params.symbol = options.symbol;
    }

    const headers = this.buildAuthHeaders(this.toQueryString(params));

    return this.get('/v5/account/fee-rate', params, headers);
  }

  async setMarginMode(mode: string): Promise<Record<string, unknown>> {
    const body = { setMarginMode: mode };
    const headers = this.buildAuthHeaders(JSON.stringify(body));
    return this.post('/v5/account/set-margin-mode', body, headers);
  }

  async fetchTransactionLog(
    options?: { category?: string; limit?: number }
  ): Promise<{ result: { list: Array<Record<string, unknown>> } }> {
    const params: Record<string, string | number | boolean> = {};

    if (options?.category !== undefined) {
      params.category = options.category;
    }

    if (options?.limit !== undefined) {
      params.limit = options.limit;
    }

    const headers = this.buildAuthHeaders(this.toQueryString(params));

    return this.get('/v5/account/transaction-log', params, headers);
  }
}
