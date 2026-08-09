import type { CreateOrderWebSocketArgs, ExchangeArgs, FetchPageWithLimitArgs } from '../types/exchange';
import type { Position, Order, FundingRateHistory, FundingInfo, MarkPrice, OpenInterest } from '../types/common';
import { MarginModeEnum, OrderSideEnum, OrderTypeEnum, PositionModeEnum, TimeInForceEnum } from '../types/common';
import { ExchangeError } from '../errors/ExchangeError';
import type { BybitPositionIdx } from './bybitTrailingStopId';
import {
  buildBybitTrailingStopId,
  parseBybitTrailingStopId,
  resolveBybitPositionIdx,
} from './bybitTrailingStopId';
import {
  normalizeBybitPosition,
  normalizeBybitFundingRateHistoryList,
  normalizeBybitMarkPriceList,
  normalizeBybitOpenInterest,
} from '../normalizers/bybitNormalizer';
import {
  BYBIT_PUBLIC_LINEAR_WEBSOCKET_URL,
  BYBIT_LINEAR_BATCH_CHUNK_SIZE,
} from '../constants/bybit';
import { BybitBaseClient } from './BybitBaseClient';

const BYBIT_LEVERAGE_NOOP_ERROR_CODE = 110043;

/** Скольжение ведёт позицию целиком: частичного режима у него в нашем контракте нет. */
const BYBIT_TRAILING_STOP_TPSL_MODE = 'Full';

/** Как Bybit называет режимы маржи счёта; «обычный» у него и есть кросс-маржа. */
const BYBIT_ISOLATED_MARGIN_MODE = 'ISOLATED_MARGIN';
const BYBIT_CROSS_MARGIN_MODE = 'REGULAR_MARGIN';

interface BuildBybitTrailingStopOrderArgs {
  symbol: string;
  positionIdx: BybitPositionIdx;
  side: OrderSideEnum;
  activationPrice: number;
  status: string;
}

class BybitLinear extends BybitBaseClient {
  protected readonly marketLabel = 'linear';
  protected readonly batchChunkSize = BYBIT_LINEAR_BATCH_CHUNK_SIZE;

  constructor(args: ExchangeArgs) {
    super({
      exchangeArgs: args,
      category: 'linear',
      publicWebSocketUrl: BYBIT_PUBLIC_LINEAR_WEBSOCKET_URL,
      publicStreamLabel: 'Bybit Linear Public WebSocket',
      tradeStreamLabel: 'Bybit Linear Order WebSocket',
    });
  }

  async createOrderWebSocket(args: CreateOrderWebSocketArgs): Promise<Order> {
    if (args.type === OrderTypeEnum.TrailingStop) {
      return this.placeTrailingStop(args);
    }

    const orderParams = this.buildBybitOrderParams(args);

    return this.submitOrder(orderParams, args);
  }

  /**
   * Отступ снаружи приходит в процентах, а Bybit принимает его расстоянием в цене, поэтому
   * нужна опора. Ею служит цена вооружения, если она названа: именно от неё скольжение
   * начинает вести. Не названа — берём текущую цену маркировки, то есть ту же точку, от
   * которой биржа поведёт стоп прямо сейчас.
   */
  private async resolveTrailingReferencePrice(args: CreateOrderWebSocketArgs): Promise<number> {
    if (args.activationPrice !== undefined && args.activationPrice > 0) {
      return args.activationPrice;
    }

    const markPriceList = await this.fetchMarkPrice(args.symbol);
    const markPrice = markPriceList.find((entry) => entry.symbol === args.symbol)?.markPrice;

    if (markPrice === undefined || markPrice <= 0) {
      throw new ExchangeError(
        `Bybit: cannot arm a trailing stop for ${args.symbol} — no mark price to measure the offset from`,
        'TRAILING_STOP_NO_REFERENCE_PRICE',
        'bybit',
      );
    }

    return markPrice;
  }

  private async placeTrailingStop(args: CreateOrderWebSocketArgs): Promise<Order> {
    if (args.callbackRate === undefined || args.callbackRate <= 0) {
      throw new ExchangeError(
        `Bybit: a trailing stop for ${args.symbol} needs a positive offset in percent`,
        'TRAILING_STOP_OFFSET_MISSING',
        'bybit',
      );
    }

    const positionIdx = resolveBybitPositionIdx(args.positionSide);
    const referencePrice = await this.resolveTrailingReferencePrice(args);
    // Расстояние — тоже цена, поэтому кладём его на сетку символа: не по сетке биржа отобьёт.
    const trailingDistance = this.priceToPrecision(args.symbol, referencePrice * args.callbackRate / 100);

    const params: Record<string, unknown> = {
      category: 'linear',
      symbol: args.symbol,
      tpslMode: BYBIT_TRAILING_STOP_TPSL_MODE,
      positionIdx,
      trailingStop: String(trailingDistance),
    };

    if (args.activationPrice !== undefined && args.activationPrice > 0) {
      params.activePrice = String(this.priceToPrecision(args.symbol, args.activationPrice));
    }

    this.logger.debug(
      `[Bybit] Arming trailing stop for ${args.symbol}: offset ${args.callbackRate}% = ${trailingDistance} in price`,
    );
    await this.httpClient.setTradingStop(params);

    return this.buildTrailingStopOrder({
      symbol: args.symbol,
      positionIdx,
      side: args.side,
      activationPrice: args.activationPrice ?? 0,
      status: 'open',
    });
  }

  private buildTrailingStopOrder(args: BuildBybitTrailingStopOrderArgs): Order {
    const timestamp = Date.now();

    return {
      id: buildBybitTrailingStopId(args.positionIdx),
      clientOrderId: '',
      symbol: args.symbol,
      side: args.side,
      type: OrderTypeEnum.TrailingStop,
      timeInForce: TimeInForceEnum.Gtc,
      price: 0,
      avgPrice: 0,
      // Цена вооружения — единственный уровень, который у скольжения вообще есть заранее:
      // уровень выхода биржа ведёт сама и наружу до срабатывания не отдаёт.
      stopPrice: args.activationPrice,
      amount: 0,
      filledAmount: 0,
      filledQuoteAmount: 0,
      status: args.status,
      reduceOnly: true,
      isConditional: true,
      closePosition: true,
      timestamp,
      updatedTimestamp: timestamp,
    };
  }

  async cancelOrder(symbol: string, orderId: string): Promise<Order> {
    const positionIdx = parseBybitTrailingStopId(orderId);

    if (positionIdx === null) {
      return super.cancelOrder(symbol, orderId);
    }

    this.logger.debug(`[Bybit] Clearing trailing stop for ${symbol} (positionIdx=${positionIdx})`);
    // Нулевое расстояние — документированный способ снять скольжение; отдельной отмены нет.
    await this.httpClient.setTradingStop({
      category: 'linear',
      symbol,
      tpslMode: BYBIT_TRAILING_STOP_TPSL_MODE,
      positionIdx,
      trailingStop: '0',
    });

    return this.buildTrailingStopOrder({
      symbol,
      positionIdx,
      side: OrderSideEnum.Buy,
      activationPrice: 0,
      status: 'canceled',
    });
  }

  async getOrder(symbol: string, orderId: string): Promise<Order> {
    const positionIdx = parseBybitTrailingStopId(orderId);

    if (positionIdx === null) {
      return super.getOrder(symbol, orderId);
    }

    const raw = await this.httpClient.getPositionList('linear', { symbol });
    const positionRaw = (raw.result.list ?? []).find((entry) => entry.positionIdx === positionIdx);
    const trailingDistance = parseFloat(String(positionRaw?.['trailingStop'] ?? '0'));

    // Нулевое расстояние на бирже означает «скольжения нет». Отдать его как вооружённую
    // заявку было бы ложью того же сорта, что и молча проглоченный запрос.
    if (!positionRaw || !(trailingDistance > 0)) {
      throw new Error(`Trailing stop ${orderId} not found for ${symbol}`);
    }

    return this.buildTrailingStopOrder({
      symbol,
      positionIdx,
      side: positionRaw.side === 'Buy' ? OrderSideEnum.Sell : OrderSideEnum.Buy,
      activationPrice: parseFloat(String(positionRaw['activePrice'] ?? '0')),
      status: 'open',
    });
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

  /**
   * На едином счёте Bybit режим маржи — свойство ВСЕГО счёта, а не отдельного символа
   * (проверено живым чтением 08.08.2026). Раньше метод просто писал строчку в журнал: у
   * потребителя, попросившего изолированную маржу перед рискованным входом, счёт оставался
   * в прежнем режиме, и узнать об этом было неоткуда.
   *
   * Сначала читаем текущий режим и молчим, если он уже нужный: лишняя запись в настройки
   * счёта — не бесплатное действие, а биржа отбивает её ошибкой.
   */
  async setMarginMode(marginMode: MarginModeEnum, symbol: string): Promise<void> {
    const desiredMode = marginMode === MarginModeEnum.Isolated
      ? BYBIT_ISOLATED_MARGIN_MODE
      : BYBIT_CROSS_MARGIN_MODE;
    const accountInfo = await this.httpClient.fetchAccountInfo();
    const currentMode = accountInfo.result['marginMode'];

    if (currentMode === desiredMode) {
      this.logger.debug(`[Bybit] Margin mode already ${desiredMode} — nothing to switch for ${symbol}`);

      return;
    }

    // Просили за символ, меняем счёт целиком — потребитель обязан узнать об этом громко,
    // иначе соседние позиции поедут в другом режиме молча.
    this.logger.warn(
      `[Bybit] Margin mode is an ACCOUNT-WIDE setting: switching to ${desiredMode} for ${symbol} affects every symbol on this account`,
    );
    await this.httpClient.setMarginMode(desiredMode);
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
