import type { BinanceRawPositionRisk } from '../normalizers/binanceNormalizer';
import type { FetchKlinesArgs } from '../types/exchange';
import { buildBinanceSignedParams } from '../auth/binanceAuth';
import { applyTimeRangeOptions } from '../utils/httpParams';
import type { BinanceEndpoints, BinanceHttpClientArgs } from './BinanceBaseHttpClient';
import { BinanceBaseHttpClient } from './BinanceBaseHttpClient';
import { BINANCE_REQUEST_TIMEOUT } from '../constants/binance';

export class BinanceFuturesHttpClient extends BinanceBaseHttpClient {
  protected readonly endpoints: BinanceEndpoints = {
    exchangeInfo: '/fapi/v1/exchangeInfo',
    ticker24hr: '/fapi/v1/ticker/24hr',
    depth: '/fapi/v1/depth',
    klines: '/fapi/v1/klines',
    trades: '/fapi/v1/trades',
    order: '/fapi/v1/order',
    openOrders: '/fapi/v1/openOrders',
    account: '/fapi/v2/account',
    listenKey: '/fapi/v1/listenKey',
  };

  constructor(args: BinanceHttpClientArgs) {
    super(args, BINANCE_REQUEST_TIMEOUT);
  }

  async fetchMarkPrice(
    symbol?: string,
  ): Promise<Record<string, unknown> | Array<Record<string, unknown>>> {
    const params: Record<string, string | number | boolean> = {};

    if (symbol !== undefined) {
      params.symbol = symbol;
    }

    return this.get<Record<string, unknown> | Array<Record<string, unknown>>>(
      '/fapi/v1/premiumIndex',
      params,
    );
  }

  async fetchFundingRate(
    symbol?: string,
    options?: FetchKlinesArgs,
  ): Promise<Array<Record<string, unknown>>> {
    const params: Record<string, string | number | boolean> = {};

    if (symbol !== undefined) {
      params.symbol = symbol;
    }

    applyTimeRangeOptions(params, options);

    return this.get<Array<Record<string, unknown>>>('/fapi/v1/fundingRate', params);
  }

  async fetchOpenInterest(symbol: string): Promise<Record<string, unknown>> {
    return this.get<Record<string, unknown>>('/fapi/v1/openInterest', { symbol });
  }

  async modifyOrder(params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const signed = buildBinanceSignedParams({
      params: params as Record<string, string | number | boolean>,
      secret: this.secret,
    });

    return this.putWithParams<Record<string, unknown>>(
      '/fapi/v1/order',
      signed as Record<string, string | number | boolean>,
      this.authHeaders(),
    );
  }

  async cancelAllOrders(symbol: string): Promise<Array<Record<string, unknown>>> {
    return this.signedDelete<Array<Record<string, unknown>>>(
      '/fapi/v1/allOpenOrders',
      { symbol },
    );
  }

  async getAllOrders(
    symbol: string,
    options?: FetchKlinesArgs,
  ): Promise<Array<Record<string, unknown>>> {
    const params: Record<string, string | number | boolean> = { symbol };
    applyTimeRangeOptions(params, options);

    return this.signedGet<Array<Record<string, unknown>>>('/fapi/v1/allOrders', params);
  }

  async createBatchOrders(
    orderList: Array<Record<string, unknown>>,
  ): Promise<Array<Record<string, unknown>>> {
    return this.signedPost<Array<Record<string, unknown>>>(
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
      { symbol, orderIdList: JSON.stringify(orderIdList) },
    );
  }

  async fetchPositionRisk(symbol?: string): Promise<BinanceRawPositionRisk[]> {
    const params: Record<string, string | number | boolean> = {};

    if (symbol !== undefined) {
      params.symbol = symbol;
    }

    return this.signedGet<BinanceRawPositionRisk[]>('/fapi/v2/positionRisk', params);
  }

  async fetchCommissionRate(symbol: string): Promise<Record<string, unknown>> {
    return this.signedGet<Record<string, unknown>>('/fapi/v1/commissionRate', { symbol });
  }

  async fetchIncome(
    options?: FetchKlinesArgs,
  ): Promise<Array<Record<string, unknown>>> {
    const params: Record<string, string | number | boolean> = {};
    applyTimeRangeOptions(params, options);

    return this.signedGet<Array<Record<string, unknown>>>('/fapi/v1/income', params);
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
