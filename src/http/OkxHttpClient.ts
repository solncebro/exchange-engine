import { buildOkxAuthHeaders, buildOkxRestTimestamp } from '../auth/okxAuth';
import {
  OKX_BATCH_ACCEPTED_CODE_LIST,
  OKX_DEMO_TRADING_HEADER_NAME,
  OKX_DEMO_TRADING_HEADER_VALUE,
  OKX_EXPECTED_ERROR_CODE_LIST,
  OKX_MAX_PAGE_COUNT,
  OKX_ORDER_PAGE_LIMIT,
  OKX_POSITIONS_HISTORY_PAGE_LIMIT,
  OKX_RATE_LIMIT_ERROR_CODE,
  OKX_RATE_LIMIT_RETRY_DELAY_MS,
  OKX_REQUEST_TIMEOUT,
  OKX_STALE_TIMESTAMP_ATTEMPT_LIMIT,
  OKX_STALE_TIMESTAMP_ERROR_CODE,
  OKX_SUCCESS_CODE,
} from '../constants/okx';
import { ExchangeError } from '../errors/ExchangeError';
import type {
  OkxAccountConfigRaw,
  OkxAlgoOrderRaw,
  OkxAlgoOrderResultRaw,
  OkxBalanceRaw,
  OkxBillRaw,
  OkxFeeRateRaw,
  OkxFundingRateHistoryRaw,
  OkxFundingRateRaw,
  OkxIndexTickerRaw,
  OkxInstrumentRaw,
  OkxMarkPriceRaw,
  OkxOpenInterestRaw,
  OkxOrderBookRaw,
  OkxOrderRaw,
  OkxOrderResultRaw,
  OkxPositionHistoryRaw,
  OkxPositionModeRaw,
  OkxPositionRaw,
  OkxPositionTierRaw,
  OkxPublicTradeRaw,
  OkxSetLeverageRaw,
  OkxTickerRaw,
} from '../normalizers/okxNormalizer';
import { buildOptionalParams } from '../utils/httpParams';
import { toOkxErrorCode } from '../utils/okxErrorCode';
import { serializeQueryParams } from '../utils/serializeQueryParams';
import { sleep } from '../utils/sleep';
import { BaseHttpClient } from './BaseHttpClient';
import type { HttpPostBody } from './BaseHttpClient.types';
import { isOkxStaleTimestampError } from './okxTimestampError';
import type {
  CancelOkxAlgoOrderParams,
  CancelOkxOrderParams,
  FetchAllOkxAlgoOrderHistoryArgs,
  FetchAllOkxOrderHistoryArgs,
  FetchAllOkxPositionsHistoryArgs,
  FetchOkxAlgoOrderArgs,
  FetchOkxAlgoOrderHistoryArgs,
  FetchOkxAllPagesArgs,
  FetchOkxBillsArgs,
  FetchOkxCandlesArgs,
  FetchOkxFundingRateHistoryArgs,
  FetchOkxIndexTickersArgs,
  FetchOkxOrderArgs,
  FetchOkxOrderHistoryArgs,
  FetchOkxPendingAlgoOrdersArgs,
  FetchOkxPendingOrdersArgs,
  FetchOkxPositionsArgs,
  FetchOkxPositionTiersArgs,
  FetchOkxPositionsHistoryArgs,
  FetchOkxTradeFeeArgs,
  OkxApiResponse,
  OkxHttpClientArgs,
  OkxInstrumentType,
  OkxTimeRangeArgs,
  SetOkxLeverageArgs,
} from './OkxHttpClient.types';

/**
 * Тело с кодом 200, но не в формате OKX: страница защиты перед биржей, посредник, ответивший
 * своим текстом. Раньше такое тело роняло клиент внутренней ошибкой языка («Cannot read
 * properties of undefined (reading 'trim')») — по ней невозможно понять, что произошло, и она
 * читается как поломка библиотеки; вдобавок повтор по превышению частоты (ловит только
 * `ExchangeError` с кодом 50011) мимо неё пролетал, а именно страница защиты — самый частый повод
 * для такого тела. Обе соседние биржи от этого защищены: Bybit смотрит `retCode !== undefined`,
 * Binance — `'code' in response`.
 */
function isOkxApiResponseShape(response: unknown): boolean {
  return typeof response === 'object' && response !== null && 'code' in response && typeof response.code === 'string';
}

/** OKX принимает параметры запроса строками — число, положенное как число, биржа берёт не везде. */
function toOkxParamValue(value: string | number | boolean): string | number | boolean {
  return typeof value === 'number' ? String(value) : value;
}

class OkxHttpClient extends BaseHttpClient {
  private readonly secret: string;
  private readonly passphrase: string;
  private readonly isDemoMode: boolean;

  constructor(args: OkxHttpClientArgs) {
    super({ baseUrl: args.baseUrl, apiKey: args.apiKey, logger: args.logger, timeout: OKX_REQUEST_TIMEOUT, httpsAgent: args.httpsAgent });

    if (args.passphrase === '' && (args.apiKey !== '' || args.secret !== '')) {
      throw new ExchangeError('OKX API requires a passphrase (ExchangeConfig.passphrase)', 'OKX_PASSPHRASE_REQUIRED', 'OKX');
    }

    this.secret = args.secret;
    this.passphrase = args.passphrase;
    this.isDemoMode = args.isDemoMode;
  }

  protected override get errorExchangeLabel(): string {
    return 'OKX';
  }

  private buildRequestPath(path: string, params?: Record<string, string | number | boolean>): string {
    if (params !== undefined && Object.keys(params).length > 0) {
      return `${path}?${serializeQueryParams(params)}`;
    }

    return path;
  }

  private buildSignedHeaders(method: 'GET' | 'POST', requestPath: string, body: string): Record<string, string> {
    if (this.apiKey === '' || this.secret === '' || this.passphrase === '') {
      throw new ExchangeError('OKX private requests require complete credentials', 'OKX_CREDENTIALS_REQUIRED', 'OKX');
    }

    const headers = buildOkxAuthHeaders({
      apiKey: this.apiKey,
      secret: this.secret,
      passphrase: this.passphrase,
      method,
      requestPath,
      body,
      timestamp: buildOkxRestTimestamp(Date.now()),
    });

    if (this.isDemoMode) {
      return { ...headers, [OKX_DEMO_TRADING_HEADER_NAME]: OKX_DEMO_TRADING_HEADER_VALUE };
    }

    return headers;
  }

  private buildPublicHeaders(): Record<string, string> {
    if (this.isDemoMode) {
      return { [OKX_DEMO_TRADING_HEADER_NAME]: OKX_DEMO_TRADING_HEADER_VALUE };
    }

    return {};
  }

  /**
   * Тот же общий сборщик, что у Bybit, но с преобразованием: OKX ждёт параметры строками, а
   * Bybit оставляет числа числами — поэтому преобразование живёт здесь, а не в общем помощнике.
   */
  private buildOkxOptionalParams(
    entryList: Record<string, string | number | boolean | undefined>,
  ): Record<string, string | number | boolean> {
    return buildOptionalParams(entryList, toOkxParamValue);
  }

  private buildTimeRangeParams(options?: OkxTimeRangeArgs): Record<string, string | number | boolean> {
    return this.buildOkxOptionalParams({ after: options?.after, before: options?.before, limit: options?.limit });
  }

  private async getValidated<T>(send: () => Promise<OkxApiResponse<T>>): Promise<T[]> {
    try {
      const response = await send();

      this.validateResponse(response);

      return response.data ?? [];
    } catch (error) {
      if (!(error instanceof ExchangeError) || error.code !== OKX_RATE_LIMIT_ERROR_CODE) {
        throw error;
      }

      this.logger.warn(`OKX rate limit hit (code ${OKX_RATE_LIMIT_ERROR_CODE}); retrying once after ${OKX_RATE_LIMIT_RETRY_DELAY_MS}ms`);
      await sleep(OKX_RATE_LIMIT_RETRY_DELAY_MS);

      const retryResponse = await send();

      this.validateResponse(retryResponse);

      return retryResponse.data ?? [];
    }
  }

  private async publicGet<T>(path: string, params?: Record<string, string | number | boolean>): Promise<T[]> {
    return this.getValidated<T>(() => this.get<OkxApiResponse<T>>(path, params, this.buildPublicHeaders()));
  }

  private async signedGet<T>(path: string, params?: Record<string, string | number | boolean>): Promise<T[]> {
    return this.signedRequest(() =>
      this.getValidated<T>(() =>
        this.get<OkxApiResponse<T>>(path, params, () => this.buildSignedHeaders('GET', this.buildRequestPath(path, params), '')),
      ),
    );
  }

  private async signedPost<T>(path: string, body: HttpPostBody): Promise<OkxApiResponse<T>> {
    return this.signedRequest(async () => {
      const bodyText = JSON.stringify(body);
      const headers = this.buildSignedHeaders('POST', path, bodyText);
      const response = await this.post<OkxApiResponse<T>>(path, body, headers);

      if (response.code === String(OKX_STALE_TIMESTAMP_ERROR_CODE)) {
        throw new ExchangeError(`OKX API error ${response.code}: ${response.msg}`, OKX_STALE_TIMESTAMP_ERROR_CODE, 'OKX');
      }

      return response;
    });
  }

  private async signedRequest<T>(send: () => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await send();
      } catch (error) {
        if (attempt >= OKX_STALE_TIMESTAMP_ATTEMPT_LIMIT || !isOkxStaleTimestampError(error)) {
          throw error;
        }

        this.logger.warn(
          `OKX rejected a stale timestamp; re-signing and retrying (attempt ${attempt + 1}/${OKX_STALE_TIMESTAMP_ATTEMPT_LIMIT})`,
        );
      }
    }
  }

  private logExpectedErrorCode(errorCode: number | string, message: string): void {
    if (typeof errorCode === 'number' && OKX_EXPECTED_ERROR_CODE_LIST.includes(errorCode)) {
      this.logger.info(`OKX returned an expected error ${errorCode}: ${message} (handled by the caller)`);
    }
  }

  private validateResponse<T>(response: OkxApiResponse<T>): void {
    if (!isOkxApiResponseShape(response)) {
      throw new ExchangeError(
        'OKX answered with HTTP 200 but not in its own format (no textual `code` field) — most likely a protection page or a proxy in front of the exchange',
        'OKX_UNEXPECTED_RESPONSE_FORMAT',
        'OKX',
      );
    }

    if (response.code === OKX_SUCCESS_CODE) {
      return;
    }

    const errorCode = toOkxErrorCode(response.code);

    this.logExpectedErrorCode(errorCode, response.msg);

    throw new ExchangeError(`OKX API error ${response.code}: ${response.msg}`, errorCode, 'OKX');
  }

  /**
   * Исход ОТДЕЛЬНОЙ заявки живёт в `sCode` записи, а не только в коде конверта: биржа отвечает
   * `code: '0'` и при этом кладёт в запись отказ (например `sCode: '51008'`, «недостаточно
   * средств») с пустым номером заявки. Пока `sCode` смотрели только при неуспешном конверте,
   * такая запись возвращалась как успех, и клиент докладывал о поставленной заявке с пустым
   * номером. Пакетный путь от этого защищён (`buildPlacedOrderOutcome` отвергает пустой номер),
   * одиночный — не был.
   */
  private validateOrderResponse<T extends { sCode: string; sMsg: string }>(response: OkxApiResponse<T>): T {
    const item = (response.data ?? [])[0];

    if (item !== undefined && item.sCode !== OKX_SUCCESS_CODE) {
      const errorCode = toOkxErrorCode(item.sCode);

      this.logExpectedErrorCode(errorCode, item.sMsg);

      throw new ExchangeError(`OKX order error ${item.sCode}: ${item.sMsg}`, errorCode, 'OKX');
    }

    if (response.code !== OKX_SUCCESS_CODE) {
      this.validateResponse(response);
    }

    if (item === undefined) {
      throw new ExchangeError('OKX returned an empty order response', 'OKX_EMPTY_ORDER_RESPONSE', 'OKX');
    }

    return item;
  }

  /**
   * Коды `1` (весь пакет отвергнут) и `2` (частично) исключением не считаются — исход каждой
   * заявки приезжает своей записью. Но если записей НЕТ вовсе, а код не успешный, значит пакет
   * отвергнут ДО поштучной обработки, и единственная причина лежит в `msg` конверта. Пока
   * исключения здесь не было, наружу уходил пустой список, каждая заявка получала исход «биржа не
   * ответила про эту запись пакета», а текст биржи не доходил до вызывающего никогда.
   */
  private validateBatchResponse<T>(response: OkxApiResponse<T>): OkxApiResponse<T> {
    if (!OKX_BATCH_ACCEPTED_CODE_LIST.includes(response.code)) {
      this.validateResponse(response);
    }

    const dataList = response.data ?? [];

    if (dataList.length === 0 && response.code !== OKX_SUCCESS_CODE) {
      const errorCode = toOkxErrorCode(response.code);

      this.logExpectedErrorCode(errorCode, response.msg);

      throw new ExchangeError(`OKX rejected the whole batch (${response.code}): ${response.msg}`, errorCode, 'OKX');
    }

    return { ...response, data: dataList };
  }

  async fetchInstruments(instType: OkxInstrumentType): Promise<OkxInstrumentRaw[]> {
    return this.publicGet<OkxInstrumentRaw>('/api/v5/public/instruments', { instType });
  }

  async fetchTickers(instType: OkxInstrumentType): Promise<OkxTickerRaw[]> {
    return this.publicGet<OkxTickerRaw>('/api/v5/market/tickers', { instType });
  }

  async fetchCandles(args: FetchOkxCandlesArgs): Promise<string[][]> {
    const params: Record<string, string | number | boolean> = {
      instId: args.instId,
      bar: args.bar,
      ...this.buildTimeRangeParams(args),
    };

    return this.publicGet<string[]>('/api/v5/market/candles', params);
  }

  async fetchHistoryCandles(args: FetchOkxCandlesArgs): Promise<string[][]> {
    const params: Record<string, string | number | boolean> = {
      instId: args.instId,
      bar: args.bar,
      ...this.buildTimeRangeParams(args),
    };

    return this.publicGet<string[]>('/api/v5/market/history-candles', params);
  }

  async fetchOrderBook(instId: string, depth?: number): Promise<OkxOrderBookRaw[]> {
    const params: Record<string, string | number | boolean> = { instId, ...this.buildOkxOptionalParams({ sz: depth }) };

    return this.publicGet<OkxOrderBookRaw>('/api/v5/market/books', params);
  }

  async fetchTrades(instId: string, limit?: number): Promise<OkxPublicTradeRaw[]> {
    const params: Record<string, string | number | boolean> = { instId, ...this.buildOkxOptionalParams({ limit }) };

    return this.publicGet<OkxPublicTradeRaw>('/api/v5/market/trades', params);
  }

  async fetchMarkPrice(instType: OkxInstrumentType, instId?: string): Promise<OkxMarkPriceRaw[]> {
    const params: Record<string, string | number | boolean> = { instType, ...this.buildOkxOptionalParams({ instId }) };

    return this.publicGet<OkxMarkPriceRaw>('/api/v5/public/mark-price', params);
  }

  /**
   * Индексная цена: своя ручка, потому что ответ цены маркировки её не несёт. Адресуется либо
   * одним индексом (`instId`, это контракт без хвоста `-SWAP`), либо валютой котировки
   * (`quoteCcy`) — тогда приходят все индексы этой валюты одним ответом.
   */
  async fetchIndexTickers(args: FetchOkxIndexTickersArgs): Promise<OkxIndexTickerRaw[]> {
    const params = this.buildOkxOptionalParams({ instId: args.instId, quoteCcy: args.quoteCcy });

    return this.publicGet<OkxIndexTickerRaw>('/api/v5/market/index-tickers', params);
  }

  async fetchOpenInterest(instType: OkxInstrumentType, instId: string): Promise<OkxOpenInterestRaw[]> {
    return this.publicGet<OkxOpenInterestRaw>('/api/v5/public/open-interest', { instType, instId });
  }

  async fetchFundingRate(instId: string): Promise<OkxFundingRateRaw[]> {
    return this.publicGet<OkxFundingRateRaw>('/api/v5/public/funding-rate', { instId });
  }

  async fetchFundingRateHistory(args: FetchOkxFundingRateHistoryArgs): Promise<OkxFundingRateHistoryRaw[]> {
    const params: Record<string, string | number | boolean> = {
      instId: args.instId,
      ...this.buildTimeRangeParams(args),
    };

    return this.publicGet<OkxFundingRateHistoryRaw>('/api/v5/public/funding-rate-history', params);
  }

  async fetchPositionTierList(args: FetchOkxPositionTiersArgs): Promise<OkxPositionTierRaw[]> {
    return this.publicGet<OkxPositionTierRaw>('/api/v5/public/position-tiers', {
      instType: args.instType,
      tdMode: args.tdMode,
      instFamily: args.instFamily,
    });
  }

  async fetchBalance(): Promise<OkxBalanceRaw[]> {
    return this.signedGet<OkxBalanceRaw>('/api/v5/account/balance');
  }

  async fetchPositions(args: FetchOkxPositionsArgs): Promise<OkxPositionRaw[]> {
    const params = this.buildOkxOptionalParams({ instType: args.instType, instId: args.instId });

    return this.signedGet<OkxPositionRaw>('/api/v5/account/positions', params);
  }

  async fetchPositionsHistory(args: FetchOkxPositionsHistoryArgs): Promise<OkxPositionHistoryRaw[]> {
    const params: Record<string, string | number | boolean> = {
      ...this.buildTimeRangeParams(args),
      ...this.buildOkxOptionalParams({ instType: args.instType, instId: args.instId }),
    };

    return this.signedGet<OkxPositionHistoryRaw>('/api/v5/account/positions-history', params);
  }

  async fetchAccountConfig(): Promise<OkxAccountConfigRaw[]> {
    return this.signedGet<OkxAccountConfigRaw>('/api/v5/account/config');
  }

  async setPositionMode(posMode: string): Promise<OkxPositionModeRaw[]> {
    const response = await this.signedPost<OkxPositionModeRaw>('/api/v5/account/set-position-mode', { posMode });

    this.validateResponse(response);

    return response.data ?? [];
  }

  async setLeverage(args: SetOkxLeverageArgs): Promise<OkxSetLeverageRaw[]> {
    const body: Record<string, unknown> = {
      instId: args.instId,
      lever: args.lever,
      mgnMode: args.mgnMode,
      ...this.buildOkxOptionalParams({ posSide: args.posSide }),
    };

    const response = await this.signedPost<OkxSetLeverageRaw>('/api/v5/account/set-leverage', body);

    this.validateResponse(response);

    return response.data ?? [];
  }

  async fetchTradeFee(args: FetchOkxTradeFeeArgs): Promise<OkxFeeRateRaw[]> {
    const params: Record<string, string | number | boolean> = {
      instType: args.instType,
      ...this.buildOkxOptionalParams({ instId: args.instId, instFamily: args.instFamily }),
    };

    return this.signedGet<OkxFeeRateRaw>('/api/v5/account/trade-fee', params);
  }

  async fetchBills(args: FetchOkxBillsArgs): Promise<OkxBillRaw[]> {
    const path = args.isArchive ? '/api/v5/account/bills-archive' : '/api/v5/account/bills';
    const params: Record<string, string | number | boolean> = {
      ...this.buildTimeRangeParams(args),
      ...this.buildOkxOptionalParams({
        instType: args.instType,
        instId: args.instId,
        type: args.type,
        subType: args.subType,
        begin: args.begin,
        end: args.end,
      }),
    };

    return this.signedGet<OkxBillRaw>(path, params);
  }

  async placeOrder(params: Record<string, unknown>): Promise<OkxOrderResultRaw> {
    const response = await this.signedPost<OkxOrderResultRaw>('/api/v5/trade/order', params);

    return this.validateOrderResponse(response);
  }

  async placeBatchOrders(paramsList: Array<Record<string, unknown>>): Promise<OkxApiResponse<OkxOrderResultRaw>> {
    const response = await this.signedPost<OkxOrderResultRaw>('/api/v5/trade/batch-orders', paramsList);

    return this.validateBatchResponse(response);
  }

  async cancelOrder(params: CancelOkxOrderParams): Promise<OkxOrderResultRaw> {
    const body: Record<string, unknown> = {
      instId: params.instId,
      ...this.buildOkxOptionalParams({ ordId: params.ordId, clOrdId: params.clOrdId }),
    };

    const response = await this.signedPost<OkxOrderResultRaw>('/api/v5/trade/cancel-order', body);

    return this.validateOrderResponse(response);
  }

  async cancelBatchOrders(paramsList: Array<Record<string, unknown>>): Promise<OkxApiResponse<OkxOrderResultRaw>> {
    const response = await this.signedPost<OkxOrderResultRaw>('/api/v5/trade/cancel-batch-orders', paramsList);

    return this.validateBatchResponse(response);
  }

  async amendOrder(params: Record<string, unknown>): Promise<OkxOrderResultRaw> {
    const response = await this.signedPost<OkxOrderResultRaw>('/api/v5/trade/amend-order', params);

    return this.validateOrderResponse(response);
  }

  async amendBatchOrders(paramsList: Array<Record<string, unknown>>): Promise<OkxApiResponse<OkxOrderResultRaw>> {
    const response = await this.signedPost<OkxOrderResultRaw>('/api/v5/trade/amend-batch-orders', paramsList);

    return this.validateBatchResponse(response);
  }

  async fetchOrder(args: FetchOkxOrderArgs): Promise<OkxOrderRaw[]> {
    const params: Record<string, string | number | boolean> = {
      instId: args.instId,
      ...this.buildOkxOptionalParams({ ordId: args.ordId, clOrdId: args.clOrdId }),
    };

    return this.signedGet<OkxOrderRaw>('/api/v5/trade/order', params);
  }

  async fetchPendingOrders(args: FetchOkxPendingOrdersArgs): Promise<OkxOrderRaw[]> {
    const params: Record<string, string | number | boolean> = {
      instType: args.instType,
      ...this.buildTimeRangeParams(args),
      ...this.buildOkxOptionalParams({ instId: args.instId }),
    };

    return this.signedGet<OkxOrderRaw>('/api/v5/trade/orders-pending', params);
  }

  async fetchAllPendingOrders(args: FetchOkxPendingOrdersArgs): Promise<OkxOrderRaw[]> {
    return this.fetchAllPages<OkxOrderRaw>({
      label: 'fetchAllPendingOrders',
      pageLimit: OKX_ORDER_PAGE_LIMIT,
      after: args.after,
      fetchPage: (after) => this.fetchPendingOrders({ ...args, after, limit: OKX_ORDER_PAGE_LIMIT }),
      resolveCursor: (raw) => raw.ordId,
    });
  }

  async fetchOrderHistory(args: FetchOkxOrderHistoryArgs): Promise<OkxOrderRaw[]> {
    const path = args.isArchive ? '/api/v5/trade/orders-history-archive' : '/api/v5/trade/orders-history';
    const params: Record<string, string | number | boolean> = {
      instType: args.instType,
      ...this.buildTimeRangeParams(args),
      ...this.buildOkxOptionalParams({ instId: args.instId, begin: args.begin, end: args.end }),
    };

    return this.signedGet<OkxOrderRaw>(path, params);
  }

  /**
   * История заявок тоже приходит страницами по сто, и один запрос молча обрезал ответ ровно на
   * сотой записи: месяц торговли активным инструментом выглядел как сто заявок и ни слова о том,
   * что это не всё.
   */
  async fetchAllOrderHistory(args: FetchAllOkxOrderHistoryArgs): Promise<OkxOrderRaw[]> {
    return this.fetchAllPages<OkxOrderRaw>({
      label: 'fetchAllOrderHistory',
      pageLimit: OKX_ORDER_PAGE_LIMIT,
      maxRecordCount: args.maxRecordCount,
      after: args.after,
      fetchPage: (after) => this.fetchOrderHistory({ ...args, after, limit: OKX_ORDER_PAGE_LIMIT }),
      resolveCursor: (raw) => raw.ordId,
    });
  }

  async placeAlgoOrder(params: Record<string, unknown>): Promise<OkxAlgoOrderResultRaw> {
    const response = await this.signedPost<OkxAlgoOrderResultRaw>('/api/v5/trade/order-algo', params);

    return this.validateOrderResponse(response);
  }

  async cancelAlgoOrders(paramsList: CancelOkxAlgoOrderParams[]): Promise<OkxApiResponse<OkxAlgoOrderResultRaw>> {
    const bodyList: Array<Record<string, unknown>> = paramsList.map((params) => ({ algoId: params.algoId, instId: params.instId }));
    const response = await this.signedPost<OkxAlgoOrderResultRaw>('/api/v5/trade/cancel-algos', bodyList);

    return this.validateBatchResponse(response);
  }

  async amendAlgoOrder(params: Record<string, unknown>): Promise<OkxAlgoOrderResultRaw> {
    const response = await this.signedPost<OkxAlgoOrderResultRaw>('/api/v5/trade/amend-algos', params);

    return this.validateOrderResponse(response);
  }

  async fetchAlgoOrder(args: FetchOkxAlgoOrderArgs): Promise<OkxAlgoOrderRaw[]> {
    const params = this.buildOkxOptionalParams({ algoId: args.algoId, algoClOrdId: args.algoClOrdId });

    return this.signedGet<OkxAlgoOrderRaw>('/api/v5/trade/order-algo', params);
  }

  async fetchPendingAlgoOrders(args: FetchOkxPendingAlgoOrdersArgs): Promise<OkxAlgoOrderRaw[]> {
    const params: Record<string, string | number | boolean> = {
      ordType: args.ordType,
      ...this.buildTimeRangeParams(args),
      ...this.buildOkxOptionalParams({ instType: args.instType, instId: args.instId }),
    };

    return this.signedGet<OkxAlgoOrderRaw>('/api/v5/trade/orders-algo-pending', params);
  }

  /**
   * Открытые условные заявки биржа отдаёт страницами по сто. Без дочитывания вызывающий получил
   * бы урезанный список защитных заявок и решил, что по остальным символам стопов нет.
   */
  async fetchAllPendingAlgoOrders(args: FetchOkxPendingAlgoOrdersArgs): Promise<OkxAlgoOrderRaw[]> {
    return this.fetchAllPages<OkxAlgoOrderRaw>({
      label: 'fetchAllPendingAlgoOrders',
      pageLimit: OKX_ORDER_PAGE_LIMIT,
      after: args.after,
      fetchPage: (after) => this.fetchPendingAlgoOrders({ ...args, after, limit: OKX_ORDER_PAGE_LIMIT }),
      resolveCursor: (raw) => raw.algoId,
    });
  }

  async fetchAlgoOrderHistory(args: FetchOkxAlgoOrderHistoryArgs): Promise<OkxAlgoOrderRaw[]> {
    const params: Record<string, string | number | boolean> = {
      ordType: args.ordType,
      ...this.buildTimeRangeParams(args),
      ...this.buildOkxOptionalParams({
        state: args.state,
        algoId: args.algoId,
        instType: args.instType,
        instId: args.instId,
      }),
    };

    return this.signedGet<OkxAlgoOrderRaw>('/api/v5/trade/orders-algo-history', params);
  }

  /**
   * Окна по времени этот вход биржи не принимает вовсе — только страницы по номеру условной
   * заявки, — поэтому отбор по времени остаётся на стороне вызывающего, а здесь ограничивает
   * чтение `maxRecordCount`.
   */
  async fetchAllAlgoOrderHistory(args: FetchAllOkxAlgoOrderHistoryArgs): Promise<OkxAlgoOrderRaw[]> {
    return this.fetchAllPages<OkxAlgoOrderRaw>({
      label: 'fetchAllAlgoOrderHistory',
      pageLimit: OKX_ORDER_PAGE_LIMIT,
      maxRecordCount: args.maxRecordCount,
      after: args.after,
      fetchPage: (after) => this.fetchAlgoOrderHistory({ ...args, after, limit: OKX_ORDER_PAGE_LIMIT }),
      resolveCursor: (raw) => raw.algoId,
    });
  }

  /**
   * Страницы истории позиций адресуются отметкой времени закрытия (`uTime`), а не номером:
   * «records earlier than the requested uTime», причём все записи с одной отметкой приходят
   * в одном ответе — поэтому шаг курсором не теряет и не задваивает строки.
   */
  async fetchAllPositionsHistory(args: FetchAllOkxPositionsHistoryArgs): Promise<OkxPositionHistoryRaw[]> {
    return this.fetchAllPages<OkxPositionHistoryRaw>({
      label: 'fetchAllPositionsHistory',
      pageLimit: OKX_POSITIONS_HISTORY_PAGE_LIMIT,
      maxRecordCount: args.maxRecordCount,
      after: args.after,
      fetchPage: (after) => this.fetchPositionsHistory({ ...args, after, limit: OKX_POSITIONS_HISTORY_PAGE_LIMIT }),
      resolveCursor: (raw) => raw.uTime,
    });
  }

  private async fetchAllPages<T>(args: FetchOkxAllPagesArgs<T>): Promise<T[]> {
    const allEntryList: T[] = [];
    let after = args.after;

    for (let pageCount = 0; pageCount < OKX_MAX_PAGE_COUNT; pageCount++) {
      const page = await args.fetchPage(after);

      allEntryList.push(...page);

      const hasEnough = args.maxRecordCount !== undefined && allEntryList.length >= args.maxRecordCount;

      if (page.length < args.pageLimit || hasEnough) {
        return allEntryList;
      }

      after = args.resolveCursor(page[page.length - 1]);
    }

    this.logger.warn(`OKX ${args.label} reached the page count limit (${OKX_MAX_PAGE_COUNT}); returning a partial result`);

    return allEntryList;
  }
}

export { OkxHttpClient };
