import { buildBybitAuthHeaders } from '../auth/bybitAuth';
import {
  BYBIT_INSTRUMENTS_MAX_PAGE_COUNT,
  BYBIT_OPEN_ORDERS_MAX_PAGE_COUNT,
  BYBIT_OPEN_ORDERS_PAGE_INTERVAL_MS,
  BYBIT_OPEN_ORDERS_PAGE_LIMIT,
  BYBIT_RECV_WINDOW,
  BYBIT_REQUEST_TIMEOUT,
  BYBIT_RISK_LIMIT_MAX_PAGE_COUNT,
  BYBIT_RISK_LIMIT_PAGE_INTERVAL_MS,
  BYBIT_TRANSACTION_LOG_MAX_PAGE_COUNT,
  BYBIT_TRANSACTION_LOG_PAGE_INTERVAL_MS,
} from '../constants/bybit';
import { ExchangeError } from '../errors/ExchangeError';
import { serializeQueryParams } from '../utils/serializeQueryParams';
import { sleep } from '../utils/sleep';
import type {
  BybitClosedPnlRaw,
  BybitFeeRateRaw,
  BybitFundingRateHistoryRaw,
  BybitInstrumentInfoRaw,
  BybitOpenInterestRaw,
  BybitOrderResponseRaw,
  BybitPositionRaw,
  BybitPublicTradeRaw,
  BybitRiskLimitRaw,
  BybitTickerRaw,
  BybitTransactionLogRaw,
  BybitWalletBalanceRaw,
} from '../normalizers/bybitNormalizer';
import { applyTimeRangeOptions, buildOptionalParams } from '../utils/httpParams';
import { BaseHttpClient } from './BaseHttpClient';

import type {
  BybitAmendBatchOrdersResponse,
  BybitApiResponse,
  BybitCancelBatchOrdersResponse,
  BybitCreateBatchOrdersResponse,
  BybitCancelOrderResult,
  BybitHttpClientArgs,
  BybitListResponse,
  BybitOrderBookRaw,
  BybitResponse,
  FetchBybitKlineArgs,
  FetchTransactionLogArgs,
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

  protected override get errorExchangeLabel(): string {
    return 'bybit';
  }

  private buildAuthHeaders(payload: string): Record<string, string> {
    return buildBybitAuthHeaders({
      apiKey: this.apiKey,
      secret: this.secret,
      timestamp: Date.now(),
      recvWindow: BYBIT_RECV_WINDOW,
      payload,
    });
  }

  protected async authenticatedGet<T>(
    path: string,
    params: Record<string, string | number | boolean>,
  ): Promise<T> {
    // Заголовки подписи строятся фабрикой: у Bybit отметка времени тоже проверяется на приёме, а
    // между сборкой и отправкой стоит пауза перед повтором.
    const response = await this.get<T & BybitApiResponse>(path, params, () => this.buildAuthHeaders(serializeQueryParams(params)));

    this.validateResponse(response);

    return response;
  }

  protected async authenticatedPost<T>(
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
    return {
      category,
      ...buildOptionalParams({
        symbol: options?.symbol,
        limit: options?.limit,
        orderId: options?.orderId,
        orderLinkId: options?.orderLinkId,
        settleCoin: options?.settleCoin,
        baseCoin: options?.baseCoin,
        orderFilter: options?.orderFilter,
        startTime: options?.startTime,
        endTime: options?.endTime,
        cursor: options?.cursor,
      }),
    };
  }

  async fetchInstrumentsInfo(
    category: string,
    options?: SymbolFilterArgs,
  ): Promise<BybitListResponse<BybitInstrumentInfoRaw>> {
    return this.authenticatedGet('/v5/market/instruments-info', this.buildCategoryParams(category, options));
  }

  async fetchAllInstrumentsInfo(category: string): Promise<BybitInstrumentInfoRaw[]> {
    const tradingList = await this.fetchInstrumentsInfoByStatus(category, 'Trading');

    if (category !== 'linear') {
      return tradingList;
    }

    const preLaunchList = await this.fetchInstrumentsInfoByStatus(category, 'PreLaunch');

    return [...tradingList, ...preLaunchList];
  }

  private async fetchInstrumentsInfoByStatus(
    category: string,
    status: string,
  ): Promise<BybitInstrumentInfoRaw[]> {
    const allInstrumentList: BybitInstrumentInfoRaw[] = [];
    let cursor: string | undefined;

    for (let pageCount = 0; pageCount < BYBIT_INSTRUMENTS_MAX_PAGE_COUNT; pageCount++) {
      const params: Record<string, string | number | boolean> = { category, limit: 1000, status };

      if (cursor) {
        params.cursor = cursor;
      }

      const response = await this.authenticatedGet<BybitListResponse<BybitInstrumentInfoRaw>>(
        '/v5/market/instruments-info',
        params,
      );

      allInstrumentList.push(...response.result.list);
      cursor = response.result.nextPageCursor ?? undefined;

      if (!cursor) {
        return allInstrumentList;
      }
    }

    this.logger.warn(
      `Bybit instruments-info (${category}, ${status}) reached the page count limit (${BYBIT_INSTRUMENTS_MAX_PAGE_COUNT}); returning a partial result`,
    );

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

  /**
   * Обход открытых заявок по курсору. Страница — 20 (по умолчанию) или заказанные здесь 50 заявок,
   * а счёт один на все символы, поэтому без листания сверх первой страницы заявки терялись бы
   * незамеченными. Конец — по ПУСТОЙ странице: биржа отдаёт непустой курсор и на последней
   * заполненной странице (живой счёт 18.09.2026), поэтому проверять надо список, а не курсор.
   */
  async fetchAllOpenOrders(
    category: string,
    options?: SymbolLimitFilterArgs,
  ): Promise<BybitOrderResponseRaw[]> {
    const allOrderList: BybitOrderResponseRaw[] = [];
    let cursor: string | undefined;

    for (let pageCount = 0; pageCount < BYBIT_OPEN_ORDERS_MAX_PAGE_COUNT; pageCount++) {
      if (pageCount > 0) {
        await sleep(BYBIT_OPEN_ORDERS_PAGE_INTERVAL_MS);
      }

      const response = await this.getOpenOrders(category, { ...options, limit: BYBIT_OPEN_ORDERS_PAGE_LIMIT, cursor });

      allOrderList.push(...response.result.list);
      const nextPageCursor = response.result.nextPageCursor;

      if (response.result.list.length === 0 || nextPageCursor === undefined || nextPageCursor === null || nextPageCursor === '') {
        return allOrderList;
      }

      if (nextPageCursor === cursor) {
        throw new Error('[Bybit] open orders handed out the same page cursor twice — the answer would be incomplete');
      }

      cursor = nextPageCursor;
    }

    throw new Error(
      `[Bybit] open orders reached the page count limit (${BYBIT_OPEN_ORDERS_MAX_PAGE_COUNT}) — the answer would be incomplete`,
    );
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
  ): Promise<BybitCreateBatchOrdersResponse> {
    return this.authenticatedPost('/v5/order/create-batch', { category, request: requestList });
  }

  async cancelBatchOrders(
    category: string,
    requestList: Array<Record<string, unknown>>,
  ): Promise<BybitCancelBatchOrdersResponse> {
    return this.authenticatedPost('/v5/order/cancel-batch', { category, request: requestList });
  }

  async amendBatchOrders(
    category: string,
    requestList: Array<Record<string, unknown>>,
  ): Promise<BybitAmendBatchOrdersResponse> {
    return this.authenticatedPost('/v5/order/amend-batch', { category, request: requestList });
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
    options?: FetchTransactionLogArgs,
  ): Promise<BybitListResponse<BybitTransactionLogRaw>> {
    const params: Record<string, string | number | boolean> = {};

    if (options?.category !== undefined) {
      params.category = options.category;
    }

    if (options?.limit !== undefined) {
      params.limit = options.limit;
    }

    if (options?.startTime !== undefined) {
      params.startTime = options.startTime;
    }

    if (options?.endTime !== undefined) {
      params.endTime = options.endTime;
    }

    if (options?.cursor !== undefined) {
      params.cursor = options.cursor;
    }

    return this.authenticatedGet('/v5/account/transaction-log', params);
  }

  /**
   * Журнал операций за окно ЦЕЛИКОМ: страницы дочитываются по курсору, пока биржа его отдаёт.
   * Журнал один на весь счёт (символ этот вход не принимает), поэтому за несколько часов живой
   * торговли в окне лежит больше одной страницы, и одиночное чтение теряло начисления, лежащие
   * за первой. Курсор без конца — отказ, а не частичный список: см. потолок в константах.
   */
  async fetchAllTransactionLog(options?: FetchTransactionLogArgs): Promise<BybitTransactionLogRaw[]> {
    const allEntryList: BybitTransactionLogRaw[] = [];
    let cursor: string | undefined;

    for (let pageCount = 0; pageCount < BYBIT_TRANSACTION_LOG_MAX_PAGE_COUNT; pageCount++) {
      if (pageCount > 0) {
        await sleep(BYBIT_TRANSACTION_LOG_PAGE_INTERVAL_MS);
      }

      const response = await this.fetchTransactionLog({ ...options, cursor });

      allEntryList.push(...response.result.list);
      const nextPageCursor = response.result.nextPageCursor;

      // Конец журнала биржа обозначает ЗНАЧЕНИЕМ null (проверено на живом счёте 17.09.2026), а не
      // только отсутствием поля или пустой строкой. Прежняя проверка на null не останавливалась:
      // запрос уходил снова с `cursor=null`, десятки раз за секунду, и биржа отвечала 10006
      // «Too many visits» — так падало КАЖДОЕ чтение журнала: фандинг при закрытии и отчёт.
      if (nextPageCursor === undefined || nextPageCursor === null || nextPageCursor === '') {
        return allEntryList;
      }

      // Тот же курсор второй раз — биржа не продвигается; листать дальше значит жечь лимит впустую.
      if (nextPageCursor === cursor) {
        throw new Error('[Bybit] transaction log handed out the same page cursor twice — the answer would be incomplete');
      }

      cursor = nextPageCursor;
    }

    throw new Error(
      `[Bybit] transaction log reached the page count limit (${BYBIT_TRANSACTION_LOG_MAX_PAGE_COUNT}) — the answer would be incomplete`,
    );
  }

  /**
   * Ступени риска символа (или всей категории, когда символ не задан) — страницы дочитываются
   * по курсору, пока биржа его отдаёт. Страница — 15 символов, у linear их ~450, поэтому обход
   * всей категории идёт постранично; с указанным символом ответ умещается в одну страницу, и
   * тот же цикл заканчивает работу на первом же `nextPageCursor`, которого нет.
   */
  async fetchRiskLimitList(category: string, symbol?: string): Promise<BybitRiskLimitRaw[]> {
    const allRiskLimitList: BybitRiskLimitRaw[] = [];
    let cursor: string | undefined;

    for (let pageCount = 0; pageCount < BYBIT_RISK_LIMIT_MAX_PAGE_COUNT; pageCount++) {
      if (pageCount > 0) {
        await sleep(BYBIT_RISK_LIMIT_PAGE_INTERVAL_MS);
      }

      const params: Record<string, string | number | boolean> = { category };

      if (symbol) {
        params.symbol = symbol;
      }

      if (cursor) {
        params.cursor = cursor;
      }

      const response = await this.authenticatedGet<BybitListResponse<BybitRiskLimitRaw>>(
        '/v5/market/risk-limit',
        params,
      );

      allRiskLimitList.push(...response.result.list);
      const nextPageCursor = response.result.nextPageCursor;

      if (nextPageCursor === undefined || nextPageCursor === null || nextPageCursor === '') {
        return allRiskLimitList;
      }

      // Тот же курсор второй раз — биржа не продвигается; листать дальше значит жечь лимит впустую.
      if (nextPageCursor === cursor) {
        this.logger.warn(
          `[Bybit] risk-limit (${category}) handed out the same page cursor twice — returning a partial result`,
        );

        return allRiskLimitList;
      }

      cursor = nextPageCursor;
    }

    this.logger.warn(
      `[Bybit] risk-limit (${category}) reached the page count limit (${BYBIT_RISK_LIMIT_MAX_PAGE_COUNT}); returning a partial result`,
    );

    return allRiskLimitList;
  }
}

export { BybitHttpClient };
