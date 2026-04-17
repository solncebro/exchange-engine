import type { ExchangeArgs, FetchPageWithLimitArgs, ModifyOrderArgs, CreateOrderWebSocketArgs } from '../types/exchange';
import type { Position, Order, FundingRateHistory, FundingInfo, AccountBalances, MarkPrice, OpenInterest, FeeRate, Income } from '../types/common';
import { MarginModeEnum, PositionModeEnum } from '../types/common';
import { BinanceFuturesHttpClient } from '../http/BinanceFuturesHttpClient';
import {
  normalizeBinancePosition,
  normalizeBinanceOrder,
  normalizeBinanceFundingRateHistory,
  normalizeBinanceFundingInfo,
  normalizeBinanceFuturesBalances,
  normalizeBinanceMarkPriceList,
  normalizeBinanceOpenInterest,
  normalizeBinanceCommissionRate,
  normalizeBinanceIncomeList,
} from '../normalizers/binanceNormalizer';
import { BinanceFuturesPublicStream } from '../ws/BinanceFuturesPublicStream';
import {
  BINANCE_KLINE_LIMIT_FUTURES,
  BINANCE_FUTURES_BASE_URL,
  BINANCE_DEMO_FUTURES_BASE_URL,
  BINANCE_FUTURES_WEBSOCKET_COMBINED_URL,
  BINANCE_DEMO_FUTURES_WEBSOCKET_COMBINED_URL,
  BINANCE_FUTURES_TRADE_WEBSOCKET_URL,
  BINANCE_DEMO_FUTURES_TRADE_WEBSOCKET_URL,
  BINANCE_FUTURES_WEBSOCKET_STREAM_URL,
} from '../constants/binance';
import { BinanceBaseClient } from './BinanceBaseClient';
import { BaseExchangeClient } from './BaseExchangeClient';
import type { AxiosLikeError, BinanceModifyOrderParams } from './BinanceFutures.types';

const BINANCE_POSITION_MODE_NOOP_ERROR_CODE = -4059;
const BINANCE_MARGIN_MODE_NOOP_ERROR_CODE = -4046;

function parseBinanceErrorCode(error: unknown): number | null {
  if (!error || typeof error !== 'object') {
    return null;
  }

  const axiosLikeError = error as AxiosLikeError;
  const code = axiosLikeError.response?.data?.code;

  if (typeof code !== 'number') {
    return null;
  }

  return code;
}

class BinanceFutures extends BinanceBaseClient<BinanceFuturesHttpClient> {
  protected readonly marketLabel = 'futures';
  protected readonly klineLimit = BINANCE_KLINE_LIMIT_FUTURES;

  constructor(args: ExchangeArgs) {
    const isDemoMode = args.config.isDemoMode === true;

    const baseUrl = isDemoMode
      ? BINANCE_DEMO_FUTURES_BASE_URL
      : BINANCE_FUTURES_BASE_URL;

    const webSocketCombinedUrl = isDemoMode
      ? BINANCE_DEMO_FUTURES_WEBSOCKET_COMBINED_URL
      : BINANCE_FUTURES_WEBSOCKET_COMBINED_URL;

    const tradeWebSocketUrl = isDemoMode
      ? BINANCE_DEMO_FUTURES_TRADE_WEBSOCKET_URL
      : BINANCE_FUTURES_TRADE_WEBSOCKET_URL;

    const httpClient = new BinanceFuturesHttpClient({
      baseUrl,
      apiKey: args.config.apiKey,
      secret: args.config.secret,
      logger: args.logger,
      httpsAgent: args.config.httpsAgent,
    });

    const publicStream = new BinanceFuturesPublicStream({
      webSocketCombinedUrl,
      logger: args.logger,
      onNotify: BaseExchangeClient.createNotifyHandler(args.onNotify),
      label: 'Binance Futures Public WebSocket',
    });

    super({
      exchangeArgs: args,
      httpClient,
      publicStream,
      tradeWebSocketUrl,
      tradeStreamLabel: 'Binance Futures Order WebSocket',
      userDataWebSocketUrl: BINANCE_FUTURES_WEBSOCKET_STREAM_URL,
    });

    publicStream.setTradeSymbols(this.tradeSymbols);
  }

  protected async fetchAndNormalizeBalances(): Promise<AccountBalances> {
    const raw = await this.httpClient.fetchFuturesAccount();

    return normalizeBinanceFuturesBalances(raw);
  }

  async fetchFundingRateHistory(
    symbol: string,
    options?: FetchPageWithLimitArgs,
  ): Promise<FundingRateHistory[]> {
    this.logger.debug(`Fetching funding rate history for ${symbol}`);
    const raw = await this.httpClient.fetchFundingRateHistory(symbol, options);

    return normalizeBinanceFundingRateHistory(raw);
  }

  async fetchFundingInfo(symbol?: string): Promise<FundingInfo[]> {
    this.logger.debug('Fetching funding info');
    const raw = await this.httpClient.fetchFundingInfo(symbol);

    return normalizeBinanceFundingInfo(raw);
  }

  async fetchPositionMode(): Promise<PositionModeEnum> {
    this.logger.debug('Fetching position mode');
    const raw = await this.httpClient.fetchPositionMode();

    return raw.dualSidePosition === true ? PositionModeEnum.Hedge : PositionModeEnum.OneWay;
  }

  async fetchPosition(symbol: string): Promise<Position> {
    this.logger.debug(`Fetching position for ${symbol}`);
    const rawPositionList = await this.httpClient.fetchPositionRisk(symbol);
    const position = rawPositionList.find((p) => p.symbol === symbol);

    if (!position) {
      throw new Error(`Position not found for ${symbol}`);
    }

    return normalizeBinancePosition(position);
  }

  async setLeverage(leverage: number, symbol: string): Promise<void> {
    this.logger.info(`Setting leverage to ${leverage}x for ${symbol}`);
    await this.httpClient.setLeverage(symbol, leverage);
  }

  async setMarginMode(marginMode: MarginModeEnum, symbol: string): Promise<void> {
    this.logger.info(`Setting margin mode to ${marginMode} for ${symbol}`);
    const marginType = marginMode === MarginModeEnum.Isolated ? 'ISOLATED' : 'CROSSED';

    try {
      await this.httpClient.setMarginType(symbol, marginType);
    } catch (error) {
      const errorCode = parseBinanceErrorCode(error);

      if (errorCode === BINANCE_MARGIN_MODE_NOOP_ERROR_CODE) {
        return;
      }

      throw error;
    }
  }

  async modifyOrder(args: ModifyOrderArgs): Promise<Order> {
    this.logger.debug(`[Binance] Modifying order ${args.orderId} for ${args.symbol}`);
    const params: BinanceModifyOrderParams = {
      symbol: args.symbol,
      orderId: args.orderId,
    };

    if (args.price !== undefined) {
      params.price = String(this.priceToPrecision(args.symbol, args.price));
    }

    if (args.amount !== undefined) {
      params.quantity = String(this.amountToPrecision(args.symbol, args.amount));
    }

    if (args.triggerPrice !== undefined) {
      params.stopPrice = String(this.priceToPrecision(args.symbol, args.triggerPrice));
    }

    const raw = await this.httpClient.modifyOrder(params);

    return normalizeBinanceOrder(raw);
  }

  async cancelAllOrders(symbol: string): Promise<void> {
    this.logger.debug(`[Binance] Cancelling all orders for ${symbol}`);
    await this.httpClient.cancelAllOrders(symbol);
  }

  async createBatchOrders(orderList: CreateOrderWebSocketArgs[]): Promise<Order[]> {
    this.logger.debug(`[Binance] Creating batch of ${orderList.length} orders`);
    const paramsList = orderList.map((args) => this.buildBinanceOrderParams(args));
    const rawList = await this.httpClient.createBatchOrders(paramsList);

    return rawList.map(normalizeBinanceOrder);
  }

  async cancelBatchOrders(symbol: string, orderIdList: string[]): Promise<void> {
    this.logger.debug(`[Binance] Cancelling batch of ${orderIdList.length} orders for ${symbol}`);
    await this.httpClient.cancelBatchOrders(symbol, orderIdList);
  }

  async fetchMarkPrice(symbol?: string): Promise<MarkPrice[]> {
    this.logger.debug('[Binance] Fetching mark price');
    const raw = await this.httpClient.fetchMarkPrice(symbol);
    const rawList = Array.isArray(raw) ? raw : [raw];

    return normalizeBinanceMarkPriceList(rawList);
  }

  async fetchOpenInterest(symbol: string): Promise<OpenInterest> {
    this.logger.debug(`[Binance] Fetching open interest for ${symbol}`);
    const raw = await this.httpClient.fetchOpenInterest(symbol);

    return normalizeBinanceOpenInterest(raw);
  }

  async fetchFeeRate(symbol?: string): Promise<FeeRate[]> {
    this.logger.debug('[Binance] Fetching fee rate');
    const raw = await this.httpClient.fetchCommissionRate(symbol);

    return normalizeBinanceCommissionRate(raw);
  }

  async fetchIncome(options?: FetchPageWithLimitArgs): Promise<Income[]> {
    this.logger.debug('[Binance] Fetching income');
    const rawList = await this.httpClient.fetchIncome(options);

    return normalizeBinanceIncomeList(rawList);
  }

  async setPositionMode(mode: PositionModeEnum): Promise<void> {
    this.logger.info(`[Binance] Setting position mode to ${mode}`);
    const dualSidePosition = mode === PositionModeEnum.Hedge;

    try {
      await this.httpClient.setPositionMode(dualSidePosition);
    } catch (error) {
      const errorCode = parseBinanceErrorCode(error);

      if (errorCode === BINANCE_POSITION_MODE_NOOP_ERROR_CODE) {
        return;
      }

      throw error;
    }
  }
}

export { BinanceFutures };
