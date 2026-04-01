import type { CreateOrderWebSocketArgs, ExchangeArgs, FetchPageWithLimitArgs } from '../types/exchange';
import type { Position, Order, FundingRateHistory, FundingInfo, MarkPrice, OpenInterest } from '../types/common';
import { MarginModeEnum, PositionModeEnum } from '../types/common';
import { ExchangeError } from '../errors/ExchangeError';
import {
  normalizeBybitPosition,
  normalizeBybitFundingRateHistoryList,
  normalizeBybitMarkPriceList,
  normalizeBybitOpenInterest,
} from '../normalizers/bybitNormalizer';
import {
  BYBIT_PUBLIC_LINEAR_WEBSOCKET_URL,
  BYBIT_DEMO_PUBLIC_LINEAR_WEBSOCKET_URL,
} from '../constants/bybit';
import { BybitBaseClient } from './BybitBaseClient';

class BybitLinear extends BybitBaseClient {
  protected readonly marketLabel = 'linear';

  constructor(args: ExchangeArgs) {
    const isDemoMode = args.config.isDemoMode === true;
    const publicWebSocketUrl = isDemoMode ? BYBIT_DEMO_PUBLIC_LINEAR_WEBSOCKET_URL : BYBIT_PUBLIC_LINEAR_WEBSOCKET_URL;

    super({
      exchangeArgs: args,
      category: 'linear',
      publicWebSocketUrl,
      publicStreamLabel: 'Bybit Linear Public WebSocket',
      tradeStreamLabel: 'Bybit Linear Order WebSocket',
    });
  }

  async createOrderWebSocket(args: CreateOrderWebSocketArgs): Promise<Order> {
    const orderParams = this.buildBybitOrderParams(args);

    return this.submitOrder(orderParams, args);
  }

  async fetchFundingRateHistory(symbol: string, options?: FetchPageWithLimitArgs): Promise<FundingRateHistory[]> {
    this.logger.debug(`[Bybit] Fetching funding rate history for ${symbol}`);
    const raw = await this.httpClient.fetchFundingHistory('linear', symbol, options);

    return normalizeBybitFundingRateHistoryList(raw.result.list);
  }

  async fetchFundingInfo(): Promise<FundingInfo[]> {
    throw new Error('Not implemented for Bybit');
  }

  async fetchPositionMode(): Promise<PositionModeEnum> {
    throw new Error('Not implemented for Bybit');
  }

  async fetchPosition(symbol: string): Promise<Position> {
    this.logger.debug(`Fetching position for ${symbol}`);
    const raw = await this.httpClient.getPositionList('linear', { symbol });
    const position = raw.result.list[0];

    if (!position) {
      throw new Error(`Position not found for ${symbol}`);
    }

    return normalizeBybitPosition(position);
  }

  async setLeverage(leverage: number, symbol: string): Promise<void> {
    this.logger.info(`Setting leverage to ${leverage}x for ${symbol}`);
    await this.httpClient.setLeverage({ category: 'linear', symbol, buyLeverage: leverage, sellLeverage: leverage });
  }

  async setMarginMode(marginMode: MarginModeEnum, symbol: string): Promise<void> {
    this.logger.info(`Setting margin mode to ${marginMode} for ${symbol}`);
    const tradeMode = marginMode === MarginModeEnum.Isolated ? 1 : 0;
    const defaultLeverage = 10;

    await this.httpClient.switchIsolated({
      category: 'linear',
      symbol,
      tradeMode,
      buyLeverage: defaultLeverage,
      sellLeverage: defaultLeverage,
    });
  }

  async fetchMarkPrice(symbol?: string): Promise<MarkPrice[]> {
    this.logger.debug('[Bybit] Fetching mark price');
    const raw = await this.httpClient.fetchTickers(this.category, { symbol });

    return normalizeBybitMarkPriceList(raw.result.list);
  }

  async fetchOpenInterest(symbol: string): Promise<OpenInterest> {
    this.logger.debug(`[Bybit] Fetching open interest for ${symbol}`);
    const raw = await this.httpClient.fetchOpenInterest('linear', symbol);
    const result = normalizeBybitOpenInterest(raw.result.list[0]);

    return { ...result, symbol };
  }

  async setPositionMode(mode: PositionModeEnum): Promise<void> {
    this.logger.info(`[Bybit] Setting position mode to ${mode}`);
    const bybitMode = mode === PositionModeEnum.Hedge ? 3 : 0;

    try {
      await this.httpClient.setPositionMode(this.category, bybitMode);
    } catch (error) {
      if (error instanceof ExchangeError && error.code === 110025) {
        return;
      }

      throw error;
    }
  }
}

export { BybitLinear };
