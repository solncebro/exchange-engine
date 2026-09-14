import type {
  BinancePositionRiskRaw,
  BinanceFundingRateHistoryRaw,
  BinanceFundingInfoRaw,
  BinanceOrderResponseRaw,
  BinanceAlgoOrderRaw,
  BinanceFuturesAccountRaw,
  BinanceMarkPriceRaw,
  BinanceOpenInterestRaw,
  BinanceCommissionRateRaw,
  BinanceIncomeRaw,
  BinanceUserTradeRaw,
} from '../normalizers/binanceNormalizer';
import type { FetchIncomeArgs, FetchPageWithLimitArgs } from '../types/exchange';
import {
  BINANCE_REQUEST_TIMEOUT,
  BINANCE_FUTURES_ALGO_ORDER_PATH,
  BINANCE_FUTURES_OPEN_ALGO_ORDERS_PATH,
  BINANCE_FUTURES_ALL_ALGO_ORDERS_PATH,
  BINANCE_FUTURES_CANCEL_ALL_ALGO_ORDERS_PATH,
} from '../constants/binance';
import { BINANCE_INCOME_TYPE } from '../constants/mappings';
import { applyTimeRangeOptions } from '../utils/httpParams';
import { serializeBinanceOrderIdList } from '../utils/binanceOrderId';
import type { BinanceEndpoints, BinanceHttpClientArgs } from './BinanceBaseHttpClient';
import { BinanceBaseHttpClient } from './BinanceBaseHttpClient';
import type { BinanceAlgoOrderLookupArgs, BinanceUserTradeQueryArgs } from './BinanceFuturesHttpClient.types';

function buildAlgoOrderLookupParams(
  args: BinanceAlgoOrderLookupArgs,
): Record<string, string | number | boolean> {
  const params: Record<string, string | number | boolean> = {};

  if (args.algoId !== undefined) {
    params.algoId = args.algoId;
  }

  if (args.clientAlgoId !== undefined) {
    params.clientAlgoId = args.clientAlgoId;
  }

  return params;
}

class BinanceFuturesHttpClient extends BinanceBaseHttpClient {
  protected readonly endpoints: BinanceEndpoints = {
    exchangeInfo: '/fapi/v1/exchangeInfo',
    ticker24hr: '/fapi/v1/ticker/24hr',
    depth: '/fapi/v1/depth',
    klines: '/fapi/v1/klines',
    trades: '/fapi/v1/trades',
    order: '/fapi/v1/order',
    openOrders: '/fapi/v1/openOrders',
    allOrders: '/fapi/v1/allOrders',
    account: '/fapi/v3/account',
    listenKey: '/fapi/v1/listenKey',
  };

  constructor(args: BinanceHttpClientArgs) {
    super(args, BINANCE_REQUEST_TIMEOUT);
  }

  protected override get errorExchangeLabel(): string {
    return 'binance';
  }

  async fetchFuturesAccount(): Promise<BinanceFuturesAccountRaw> {
    return this.signedGet<BinanceFuturesAccountRaw>(this.endpoints.account);
  }

  async fetchFundingInfo(symbol?: string): Promise<BinanceFundingInfoRaw[]> {
    return this.get<BinanceFundingInfoRaw[]>('/fapi/v1/fundingInfo', this.buildOptionalSymbolParams(symbol));
  }

  async fetchPositionMode(): Promise<Record<string, unknown>> {
    return this.signedGet<Record<string, unknown>>('/fapi/v1/positionSide/dual', {});
  }

  async fetchMarkPrice(
    symbol?: string,
  ): Promise<BinanceMarkPriceRaw | BinanceMarkPriceRaw[]> {
    return this.get<BinanceMarkPriceRaw | BinanceMarkPriceRaw[]>(
      '/fapi/v1/premiumIndex',
      this.buildOptionalSymbolParams(symbol),
    );
  }

  async fetchFundingRateHistory(
    symbol: string,
    options?: FetchPageWithLimitArgs,
  ): Promise<BinanceFundingRateHistoryRaw[]> {
    const params: Record<string, string | number | boolean> = { symbol };
    applyTimeRangeOptions(params, options);

    return this.get<BinanceFundingRateHistoryRaw[]>('/fapi/v1/fundingRate', params);
  }

  async fetchOpenInterest(symbol: string): Promise<BinanceOpenInterestRaw> {
    return this.get<BinanceOpenInterestRaw>('/fapi/v1/openInterest', { symbol });
  }

  async modifyOrder(params: Record<string, unknown>): Promise<BinanceOrderResponseRaw> {
    return this.signedPut<BinanceOrderResponseRaw>(
      '/fapi/v1/order',
      params as Record<string, string | number | boolean>,
    );
  }

  async cancelAllOrders(symbol: string): Promise<Array<Record<string, unknown>>> {
    return this.signedDelete<Array<Record<string, unknown>>>(
      '/fapi/v1/allOpenOrders',
      { symbol },
    );
  }

  async createBatchOrders(
    orderList: Array<Record<string, unknown>>,
  ): Promise<BinanceOrderResponseRaw[]> {
    return this.signedPost<BinanceOrderResponseRaw[]>(
      '/fapi/v1/batchOrders',
      { batchOrders: JSON.stringify(orderList) },
    );
  }

  async cancelBatchOrders(
    symbol: string,
    orderIdList: string[],
  ): Promise<Array<Record<string, unknown>>> {
    return this.signedDelete<Array<Record<string, unknown>>>(
      '/fapi/v1/batchOrders',
      { symbol, orderIdList: serializeBinanceOrderIdList(orderIdList) },
    );
  }

  async modifyBatchOrders(
    orderList: Array<Record<string, unknown>>,
  ): Promise<Array<Record<string, unknown>>> {
    return this.signedPut<Array<Record<string, unknown>>>(
      '/fapi/v1/batchOrders',
      { batchOrders: JSON.stringify(orderList) },
    );
  }

  async createAlgoOrder(params: Record<string, unknown>): Promise<BinanceAlgoOrderRaw> {
    return this.signedPost<BinanceAlgoOrderRaw>(
      BINANCE_FUTURES_ALGO_ORDER_PATH,
      params as Record<string, string | number | boolean>,
    );
  }

  async fetchAlgoOrder(args: BinanceAlgoOrderLookupArgs): Promise<BinanceAlgoOrderRaw> {
    return this.signedGet<BinanceAlgoOrderRaw>(
      BINANCE_FUTURES_ALGO_ORDER_PATH,
      buildAlgoOrderLookupParams(args),
    );
  }

  async cancelAlgoOrder(args: BinanceAlgoOrderLookupArgs): Promise<Record<string, unknown>> {
    return this.signedDelete<Record<string, unknown>>(
      BINANCE_FUTURES_ALGO_ORDER_PATH,
      buildAlgoOrderLookupParams(args),
    );
  }

  async fetchOpenAlgoOrders(symbol?: string): Promise<BinanceAlgoOrderRaw[]> {
    return this.signedGet<BinanceAlgoOrderRaw[]>(
      BINANCE_FUTURES_OPEN_ALGO_ORDERS_PATH,
      this.buildOptionalSymbolParams(symbol),
    );
  }

  async fetchAllAlgoOrders(
    symbol: string,
    options?: FetchPageWithLimitArgs,
  ): Promise<BinanceAlgoOrderRaw[]> {
    const params: Record<string, string | number | boolean> = { symbol };
    applyTimeRangeOptions(params, options);

    return this.signedGet<BinanceAlgoOrderRaw[]>(BINANCE_FUTURES_ALL_ALGO_ORDERS_PATH, params);
  }

  async cancelAllAlgoOrders(symbol: string): Promise<Record<string, unknown>> {
    return this.signedDelete<Record<string, unknown>>(
      BINANCE_FUTURES_CANCEL_ALL_ALGO_ORDERS_PATH,
      { symbol },
    );
  }

  async fetchPositionRisk(symbol?: string): Promise<BinancePositionRiskRaw[]> {
    return this.signedGet<BinancePositionRiskRaw[]>('/fapi/v3/positionRisk', this.buildOptionalSymbolParams(symbol));
  }

  async fetchCommissionRate(symbol?: string): Promise<BinanceCommissionRateRaw> {
    return this.signedGet<BinanceCommissionRateRaw>('/fapi/v1/commissionRate', this.buildOptionalSymbolParams(symbol));
  }

  async fetchIncome(
    options?: FetchIncomeArgs,
  ): Promise<BinanceIncomeRaw[]> {
    const params: Record<string, string | number | boolean> = {};
    applyTimeRangeOptions(params, options);

    // Фильтрует сама биржа: раньше выбрать можно было только фандинг, а символ не
    // передавался вовсе — приходилось тянуть весь счёт и отсеивать у себя.
    if (options?.incomeType !== undefined) {
      params.incomeType = BINANCE_INCOME_TYPE[options.incomeType];
    }

    if (options?.symbol !== undefined) {
      params.symbol = options.symbol;
    }

    return this.signedGet<BinanceIncomeRaw[]>('/fapi/v1/income', params);
  }

  /**
   * Собственные сделки счёта — единственный вход Binance, дающий реализованный итог и
   * комиссию в разрезе сделки. Символ необязателен: без него отвечает по всему счёту.
   * `fromId` биржа запрещает сочетать с окном времени, поэтому при нём окно не передаётся:
   * так устроен постраничный добор (первая страница — по времени, следующие — по номеру).
   */
  async fetchUserTrades(args: BinanceUserTradeQueryArgs): Promise<BinanceUserTradeRaw[]> {
    const params: Record<string, string | number | boolean> = this.buildOptionalSymbolParams(args.symbol);

    if (args.fromId === undefined) {
      applyTimeRangeOptions(params, args);
    } else {
      params.fromId = args.fromId;

      if (args.limit !== undefined) {
        params.limit = args.limit;
      }
    }

    return this.signedGet<BinanceUserTradeRaw[]>('/fapi/v1/userTrades', params);
  }

  async setLeverage(symbol: string, leverage: number): Promise<Record<string, unknown>> {
    return this.signedPost<Record<string, unknown>>('/fapi/v1/leverage', { symbol, leverage });
  }

  async setMarginType(symbol: string, marginType: string): Promise<Record<string, unknown>> {
    return this.signedPost<Record<string, unknown>>('/fapi/v1/marginType', { symbol, marginType });
  }

  async setPositionMode(dualSidePosition: boolean): Promise<Record<string, unknown>> {
    return this.signedPost<Record<string, unknown>>(
      '/fapi/v1/positionSide/dual',
      { dualSidePosition },
    );
  }

  async modifyPositionMargin(
    symbol: string,
    amount: number,
    type: number,
  ): Promise<Record<string, unknown>> {
    return this.signedPost<Record<string, unknown>>(
      '/fapi/v1/positionMargin',
      { symbol, amount, type },
    );
  }
}

export { BinanceFuturesHttpClient };
