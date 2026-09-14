import type { ExchangeArgs, FetchPageWithLimitArgs, SetLeverageResult } from '../types/exchange';
import type { ClosedPnl, FundingInfo, FundingRateHistory, MarkPrice, OpenInterest, Position } from '../types/common';
import { MarginModeEnum, PositionModeEnum } from '../types/common';
import { ExchangeError } from '../errors/ExchangeError';
import type { OkxIndexTickerRaw, OkxPositionRaw, OkxSetLeverageRaw } from '../normalizers/okxNormalizer';
import {
  normalizeOkxClosedPnlList,
  normalizeOkxFundingInfoList,
  normalizeOkxFundingRateHistoryList,
  normalizeOkxMarkPriceList,
  normalizeOkxOpenInterest,
  normalizeOkxPosition,
  toOkxIndexInstId,
} from '../normalizers/okxNormalizer';
import { OKX_POSITION_IDX } from '../constants/mappings';
import {
  OKX_FUNDING_RATE_HISTORY_LIMIT,
  OKX_ISOLATED_MARGIN_UNAVAILABLE_ACCOUNT_LEVEL_LIST,
  OKX_LINEAR_SETTLE_CURRENCY_LIST,
  OKX_POSITIONS_HISTORY_PAGE_LIMIT,
} from '../constants/okx';
import { OkxBaseClient } from './OkxBaseClient';

const OKX_HEDGE_POSITION_SIDE_LIST: ReadonlyArray<'long' | 'short'> = ['long', 'short'];

interface OkxLeverageOutcome {
  posSide: 'long' | 'short';
  dataList: OkxSetLeverageRaw[] | null;
  error: unknown;
}

/**
 * Плечо считается подтверждённым, только когда КАЖДЫЙ ответ назвал одно и то же пригодное число.
 * Пустой ответ, нечисловое поле или расхождение сторон дают `null` — вызывающий обязан считать
 * плечо неподтверждённым, а не полагаться на эхо своей просьбы.
 */
function resolveOkxConfirmedLeverage(responseDataList: OkxSetLeverageRaw[][]): number | null {
  const leverValueList = responseDataList.map((dataList) => parseFloat(dataList[0]?.lever ?? ''));
  const isConfirmed = leverValueList.length > 0
    && leverValueList.every((value) => Number.isFinite(value) && value >= 1 && value === leverValueList[0]);

  return isConfirmed ? leverValueList[0] : null;
}

class OkxSwap extends OkxBaseClient {
  protected readonly marketLabel = 'swap';
  private readonly marginModeBySymbol = new Map<string, MarginModeEnum>();
  private marginModeLookup: Promise<void> | null = null;
  private hasReadMarginModes = false;

  constructor(args: ExchangeArgs) {
    super({
      exchangeArgs: args,
      instType: 'SWAP',
      publicStreamLabel: 'OKX Swap Public WebSocket',
      tradeStreamLabel: 'OKX Swap Order WebSocket',
      privateStreamLabel: 'OKX Swap Private WebSocket',
      algoPrivateStreamLabel: 'OKX Swap Algo WebSocket',
    });
  }

  protected toOkxMarginMode(mode: MarginModeEnum): 'cross' | 'isolated' {
    return mode === MarginModeEnum.Isolated ? 'isolated' : 'cross';
  }

  protected async resolveTradeMode(symbol: string): Promise<string> {
    return this.toOkxMarginMode(await this.ensureMarginMode(symbol));
  }

  /**
   * После перезапуска процесса память пуста, и заявка ушла бы с общей маржой по позиции, которую
   * биржа держит изолированной, — отвергнутой оказалась бы каждая заявка по этому инструменту,
   * включая защитную. Фактический режим несёт САМА позиция, поэтому спрашиваем позиции ВСЕГО
   * счёта одним запросом и заполняем память сразу по всем инструментам: пачка заявок собирается
   * по одной, и память по инструменту давала бы столько последовательных запросов, сколько
   * символов в пачке (при пределе входа десять запросов за две секунды), — все до отправки.
   * Параллельные вызовы делят один запрос; отказ не запоминается, следующая заявка спросит снова.
   */
  private async ensureMarginMode(symbol: string): Promise<MarginModeEnum> {
    const chosenMode = this.marginModeBySymbol.get(symbol);

    if (chosenMode !== undefined) {
      return chosenMode;
    }

    if (!this.hasReadMarginModes) {
      try {
        await this.ensureMarginModesRead();
      } catch (error) {
        this.logger.warn(
          `[OKX] Could not read the margin mode of ${symbol} from the exchange; orders use cross until it is read: ${(error as Error).message}`,
        );

        return MarginModeEnum.Cross;
      }
    }

    // Инструмента без открытой позиции в снимке нет — у биржи по нему режима и не заведено,
    // а умолчание счёта общее.
    return this.marginModeBySymbol.get(symbol) ?? MarginModeEnum.Cross;
  }

  private ensureMarginModesRead(): Promise<void> {
    if (this.marginModeLookup === null) {
      this.marginModeLookup = this.readMarginModesFromOpenPositions().finally(() => {
        this.marginModeLookup = null;
      });
    }

    return this.marginModeLookup;
  }

  /**
   * Отказ чтения наружу не гасится: умолчание остаётся прежним (общая маржа), но признак
   * «счёт прочитан» не выставляется — запомнить неизвестность значило бы закрепить догадку
   * навсегда. Явный выбор, сделанный ВО ВРЕМЯ чтения, побеждает прочитанное, поэтому уже
   * занятые записи снимок не трогает.
   */
  private async readMarginModesFromOpenPositions(): Promise<void> {
    const positionRawList = await this.httpClient.fetchPositions({ instType: 'SWAP' });

    for (const position of positionRawList) {
      if (parseFloat(position.pos ?? '0') === 0) {
        continue;
      }

      const symbol = this.resolveOkxPositionSymbolOrWarn(position);

      if (symbol === null || this.marginModeBySymbol.has(symbol)) {
        continue;
      }

      this.marginModeBySymbol.set(
        symbol,
        position.mgnMode === 'isolated' ? MarginModeEnum.Isolated : MarginModeEnum.Cross,
      );
      this.logger.info(`[OKX] Margin mode of ${symbol} taken from the open position on the exchange: ${position.mgnMode}`);
    }

    this.hasReadMarginModes = true;
  }

  /** Неразобранное обозначение биржи не смеет ронять чтение режимов по остальным инструментам. */
  private resolveOkxPositionSymbolOrWarn(position: OkxPositionRaw): string | null {
    try {
      return this.symbolMap.resolveSymbol(position.instId);
    } catch (error) {
      this.logger.warn(
        `[OKX] Margin mode of ${position.instId} skipped: its instrument is not in the loaded map (${(error as Error).message})`,
      );

      return null;
    }
  }

  /**
   * OKX не позволяет сменить режим маржи символа, пока по нему есть открытая позиция или
   * активная заявка (биржа отвечает ошибкой на прямую попытку). Здесь режим лишь запоминается
   * для будущих заявок; если позиция уже открыта в ДРУГОМ режиме, вызывающий должен узнать
   * об этом — иначе решение «поставить эту заявку изолированной маржой» тихо не сработает.
   */
  async setMarginMode(marginMode: MarginModeEnum, symbol: string): Promise<void> {
    this.marginModeBySymbol.set(symbol, marginMode);
    await this.warnIfIsolatedMarginIsUnavailable(marginMode, symbol);

    let positionList: OkxPositionRaw[];

    try {
      const instId = this.symbolMap.resolveInstId(symbol);
      positionList = await this.httpClient.fetchPositions({ instType: 'SWAP', instId });
    } catch (error) {
      this.logger.warn(
        `[OKX] Could not verify open positions while switching margin mode for ${symbol}: ${(error as Error).message}`,
      );

      return;
    }

    const desiredMode = this.toOkxMarginMode(marginMode);
    const openPosition = positionList.find((position) => parseFloat(position.pos ?? '0') !== 0);

    if (openPosition !== undefined && openPosition.mgnMode !== desiredMode) {
      this.logger.warn(
        `[OKX] The open position on ${symbol} stays in ${openPosition.mgnMode} margin mode; ${desiredMode} applies to the next orders only`,
      );
    }
  }

  /**
   * Изолированная маржа существует не на всяком счёте: дословно «isolated is not available in
   * multi-currency margin mode and portfolio margin mode» — то есть при режимах счёта 3 и 4.
   * Выбор проходил молча, а отвергнута биржей была бы КАЖДАЯ последующая заявка, включая
   * защитные, — поэтому о заведомо невозможном сочетании предупреждаем сразу.
   */
  private async warnIfIsolatedMarginIsUnavailable(marginMode: MarginModeEnum, symbol: string): Promise<void> {
    if (marginMode !== MarginModeEnum.Isolated) {
      return;
    }

    try {
      const config = await this.ensureAccountConfig();

      if (!OKX_ISOLATED_MARGIN_UNAVAILABLE_ACCOUNT_LEVEL_LIST.includes(config.acctLv)) {
        return;
      }

      this.logger.warn(
        `[OKX] Isolated margin is unavailable in account mode ${config.acctLv} — every order for ${symbol} will be rejected by the exchange`,
      );
    } catch (error) {
      this.logger.warn(
        `[OKX] Could not read the account mode while switching margin mode for ${symbol}: ${(error as Error).message}`,
      );
    }
  }

  async fetchPositionMode(): Promise<PositionModeEnum | undefined> {
    const config = await this.ensureAccountConfig();

    if (config.posMode === 'long_short_mode') {
      return PositionModeEnum.Hedge;
    }

    if (config.posMode === 'net_mode') {
      return PositionModeEnum.OneWay;
    }

    return undefined;
  }

  async setPositionMode(mode: PositionModeEnum): Promise<void> {
    const desired = mode === PositionModeEnum.Hedge ? 'long_short_mode' : 'net_mode';
    const config = await this.ensureAccountConfig();

    if (config.posMode === desired) {
      this.logger.debug(`[OKX] Position mode already ${desired} — nothing to switch`);

      return;
    }

    await this.httpClient.setPositionMode(desired);
    this.invalidateAccountConfig();
  }

  /**
   * В двустороннем режиме с изолированной маржой плечо ставится отдельно на длинную и на короткую
   * сторону — двумя запросами. Опасен не отказ ПЕРВОГО (тогда на бирже ничего не изменилось), а
   * отказ ВТОРОГО: одна сторона уже с новым плечом, другая со старым, и вызывающий об этом не
   * знает. Поэтому оба запроса отправляются всегда, даже если первый отказал, и отказ ЛЮБОГО из
   * них выходит наружу ошибкой, которая прямо называет, какая сторона осталась неизменной, а
   * какая — уже изменена. Подтверждённым плечо считается только когда ОБА ответа назвали одно и то
   * же число.
   */
  async setLeverage(leverage: number, symbol: string): Promise<SetLeverageResult> {
    this.logger.info(`[OKX] Setting leverage to ${leverage}x for ${symbol}`);
    const instId = this.symbolMap.resolveInstId(symbol);
    const mgnMode = this.toOkxMarginMode(await this.ensureMarginMode(symbol));
    const config = await this.ensureAccountConfig();

    if (mgnMode !== 'isolated' || config.posMode !== 'long_short_mode') {
      const dataList = await this.httpClient.setLeverage({ instId, lever: String(leverage), mgnMode });

      return { confirmedLeverage: resolveOkxConfirmedLeverage([dataList]) };
    }

    return this.setOkxHedgeIsolatedLeverage(instId, String(leverage));
  }

  private async setOkxHedgeIsolatedLeverage(instId: string, lever: string): Promise<SetLeverageResult> {
    const outcomeList: OkxLeverageOutcome[] = [];

    for (const posSide of OKX_HEDGE_POSITION_SIDE_LIST) {
      try {
        const dataList = await this.httpClient.setLeverage({ instId, lever, mgnMode: 'isolated', posSide });

        outcomeList.push({ posSide, dataList, error: null });
      } catch (error) {
        outcomeList.push({ posSide, dataList: null, error });
      }
    }

    const failedList = outcomeList.filter((outcome) => outcome.error !== null);

    if (failedList.length > 0) {
      const appliedSideList = outcomeList.filter((outcome) => outcome.error === null).map((outcome) => outcome.posSide);
      const failedSideList = failedList.map((outcome) => outcome.posSide);

      throw new ExchangeError(
        `OKX: leverage ${lever} for ${instId} was rejected on ${failedSideList.join(' and ')}`
          + ` (${appliedSideList.length > 0 ? `already applied on ${appliedSideList.join(' and ')}` : 'nothing was applied'})`
          + `: ${(failedList[0].error as Error).message}`,
        'OKX_LEVERAGE_SIDES_DIVERGED',
        'OKX',
      );
    }

    return { confirmedLeverage: resolveOkxConfirmedLeverage(outcomeList.map((outcome) => outcome.dataList ?? [])) };
  }

  async fetchPosition(symbol: string): Promise<Position> {
    this.logger.debug(`[OKX] Fetching position for ${symbol}`);
    const instId = this.symbolMap.resolveInstId(symbol);
    const rawList = await this.httpClient.fetchPositions({ instType: 'SWAP', instId });
    const raw = rawList[0];

    if (raw === undefined) {
      throw new Error(`Position not found for ${symbol}`);
    }

    return normalizeOkxPosition(raw, this.resolveContractValue(symbol));
  }

  async fetchPositionSnapshot(symbol: string, positionIdx?: number): Promise<Position | null> {
    this.logger.debug(`[OKX] Fetching position snapshot for ${symbol} (positionIdx=${positionIdx ?? 'any'})`);
    const instId = this.symbolMap.resolveInstId(symbol);
    const rawList = await this.httpClient.fetchPositions({ instType: 'SWAP', instId });

    if (rawList.length === 0) {
      return null;
    }

    const contractValue = this.resolveContractValue(symbol);

    if (positionIdx === undefined) {
      const hedgeEntry = rawList.find((entry) => entry.posSide === 'long' || entry.posSide === 'short');

      if (hedgeEntry !== undefined) {
        throw new Error(
          `fetchPositionSnapshot called without positionIdx but symbol ${symbol} is in hedge mode (response contains long/short posSide entries). Caller MUST pass positionIdx explicitly in hedge mode.`,
        );
      }

      return normalizeOkxPosition(rawList[0], contractValue);
    }

    if (positionIdx !== 0 && positionIdx !== 1 && positionIdx !== 2) {
      throw new Error(`Invalid positionIdx ${positionIdx} for ${symbol}: expected 0 (net), 1 (long) or 2 (short)`);
    }

    const matched = rawList.find((entry) => OKX_POSITION_IDX[entry.posSide] === positionIdx);

    return matched !== undefined ? normalizeOkxPosition(matched, contractValue) : null;
  }

  async fetchPositionList(symbol: string): Promise<Position[]> {
    this.logger.debug(`[OKX] Fetching position list for ${symbol}`);
    const instId = this.symbolMap.resolveInstId(symbol);
    const rawList = await this.httpClient.fetchPositions({ instType: 'SWAP', instId });
    const contractValue = this.resolveContractValue(symbol);

    return rawList.map((raw) => normalizeOkxPosition(raw, contractValue));
  }

  async fetchAllPositions(): Promise<Position[]> {
    this.logger.debug('[OKX] Fetching all positions');
    const rawList = await this.httpClient.fetchPositions({ instType: 'SWAP' });
    const positionList: Position[] = [];

    for (const raw of rawList) {
      if (parseFloat(raw.pos ?? '0') === 0) {
        continue;
      }

      let symbol: string;

      try {
        symbol = this.symbolMap.resolveSymbol(raw.instId);
      } catch {
        this.logger.warn(`[OKX] Cannot resolve symbol for instId ${raw.instId} — skipping in fetchAllPositions`);

        continue;
      }

      if (!this.symbolMap.has(symbol)) {
        this.logger.warn(`[OKX] Instrument ${raw.instId} is not in the loaded instrument map — skipping in fetchAllPositions`);

        continue;
      }

      positionList.push(normalizeOkxPosition(raw, this.resolveContractValue(symbol)));
    }

    return positionList;
  }

  async fetchFundingRateHistory(symbol: string, options?: FetchPageWithLimitArgs): Promise<FundingRateHistory[]> {
    this.logger.debug(`[OKX] Fetching funding rate history for ${symbol}`);
    const instId = this.symbolMap.resolveInstId(symbol);

    const rawList = await this.httpClient.fetchFundingRateHistory({
      instId,
      after: options?.endTime !== undefined ? String(options.endTime + 1) : undefined,
      before: options?.startTime !== undefined ? String(options.startTime - 1) : undefined,
      limit: Math.min(options?.limit ?? 100, OKX_FUNDING_RATE_HISTORY_LIMIT),
    });

    return normalizeOkxFundingRateHistoryList(rawList);
  }

  async fetchFundingInfo(symbol?: string): Promise<FundingInfo[]> {
    this.logger.debug('[OKX] Fetching funding info');
    const instId = symbol !== undefined ? this.symbolMap.resolveInstId(symbol) : 'ANY';
    const rawList = await this.httpClient.fetchFundingRate(instId);
    const fundingInfoList = normalizeOkxFundingInfoList(rawList);

    if (symbol !== undefined || this.symbolMap.size() === 0) {
      return fundingInfoList;
    }

    return fundingInfoList.filter((entry) => this.symbolMap.has(entry.symbol));
  }

  /**
   * Индексная цена спрашивается ОТДЕЛЬНОЙ ручкой: ответ цены маркировки её не несёт, а у обеих
   * соседних бирж это поле заполнено, и без него у потребителя отключается составляющая
   * `Max(Индекс, …)` в расчёте границы цены — навсегда, а не на один кадр. Одним обозначением
   * (индекс — контракт без хвоста `-SWAP`), либо по валютам котировки, когда символ не задан.
   */
  async fetchMarkPrice(symbol?: string): Promise<MarkPrice[]> {
    this.logger.debug('[OKX] Fetching mark price');
    const instId = symbol !== undefined ? this.symbolMap.resolveInstId(symbol) : undefined;

    const [markList, fundingList, indexList] = await Promise.all([
      this.httpClient.fetchMarkPrice('SWAP', instId),
      this.httpClient.fetchFundingRate(instId ?? 'ANY'),
      this.fetchOkxIndexTickerList(instId),
    ]);

    const markPriceList = normalizeOkxMarkPriceList(markList, fundingList, indexList);

    if (symbol !== undefined || this.symbolMap.size() === 0) {
      return markPriceList;
    }

    return markPriceList.filter((entry) => this.symbolMap.has(entry.symbol));
  }

  /**
   * Отказ ручки индекса не срывает чтение цены маркировки: индекс — дополнение, а не её условие.
   * Без символа индексы спрашиваются по каждой валюте расчёта, которую библиотека поддерживает, —
   * иначе контракты в USDC остались бы без индекса.
   */
  private async fetchOkxIndexTickerList(instId?: string): Promise<OkxIndexTickerRaw[]> {
    try {
      if (instId !== undefined) {
        return await this.httpClient.fetchIndexTickers({ instId: toOkxIndexInstId(instId) });
      }

      const pageList = await Promise.all(
        OKX_LINEAR_SETTLE_CURRENCY_LIST.map((quoteCcy) => this.httpClient.fetchIndexTickers({ quoteCcy })),
      );

      return pageList.flat();
    } catch (error) {
      this.logger.warn(`[OKX] Could not read index prices; mark price is reported without them: ${(error as Error).message}`);

      return [];
    }
  }

  async fetchOpenInterest(symbol: string): Promise<OpenInterest> {
    this.logger.debug(`[OKX] Fetching open interest for ${symbol}`);
    const instId = this.symbolMap.resolveInstId(symbol);
    const openInterestRawList = await this.httpClient.fetchOpenInterest('SWAP', instId);

    if (openInterestRawList.length === 0) {
      throw new ExchangeError('OKX returned an empty open interest response', 'OKX_OPEN_INTEREST_EMPTY', 'OKX');
    }

    return { ...normalizeOkxOpenInterest(openInterestRawList[0]), symbol };
  }

  /**
   * `options.limit` — сколько строк ИТОГА вернуть (как у Binance и Bybit), а не размер страницы:
   * биржа отдаёт историю позиций по сто записей, и один запрос молча обрезал ответ ровно на сотой.
   *
   * ⚠️ Строка OKX НАКОПИТЕЛЬНАЯ, в отличие от соседей. У Binance и Bybit строка — это одно
   * закрытие; у OKX это одна запись на ВСЮ ЖИЗНЬ позиции, которая обновляется при каждом
   * частичном закрытии («Position's cumulative closed volume», «Accumulated fee», страницы
   * адресуются `uTime` — временем обновления). Одна и та же позиция вернётся и за понедельник, и
   * за вторник, но с РАЗНЫМ (растущим) итогом, поэтому складывать итоги по окнам нельзя — выйдет
   * задвоение. `orderId` здесь — номер ПОЗИЦИИ (`posId`), а не заявки. Ничего из этого библиотека
   * не «чинит»: так устроен ответ биржи, и знать об этом должен потребитель.
   */
  async fetchClosedPnl(symbol?: string, options?: FetchPageWithLimitArgs): Promise<ClosedPnl[]> {
    this.logger.debug('[OKX] Fetching closed PnL');
    const instId = symbol !== undefined ? this.symbolMap.resolveInstId(symbol) : undefined;
    const maxRecordCount = options?.limit ?? OKX_POSITIONS_HISTORY_PAGE_LIMIT;

    const rawList = await this.httpClient.fetchAllPositionsHistory({
      instType: 'SWAP',
      instId,
      after: options?.endTime !== undefined ? String(options.endTime + 1) : undefined,
      before: options?.startTime !== undefined ? String(options.startTime - 1) : undefined,
      maxRecordCount,
    });

    return normalizeOkxClosedPnlList(rawList, this.contractValueBySymbol, this.logger).slice(0, maxRecordCount);
  }
}

export { OkxSwap };
