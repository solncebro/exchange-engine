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
  BYBIT_LINEAR_BATCH_CHUNK_SIZE,
} from '../constants/bybit';
import { BybitBaseClient } from './BybitBaseClient';

const BYBIT_LEVERAGE_NOOP_ERROR_CODE = 110043;

class BybitLinear extends BybitBaseClient {
  protected readonly marketLabel = 'linear';
  protected readonly batchChunkSize = BYBIT_LINEAR_BATCH_CHUNK_SIZE;

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

  async fetchPositionMode(): Promise<PositionModeEnum | undefined> {
    this.logger.debug('[Bybit] Fetching position mode via USDT settleCoin position list');
    const raw = await this.httpClient.getPositionList('linear', { settleCoin: 'USDT' });
    const positionList = raw.result.list ?? [];

    if (positionList.length === 0) {
      return undefined;
    }

    const hasHedgePosition = positionList.some((position) => position.positionIdx === 1 || position.positionIdx === 2);

    return hasHedgePosition ? PositionModeEnum.Hedge : PositionModeEnum.OneWay;
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

  async fetchPositionSnapshot(symbol: string, positionIdx?: number): Promise<Position | null> {
    this.logger.debug(`Fetching position snapshot for ${symbol} (positionIdx=${positionIdx ?? 'any'})`);
    const raw = await this.httpClient.getPositionList('linear', { symbol });
    const rawList = raw.result.list ?? [];

    if (rawList.length === 0) {
      return null;
    }

    const entryWithMissingIdx = rawList.find((entry) => entry.positionIdx === undefined || entry.positionIdx === null);

    if (entryWithMissingIdx !== undefined) {
      throw new Error(
        `fetchPositionSnapshot received raw entry without positionIdx for ${symbol}. ` +
        `This indicates an unexpected Bybit V5 response shape; cannot safely determine position side.`,
      );
    }

    if (positionIdx === undefined) {
      const hedgeEntry = rawList.find((entry) => entry.positionIdx === 1 || entry.positionIdx === 2);

      if (hedgeEntry !== undefined) {
        throw new Error(
          `fetchPositionSnapshot called without positionIdx but symbol ${symbol} is in hedge mode (raw entries have positionIdx 1/2). ` +
          `Caller MUST pass positionIdx explicitly in hedge mode to avoid non-deterministic side selection.`,
        );
      }

      return normalizeBybitPosition(rawList[0]);
    }

    const matched = rawList.find((entry) => entry.positionIdx === positionIdx);

    if (!matched) {
      return null;
    }

    return normalizeBybitPosition(matched);
  }

  async fetchPositionList(symbol: string): Promise<Position[]> {
    this.logger.debug(`Fetching position list for ${symbol}`);
    const raw = await this.httpClient.getPositionList('linear', { symbol });
    const rawList = raw.result.list ?? [];

    return rawList.map(normalizeBybitPosition);
  }

  async fetchAllPositions(): Promise<Position[]> {
    this.logger.debug('[Bybit] Fetching all positions via settleCoin=USDT');
    const raw = await this.httpClient.getPositionList('linear', { settleCoin: 'USDT' });
    const rawList = raw.result.list ?? [];

    return rawList
      .filter((entry) => parseFloat(entry.size) > 0)
      .map(normalizeBybitPosition);
  }

  async setLeverage(leverage: number, symbol: string): Promise<void> {
    this.logger.info(`Setting leverage to ${leverage}x for ${symbol}`);

    try {
      await this.httpClient.setLeverage({ category: 'linear', symbol, buyLeverage: leverage, sellLeverage: leverage });
    } catch (error) {
      if (error instanceof ExchangeError && error.code === BYBIT_LEVERAGE_NOOP_ERROR_CODE) {
        return;
      }

      throw error;
    }
  }

  async setMarginMode(_marginMode: MarginModeEnum, _symbol: string): Promise<void> {
    this.logger.info('[Bybit] setMarginMode skipped (Unified Account manages margin mode at account level)');
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
