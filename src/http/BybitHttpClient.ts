import { buildBybitAuthHeaders } from '../auth/bybitAuth';
import { BYBIT_REQUEST_TIMEOUT } from '../constants/bybit';
import { ExchangeError } from '../errors/ExchangeError';
import type {
  BybitClosedPnlRaw,
  BybitFeeRateRaw,
  BybitFundingRateHistoryRaw,
  BybitInstrumentInfoRaw,
  BybitOpenInterestRaw,
  BybitOrderResponseRaw,
  BybitPositionRaw,
  BybitPublicTradeRaw,
  BybitTickerRaw,
  BybitTransactionLogRaw,
  BybitWalletBalanceRaw,
} from '../normalizers/bybitNormalizer';
import { applyTimeRangeOptions } from '../utils/httpParams';
import { BaseHttpClient } from './BaseHttpClient';

import type {
  BybitApiResponse,
  BybitCancelOrderResult,
  BybitHttpClientArgs,
  BybitListResponse,
  BybitOrderBookRaw,
  BybitResponse,
  CategoryFilterArgs,
  FetchBybitKlineArgs,
  FetchPageWithLimitArgs,
  PeriodFilterArgs,
  SetBybitLeverageArgs,
  SwitchBybitIsolatedArgs,
  SymbolFilterArgs,
  SymbolLimitFilterArgs,
} from './BybitHttpClient.types';

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

  private async authenticatedGet<T>(
    path: string,
    params: Record<string, string | number | boolean>,
  ): Promise<T> {
    const headers = this.buildAuthHeaders(this.toQueryString(params));
    const response = await this.get<T & BybitApiResponse>(path, params, headers);

    this.validateResponse(response);

    return response;
  }

  private async authenticatedPost<T>(
    path: string,
    body: Record<string, unknown>,
  ): Promise<T> {
    const headers = this.buildAuthHeaders(JSON.stringify(body));
    const response = await this.post<T & BybitApiResponse>(path, body, headers);

    this.validateResponse(response);

    return response;
  }

  private validateResponse(response: BybitApiResponse): void {
    if (response.retCode !== undefined && response.retCode !== 0) {
      throw new ExchangeError(`Bybit API error ${response.retCode}: ${response.retMsg}`, response.retCode, 'bybit');
    }
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

    if (options?.orderId !== undefined) {
      params.orderId = options.orderId;
    }

    return params;
  }

  async fetchInstrumentsInfo(
    category: string,
    options?: SymbolFilterArgs,
  ): Promise<BybitListResponse<BybitInstrumentInfoRaw>> {
    return this.authenticatedGet('/v5/market/instruments-info', this.buildCategoryParams(category, options));
  }

  async fetchAllInstrumentsInfo(category: string): Promise<BybitInstrumentInfoRaw[]> {
    const allInstrumentList: BybitInstrumentInfoRaw[] = [];
    let cursor: string | undefined;

    do {
      const params: Record<string, string | number | boolean> = { category, limit: 1000 };

      if (cursor) {
        params.cursor = cursor;
      }

      const response = await this.authenticatedGet<BybitListResponse<BybitInstrumentInfoRaw>>(
        '/v5/market/instruments-info',
        params,
      );

      allInstrumentList.push(...response.result.list);
      cursor = response.result.nextPageCursor ?? undefined;
    } while (cursor);

    return allInstrumentList;
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
  ): Promise<BybitListResponse<BybitFundingRateHistoryRaw>> {
    const params: Record<string, string | number | boolean> = { category, symbol };
    applyTimeRangeOptions(params, options);

    return this.authenticatedGet('/v5/market/funding/history', params);
  }

  async fetchOpenInterest(
    category: string,
    symbol: string,
    options?: PeriodFilterArgs,
  ): Promise<BybitListResponse<BybitOpenInterestRaw>> {
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
  ): Promise<BybitListResponse<BybitPublicTradeRaw>> {
    const params: Record<string, string | number | boolean> = { category, symbol };

    if (limit !== undefined) {
      params.limit = limit;
    }

    return this.authenticatedGet('/v5/market/recent-trade', params);
  }

  async createOrder(params: Record<string, unknown>): Promise<BybitResponse<BybitOrderResponseRaw>> {
    return this.authenticatedPost('/v5/order/create', params);
  }

  async amendOrder(params: Record<string, unknown>): Promise<BybitResponse<Record<string, unknown>>> {
    return this.authenticatedPost('/v5/order/amend', params);
  }

  async cancelOrder(params: Record<string, unknown>): Promise<BybitResponse<BybitCancelOrderResult>> {
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
  ): Promise<BybitListResponse<BybitOrderResponseRaw>> {
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
  ): Promise<BybitListResponse<BybitClosedPnlRaw>> {
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
  ): Promise<BybitListResponse<BybitFeeRateRaw>> {
    return this.authenticatedGet('/v5/account/fee-rate', this.buildCategoryParams(category, options));
  }

  async setMarginMode(mode: string): Promise<Record<string, unknown>> {
    return this.authenticatedPost('/v5/account/set-margin-mode', { setMarginMode: mode });
  }

  async setPositionMode(
    category: string,
    mode: number,
    coin?: string,
  ): Promise<Record<string, unknown>> {
    const body: Record<string, unknown> = { category, mode };

    if (coin !== undefined) {
      body.coin = coin;
    }

    return this.authenticatedPost('/v5/position/switch-mode', body);
  }

  async fetchTransactionLog(
    options?: CategoryFilterArgs,
  ): Promise<BybitListResponse<BybitTransactionLogRaw>> {
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
