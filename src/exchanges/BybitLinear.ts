import type { SetBybitLeverageArgs, SymbolLimitFilterArgs } from '../http/BybitHttpClient.types';
import type { BybitPositionListWithAccountInfo, BybitRememberedAccountInfo } from './BybitLinear.types';
import type { BybitAccountInfoRaw, BybitPositionRaw } from '../normalizers/bybitNormalizer';
import type { AddIsolatedPositionMarginArgs, FetchOrderExecutionSummaryArgs, SetLeverageOptions } from '../types/exchange';
import type { OrderExecutionSummary } from '../types/common';
import { buildOrderExecutionWindowList, summarizeOrderExecutionList } from '../utils/orderExecutionSummary';
import type { OrderExecutionEntry } from '../utils/orderExecutionSummary.types';
import { sleep } from '../utils/sleep';
import type { CreateOrderWebSocketArgs, ExchangeArgs, FetchFundingRateHistoryArgs, SetLeverageResult } from '../types/exchange';
import type { Position, Order, FundingRateHistory, FundingInfo, MarkPrice, OpenInterest, LeverageTier, LeverageTierListBySymbol } from '../types/common';
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
  normalizeBybitPositionList,
  isBybitPortfolioMarginAccount,
  resolveBybitMarginMode,
  resolveBybitPositionMarginMode,
  normalizeBybitFundingRateHistoryList,
  normalizeBybitFundingInfoList,
  normalizeBybitMarkPriceList,
  normalizeBybitOpenInterest,
  normalizeBybitRiskLimitList,
} from '../normalizers/bybitNormalizer';
import {
  BYBIT_PUBLIC_LINEAR_WEBSOCKET_URL,
  BYBIT_LINEAR_BATCH_CHUNK_SIZE,
  BYBIT_MARK_PRICE_KLINE_READ_INTERVAL_MS,
  BYBIT_ISOLATED_MARGIN_MODE,
  BYBIT_CROSS_MARGIN_MODE,
  BYBIT_LINEAR_SETTLE_COIN,
  BYBIT_MARGIN_MODE_UNKNOWN_ERROR_CODE,
  BYBIT_ORDER_EXECUTION_PAGE_INTERVAL_MS,
  BYBIT_POSITION_MARGIN_DECIMAL_PLACES,
} from '../constants/bybit';
import { BybitBaseClient } from './BybitBaseClient';

const BYBIT_LEVERAGE_NOOP_ERROR_CODE = 110043;
const ONE_MINUTE_MS = 60_000;

/** Скольжение ведёт позицию целиком: частичного режима у него в нашем контракте нет. */
const BYBIT_TRAILING_STOP_TPSL_MODE = 'Full';

// The settle coin of the linear USDT contracts whose position mode is switched as one.
const BYBIT_POSITION_MODE_SETTLE_COIN = 'USDT';

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
  private rememberedAccountInfo: BybitRememberedAccountInfo | null = null;
  private accountInfoReadSequence = 0;

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

  async fetchOrderExecutionSummary(args: FetchOrderExecutionSummaryArgs): Promise<OrderExecutionSummary> {
    const executionList: OrderExecutionEntry[] = [];

    for (const [windowIndex, window] of buildOrderExecutionWindowList(args).entries()) {
      if (windowIndex > 0) await sleep(BYBIT_ORDER_EXECUTION_PAGE_INTERVAL_MS);

      const rawList = await this.httpClient.fetchAllOrderExecutionList({ symbol: args.symbol, orderId: args.orderId, ...window });

      for (const raw of rawList) {
        if (raw.execType !== 'Trade') throw new Error('Unsupported order execution type');

        executionList.push({ id: raw.execId, orderId: raw.orderId, symbol: raw.symbol, amount: Number(raw.execQty), price: Number(raw.execPrice), quoteAmount: Number(raw.execValue), feeAmount: raw.execFee === undefined || raw.execFee === '' ? null : Number(raw.execFee), feeAsset: raw.feeCurrency?.trim() ? raw.feeCurrency : null, timeMs: Number(raw.execTime) });
      }
    }

    return summarizeOrderExecutionList({ ...args, executionList });
  }

  async fetchFundingRateHistory(symbol: string, options?: FetchFundingRateHistoryArgs): Promise<FundingRateHistory[]> {
    this.logger.debug(`[Bybit] Fetching funding rate history for ${symbol}`);
    const raw = await this.httpClient.fetchFundingHistory('linear', symbol, options);
    const fundingRateHistoryList = normalizeBybitFundingRateHistoryList(raw.result.list);

    if (options?.shouldIncludeMarkPrices !== true) {
      return fundingRateHistoryList;
    }

    for (const [index, fundingRateHistory] of fundingRateHistoryList.entries()) {
      if (index > 0) await sleep(BYBIT_MARK_PRICE_KLINE_READ_INTERVAL_MS);

      fundingRateHistory.markPrice = await this.fetchFundingMarkPrice(symbol, fundingRateHistory.fundingTime);
    }

    return fundingRateHistoryList;
  }

  private async fetchFundingMarkPrice(symbol: string, fundingTime: number): Promise<number | null> {
    if (!Number.isFinite(fundingTime)) {
      this.logger.warn(`[Bybit] Cannot enrich funding history for ${symbol}: invalid funding time`);

      return null;
    }

    try {
      const raw = await this.httpClient.fetchMarkPriceKline({
        category: 'linear',
        symbol,
        start: fundingTime,
        end: fundingTime + ONE_MINUTE_MS - 1,
      });
      const markPriceKline = raw.result.list.find((entry) => Number(entry[0]) === fundingTime);
      const markPrice = Number(markPriceKline?.[1]);

      if (!markPriceKline || !Number.isFinite(markPrice) || markPrice <= 0) {
        this.logger.warn(`[Bybit] Cannot enrich funding history for ${symbol} at ${fundingTime}: exact mark-price kline is unavailable`);

        return null;
      }

      return markPrice;
    } catch (error) {
      this.logger.warn(`[Bybit] Cannot enrich funding history for ${symbol} at ${fundingTime}: ${String(error)}`);

      return null;
    }
  }

  /**
   * Отдельной ручки «сведения о фандинге» у Bybit нет — интервал начислений и границы ставки
   * лежат в списке инструментов. Кеша нет намеренно: границы ставки биржа меняет, и старое
   * значение здесь опаснее лишнего запроса.
   */
  async fetchFundingInfo(symbol?: string): Promise<FundingInfo[]> {
    if (symbol !== undefined) {
      this.logger.debug(`[Bybit] Fetching funding info for ${symbol}`);
      const raw = await this.httpClient.fetchInstrumentsInfo(this.category, { symbol });

      return normalizeBybitFundingInfoList(raw.result.list);
    }

    this.logger.debug('[Bybit] Fetching funding info for every instrument');
    const rawList = await this.httpClient.fetchAllInstrumentsInfo(this.category);

    return normalizeBybitFundingInfoList(rawList);
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
    const { accountInfo, positionList } = await this.readPositionListWithAccountInfo({ symbol }, this.readAccountInfoForPositionRead());
    const position = positionList[0];

    if (!position) {
      throw new Error(`Position not found for ${symbol}`);
    }

    return this.normalizePositionWithAccountInfo(position, accountInfo);
  }

  async fetchPositionSnapshot(symbol: string, positionIdx?: number): Promise<Position | null> {
    this.logger.debug(`Fetching position snapshot for ${symbol} (positionIdx=${positionIdx ?? 'any'})`);
    const { accountInfo, positionList: rawList } = await this.readPositionListWithAccountInfo({ symbol }, this.readAccountInfoForPositionRead());

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

      return this.normalizePositionWithAccountInfo(rawList[0], accountInfo);
    }

    const matched = rawList.find((entry) => entry.positionIdx === positionIdx);

    if (!matched) {
      return null;
    }

    return this.normalizePositionWithAccountInfo(matched, accountInfo);
  }

  async fetchPositionList(symbol: string): Promise<Position[]> {
    this.logger.debug(`Fetching position list for ${symbol}`);
    const { accountInfo, positionList } = await this.readPositionListWithAccountInfo({ symbol }, this.readAccountInfoForPositionRead());

    return this.normalizePositionListWithAccountInfo(positionList, accountInfo);
  }

  async fetchAllPositions(): Promise<Position[]> {
    this.logger.debug(`[Bybit] Fetching all positions via settleCoin=${BYBIT_LINEAR_SETTLE_COIN}`);
    const [accountInfo, positionList] = await Promise.all([
      this.readAccountInfoForPositionRead(),
      this.httpClient.fetchAllPositionList('linear', { settleCoin: BYBIT_LINEAR_SETTLE_COIN }),
    ]);

    const openPositionList = normalizeBybitPositionList(positionList, accountInfo).filter((position) => position.contracts > 0);

    this.warnAboutPositionListWithUnknownMarginMode(accountInfo, openPositionList);

    return openPositionList;
  }

  private normalizePositionWithAccountInfo(raw: BybitPositionRaw, accountInfo: BybitAccountInfoRaw | null): Position {
    const position = normalizeBybitPosition(raw, resolveBybitPositionMarginMode(accountInfo, raw));

    this.warnAboutPositionListWithUnknownMarginMode(accountInfo, [position]);

    return position;
  }

  private normalizePositionListWithAccountInfo(rawList: BybitPositionRaw[], accountInfo: BybitAccountInfoRaw | null): Position[] {
    const positionList = normalizeBybitPositionList(rawList, accountInfo);

    this.warnAboutPositionListWithUnknownMarginMode(accountInfo, positionList);

    return positionList;
  }

  // Без сведений о счёте предупреждение уже выдано при их чтении. Иначе неизвестный режим — у единого
  // счёта незнакомый режим счёта, у классического незнакомая ячейка tradeMode — называется явно.
  private warnAboutPositionListWithUnknownMarginMode(accountInfo: BybitAccountInfoRaw | null, positionList: Position[]): void {
    if (accountInfo === null) {
      return;
    }

    const symbolList = [...new Set(positionList.filter((position) => position.marginMode === null).map((position) => position.symbol))];

    if (symbolList.length === 0) {
      return;
    }

    this.logger.warn(
      `[Bybit] margin mode of ${symbolList.join(', ')} is unknown ` +
      `(unifiedMarginStatus=${String(accountInfo.unifiedMarginStatus)}, marginMode=${String(accountInfo.marginMode)}): ` +
      'positions are read with an unknown margin mode',
    );
  }

  async addIsolatedPositionMargin(args: AddIsolatedPositionMarginArgs): Promise<void> {
    const margin = this.formatIsolatedPositionMarginAmount(args.amount, BYBIT_POSITION_MARGIN_DECIMAL_PLACES);

    await this.httpClient.addPositionMargin({
      category: 'linear',
      symbol: args.symbol,
      margin,
      positionIdx: resolveBybitPositionIdx(args.positionSide),
    });
  }

  private async readPositionListWithAccountInfo<AccountInfo extends BybitAccountInfoRaw | null>(
    options: SymbolLimitFilterArgs,
    pendingAccountInfo: Promise<AccountInfo>,
  ): Promise<BybitPositionListWithAccountInfo<AccountInfo>> {
    const [accountInfo, positionListResponse] = await Promise.all([
      pendingAccountInfo,
      this.httpClient.getPositionList('linear', options),
    ]);

    return { accountInfo, positionList: positionListResponse.result.list ?? [] };
  }

  private async readAccountInfo(): Promise<BybitAccountInfoRaw> {
    this.accountInfoReadSequence++;
    const readSequence = this.accountInfoReadSequence;
    const response = await this.httpClient.fetchAccountInfo();

    this.rememberAccountInfo(response.result, readSequence);

    return response.result;
  }

  private rememberAccountInfo(accountInfo: BybitAccountInfoRaw, readSequence: number): void {
    if (this.rememberedAccountInfo !== null && this.rememberedAccountInfo.readSequence > readSequence) {
      return;
    }

    this.rememberedAccountInfo = { accountInfo, readSequence, rememberedAtMs: Date.now() };
  }

  private async readAccountInfoForPositionRead(): Promise<BybitAccountInfoRaw | null> {
    try {
      return await this.readAccountInfo();
    } catch (error) {
      const remembered = this.rememberedAccountInfo;
      const reason = error instanceof Error ? error.message : String(error);

      if (remembered === null) {
        this.logger.warn(`[Bybit] /v5/account/info failed (${reason}) and nothing is remembered yet: positions are read with an unknown margin mode`);

        return null;
      }

      const ageSeconds = Math.round((Date.now() - remembered.rememberedAtMs) / 1000);

      this.logger.warn(
        `[Bybit] /v5/account/info failed (${reason}): ` +
        `margin mode is taken from the account information read ${ageSeconds} s ago (marginMode=${String(remembered.accountInfo.marginMode)})`,
      );

      return remembered.accountInfo;
    }
  }

  async setLeverage(leverage: number, symbol: string, options?: SetLeverageOptions): Promise<SetLeverageResult> {
    this.logger.info(`Setting leverage to ${leverage}x for ${symbol}`);

    const params = options?.direction === undefined
      ? { category: 'linear', symbol, buyLeverage: leverage, sellLeverage: leverage }
      : await this.readDirectionalLeverageParams(leverage, symbol, options);

    try {
      await this.httpClient.setLeverage(params);
    } catch (error) {
      if (error instanceof ExchangeError && error.code === BYBIT_LEVERAGE_NOOP_ERROR_CODE) {
        // «Плечо не изменилось» = на бирже УЖЕ стоит ровно запрошенное — это подтверждение.
        return { confirmedLeverage: leverage };
      }

      throw error;
    }

    // Ответ Bybit установленного значения не несёт; принятая без ошибки установка ставит ровно
    // запрошенное — контракт подтверждения единый с Binance (см. SetLeverageResult).
    return { confirmedLeverage: leverage };
  }

  private async readDirectionalLeverageParams(leverage: number, symbol: string, options: SetLeverageOptions): Promise<SetBybitLeverageArgs> {
    const readResult = await this.readPositionListWithAccountInfo({ symbol }, this.readAccountInfo());
    const { accountInfo } = readResult;

    if (isBybitPortfolioMarginAccount(accountInfo)) {
      throw new ExchangeError(
        `Bybit: directional leverage is unavailable for ${symbol} — the account is in portfolio margin, where the exchange treats leverage rules as invalid`,
        'LEVERAGE_PORTFOLIO_MARGIN_UNSUPPORTED',
        'bybit',
      );
    }

    const positionList = readResult.positionList.filter(position => position.symbol === symbol);
    const marginMode = resolveBybitMarginMode(accountInfo, positionList);

    if (marginMode === null) {
      throw new ExchangeError('Bybit: cannot safely determine margin mode for directional leverage', BYBIT_MARGIN_MODE_UNKNOWN_ERROR_CODE, 'bybit');
    }

    const params: SetBybitLeverageArgs = { category: 'linear', symbol, buyLeverage: leverage, sellLeverage: leverage };

    if (marginMode !== MarginModeEnum.Isolated) {
      return params;
    }

    const isOneWay = positionList.length === 1 && positionList[0].positionIdx === 0;

    if (isOneWay) {
      return params;
    }

    const isHedge = positionList.length === 2 &&
      positionList.some(position => position.positionIdx === 1) &&
      positionList.some(position => position.positionIdx === 2);

    if (!isHedge) {
      throw new ExchangeError('Bybit: cannot safely determine position mode for directional leverage', 'LEVERAGE_POSITION_MODE_UNKNOWN', 'bybit');
    }

    const oppositeIdx = options.direction === 'long' ? 2 : 1;
    const oppositeLeverage = Number(positionList.find(position => position.positionIdx === oppositeIdx)?.leverage);

    if (!Number.isFinite(oppositeLeverage) || oppositeLeverage <= 0) {
      throw new ExchangeError('Bybit: opposite side leverage is unavailable', 'LEVERAGE_OPPOSITE_SIDE_UNKNOWN', 'bybit');
    }

    if (options.direction === 'long') {
      params.sellLeverage = oppositeLeverage;
    } else {
      params.buyLeverage = oppositeLeverage;
    }

    return params;
  }

  async fetchLeverageTierList(symbol: string): Promise<LeverageTier[]> {
    const rawList = await this.httpClient.fetchRiskLimitList('linear', symbol);

    return normalizeBybitRiskLimitList(rawList).get(symbol) ?? [];
  }

  async fetchAllLeverageTierList(): Promise<LeverageTierListBySymbol> {
    const rawList = await this.httpClient.fetchRiskLimitList('linear');

    return normalizeBybitRiskLimitList(rawList);
  }

  /**
   * На едином счёте Bybit режим маржи — свойство ВСЕГО счёта, а не отдельного символа
   * (проверено живым чтением 08.08.2026). Раньше метод просто писал строчку в журнал: у
   * потребителя, попросившего изолированную маржу перед рискованным входом, счёт оставался
   * в прежнем режиме, и узнать об этом было неоткуда.
   *
   * Сначала читаем текущий режим по тому же правилу, что и чтение позиций, и молчим, если он уже
   * нужный: лишняя запись в настройки счёта — не бесплатное действие, а биржа отбивает её ошибкой.
   * Портфельную маржу не трогаем: перевод выводит из неё весь счёт, а вернуть её библиотека не может.
   */
  async setMarginMode(marginMode: MarginModeEnum, symbol: string): Promise<void> {
    const desiredMode = marginMode === MarginModeEnum.Isolated
      ? BYBIT_ISOLATED_MARGIN_MODE
      : BYBIT_CROSS_MARGIN_MODE;
    const readResult = await this.readPositionListWithAccountInfo({ symbol }, this.readAccountInfo());
    const { accountInfo } = readResult;

    const positionList = readResult.positionList.filter(position => position.symbol === symbol);
    const currentMarginMode = resolveBybitMarginMode(accountInfo, positionList);

    if (currentMarginMode === marginMode) {
      this.logger.debug(`[Bybit] Margin mode already ${marginMode} (${String(accountInfo.marginMode)}) — nothing to switch for ${symbol}`);

      return;
    }

    if (currentMarginMode === null) {
      throw new ExchangeError(
        `Bybit: cannot safely determine the current margin mode of the account for ${symbol} — refusing to switch it blindly`,
        BYBIT_MARGIN_MODE_UNKNOWN_ERROR_CODE,
        'bybit',
      );
    }

    if (isBybitPortfolioMarginAccount(accountInfo)) {
      throw new ExchangeError(
        `Bybit: the account is in portfolio margin — switching it to ${marginMode} for ${symbol} would take the WHOLE account out of portfolio margin, and this library cannot switch it back; switch the account manually`,
        'PORTFOLIO_MARGIN_SWITCH_REFUSED',
        'bybit',
      );
    }

    // Просили за символ, меняем счёт целиком — потребитель обязан узнать об этом громко,
    // иначе соседние позиции поедут в другом режиме молча.
    this.logger.warn(
      `[Bybit] Margin mode is an ACCOUNT-WIDE setting: switching to ${desiredMode} for ${symbol} affects every symbol on this account`,
    );
    await this.httpClient.setMarginMode(desiredMode);
    this.accountInfoReadSequence++;
    this.rememberAccountInfo({ ...accountInfo, marginMode: desiredMode }, this.accountInfoReadSequence);
  }

  async fetchMarkPrice(symbol?: string): Promise<MarkPrice[]> {
    this.logger.debug('[Bybit] Fetching mark price');
    const raw = await this.httpClient.fetchTickers(this.category, { symbol });

    return normalizeBybitMarkPriceList(raw.result.list, raw.time);
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
      // Bybit needs a symbol or a coin: the coin switches every USDT contract without a position or an open order.
      await this.httpClient.setPositionMode({ category: this.category, mode: bybitMode, coin: BYBIT_POSITION_MODE_SETTLE_COIN });
    } catch (error) {
      if (error instanceof ExchangeError && error.code === 110025) {
        return;
      }

      throw error;
    }
  }
}

export { BybitLinear };
