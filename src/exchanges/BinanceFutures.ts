import type {
  CancelBatchOrdersResult,
  CreateOrderWebSocketArgs,
  ExchangeArgs,
  FetchIncomeArgs,
  FetchPageWithLimitArgs,
  ModifyBatchOrderArgs,
  ModifyBatchOrdersResult,
  ModifyOrderArgs,
} from '../types/exchange';
import type { Position, Order, FundingRateHistory, FundingInfo, AccountBalances, MarkPrice, OpenInterest, FeeRate, Income } from '../types/common';
import { MarginModeEnum, PositionModeEnum } from '../types/common';
import { BinanceFuturesHttpClient } from '../http/BinanceFuturesHttpClient';
import type { BinanceOrderResponseRaw } from '../normalizers/binanceNormalizer';
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
  BINANCE_FUTURES_TRADE_WEBSOCKET_URL,
  BINANCE_DEMO_FUTURES_TRADE_WEBSOCKET_URL,
  BINANCE_FUTURES_WEBSOCKET_STREAM_URL,
  BINANCE_DEMO_FUTURES_WEBSOCKET_STREAM_URL,
  BINANCE_FUTURES_WEBSOCKET_MARKET_URL,
  BINANCE_DEMO_FUTURES_WEBSOCKET_MARKET_URL,
  BINANCE_FUTURES_CANCEL_BATCH_CHUNK_SIZE,
  BINANCE_FUTURES_CREATE_BATCH_CHUNK_SIZE,
  BINANCE_FUTURES_MODIFY_BATCH_CHUNK_SIZE,
} from '../constants/binance';
import { BINANCE_ORDER_SIDE_REVERSE } from '../constants/mappings';
import { chunkList as chunkListUtil } from '../utils/chunkList';
import { isBinanceNumericOrderId } from '../utils/binanceOrderId';
import { BinanceBaseClient } from './BinanceBaseClient';
import { BaseExchangeClient } from './BaseExchangeClient';
import type { AxiosLikeError, BinanceModifyBatchOrderParams, BinanceModifyOrderParams } from './BinanceFutures.types';

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

    const webSocketStreamUrl = isDemoMode
      ? BINANCE_DEMO_FUTURES_WEBSOCKET_MARKET_URL
      : BINANCE_FUTURES_WEBSOCKET_MARKET_URL;

    const tradeWebSocketUrl = isDemoMode
      ? BINANCE_DEMO_FUTURES_TRADE_WEBSOCKET_URL
      : BINANCE_FUTURES_TRADE_WEBSOCKET_URL;

    const userDataWebSocketUrl = isDemoMode
      ? BINANCE_DEMO_FUTURES_WEBSOCKET_STREAM_URL
      : BINANCE_FUTURES_WEBSOCKET_STREAM_URL;

    const httpClient = new BinanceFuturesHttpClient({
      baseUrl,
      apiKey: args.config.apiKey,
      secret: args.config.secret,
      logger: args.logger,
      httpsAgent: args.config.httpsAgent,
    });

    const publicStream = new BinanceFuturesPublicStream({
      webSocketUrl: webSocketStreamUrl,
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
      userDataWebSocketUrl,
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

  async fetchPositionSnapshot(symbol: string, positionIdx?: number): Promise<Position | null> {
    if (positionIdx !== undefined && positionIdx !== 0 && positionIdx !== 1 && positionIdx !== 2) {
      throw new Error(
        `fetchPositionSnapshot received invalid positionIdx=${positionIdx} for ${symbol}. ` +
        `Allowed: undefined (oneWay), 0 (oneWay slot), 1 (hedge LONG), 2 (hedge SHORT).`,
      );
    }

    this.logger.debug(`Fetching position snapshot for ${symbol} (positionIdx=${positionIdx ?? 'any'})`);
    const rawPositionList = await this.httpClient.fetchPositionRisk(symbol);
    const filteredList = rawPositionList.filter((p) => p.symbol === symbol);

    if (filteredList.length === 0) {
      return null;
    }

    if (positionIdx === undefined || positionIdx === 0) {
      const hedgeEntry = filteredList.find((p) => p.positionSide === 'LONG' || p.positionSide === 'SHORT');

      if (hedgeEntry !== undefined) {
        throw new Error(
          `fetchPositionSnapshot called without positionIdx but symbol ${symbol} is in hedge mode ` +
          `(response contains LONG/SHORT positionSide entries). Caller MUST pass positionIdx explicitly in hedge mode.`,
        );
      }

      const both = filteredList.find((p) => p.positionSide === 'BOTH');

      if (both === undefined) {
        return null;
      }

      return normalizeBinancePosition(both);
    }

    const targetSide = positionIdx === 1 ? 'LONG' : 'SHORT';
    const matched = filteredList.find((p) => p.positionSide === targetSide);

    if (!matched) {
      return null;
    }

    const normalized = normalizeBinancePosition(matched);

    return { ...normalized, positionIdx };
  }

  async fetchPositionList(symbol: string): Promise<Position[]> {
    this.logger.debug(`Fetching position list for ${symbol}`);
    const rawPositionList = await this.httpClient.fetchPositionRisk(symbol);
    const filteredList = rawPositionList.filter((p) => p.symbol === symbol);

    return filteredList.map((raw) => {
      const normalized = normalizeBinancePosition(raw);

      if (raw.positionSide === 'LONG') {
        return { ...normalized, positionIdx: 1 };
      }

      if (raw.positionSide === 'SHORT') {
        return { ...normalized, positionIdx: 2 };
      }

      return normalized;
    });
  }

  async fetchAllPositions(): Promise<Position[]> {
    this.logger.debug('[Binance] Fetching all positions');
    const rawPositionList = await this.httpClient.fetchPositionRisk(undefined);

    return rawPositionList
      .filter((raw) => Math.abs(parseFloat(raw.positionAmt)) > 0)
      .map((raw) => {
        const normalized = normalizeBinancePosition(raw);

        if (raw.positionSide === 'LONG') {
          return { ...normalized, positionIdx: 1 };
        }

        if (raw.positionSide === 'SHORT') {
          return { ...normalized, positionIdx: 2 };
        }

        return normalized;
      });
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
    if (orderList.length === 0) {
      return [];
    }

    this.logger.debug(`[Binance] Creating batch of ${orderList.length} orders`);
    const chunkedOrderList = chunkListUtil(orderList, BINANCE_FUTURES_CREATE_BATCH_CHUNK_SIZE);
    const aggregatedOrderList: Order[] = [];

    for (const chunk of chunkedOrderList) {
      const paramsList = chunk.map((args) => this.buildBinanceOrderParams(args));
      const rawList = await this.httpClient.createBatchOrders(paramsList);

      rawList.forEach((rawItem, indexInChunk) => {
        if (this.isBinanceBatchErrorItem(rawItem)) {
          const requestedSymbol = chunk[indexInChunk].symbol;
          this.logger.warn(
            { code: rawItem.code, msg: rawItem.msg, symbol: requestedSymbol },
            '[Binance] createBatchOrders: per-order error skipped',
          );

          return;
        }

        aggregatedOrderList.push(normalizeBinanceOrder(rawItem as unknown as BinanceOrderResponseRaw));
      });
    }

    return aggregatedOrderList;
  }

  async cancelBatchOrders(symbol: string, orderIdList: string[]): Promise<CancelBatchOrdersResult> {
    this.logger.debug(`[Binance] Cancelling batch of ${orderIdList.length} orders for ${symbol}`);

    if (orderIdList.length === 0) {
      return [];
    }

    const aggregatedResultList: CancelBatchOrdersResult = [];
    const chunkedOrderIdList = chunkListUtil(orderIdList, BINANCE_FUTURES_CANCEL_BATCH_CHUNK_SIZE);

    for (const chunk of chunkedOrderIdList) {
      const sendableOrderIdList = chunk.filter((orderId) => isBinanceNumericOrderId(orderId));
      const rawList =
        sendableOrderIdList.length > 0 ? await this.httpClient.cancelBatchOrders(symbol, sendableOrderIdList) : [];

      let sentIndex = 0;

      for (const requestedOrderId of chunk) {
        if (!isBinanceNumericOrderId(requestedOrderId)) {
          this.logger.warn(
            { symbol, orderId: requestedOrderId },
            '[Binance] cancelBatchOrders: non-numeric orderId skipped',
          );

          aggregatedResultList.push({
            orderId: requestedOrderId,
            isSuccess: false,
            errorCode: null,
            errorText: 'Binance requires a numeric orderId',
          });

          continue;
        }

        const rawItem = rawList[sentIndex];

        sentIndex += 1;

        const code = typeof rawItem?.['code'] === 'number' ? (rawItem['code'] as number) : null;
        const msg = typeof rawItem?.['msg'] === 'string' ? (rawItem['msg'] as string) : null;
        const status = typeof rawItem?.['status'] === 'string' ? (rawItem['status'] as string) : null;
        const isSuccess = status === 'CANCELED' || (code === null && status !== null);

        aggregatedResultList.push({
          orderId: requestedOrderId,
          isSuccess,
          errorCode: isSuccess ? null : code,
          errorText: isSuccess ? null : (msg ?? 'Unknown error'),
        });
      }
    }

    return aggregatedResultList;
  }

  async modifyBatchOrders(orderList: ModifyBatchOrderArgs[]): Promise<ModifyBatchOrdersResult> {
    if (orderList.length === 0) {
      return [];
    }

    this.logger.debug(`[Binance] Modifying batch of ${orderList.length} orders`);
    const chunkedList = chunkListUtil(orderList, BINANCE_FUTURES_MODIFY_BATCH_CHUNK_SIZE);
    const aggregatedResultList: ModifyBatchOrdersResult = [];

    for (const chunk of chunkedList) {
      const paramsList = chunk.map((args) => this.buildBinanceModifyBatchOrderParams(args));
      const rawList = await this.httpClient.modifyBatchOrders(
        paramsList as unknown as Array<Record<string, unknown>>,
      );

      chunk.forEach((requestedOrder, indexInChunk) => {
        const rawItem = rawList[indexInChunk];
        const code = typeof rawItem?.['code'] === 'number' ? (rawItem['code'] as number) : null;
        const msg = typeof rawItem?.['msg'] === 'string' ? (rawItem['msg'] as string) : null;
        const isSuccess = code === null;

        aggregatedResultList.push({
          orderId: requestedOrder.orderId,
          isSuccess,
          errorCode: isSuccess ? null : code,
          errorText: isSuccess ? null : (msg ?? 'Unknown error'),
        });
      });
    }

    return aggregatedResultList;
  }

  private buildBinanceModifyBatchOrderParams(args: ModifyBatchOrderArgs): BinanceModifyBatchOrderParams {
    const params: BinanceModifyBatchOrderParams = {
      symbol: args.symbol,
      orderId: args.orderId,
      side: BINANCE_ORDER_SIDE_REVERSE[args.side],
    };

    if (args.clientOrderId !== undefined) {
      params.origClientOrderId = args.clientOrderId;
    }

    if (args.price !== undefined) {
      params.price = String(this.priceToPrecision(args.symbol, args.price));
    }

    if (args.amount !== undefined) {
      params.quantity = String(this.amountToPrecision(args.symbol, args.amount));
    }

    if (args.triggerPrice !== undefined) {
      params.stopPrice = String(this.priceToPrecision(args.symbol, args.triggerPrice));
    }

    return params;
  }

  private isBinanceBatchErrorItem(rawItem: unknown): rawItem is { code: number; msg?: string } {
    return (
      typeof rawItem === 'object' &&
      rawItem !== null &&
      typeof (rawItem as { code?: unknown }).code === 'number' &&
      (rawItem as { code: number }).code < 0
    );
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

  async fetchIncome(options?: FetchIncomeArgs): Promise<Income[]> {
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
