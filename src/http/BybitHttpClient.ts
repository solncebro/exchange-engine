import type { ExchangeLogger } from '../types/common';
import type { FetchPageWithLimitArgs } from '../types/exchange';
import type {
  BybitInstrumentInfoRaw,
  BybitTickerRaw,
  BybitPositionRaw,
  BybitOrderResponseRaw,
  BybitWalletBalanceRaw,
} from '../normalizers/bybitNormalizer';
import { buildBybitAuthHeaders } from '../auth/bybitAuth';
import { applyTimeRangeOptions } from '../utils/httpParams';
import { BYBIT_REQUEST_TIMEOUT } from '../constants/bybit';
import { BaseHttpClient } from './BaseHttpClient';

interface BybitHttpClientArgs {
  baseUrl: string;
  apiKey: string;
  secret: string;
  logger: ExchangeLogger;
  httpsAgent?: unknown;
}

interface SymbolFilterArgs {
  symbol?: string;
}

interface SymbolLimitFilterArgs {
  symbol?: string;
  limit?: number;
}

interface PeriodFilterArgs {
  period?: string;
  limit?: number;
}

interface CategoryFilterArgs {
  category?: string;
  limit?: number;
}

interface FetchBybitKlineArgs {
  category: string;
  symbol: string;
  interval: string;
  options?: FetchPageWithLimitArgs;
}

interface SetBybitLeverageArgs {
  category: string;
  symbol: string;
  buyLeverage: number;
  sellLeverage: number;
}

interface SwitchBybitIsolatedArgs {
  category: string;
  symbol: string;
  tradeMode: number;
  buyLeverage: number;
  sellLeverage: number;
}

interface BybitListResponse<T> {
  result: { list: T[] };
}

interface BybitResponse<T> {
  result: T;
}

interface BybitOrderBookRaw {
  a: string[][];
  b: string[][];
}

interface BybitCreateOrderApiResponse {
  retCode: number;
  retMsg: string;
  result: BybitOrderResponseRaw;
}

class BybitHttpClient extends BaseHttpClient {
  private readonly secret: string;

  constructor(args: BybitHttpClientArgs) {
    super({ baseUrl: args.baseUrl, apiKey: args.apiKey, logger: args.logger, timeout: BYBIT_REQUEST_TIMEOUT, httpsAgent: args.httpsAgent });
    this.secret = args.secret;
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

    for (const [key, value] of Object.entries(params)) {
      urlParams.append(key, String(value));
    }

    return urlParams.toString();
  }

  private authenticatedGet<T>(
    path: string,
    params: Record<string, string | number | boolean>,
  ): Promise<T> {
    const headers = this.buildAuthHeaders(this.toQueryString(params));

    return this.get<T>(path, params, headers);
  }

  private authenticatedPost<T>(
    path: string,
    body: Record<string, unknown>,
  ): Promise<T> {
    const headers = this.buildAuthHeaders(JSON.stringify(body));

    return this.post<T>(path, body, headers);
  }

  private buildCategoryParams(
    category: string,
    options?: SymbolLimitFilterArgs,
  ): Record<string, string | number | boolean> {
    const params: Record<string, string | number | boolean> = { category };

    if (options?.symbol !== undefined) {
      params.symbol = options.symbol;
    }

    if (options?.limit !== undefined) {
      params.limit = options.limit;
    }

    return params;
  }

  async fetchInstrumentsInfo(
    category: string,
    options?: SymbolFilterArgs,
  ): Promise<BybitListResponse<BybitInstrumentInfoRaw>> {
    return this.authenticatedGet('/v5/market/instruments-info', this.buildCategoryParams(category, options));
  }

  async fetchTickers(
    category: string,
    options?: SymbolFilterArgs,
  ): Promise<BybitListResponse<BybitTickerRaw>> {
    return this.authenticatedGet('/v5/market/tickers', this.buildCategoryParams(category, options));
  }

  async fetchOrderBook(
    category: string,
    symbol: string,
    limit?: number,
  ): Promise<BybitResponse<BybitOrderBookRaw>> {
    const params: Record<string, string | number | boolean> = { category, symbol };

    if (limit !== undefined) {
      params.limit = limit;
    }

    return this.authenticatedGet('/v5/market/orderbook', params);
  }

  async fetchKline(args: FetchBybitKlineArgs): Promise<BybitListResponse<string[]>> {
    const { category, symbol, interval, options } = args;
    const params: Record<string, string | number | boolean> = { category, symbol, interval };
    applyTimeRangeOptions(params, options);

    return this.authenticatedGet('/v5/market/kline', params);
  }

  async fetchFundingHistory(
    category: string,
    symbol: string,
    options?: FetchPageWithLimitArgs,
  ): Promise<BybitListResponse<Record<string, unknown>>> {
    const params: Record<string, string | number | boolean> = { category, symbol };
    applyTimeRangeOptions(params, options);

    return this.authenticatedGet('/v5/market/funding/history', params);
  }

  async fetchOpenInterest(
    category: string,
    symbol: string,
    options?: PeriodFilterArgs,
  ): Promise<BybitListResponse<Record<string, unknown>>> {
    const params: Record<string, string | number | boolean> = { category, symbol };

    if (options?.period !== undefined) {
      params.period = options.period;
    }

    if (options?.limit !== undefined) {
      params.limit = options.limit;
    }

    return this.authenticatedGet('/v5/market/open-interest', params);
  }

  async fetchRecentTrades(
    category: string,
    symbol: string,
    limit?: number,
  ): Promise<BybitListResponse<Record<string, unknown>>> {
    const params: Record<string, string | number | boolean> = { category, symbol };

    if (limit !== undefined) {
      params.limit = limit;
    }

    return this.authenticatedGet('/v5/market/recent-trade', params);
  }

  async createOrder(params: Record<string, unknown>): Promise<BybitResponse<BybitOrderResponseRaw>> {
    const response = await this.authenticatedPost<BybitCreateOrderApiResponse>(
      '/v5/order/create',
      params,
    );

    if (response.retCode !== 0) {
      throw new Error(`Bybit API error ${response.retCode}: ${response.retMsg}`);
    }

    return response;
  }

  async amendOrder(params: Record<string, unknown>): Promise<BybitResponse<Record<string, unknown>>> {
    return this.authenticatedPost('/v5/order/amend', params);
  }

  async cancelOrder(params: Record<string, unknown>): Promise<BybitResponse<Record<string, unknown>>> {
    return this.authenticatedPost('/v5/order/cancel', params);
  }

  async cancelAllOrders(
    category: string,
    symbol?: string,
  ): Promise<BybitListResponse<Record<string, unknown>>> {
    const body: Record<string, unknown> = { category };

    if (symbol !== undefined) {
      body.symbol = symbol;
    }

    return this.authenticatedPost('/v5/order/cancel-all', body);
  }

  async getOpenOrders(
    category: string,
    options?: SymbolLimitFilterArgs,
  ): Promise<BybitListResponse<Record<string, unknown>>> {
    return this.authenticatedGet('/v5/order/realtime', this.buildCategoryParams(category, options));
  }

  async getOrderHistory(
    category: string,
    options?: SymbolLimitFilterArgs,
  ): Promise<BybitListResponse<BybitOrderResponseRaw>> {
    return this.authenticatedGet('/v5/order/history', this.buildCategoryParams(category, options));
  }

  async createBatchOrders(
    category: string,
    requestList: Array<Record<string, unknown>>,
  ): Promise<BybitListResponse<Record<string, unknown>>> {
    return this.authenticatedPost('/v5/order/create-batch', { category, request: requestList });
  }

  async cancelBatchOrders(
    category: string,
    requestList: Array<Record<string, unknown>>,
  ): Promise<BybitListResponse<Record<string, unknown>>> {
    return this.authenticatedPost('/v5/order/cancel-batch', { category, request: requestList });
  }

  async getPositionList(
    category: string,
    options?: SymbolLimitFilterArgs,
  ): Promise<BybitListResponse<BybitPositionRaw>> {
    return this.authenticatedGet('/v5/position/list', this.buildCategoryParams(category, options));
  }

  async setLeverage(args: SetBybitLeverageArgs): Promise<Record<string, unknown>> {
    return this.authenticatedPost('/v5/position/set-leverage', {
      category: args.category,
      symbol: args.symbol,
      buyLeverage: String(args.buyLeverage),
      sellLeverage: String(args.sellLeverage),
    });
  }

  async switchIsolated(args: SwitchBybitIsolatedArgs): Promise<Record<string, unknown>> {
    return this.authenticatedPost('/v5/position/switch-isolated', {
      category: args.category,
      symbol: args.symbol,
      tradeMode: args.tradeMode,
      buyLeverage: String(args.buyLeverage),
      sellLeverage: String(args.sellLeverage),
    });
  }

  async setTradingStop(params: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.authenticatedPost('/v5/position/trading-stop', params);
  }

  async getClosedPnl(
    category: string,
    options?: SymbolLimitFilterArgs,
  ): Promise<BybitListResponse<Record<string, unknown>>> {
    return this.authenticatedGet('/v5/position/closed-pnl', this.buildCategoryParams(category, options));
  }

  async fetchWalletBalance(
    accountType: string,
  ): Promise<BybitResponse<BybitWalletBalanceRaw>> {
    return this.authenticatedGet('/v5/account/wallet-balance', { accountType });
  }

  async fetchAccountInfo(): Promise<BybitResponse<Record<string, unknown>>> {
    return this.authenticatedGet('/v5/account/info', {});
  }

  async fetchFeeRate(
    category: string,
    options?: SymbolFilterArgs,
  ): Promise<BybitResponse<Record<string, unknown>>> {
    return this.authenticatedGet('/v5/account/fee-rate', this.buildCategoryParams(category, options));
  }

  async setMarginMode(mode: string): Promise<Record<string, unknown>> {
    return this.authenticatedPost('/v5/account/set-margin-mode', { setMarginMode: mode });
  }

  async fetchTransactionLog(
    options?: CategoryFilterArgs,
  ): Promise<BybitListResponse<Record<string, unknown>>> {
    const params: Record<string, string | number | boolean> = {};

    if (options?.category !== undefined) {
      params.category = options.category;
    }

    if (options?.limit !== undefined) {
      params.limit = options.limit;
    }

    return this.authenticatedGet('/v5/account/transaction-log', params);
  }
}

export { BybitHttpClient };
