import type {
  CancelBatchOrdersResult,
  CreateBatchOrdersResult,
  CreateOrderItemResult,
  CreateOrderWebSocketArgs,
  FetchIncomeArgs,
  FetchPageWithLimitArgs,
  ModifyBatchOrderArgs,
  ModifyBatchOrdersResult,
  ModifyOrderArgs,
  ModifyOrderItemResult,
  OrderRateLimit,
} from '../types/exchange';
import type {
  AccountBalances,
  FeeRate,
  Income,
  Kline,
  KlineInterval,
  Order,
  OrderBook,
  PublicTrade,
  TickerBySymbol,
  TradeSymbolBySymbol,
  UserDataStreamHandlerArgs,
  WebSocketConnectionInfo,
} from '../types/common';
import { MarketUnitEnum, OrderTypeEnum, PositionSideEnum, TimeInForceEnum } from '../types/common';
import type { PublicStreamLike } from '../types/stream';
import { ExchangeError } from '../errors/ExchangeError';
import { OkxHttpClient } from '../http/OkxHttpClient';
import { OkxSymbolMap, parseOkxInstId } from './okxSymbol';
import {
  buildOkxAlgoOrderUpdateEvent,
  buildOkxBalanceUpdateEvent,
  buildOkxBatchItemResult,
  buildOkxCreateOutcome,
  buildOkxOrderFromCreateResponse,
  buildOkxOrderUpdateEvent,
  buildOkxPositionUpdateEvent,
  isOkxInstrumentSupported,
  mergeOkxTriggeredOrder,
  normalizeOkxAlgoOrder,
  normalizeOkxBalances,
  normalizeOkxFeeRate,
  normalizeOkxIncomeList,
  normalizeOkxKlines,
  normalizeOkxOrder,
  normalizeOkxOrderBook,
  normalizeOkxPublicTradeList,
  normalizeOkxTickers,
  normalizeOkxTradeSymbols,
  buildOkxCommissionIncomeList,
  buildOkxRealizedPnlIncomeList,
  resolveOkxAlgoTriggerLeg,
  toOkxIndexInstId,
} from '../normalizers/okxNormalizer';
import type {
  OkxAccountConfigRaw,
  OkxAlgoOrderRaw,
  OkxBalanceRaw,
  OkxFundingRateRaw,
  OkxOrderRaw,
  OkxPositionRaw,
} from '../normalizers/okxNormalizer';
import { buildPlacedOrderOutcome, buildRejectedOrderOutcome } from '../normalizers/batchOrderOutcome';
import { OkxPublicStream } from '../ws/OkxPublicStream';
import { OkxTradeStream } from '../ws/OkxTradeStream';
import { OkxPrivateStream } from '../ws/OkxPrivateStream';
import type { OkxSubscriptionArg, OkxWebSocketMessage } from '../ws/okxWebSocketUtils.types';
import {
  OKX_INCOME_BILL_TYPE,
  OKX_ORDER_SIDE_REVERSE,
  OKX_ORDER_TYPE_BY_TIME_IN_FORCE,
  OKX_TRIGGER_PX_TYPE,
  OKX_WORKING_TYPE_TRIGGER_PX_TYPE,
} from '../constants/mappings';
import { isConditionalOrderType } from '../constants/orderTypes';
import { chunkList } from '../utils/chunkList';
import { convertCoinsToContracts, convertContractsToCoins, multiplyDecimalStrings, toDecimalNumberString } from '../utils/decimalString';
import { toOkxErrorCode } from '../utils/okxErrorCode';
import {
  OKX_ALGO_CANCEL_BATCH_CHUNK_SIZE,
  OKX_ALGO_CONDITIONAL_ORD_TYPE,
  OKX_ALGO_HISTORY_ORD_TYPE_LIST,
  OKX_ALGO_HISTORY_STATE_LIST,
  OKX_ALGO_TRAILING_ORD_TYPE,
  OKX_BASE_URL,
  OKX_BILLS_PAGE_LIMIT,
  OKX_BUSINESS_WEBSOCKET_URL,
  OKX_CLIENT_ORDER_ID_PATTERN,
  OKX_CLOSE_WHOLE_POSITION_FRACTION,
  OKX_CONTRACT_ONLY_PENDING_ALGO_ORD_TYPE_LIST,
  OKX_CONDITIONAL_ORDER_REGISTRY_MAX_SIZE,
  OKX_CONDITIONAL_ORDER_REGISTRY_TTL_MS,
  OKX_DEMO_BUSINESS_WEBSOCKET_URL,
  OKX_DEMO_PRIVATE_WEBSOCKET_URL,
  OKX_DEMO_PUBLIC_WEBSOCKET_URL,
  OKX_EXPECTED_ERROR_CODE_LIST,
  OKX_HISTORY_TRIGGERED_ORDER_READ_LIMIT,
  OKX_KLINE_INTERVAL,
  OKX_KLINE_INTERVAL_MS,
  OKX_KLINE_LIMIT,
  OKX_MARKET_ORDER_PRICE,
  OKX_ORDER_BATCH_CHUNK_SIZE,
  OKX_ORDER_BOOK_MAX_DEPTH,
  OKX_ORDER_CHANNEL_UNSENT_CODE_LIST,
  OKX_ORDER_NOT_FOUND_ERROR_CODE,
  OKX_ORDER_PAGE_LIMIT,
  OKX_ORDER_RATE_LIMIT_RPS,
  OKX_PENDING_ALGO_ORD_TYPE_REQUEST_LIST,
  OKX_PRIVATE_WEBSOCKET_URL,
  OKX_PUBLIC_WEBSOCKET_URL,
  OKX_RECENT_HISTORY_RETENTION_MS,
  OKX_TRADES_MAX_LIMIT,
} from '../constants/okx';
import { BaseExchangeClient } from './BaseExchangeClient';
import { resolveTwoServiceOrderFailure } from './twoServiceOrderLookup';
import { ConditionalOrderRegistry } from './ConditionalOrderRegistry';
import type {
  OkxAlgoAmendTarget,
  OkxAlgoSweep,
  OkxAlgoSweepFailure,
  OkxBaseClientArgs,
  OkxResolvedInstrument,
  OkxOrderChunk,
  OkxOwnedOrder,
  OkxPlannedOrder,
  OkxTwoServiceFailure,
} from './OkxBaseClient.types';
import type { OkxInstrumentType } from '../http/OkxHttpClient.types';

/**
 * Приближение для расчёта окна `after` у месячных свечей (`1M`), у которых нет постоянной
 * длительности в миллисекундах; результат всё равно фильтруется по `startTime` после нормализации.
 */
const OKX_APPROXIMATE_MONTH_MS = 31 * 24 * 60 * 60 * 1000;

/** Условные типы, у которых есть своя цена исполнения; остальные исполняются по рынку. */
const OKX_LIMIT_LIKE_CONDITIONAL_TYPE_SET: ReadonlySet<OrderTypeEnum> = new Set([
  OrderTypeEnum.Stop,
  OrderTypeEnum.StopLimit,
  OrderTypeEnum.TakeProfit,
  OrderTypeEnum.TakeProfitLimit,
]);

/** Типы, которые OKX кладёт на ногу взятия прибыли (`tp*`); остальные — на ногу защиты (`sl*`). */
const OKX_TAKE_PROFIT_ORDER_TYPE_SET: ReadonlySet<OrderTypeEnum> = new Set([
  OrderTypeEnum.TakeProfit,
  OrderTypeEnum.TakeProfitLimit,
  OrderTypeEnum.TakeProfitMarket,
]);

const OKX_SPOT_TRIGGER_PRICE_TYPE = 'last';

/** Проценты в долю точной десятичной арифметикой: 1.1% — это ровно 0.011, а не 0.011000000000000001. */
const OKX_PERCENT_TO_RATIO = '0.01';

function resolveRequestedOkxTriggerPriceType(args: CreateOrderWebSocketArgs): string {
  if (args.triggerBy !== undefined) {
    return OKX_TRIGGER_PX_TYPE[args.triggerBy];
  }

  if (args.workingType !== undefined) {
    return OKX_WORKING_TYPE_TRIGGER_PX_TYPE[args.workingType];
  }

  return OKX_SPOT_TRIGGER_PRICE_TYPE;
}

/**
 * Ответ обычной книги, по которому стоит поискать заявку в условной службе: «заявки нет»
 * (`51603`), «снять нечего» (`51400`) и «править нечего» (`51503`) — ровно те случаи, когда
 * номер может оказаться номером условной заявки, а не отсутствующей.
 */
function isOkxMissingPlainOrderError(error: unknown): boolean {
  if (!(error instanceof ExchangeError)) {
    return false;
  }

  const errorCode = typeof error.code === 'number' ? error.code : Number(error.code);

  return OKX_EXPECTED_ERROR_CODE_LIST.includes(errorCode);
}

/**
 * Отказ торгового канала, после которого заявка ТОЧНО не дошла до книги биржи: канал не сумел
 * адресовать инструмент числовым кодом. Такую заявку — и ТОЛЬКО такую — можно отправить ещё раз
 * обычным запросом: на любом другом отказе канала биржа могла её принять, и повтор поставил бы
 * вторую заявку тем же намерением.
 */
function isOkxOrderChannelUnsentError(error: unknown): boolean {
  if (!(error instanceof ExchangeError)) {
    return false;
  }

  return OKX_ORDER_CHANNEL_UNSENT_CODE_LIST.includes(String(error.code));
}

function toOkxErrorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toOkxNumericErrorCode(error: unknown): number | null {
  return error instanceof ExchangeError && typeof error.code === 'number' ? error.code : null;
}

function buildOkxErrorItemResult(orderId: string, error: unknown): ModifyOrderItemResult {
  return {
    orderId,
    isSuccess: false,
    errorCode: toOkxNumericErrorCode(error),
    errorText: toOkxErrorText(error),
  };
}

function buildOkxRejectedOutcome(error: unknown): CreateOrderItemResult {
  return buildRejectedOrderOutcome(toOkxNumericErrorCode(error), toOkxErrorText(error));
}

function takeOkxFulfilledEntry<T>(outcome: PromiseSettledResult<T[]>): T | undefined {
  return outcome.status === 'fulfilled' ? outcome.value[0] : undefined;
}

function takeOkxRejectionReasonList(outcomeList: PromiseSettledResult<unknown>[]): unknown[] {
  return outcomeList
    .filter((outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected')
    .map((outcome) => outcome.reason);
}

abstract class OkxBaseClient extends BaseExchangeClient {
  protected readonly exchangeLabel = 'OKX';
  protected readonly klineLimit = OKX_KLINE_LIMIT;
  protected readonly httpClient: OkxHttpClient;

  protected readonly instType: OkxInstrumentType;
  protected readonly isSwap: boolean;
  protected readonly symbolMap: OkxSymbolMap;
  protected readonly contractValueBySymbol = new Map<string, string>();
  protected readonly lotSizeBySymbol = new Map<string, string>();
  protected readonly groupIdBySymbol = new Map<string, string>();
  protected readonly conditionalOrderRegistry = new ConditionalOrderRegistry({
    maxSize: OKX_CONDITIONAL_ORDER_REGISTRY_MAX_SIZE,
    ttlMs: OKX_CONDITIONAL_ORDER_REGISTRY_TTL_MS,
  });
  private readonly secret: string;
  private readonly passphrase: string;
  protected readonly publicStream: OkxPublicStream;
  protected readonly tradeStream: OkxTradeStream;
  protected privateStream: OkxPrivateStream | null = null;
  protected algoPrivateStream: OkxPrivateStream | null = null;
  private accountConfig: OkxAccountConfigRaw | null = null;

  protected readonly privateWebSocketUrl: string;
  protected readonly businessWebSocketUrl: string;
  protected readonly privateStreamLabel: string;
  protected readonly algoPrivateStreamLabel: string;

  /**
   * В отличие от Bybit, у OKX торговый и приватный каналы доступны и в демо-режиме —
   * отдельного REST-фолбэка для демо здесь не требуется.
   */
  constructor(args: OkxBaseClientArgs) {
    super(args.exchangeArgs);

    const { config, logger } = args.exchangeArgs;
    const isDemoMode = config.isDemoMode === true;
    const passphrase = config.passphrase ?? '';

    this.secret = config.secret;
    this.passphrase = passphrase;
    this.instType = args.instType;
    this.isSwap = args.instType === 'SWAP';
    this.symbolMap = new OkxSymbolMap({ isSwap: this.isSwap });
    this.privateStreamLabel = args.privateStreamLabel;
    this.algoPrivateStreamLabel = args.algoPrivateStreamLabel;

    const publicWebSocketUrl = isDemoMode ? OKX_DEMO_PUBLIC_WEBSOCKET_URL : OKX_PUBLIC_WEBSOCKET_URL;
    this.businessWebSocketUrl = isDemoMode ? OKX_DEMO_BUSINESS_WEBSOCKET_URL : OKX_BUSINESS_WEBSOCKET_URL;
    this.privateWebSocketUrl = isDemoMode ? OKX_DEMO_PRIVATE_WEBSOCKET_URL : OKX_PRIVATE_WEBSOCKET_URL;

    this.httpClient = new OkxHttpClient({
      baseUrl: OKX_BASE_URL,
      apiKey: config.apiKey,
      secret: config.secret,
      passphrase,
      isDemoMode,
      logger,
      httpsAgent: config.httpsAgent,
    });

    this.publicStream = new OkxPublicStream({
      publicUrl: publicWebSocketUrl,
      businessUrl: this.businessWebSocketUrl,
      label: args.publicStreamLabel,
      logger,
      onNotify: this.onNotify,
      isSwap: this.isSwap,
      symbolMap: this.symbolMap,
      contractValueBySymbol: this.contractValueBySymbol,
      connectionPacking: config.publicStreamConnectionPacking,
      lazyOrderbookParse: config.lazyOrderbookParse,
    });

    this.tradeStream = new OkxTradeStream({
      url: this.privateWebSocketUrl,
      label: args.tradeStreamLabel,
      apiKey: config.apiKey,
      secret: config.secret,
      passphrase,
      logger,
      onNotify: this.onNotify,
      symbolMap: this.symbolMap,
    });
  }

  protected getPublicStream(): PublicStreamLike {
    return this.publicStream;
  }

  protected async fetchAndNormalizeTradeSymbols(): Promise<TradeSymbolBySymbol> {
    const [rawList, fundingRawList] = await Promise.all([
      this.httpClient.fetchInstruments(this.instType),
      this.fetchOkxFundingRateListForInstruments(),
    ]);

    this.symbolMap.clear();
    this.contractValueBySymbol.clear();
    this.lotSizeBySymbol.clear();
    this.groupIdBySymbol.clear();

    let acceptedCount = 0;

    for (const raw of rawList) {
      const identity = parseOkxInstId(raw.instId);

      if (identity === null || !isOkxInstrumentSupported(raw, this.isSwap)) {
        continue;
      }

      if (!this.symbolMap.register(identity, raw.instIdCode)) {
        this.logger.warn(
          `[OKX] Instrument ${raw.instId} takes the common name ${identity.symbol} away from another instrument — orders for it would go to the wrong instrument`,
        );
      }

      this.contractValueBySymbol.set(identity.symbol, this.isSwap ? raw.ctVal : '');
      this.lotSizeBySymbol.set(identity.symbol, raw.lotSz);
      acceptedCount += 1;

      if (raw.groupId !== undefined) {
        this.groupIdBySymbol.set(identity.symbol, raw.groupId);
      }
    }

    this.logger.info(
      { instrumentCount: acceptedCount },
      `[OKX] Fetched ${acceptedCount} ${this.instType} instruments`,
    );

    return normalizeOkxTradeSymbols(rawList, fundingRawList);
  }

  /**
   * Срок фандинга и его границы лежат не в списке инструментов, а в ответе ставки фандинга —
   * один запрос на всю загрузку (`instId=ANY` отдаёт все бессрочные разом). Отказ этой ручки не
   * срывает загрузку инструментов: без неё у инструмента просто не будет сведений о фандинге.
   * У спота фандинга нет вовсе, там запрос не делается.
   */
  private async fetchOkxFundingRateListForInstruments(): Promise<OkxFundingRateRaw[]> {
    if (!this.isSwap) {
      return [];
    }

    try {
      return await this.httpClient.fetchFundingRate('ANY');
    } catch (error) {
      this.logger.warn(`[OKX] Could not read funding info while loading instruments: ${toOkxErrorText(error)}`);

      return [];
    }
  }

  protected resolveContractValue(symbol: string): string {
    const contractValue = this.contractValueBySymbol.get(symbol);

    if (contractValue !== undefined) {
      return contractValue;
    }

    if (!this.isSwap) {
      return '';
    }

    throw new ExchangeError(
      `OKX contract value for ${symbol} is unknown — call loadTradeSymbols() first`,
      'OKX_INSTRUMENTS_NOT_LOADED',
      'OKX',
    );
  }

  /**
   * Сколько монет останется от запрошенного объёма после того, как биржа примет заявку. У
   * бессрочного контракта это НЕ округление к ближайшему шагу: на провод уходит целое число
   * контрактов, полученное отбрасыванием остатка, и общий расчёт базового класса называл 0.0157
   * монеты «0.02», тогда как уходило 0.01. Проверка объёма снаружи и отправка обязаны давать
   * одно и то же число, иначе вызывающий проверяет одну заявку, а ставит другую.
   */
  amountToPrecision(symbol: string, amount: number): number {
    if (!this.isSwap) {
      return super.amountToPrecision(symbol, amount);
    }

    const contractValue = this.contractValueBySymbol.get(symbol);
    const lotSize = this.lotSizeBySymbol.get(symbol);

    if (contractValue === undefined || lotSize === undefined) {
      return super.amountToPrecision(symbol, amount);
    }

    return convertContractsToCoins(convertCoinsToContracts({ amount, contractValue, lotSize }), contractValue);
  }

  /**
   * Шаг объёма инструмента. Для бессрочного он нужен на КАЖДУЮ заявку: биржа принимает объём
   * только в контрактах и только кратный шагу, а библиотека наружу говорит в монетах.
   */
  protected resolveLotSize(symbol: string): string {
    const lotSize = this.lotSizeBySymbol.get(symbol);

    if (lotSize !== undefined && lotSize !== '') {
      return lotSize;
    }

    throw new ExchangeError(
      `OKX lot size for ${symbol} is unknown — call loadTradeSymbols() first`,
      'OKX_INSTRUMENTS_NOT_LOADED',
      'OKX',
    );
  }

  /**
   * Чем расплачивается заявка: у спота это всегда наличный счёт, у бессрочного — режим маржи,
   * который клиент помнит по символу.
   */
  protected abstract resolveTradeMode(symbol: string): Promise<string>;

  protected async fetchAndNormalizeTickers(): Promise<TickerBySymbol> {
    const rawList = await this.httpClient.fetchTickers(this.instType);

    return normalizeOkxTickers(rawList, this.isSwap, this.contractValueBySymbol);
  }

  protected async fetchAndNormalizeKlines(
    symbol: string,
    interval: KlineInterval,
    options?: FetchPageWithLimitArgs,
  ): Promise<Kline[]> {
    const okxInterval = OKX_KLINE_INTERVAL[interval];

    if (okxInterval === undefined) {
      throw new Error(`Kline interval '${interval}' is not supported by OKX`);
    }

    const instId = this.symbolMap.resolveInstId(symbol);
    const limit = Math.min(options?.limit ?? OKX_KLINE_LIMIT, OKX_KLINE_LIMIT);
    const intervalMs = OKX_KLINE_INTERVAL_MS[interval];
    const { startTime, endTime } = options ?? {};
    const needsHistory = startTime !== undefined || endTime !== undefined || interval === '1s';

    let after: string | undefined;

    if (endTime !== undefined) {
      after = String(endTime + 1);
    } else if (startTime !== undefined && intervalMs !== undefined) {
      after = String(startTime + limit * intervalMs);
    } else if (startTime !== undefined) {
      after = String(startTime + limit * OKX_APPROXIMATE_MONTH_MS);
    }

    const candlesArgs = { instId, bar: okxInterval, after, limit };
    const rowList = needsHistory
      ? await this.httpClient.fetchHistoryCandles(candlesArgs)
      : await this.httpClient.fetchCandles(candlesArgs);

    const klineList = normalizeOkxKlines(rowList, this.isSwap, intervalMs);

    if (startTime === undefined) {
      return klineList;
    }

    return klineList.filter((kline) => kline.openTimestamp >= startTime);
  }

  protected async fetchAndNormalizeBalances(): Promise<AccountBalances> {
    const balanceRawList = await this.httpClient.fetchBalance();

    if (balanceRawList.length === 0) {
      throw new ExchangeError('OKX returned an empty balance response', 'OKX_BALANCE_EMPTY', 'OKX');
    }

    return normalizeOkxBalances(balanceRawList[0], await this.resolveAccountLevel());
  }

  /**
   * Режим счёта живёт в отдельном ответе (`/api/v5/account/config`) и читается один раз за жизнь
   * клиента. Отказ этого чтения не срывает баланс: остаток счёта — то, ради чего метод вызывают,
   * а подпись режима — пояснение к нему.
   */
  private async resolveAccountLevel(): Promise<string | undefined> {
    try {
      const config = await this.ensureAccountConfig();

      return config.acctLv;
    } catch (error) {
      this.logger.warn(`[OKX] Could not read the account mode for the balance response: ${toOkxErrorText(error)}`);

      return undefined;
    }
  }

  async fetchOrderBook(symbol: string, limit?: number): Promise<OrderBook> {
    this.logger.debug(`[OKX] Fetching order book for ${symbol}`);
    const instId = this.symbolMap.resolveInstId(symbol);
    const depth = Math.min(limit ?? OKX_ORDER_BOOK_MAX_DEPTH, OKX_ORDER_BOOK_MAX_DEPTH);
    const orderBookRawList = await this.httpClient.fetchOrderBook(instId, depth);

    if (orderBookRawList.length === 0) {
      throw new ExchangeError('OKX returned an empty order book response', 'OKX_ORDER_BOOK_EMPTY', 'OKX');
    }

    return normalizeOkxOrderBook(orderBookRawList[0], symbol, this.resolveContractValue(symbol));
  }

  async fetchTrades(symbol: string, limit?: number): Promise<PublicTrade[]> {
    this.logger.debug(`[OKX] Fetching trades for ${symbol}`);
    const instId = this.symbolMap.resolveInstId(symbol);
    const publicTradeRawList = await this.httpClient.fetchTrades(instId, Math.min(limit ?? 100, OKX_TRADES_MAX_LIMIT));

    return normalizeOkxPublicTradeList(publicTradeRawList, this.resolveContractValue(symbol));
  }

  async fetchFeeRate(symbol?: string): Promise<FeeRate[]> {
    if (symbol === undefined) {
      throw new ExchangeError('OKX fee rate requires a symbol', 'FEE_RATE_SYMBOL_REQUIRED', 'OKX');
    }

    this.logger.debug(`[OKX] Fetching fee rate for ${symbol}`);
    const instId = this.symbolMap.resolveInstId(symbol);

    const feeRateRawList = this.isSwap
      ? await this.httpClient.fetchTradeFee({ instType: this.instType, instFamily: toOkxIndexInstId(instId) })
      : await this.httpClient.fetchTradeFee({ instType: this.instType, instId });

    if (feeRateRawList.length === 0) {
      throw new ExchangeError('OKX returned an empty fee rate response', 'OKX_FEE_RATE_EMPTY', 'OKX');
    }

    const { feeRate, isFromOutdatedField } = normalizeOkxFeeRate(feeRateRawList[0], {
      symbol,
      groupId: this.groupIdBySymbol.get(symbol),
      settle: this.tradeSymbols.get(symbol)?.settle ?? '',
      isSwap: this.isSwap,
    });

    // Ставка из верхнеуровневых полей — общая для старых потребителей, а не для группы ИМЕННО
    // этого инструмента: расчёт издержек по ней может разойтись с тем, что спишет биржа.
    if (isFromOutdatedField) {
      this.logger.warn(
        `[OKX] Fee rate of ${symbol} taken from the outdated top-level fields: its own fee group is not in the response`,
      );
    }

    return [feeRate];
  }

  /**
   * Свежая ручка хранит семь дней, архивная — три месяца. Окно, заданное ТОЛЬКО концом, раньше
   * уходило в свежую и возвращало пустой список, неотличимый от «начислений не было», хотя записи
   * лежали в архиве. Смотрим на ту границу окна, которая задана: начало, если оно есть, иначе
   * конец.
   */
  private isArchiveWindow(options?: FetchPageWithLimitArgs): boolean {
    const recentBoundary = Date.now() - OKX_RECENT_HISTORY_RETENTION_MS;

    if (options?.startTime !== undefined) {
      return options.startTime < recentBoundary;
    }

    return options?.endTime !== undefined && options.endTime < recentBoundary;
  }

  /**
   * История заявок OKX лежит в ДВУХ службах: обычная книга и служба условных заявок. Сработавший
   * или снятый стоп живёт только во второй, поэтому одна книга отдавала историю, в которой нет
   * ни одного стопа. Обе читаются постранично: полная страница на сотне записей раньше молча
   * обрезала ответ, и месяц торговли выглядел как сто заявок.
   *
   * `options.limit` — сколько строк ИТОГА вернуть (как у Binance и Bybit), а не размер страницы.
   */
  async fetchOrderHistory(symbol: string, options?: FetchPageWithLimitArgs): Promise<Order[]> {
    this.logger.debug(`[OKX] Fetching order history for ${symbol}`);
    const instId = this.symbolMap.resolveInstId(symbol);
    const maxRecordCount = options?.limit ?? OKX_ORDER_PAGE_LIMIT;
    const contractValue = this.resolveContractValue(symbol);

    const plainRawList = await this.httpClient.fetchAllOrderHistory({
      instType: this.instType,
      instId,
      begin: options?.startTime !== undefined ? String(options.startTime) : undefined,
      end: options?.endTime !== undefined ? String(options.endTime) : undefined,
      isArchive: this.isArchiveWindow(options),
      maxRecordCount,
    });

    const algoRawList = await this.fetchOkxAlgoOrderHistory(instId, maxRecordCount);

    const orderList = [
      ...plainRawList.map((raw) => normalizeOkxOrder(raw, contractValue)),
      ...algoRawList.map((raw) => normalizeOkxAlgoOrder(raw, contractValue)),
    ].filter((order) => this.isWithinOkxTimeWindow(order.timestamp, options));

    const pageList = orderList.sort((first, second) => second.timestamp - first.timestamp).slice(0, maxRecordCount);

    return this.hydrateTriggeredOrderList(symbol, pageList);
  }

  /**
   * Сработавший стоп в истории. Состояние `effective` у OKX ТЕРМИНАЛЬНОЕ: вход истории условных
   * принимает только `effective|canceled|order_failed`, то есть заявка остаётся в этом состоянии
   * навсегда — в отличие от мимолётных `TRIGGERED` у Binance и Bybit, где та же заявка приезжает
   * из истории уже исполненной. Без дочитывания порождённой заявки история отдавала сработавший
   * стоп как «открыт, исполнено 0», и построенная по ней сводка не видела ни одного закрытия.
   *
   * Дочитывается ТО ЖЕ, что и в одиночном чтении (`hydrateTriggeredOrder`), но не лавиной: только
   * условные заявки, которые числятся открытыми и породили заявку (то есть ровно `effective` —
   * остальные два терминальных состояния открытыми не числятся), и не более
   * `OKX_HISTORY_TRIGGERED_ORDER_READ_LIMIT` за вызов. Упёрлись в предел — говорим об этом вслух.
   */
  private async hydrateTriggeredOrderList(symbol: string, orderList: Order[]): Promise<Order[]> {
    const pendingIndexList = orderList
      .map((order, index) => ({ order, index }))
      .filter((entry) => entry.order.isConditional === true
        && entry.order.status === 'open'
        && entry.order.triggeredOrderId !== undefined)
      .map((entry) => entry.index);

    if (pendingIndexList.length > OKX_HISTORY_TRIGGERED_ORDER_READ_LIMIT) {
      this.logger.warn(
        { symbol, triggeredOrderCount: pendingIndexList.length, limit: OKX_HISTORY_TRIGGERED_ORDER_READ_LIMIT },
        `[OKX] Order history for ${symbol} holds ${pendingIndexList.length} triggered conditional orders; only the first ${OKX_HISTORY_TRIGGERED_ORDER_READ_LIMIT} are read back, the rest keep a zero fill`,
      );
    }

    const result = [...orderList];

    for (const index of pendingIndexList.slice(0, OKX_HISTORY_TRIGGERED_ORDER_READ_LIMIT)) {
      result[index] = await this.hydrateTriggeredOrder(symbol, result[index]);
    }

    return result;
  }

  /**
   * Окна по времени служба условных заявок не принимает вовсе — только состояние и страницы по
   * номеру, — поэтому спрашиваем каждое терминальное состояние по каждому виду условной заявки,
   * а по времени отбираем уже у себя.
   */
  private async fetchOkxAlgoOrderHistory(instId: string, maxRecordCount: number): Promise<OkxAlgoOrderRaw[]> {
    const rawList: OkxAlgoOrderRaw[] = [];

    for (const ordType of OKX_ALGO_HISTORY_ORD_TYPE_LIST) {
      for (const state of OKX_ALGO_HISTORY_STATE_LIST) {
        const pageList = await this.httpClient.fetchAllAlgoOrderHistory({
          ordType,
          state,
          instType: this.instType,
          instId,
          maxRecordCount,
        });

        rawList.push(...pageList);
      }
    }

    return rawList;
  }

  private isWithinOkxTimeWindow(timestamp: number, options?: FetchPageWithLimitArgs): boolean {
    if (options?.startTime !== undefined && timestamp < options.startTime) {
      return false;
    }

    return options?.endTime === undefined || timestamp <= options.endTime;
  }

  async fetchIncome(options?: FetchIncomeArgs): Promise<Income[]> {
    this.logger.debug('[OKX] Fetching income');
    const limit = Math.min(options?.limit ?? OKX_BILLS_PAGE_LIMIT, OKX_BILLS_PAGE_LIMIT);
    const type = options?.incomeType !== undefined ? OKX_INCOME_BILL_TYPE[options.incomeType] : undefined;
    const isArchive = this.isArchiveWindow(options);

    const rawList = await this.httpClient.fetchBills({
      instType: this.instType,
      instId: options?.symbol !== undefined ? this.symbolMap.resolveInstId(options.symbol) : undefined,
      type,
      begin: options?.startTime !== undefined ? String(options.startTime) : undefined,
      end: options?.endTime !== undefined ? String(options.endTime) : undefined,
      limit,
      isArchive,
    });

    // Постраничного дочитывания здесь нет, поэтому полная страница — признак того, что часть
    // записей осталась за кадром. Отдать усечённый журнал молча хуже, чем отказать: по нему
    // посчитают фандинг за период и не узнают, что половины начислений в ответе не было.
    if (rawList.length >= limit) {
      throw new Error(`[OKX] bills returned a full page of ${limit} entries — the answer would be incomplete`);
    }

    if (options?.incomeType === 'realizedPnl') {
      return buildOkxRealizedPnlIncomeList(rawList, this.contractValueBySymbol, this.logger);
    }

    if (options?.incomeType === 'commission') {
      return buildOkxCommissionIncomeList(rawList, this.contractValueBySymbol, this.logger);
    }

    return normalizeOkxIncomeList(rawList, this.contractValueBySymbol, this.logger);
  }

  /**
   * Предел записи OKX считается НА ИНСТРУМЕНТ: документация называет 60 запросов за 2 секунды
   * на один инструмент, то есть 30 в секунду — именно это число библиотека и отдаёт. Поверх него
   * действует общий предел суб-счёта (1000 заявок за 2 секунды, отказ кодом 50061), который к
   * одному инструменту не относится и здесь не выражается.
   */
  async getOrderRateLimit(): Promise<OrderRateLimit> {
    return { writeRequestsPerSecond: OKX_ORDER_RATE_LIMIT_RPS, source: 'okx-documented' };
  }

  isTradeWebSocketConnected(): boolean {
    return this.tradeStream.isConnected();
  }

  async connectTradeWebSocket(): Promise<void> {
    await this.tradeStream.connect();
  }

  protected async ensureAccountConfig(): Promise<OkxAccountConfigRaw> {
    if (this.accountConfig !== null) {
      return this.accountConfig;
    }

    const accountConfigRawList = await this.httpClient.fetchAccountConfig();

    if (accountConfigRawList.length === 0) {
      throw new ExchangeError('OKX returned an empty account config response', 'OKX_ACCOUNT_CONFIG_EMPTY', 'OKX');
    }

    const config = accountConfigRawList[0];

    if (config.acctLv === '1' && this.isSwap) {
      this.logger.warn('[OKX] Account is in Spot mode (acctLv=1) — contract trading is unavailable');
    }

    this.accountConfig = config;

    return config;
  }

  protected invalidateAccountConfig(): void {
    this.accountConfig = null;
  }

  private assertOkxClientOrderId(clientOrderId: string | undefined): void {
    if (clientOrderId === undefined || OKX_CLIENT_ORDER_ID_PATTERN.test(clientOrderId)) {
      return;
    }

    throw new ExchangeError(
      `OKX client order id must be 1–32 letters or digits: ${clientOrderId}`,
      'OKX_CLIENT_ORDER_ID_INVALID',
      'OKX',
    );
  }

  /**
   * Объём на проводе: у бессрочного — контракты, кратные шагу инструмента, у спота — сами монеты.
   * Объём меньше одного контракта — отказ, а не нулевая заявка: биржа приняла бы её как «ничего»,
   * и вызывающий считал бы, что защита стоит.
   */
  private resolveOkxOrderSize(symbol: string, amount: number): string {
    if (!this.isSwap) {
      return toDecimalNumberString(this.amountToPrecision(symbol, amount));
    }

    const size = convertCoinsToContracts({
      amount,
      contractValue: this.resolveContractValue(symbol),
      lotSize: this.resolveLotSize(symbol),
    });

    if (size === '0') {
      throw new ExchangeError(`OKX: amount ${amount} is below one lot for ${symbol}`, 'AMOUNT_BELOW_LOT', 'OKX');
    }

    return size;
  }

  private async isOkxHedgeMode(): Promise<boolean> {
    if (!this.isSwap) {
      return false;
    }

    const config = await this.ensureAccountConfig();

    return config.posMode === 'long_short_mode';
  }

  private resolveOkxPositionSide(positionSide: PositionSideEnum | undefined): string {
    if (positionSide === PositionSideEnum.Long) {
      return 'long';
    }

    if (positionSide === PositionSideEnum.Short) {
      return 'short';
    }

    throw new ExchangeError(
      'OKX long/short mode requires positionSide Long or Short',
      'OKX_POSITION_SIDE_REQUIRED',
      'OKX',
    );
  }

  /**
   * По какой цене сверять срабатывание. Спот у OKX умеет только последнюю цену сделки — просьбу
   * о цене маркировки или индекса там нельзя выполнить, и молчаливая подмена сделала бы стоп не
   * тем, о чём просили: об этом пишем в журнал.
   */
  private resolveOkxTriggerPriceType(args: CreateOrderWebSocketArgs): string {
    const requestedType = resolveRequestedOkxTriggerPriceType(args);

    if (this.isSwap) {
      return requestedType;
    }

    if (requestedType !== OKX_SPOT_TRIGGER_PRICE_TYPE) {
      this.logger.warn(
        `[OKX] Spot conditional orders trigger on the last price only — the requested ${requestedType} price is ignored for ${args.symbol}`,
      );
    }

    return OKX_SPOT_TRIGGER_PRICE_TYPE;
  }

  /**
   * Объём и его единица — одинаково для обычной заявки и для условной. Сумму в котируемой
   * валюте спот OKX принимает только на РЫНОЧНОМ исполнении: на лимитном та же сумма стала бы
   * количеством монет. Единицу спот обязан слышать явно — собственное умолчание биржи для
   * рыночной покупки котируемая валюта, и «купить 0.25 монеты» ушло бы как «купить на 0.25
   * доллара», молча и успешно.
   */
  private isOkxQuoteSizedOrder(args: CreateOrderWebSocketArgs): boolean {
    return !this.isSwap
      && ((args.quoteOrderQty !== undefined && args.quoteOrderQty > 0) || args.marketUnit === MarketUnitEnum.QuoteCoin);
  }

  /**
   * Сколько монет несёт заявка, которую мы только что отправили. Совпадает с `amountToPrecision`
   * по построению — это одно и то же вычисление. Заявка, размеренная в котируемой валюте, монет
   * на проводе не несёт вовсе: там число монет узнаётся только из исполнения, и до него честнее
   * оставить то, о чём просил вызывающий.
   */
  private resolveOkxCreatedAmount(args: CreateOrderWebSocketArgs): number {
    if (this.isOkxQuoteSizedOrder(args)) {
      return args.amount;
    }

    return this.amountToPrecision(args.symbol, args.amount);
  }

  private applyOkxOrderSize(
    params: Record<string, unknown>,
    args: CreateOrderWebSocketArgs,
    isMarketExecution: boolean,
  ): void {
    const isQuoteSized = this.isOkxQuoteSizedOrder(args);

    if (isQuoteSized && !isMarketExecution) {
      throw new ExchangeError(
        'OKX spot accepts an amount in quote currency on MARKET orders only',
        'QUOTE_AMOUNT_MARKET_ONLY',
        'OKX',
      );
    }

    if (isQuoteSized) {
      params.sz = toDecimalNumberString(args.quoteOrderQty ?? args.amount);
      params.tgtCcy = 'quote_ccy';

      return;
    }

    params.sz = this.resolveOkxOrderSize(args.symbol, args.amount);

    if (!this.isSwap && isMarketExecution) {
      params.tgtCcy = 'base_ccy';
    }
  }

  /**
   * Обычная заявка на проводе. Условные типы отсюда уходят отказом: у них своя служба, и
   * пакетный путь зовёт этот сборщик напрямую — отказ закрывает и его.
   */
  protected async buildOkxOrderParams(args: CreateOrderWebSocketArgs): Promise<Record<string, unknown>> {
    if (isConditionalOrderType(args.type)) {
      throw new ExchangeError(
        'OKX: conditional orders go through the algo service — createOrderWebSocket handles it',
        'CONDITIONAL_ORDER_WRONG_ENDPOINT',
        'OKX',
      );
    }

    this.assertOkxClientOrderId(args.clientOrderId);

    const isMarket = args.type === OrderTypeEnum.Market;
    const params: Record<string, unknown> = {
      instId: this.symbolMap.resolveInstId(args.symbol),
      tdMode: await this.resolveTradeMode(args.symbol),
      side: OKX_ORDER_SIDE_REVERSE[args.side],
      ordType: isMarket ? 'market' : OKX_ORDER_TYPE_BY_TIME_IN_FORCE[args.timeInForce ?? TimeInForceEnum.Gtc],
    };

    this.applyOkxOrderSize(params, args, isMarket);

    if (!isMarket && args.price !== undefined && args.price > 0) {
      params.px = toDecimalNumberString(this.priceToPrecision(args.symbol, args.price));
    }

    if (this.isSwap) {
      await this.applyOkxPositionParams(params, args);
    }

    if (args.clientOrderId !== undefined) {
      params.clOrdId = args.clientOrderId;
    }

    return params;
  }

  /**
   * Сторона позиции и запрет на увеличение — взаимоисключающие: в режиме «лонг и шорт» биржа
   * требует сторону и не принимает запрет, в одностороннем — наоборот.
   */
  private async applyOkxPositionParams(params: Record<string, unknown>, args: CreateOrderWebSocketArgs): Promise<void> {
    if (await this.isOkxHedgeMode()) {
      params.posSide = this.resolveOkxPositionSide(args.positionSide);

      return;
    }

    if (args.reduceOnly !== undefined) {
      params.reduceOnly = args.reduceOnly;
    }
  }

  /** Условная заявка на проводе: отдельная служба, отдельный набор полей. */
  protected async buildOkxAlgoOrderParams(args: CreateOrderWebSocketArgs): Promise<Record<string, unknown>> {
    if (!isConditionalOrderType(args.type)) {
      throw new ExchangeError(
        'OKX: a plain order does not belong to the algo service',
        'PLAIN_ORDER_WRONG_ENDPOINT',
        'OKX',
      );
    }

    this.assertOkxClientOrderId(args.clientOrderId);

    const params: Record<string, unknown> = {
      instId: this.symbolMap.resolveInstId(args.symbol),
      tdMode: await this.resolveTradeMode(args.symbol),
      side: OKX_ORDER_SIDE_REVERSE[args.side],
    };

    if (args.clientOrderId !== undefined) {
      params.algoClOrdId = args.clientOrderId;
    }

    const isHedgeMode = await this.isOkxHedgeMode();

    if (isHedgeMode) {
      params.posSide = this.resolveOkxPositionSide(args.positionSide);
    }

    if (args.type === OrderTypeEnum.TrailingStop) {
      this.applyOkxTrailingStopParams(params, args, isHedgeMode);

      return params;
    }

    this.applyOkxConditionalParams(params, args, isHedgeMode);

    return params;
  }

  private applyOkxTrailingStopParams(
    params: Record<string, unknown>,
    args: CreateOrderWebSocketArgs,
    isHedgeMode: boolean,
  ): void {
    if (!this.isSwap) {
      throw new ExchangeError(
        'OKX spot has no trailing stop at all — there is nothing to fall back to',
        'TRAILING_STOP_UNSUPPORTED',
        'OKX',
      );
    }

    if (args.callbackRate === undefined || args.callbackRate <= 0) {
      throw new ExchangeError(
        'OKX trailing stop requires a callback rate in percent',
        'TRAILING_STOP_CALLBACK_REQUIRED',
        'OKX',
      );
    }

    params.ordType = OKX_ALGO_TRAILING_ORD_TYPE;
    // Отступ библиотека выражает в процентах, OKX — долей: два процента на проводе это 0.02.
    // Деление с плавающей точкой здесь недопустимо: 1.1 / 100 даёт 0.011000000000000001, и на
    // провод уходило число из восемнадцати знаков — единственное такое место в библиотеке.
    params.callbackRatio = multiplyDecimalStrings(toDecimalNumberString(args.callbackRate), OKX_PERCENT_TO_RATIO);
    params.sz = this.resolveOkxOrderSize(args.symbol, args.amount);

    if (args.activationPrice !== undefined && args.activationPrice > 0) {
      params.activePx = toDecimalNumberString(this.priceToPrecision(args.symbol, args.activationPrice));
    }

    if (!isHedgeMode && args.reduceOnly !== undefined) {
      params.reduceOnly = args.reduceOnly;
    }
  }

  /**
   * Сторону подхода цены к уровню (`triggerDirection` в аргументах) OKX не принимает вовсе —
   * биржа выводит её сама из того, какая нога заполнена и с какой стороны стоит заявка.
   */
  private applyOkxConditionalParams(
    params: Record<string, unknown>,
    args: CreateOrderWebSocketArgs,
    isHedgeMode: boolean,
  ): void {
    if (args.stopPrice === undefined || args.stopPrice <= 0) {
      throw this.buildOkxStopPriceRequiredError();
    }

    const isLimitLike = OKX_LIMIT_LIKE_CONDITIONAL_TYPE_SET.has(args.type);
    const hasOwnPrice = isLimitLike && args.price !== undefined && args.price > 0;
    const triggerPrice = toDecimalNumberString(this.priceToPrecision(args.symbol, args.stopPrice));
    const orderPrice = hasOwnPrice ? toDecimalNumberString(this.priceToPrecision(args.symbol, args.price ?? 0)) : OKX_MARKET_ORDER_PRICE;
    const triggerPriceType = this.resolveOkxTriggerPriceType(args);

    params.ordType = OKX_ALGO_CONDITIONAL_ORD_TYPE;

    if (OKX_TAKE_PROFIT_ORDER_TYPE_SET.has(args.type)) {
      params.tpTriggerPx = triggerPrice;
      params.tpOrdPx = orderPrice;
      params.tpTriggerPxType = triggerPriceType;
    } else {
      params.slTriggerPx = triggerPrice;
      params.slOrdPx = orderPrice;
      params.slTriggerPxType = triggerPriceType;
    }

    const isMarketExecution = orderPrice === OKX_MARKET_ORDER_PRICE;
    const isClosePosition = this.isSwap && args.closePosition === true;

    if (!isClosePosition) {
      this.applyOkxOrderSize(params, args, isMarketExecution);

      if (this.isSwap && !isHedgeMode && args.reduceOnly !== undefined) {
        params.reduceOnly = args.reduceOnly;
      }

      return;
    }

    // «Закрыть всю позицию» OKX выражает долей позиции вместо объёма и принимает такую заявку
    // только рыночной: с ценой исполнения биржа отвергла бы её целиком.
    if (!isMarketExecution) {
      throw new ExchangeError(
        'OKX closes the whole position with market conditional orders only',
        'OKX_CLOSE_POSITION_MARKET_ONLY',
        'OKX',
      );
    }

    // Долю позиции биржа принимает только вместе с «только уменьшение» и только в одностороннем
    // режиме (её собственные коды отказа 51327–51330). В режиме «лонг и шорт» такая заявка не
    // встанет никогда, поэтому отказываем сами и внятно — вместо невнятного кода биржи.
    if (isHedgeMode) {
      throw new ExchangeError(
        'OKX accepts closing the whole position in the one-way mode only; in the long/short mode pass an amount',
        'OKX_CLOSE_POSITION_ONE_WAY_ONLY',
        'OKX',
      );
    }

    params.closeFraction = OKX_CLOSE_WHOLE_POSITION_FRACTION;
    params.reduceOnly = true;
  }

  private isOrderChannelReady(): boolean {
    return this.tradeStream.isConnected() && this.tradeStream.isOrderChannelUsable();
  }

  async createOrderWebSocket(args: CreateOrderWebSocketArgs): Promise<Order> {
    if (isConditionalOrderType(args.type)) {
      return this.createOkxConditionalOrder(args);
    }

    const params = await this.buildOkxOrderParams(args);
    const orderId = await this.submitOkxOrder(params, args.symbol);
    const order = buildOkxOrderFromCreateResponse(args, orderId, this.resolveOkxCreatedAmount(args));

    // Происхождение СВОЕЙ заявки известно в момент постановки — запоминаем сразу, иначе первое
    // же чтение по номеру опрашивает обе службы, и вторая отвечает «такой заявки нет».
    this.conditionalOrderRegistry.record(args.symbol, orderId, 'plain');

    return order;
  }

  /**
   * Отказ канала по адресу инструмента не смеет стоить заявки. Канал знает инструмент числовым
   * кодом, и код может оказаться неизвестным (инструмент перелистили после загрузки списка) или
   * отвергнутым биржей — в обоих случаях заявка до книги не дошла, поэтому она уходит ОДИН раз
   * обычным запросом, который адресует инструмент именем. Любой другой отказ канала идёт наружу
   * как есть: биржа могла заявку принять, и повтор поставил бы вторую.
   */
  private async submitOkxOrder(params: Record<string, unknown>, symbol: string): Promise<string> {
    if (this.isOrderChannelReady()) {
      try {
        this.logger.debug(`[OKX] Creating order via WebSocket: ${symbol}`);
        const order = await this.tradeStream.createOrder(params);

        return order.id;
      } catch (error) {
        if (!isOkxOrderChannelUnsentError(error)) {
          throw error;
        }

        this.logger.warn(
          { symbol, error: toOkxErrorText(error) },
          `[OKX] the trade channel could not address ${symbol} — placing the order over REST instead`,
        );
      }
    }

    this.logger.debug(`[OKX] Creating order via REST: ${symbol}`);
    const result = await this.httpClient.placeOrder(params);

    return this.requireOkxPlacedOrderId(result.ordId, symbol);
  }

  /**
   * Заявка без номера — это не заявка: по ней нельзя ни прочитать, ни отменить, а наружу она ушла
   * бы как поставленная и легла бы в реестр происхождения под пустым номером. Торговый канал такую
   * запись отвергает давно (`OKX_EMPTY_ORDER_ID`), у Binance проверка тоже есть — обычный путь
   * постановки был единственным без неё.
   */
  private requireOkxPlacedOrderId(orderId: string, symbol: string): string {
    if (orderId !== '') {
      return orderId;
    }

    throw new ExchangeError(
      `OKX accepted the order for ${symbol} but returned no order id`,
      'OKX_EMPTY_ORDER_ID',
      'OKX',
    );
  }

  /** Условные заявки идут только обычным запросом: торговый канал OKX их не принимает. */
  private async createOkxConditionalOrder(args: CreateOrderWebSocketArgs): Promise<Order> {
    const params = await this.buildOkxAlgoOrderParams(args);
    const result = await this.httpClient.placeAlgoOrder(params);
    const algoId = this.requireOkxPlacedOrderId(result.algoId, args.symbol);
    const order = buildOkxOrderFromCreateResponse(args, algoId, this.resolveOkxCreatedAmount(args));

    if (result.algoClOrdId !== '') {
      order.clientOrderId = result.algoClOrdId;
    }

    this.conditionalOrderRegistry.record(args.symbol, algoId, 'conditional');

    return order;
  }

  private buildOkxOrderNotFoundError(symbol: string, orderId: string): ExchangeError {
    return new ExchangeError(
      `OKX: order ${orderId} not found for ${symbol}`,
      OKX_ORDER_NOT_FOUND_ERROR_CODE,
      'OKX',
    );
  }

  /**
   * Вход биржи `order-algo` инструмент не принимает вовсе — только номер заявки, поэтому условная
   * служба отвечает по ЛЮБОМУ инструменту счёта, а не по тому, о котором спросили. Ответ по чужому
   * инструменту — это «в условной службе такой заявки по этому инструменту нет», а не находка:
   * иначе чужая заявка уходит наружу с объёмом, пересчитанным множителем НАШЕГО контракта, её
   * номер запоминается под нашим символом, и следующая отмена снимает чужую защиту.
   */
  private takeOkxAlgoOrderForSymbol(raw: OkxAlgoOrderRaw | undefined, symbol: string): OkxAlgoOrderRaw | undefined {
    if (raw === undefined) {
      return undefined;
    }

    const instId = this.symbolMap.resolveInstId(symbol);

    if (raw.instId === instId) {
      return raw;
    }

    this.logger.info(
      { symbol, algoId: raw.algoId, instId: raw.instId },
      `[OKX] Conditional order ${raw.algoId} belongs to ${raw.instId}, not to ${instId} — reported as not found`,
    );

    return undefined;
  }

  private async readOkxAlgoOrder(symbol: string, orderId: string): Promise<Order> {
    const rawList = await this.httpClient.fetchAlgoOrder({ algoId: orderId });
    const raw = this.takeOkxAlgoOrderForSymbol(rawList[0], symbol);

    if (raw === undefined) {
      throw this.buildOkxOrderNotFoundError(symbol, orderId);
    }

    return normalizeOkxAlgoOrder(raw, this.resolveContractValue(symbol));
  }

  private async readOkxPlainOrder(symbol: string, orderId: string): Promise<Order> {
    const instId = this.symbolMap.resolveInstId(symbol);
    const rawList = await this.httpClient.fetchOrder({ instId, ordId: orderId });
    const raw = rawList[0];

    if (raw === undefined) {
      throw this.buildOkxOrderNotFoundError(symbol, orderId);
    }

    return normalizeOkxOrder(raw, this.resolveContractValue(symbol));
  }

  /**
   * Читает заявку из той службы, которой она принадлежит. Помним происхождение — один запрос;
   * не помним — спрашиваем обе и запоминаем ответ. Ответили ОБЕ — это столкновение номеров, и
   * выбирать мы отказываемся: молча вернуть чужую заявку хуже, чем сообщить о неоднозначности.
   */
  private async readOrderFromOwningService(symbol: string, orderId: string): Promise<OkxOwnedOrder> {
    const knownKind = this.conditionalOrderRegistry.lookup(symbol, orderId);

    if (knownKind === 'conditional') {
      return { order: await this.readOkxAlgoOrder(symbol, orderId), kind: 'conditional' };
    }

    if (knownKind === 'plain') {
      return { order: await this.readOkxPlainOrder(symbol, orderId), kind: 'plain' };
    }

    const instId = this.symbolMap.resolveInstId(symbol);
    const [plainOutcome, algoOutcome] = await Promise.allSettled([
      this.httpClient.fetchOrder({ instId, ordId: orderId }),
      this.httpClient.fetchAlgoOrder({ algoId: orderId }),
    ]);

    const plainRaw = takeOkxFulfilledEntry(plainOutcome);
    const algoRaw = this.takeOkxAlgoOrderForSymbol(takeOkxFulfilledEntry(algoOutcome), symbol);

    if (plainRaw !== undefined && algoRaw !== undefined) {
      throw new ExchangeError(
        `OKX: order id ${orderId} exists in both the plain and the conditional service for ${symbol}`,
        'CONDITIONAL_ORDER_ID_AMBIGUOUS',
        'OKX',
      );
    }

    if (algoRaw !== undefined) {
      this.conditionalOrderRegistry.record(symbol, orderId, 'conditional');

      return { order: normalizeOkxAlgoOrder(algoRaw, this.resolveContractValue(symbol)), kind: 'conditional' };
    }

    if (plainRaw !== undefined) {
      this.conditionalOrderRegistry.record(symbol, orderId, 'plain');

      return { order: normalizeOkxOrder(plainRaw, this.resolveContractValue(symbol)), kind: 'plain' };
    }

    throw this.resolveOkxTwoServiceFailure({
      symbol,
      orderId,
      action: 'reading',
      errorList: takeOkxRejectionReasonList([plainOutcome, algoOutcome]),
      missingOrderError: this.buildOkxOrderNotFoundError(symbol, orderId),
    });
  }

  /**
   * Разбор «одна и та же заявка отказала в обеих службах» — общий с другими биржами, у которых
   * обычные и условные заявки живут в РАЗНЫХ службах (`twoServiceOrderLookup`): «заявки нет» и
   * «спросить не удалось» там уже разведены и по тому, что уходит наружу, и по уровню записи.
   * Здесь остаётся только сказать, чем OKX опознаёт ожидаемое «нет» (`51400`/`51503`/`51603`).
   */
  private resolveOkxTwoServiceFailure(failure: OkxTwoServiceFailure): Error {
    return resolveTwoServiceOrderFailure({
      ...failure,
      exchangeLabel: this.exchangeLabel,
      logger: this.logger,
      isMissingOrderError: isOkxMissingPlainOrderError,
    });
  }

  /** Дочитывает фактическое исполнение из порождённой заявки, если условная уже сработала. */
  private async hydrateTriggeredOrder(symbol: string, order: Order): Promise<Order> {
    if (order.isConditional !== true || order.triggeredOrderId === undefined) {
      return order;
    }

    try {
      const instId = this.symbolMap.resolveInstId(symbol);
      const rawList = await this.httpClient.fetchOrder({ instId, ordId: order.triggeredOrderId });
      const raw = rawList[0];

      if (raw === undefined) {
        return order;
      }

      return mergeOkxTriggeredOrder(order, raw, this.resolveContractValue(symbol));
    } catch (error) {
      // Не срываем чтение: выдуманное заполнение попало бы в журнал как закрытие, которого не было.
      this.logger.warn(`[OKX] Could not read the order triggered by ${order.id}: ${toOkxErrorText(error)}`);

      return order;
    }
  }

  async getOrder(symbol: string, orderId: string): Promise<Order> {
    this.logger.debug(`[OKX] Fetching order ${orderId} for ${symbol}`);
    const { order } = await this.readOrderFromOwningService(symbol, orderId);

    return this.hydrateTriggeredOrder(symbol, order);
  }

  async getOrderByClientOrderId(symbol: string, clientOrderId: string): Promise<Order> {
    this.logger.debug(`[OKX] Fetching order by client id ${clientOrderId} for ${symbol}`);
    const plainRaw = await this.tryReadOkxPlainOrderByClientOrderId(symbol, clientOrderId);

    if (plainRaw !== undefined) {
      const order = normalizeOkxOrder(plainRaw, this.resolveContractValue(symbol));
      this.conditionalOrderRegistry.record(symbol, order.id, 'plain');

      return order;
    }

    const algoRawList = await this.httpClient.fetchAlgoOrder({ algoClOrdId: clientOrderId });
    const algoRaw = this.takeOkxAlgoOrderForSymbol(algoRawList[0], symbol);

    if (algoRaw === undefined) {
      throw new ExchangeError(
        `OKX: order with client id ${clientOrderId} not found for ${symbol}`,
        OKX_ORDER_NOT_FOUND_ERROR_CODE,
        'OKX',
      );
    }

    const order = normalizeOkxAlgoOrder(algoRaw, this.resolveContractValue(symbol));
    this.conditionalOrderRegistry.record(symbol, order.id, 'conditional');

    return this.hydrateTriggeredOrder(symbol, order);
  }

  private async tryReadOkxPlainOrderByClientOrderId(
    symbol: string,
    clientOrderId: string,
  ): Promise<OkxOrderRaw | undefined> {
    const instId = this.symbolMap.resolveInstId(symbol);

    try {
      const rawList = await this.httpClient.fetchOrder({ instId, clOrdId: clientOrderId });

      return rawList[0];
    } catch (error) {
      if (isOkxMissingPlainOrderError(error)) {
        return undefined;
      }

      throw error;
    }
  }

  async cancelOrder(symbol: string, orderId: string): Promise<Order> {
    this.logger.debug(`[OKX] Cancelling order ${orderId} for ${symbol}`);
    const knownKind = this.conditionalOrderRegistry.lookup(symbol, orderId);

    if (knownKind === 'conditional') {
      return this.cancelOkxConditionalOrder(symbol, orderId);
    }

    try {
      await this.cancelOkxPlainOrder(symbol, orderId);
    } catch (plainCancelError) {
      if (knownKind === 'plain' || !isOkxMissingPlainOrderError(plainCancelError)) {
        throw plainCancelError;
      }

      try {
        return await this.cancelOkxConditionalOrder(symbol, orderId);
      } catch (algoCancelError) {
        throw this.resolveOkxTwoServiceFailure({
          symbol,
          orderId,
          action: 'cancelling',
          errorList: [plainCancelError, algoCancelError],
          missingOrderError: plainCancelError,
        });
      }
    }

    // Отмена подтверждена обычной книгой — происхождение известно. Без пометки перечитывание
    // опрашивало бы обе службы, а при совпадении номеров отвечало бы «номер неоднозначен».
    this.conditionalOrderRegistry.record(symbol, orderId, 'plain');

    return this.readOrderAfterOkxCancel(symbol, orderId, () => this.getOrder(symbol, orderId));
  }

  private async cancelOkxPlainOrder(symbol: string, orderId: string): Promise<void> {
    const instId = this.symbolMap.resolveInstId(symbol);

    if (this.isOrderChannelReady()) {
      await this.tradeStream.cancelOrder({ instId, ordId: orderId });

      return;
    }

    await this.httpClient.cancelOrder({ instId, ordId: orderId });
  }

  private async cancelOkxConditionalOrder(symbol: string, orderId: string): Promise<Order> {
    const instId = this.symbolMap.resolveInstId(symbol);
    const response = await this.httpClient.cancelAlgoOrders([{ algoId: orderId, instId }]);
    const item = response.data[0];

    if (item === undefined || item.sCode !== '0') {
      throw new ExchangeError(
        `OKX algo cancel error ${item?.sCode ?? 'without a result'}: ${item?.sMsg ?? 'the exchange said nothing about this order'}`,
        item === undefined ? OKX_ORDER_NOT_FOUND_ERROR_CODE : toOkxErrorCode(item.sCode),
        'OKX',
      );
    }

    return this.readOrderAfterOkxCancel(symbol, orderId, () => this.readOkxAlgoOrder(symbol, orderId));
  }

  /**
   * Отмена возвращает лишь расписку, поэтому состояние перечитывается. Не удалось перечитать —
   * наружу уходит ошибка с причиной и с прямым указанием, что отмена УЖЕ прошла. Прежде на этом
   * месте собиралась заявка-выдумка (сторона «покупка», объём 0, исполнено 0), из которой правдой
   * были только обозначение, номер и состояние: по ней нельзя отличить «сняли, ничего не
   * исполнилось» от «сняли остаток, половина уже продана», и вызывающий продавал вдвое больше.
   * У Bybit этот приём убран сознательно (`BybitBaseClient.cancelOrder` перечитывает и отказ не
   * подменяет) — теперь так же и здесь.
   */
  private async readOrderAfterOkxCancel(symbol: string, orderId: string, read: () => Promise<Order>): Promise<Order> {
    try {
      return await read();
    } catch (error) {
      const errorText = toOkxErrorText(error);
      this.logger.warn(`[OKX] Order ${orderId} was cancelled, but reading it back failed: ${errorText}`);

      throw new ExchangeError(
        `OKX: order ${orderId} for ${symbol} was cancelled, but reading its final state failed: ${errorText}`,
        'OKX_CANCELLED_ORDER_UNREADABLE',
        'OKX',
      );
    }
  }

  private buildOkxNothingToChangeError(orderId: string): ExchangeError {
    return new ExchangeError(
      `OKX: a modification must change the price, the size or the trigger price (order ${orderId})`,
      'MODIFY_NOTHING_TO_CHANGE',
      'OKX',
    );
  }

  /**
   * Ноль в триггерной цене для OKX — не «цена не задана», а команда: «Either the stop-loss trigger
   * price or order price is 0, it means that the stop-loss is deleted» (`POST /api/v5/trade/
   * amend-algos`, поля `newSlTriggerPx`/`newTpTriggerPx`; то же сказано про `newTpTriggerPx`).
   * Поэтому ноль отвергают ОБА пути — и постановка, и правка — своим кодом, до похода на биржу:
   * иначе просьба «подтянуть стоп» снимает защиту, а биржа отвечает успехом.
   */
  private buildOkxStopPriceRequiredError(): ExchangeError {
    return new ExchangeError('OKX conditional order requires a stop price above zero', 'STOP_PRICE_REQUIRED', 'OKX');
  }

  async modifyOrder(args: ModifyOrderArgs): Promise<Order> {
    if (args.price === undefined && args.amount === undefined && args.triggerPrice === undefined) {
      throw this.buildOkxNothingToChangeError(args.orderId);
    }

    // Сверяется цена, УЖЕ посаженная на тиковую сетку: на провод уходит именно она, и цена,
    // которую шаг инструмента округлил до нуля, — та же строка «0», то есть та же команда удалить.
    if (args.triggerPrice !== undefined && this.priceToPrecision(args.symbol, args.triggerPrice) <= 0) {
      throw this.buildOkxStopPriceRequiredError();
    }

    this.logger.debug(`[OKX] Modifying order ${args.orderId} for ${args.symbol}`);
    const isConditional = args.triggerPrice !== undefined
      || this.conditionalOrderRegistry.lookup(args.symbol, args.orderId) === 'conditional';

    if (isConditional) {
      await this.amendOkxConditionalOrder(args);

      return this.getOrder(args.symbol, args.orderId);
    }

    await this.amendOkxPlainOrderOrFallBackToConditional(args);

    return this.getOrder(args.symbol, args.orderId);
  }

  /**
   * Правка ТОЛЬКО по объёму не несёт триггерной цены, поэтому после перезапуска процесса, когда
   * реестр происхождения пуст, условная заявка выглядит обычной и уходит в обычную книгу. Биржа
   * отвечает «заявки уже нет» (`51503`), и защита осталась бы прежнего размера — поэтому пробуем
   * условную службу так же, как это давно делает отмена.
   */
  private async amendOkxPlainOrderOrFallBackToConditional(args: ModifyOrderArgs): Promise<void> {
    const knownKind = this.conditionalOrderRegistry.lookup(args.symbol, args.orderId);
    const params = this.buildOkxAmendOrderParams(args);

    try {
      if (this.isOrderChannelReady()) {
        await this.tradeStream.amendOrder(params);
      } else {
        await this.httpClient.amendOrder(params);
      }
    } catch (plainAmendError) {
      if (knownKind === 'plain' || !isOkxMissingPlainOrderError(plainAmendError)) {
        throw plainAmendError;
      }

      this.logger.info(
        { symbol: args.symbol, orderId: args.orderId },
        `[OKX] order ${args.orderId} is not in the plain book — amending it in the conditional service`,
      );

      try {
        await this.amendOkxConditionalOrder(args);
      } catch (algoAmendError) {
        throw this.resolveOkxTwoServiceFailure({
          symbol: args.symbol,
          orderId: args.orderId,
          action: 'amending',
          errorList: [plainAmendError, algoAmendError],
          missingOrderError: plainAmendError,
        });
      }

      this.conditionalOrderRegistry.record(args.symbol, args.orderId, 'conditional');
    }
  }

  /**
   * Новый объём OKX понимает как ПОЛНЫЙ размер заявки, а не как остаток — считаем его от того
   * же количества монет, что и при постановке.
   */
  private buildOkxAmendOrderParams(args: ModifyOrderArgs): Record<string, unknown> {
    const params: Record<string, unknown> = {
      instId: this.symbolMap.resolveInstId(args.symbol),
      ordId: args.orderId,
    };

    if (args.amount !== undefined) {
      params.newSz = this.resolveOkxOrderSize(args.symbol, args.amount);
    }

    if (args.price !== undefined) {
      params.newPx = toDecimalNumberString(this.priceToPrecision(args.symbol, args.price));
    }

    return params;
  }

  /**
   * Правится ТА ЖЕ нога, которую отдало чтение: выбор один на оба пути
   * (`resolveOkxAlgoTriggerLeg`). Пока чтение брало ногу защиты, а правка — ногу прибыли, вызов
   * «подтянуть стоп с 60 000 до 62 000» уезжал на биржу как новая цена взятия прибыли: защита
   * оставалась на месте, прибыль переезжала, а биржа отвечала успехом.
   *
   * Скользящий стоп этот вход биржи не принимает вовсе — дословно: «Amend unfilled algo orders
   * (Support Stop order and Trigger order only, not including Move_order_stop order…)». Раньше
   * его правка уходила как правка ноги защиты, которой у него нет.
   */
  private async amendOkxConditionalOrder(args: ModifyOrderArgs): Promise<void> {
    const instId = this.symbolMap.resolveInstId(args.symbol);
    const rawList = await this.httpClient.fetchAlgoOrder({ algoId: args.orderId });
    // Та же дверь, что закрыта в чтении: вход `order-algo` инструмент не принимает, поэтому
    // ответ может прийти по ЧУЖОМУ инструменту — и по нему выбиралась бы нога защиты, то есть
    // просьба «подвинуть стоп по эфиру» двигала бы биткойновый стоп. Проверка одна на оба пути.
    const raw = this.takeOkxAlgoOrderForSymbol(rawList[0], args.symbol);

    if (raw === undefined) {
      throw this.buildOkxOrderNotFoundError(args.symbol, args.orderId);
    }

    const leg = resolveOkxAlgoTriggerLeg(raw);

    if (leg === 'trailing') {
      throw new ExchangeError(
        `OKX does not amend a trailing stop — cancel order ${args.orderId} and place a new one`,
        'OKX_TRAILING_STOP_AMEND_UNSUPPORTED',
        'OKX',
      );
    }

    const params: Record<string, unknown> = { instId, algoId: args.orderId };

    if (args.amount !== undefined) {
      params.newSz = this.resolveOkxOrderSize(args.symbol, args.amount);
    }

    this.applyOkxAlgoAmendPrices(params, args, { leg, raw });

    await this.httpClient.amendAlgoOrder(params);
  }

  /**
   * Цены правки ложатся на поля выбранной ноги. У заявки вида «триггерная» биржа требует ОБЕ
   * цены сразу («newTriggerPx — Yes», «newOrdPx — Yes»), поэтому недостающую берём из текущего
   * состояния заявки; у ног защиты и прибыли каждая цена условна и шлётся только когда есть.
   */
  private applyOkxAlgoAmendPrices(
    params: Record<string, unknown>,
    args: ModifyOrderArgs,
    order: OkxAlgoAmendTarget,
  ): void {
    const { leg, raw } = order;
    const triggerPrice = args.triggerPrice !== undefined
      ? toDecimalNumberString(this.priceToPrecision(args.symbol, args.triggerPrice))
      : '';
    const orderPrice = args.price !== undefined ? toDecimalNumberString(this.priceToPrecision(args.symbol, args.price)) : '';

    if (leg === 'generic') {
      params.newTriggerPx = triggerPrice !== '' ? triggerPrice : raw.triggerPx;
      params.newOrdPx = orderPrice !== '' ? orderPrice : raw.ordPx;

      return;
    }

    const isTakeProfitLeg = leg === 'takeProfit';
    const currentOrderPrice = isTakeProfitLeg ? raw.tpOrdPx : raw.slOrdPx;
    const newOrderPrice = orderPrice !== '' ? orderPrice : currentOrderPrice;

    if (triggerPrice !== '') {
      params[isTakeProfitLeg ? 'newTpTriggerPx' : 'newSlTriggerPx'] = triggerPrice;
    }

    if (newOrderPrice !== '') {
      params[isTakeProfitLeg ? 'newTpOrdPx' : 'newSlOrdPx'] = newOrderPrice;
    }
  }

  async fetchOpenOrders(symbol?: string): Promise<Order[]> {
    this.logger.debug('[OKX] Fetching open orders');
    const rawList = await this.httpClient.fetchAllPendingOrders({
      instType: this.instType,
      instId: symbol !== undefined ? this.symbolMap.resolveInstId(symbol) : undefined,
    });

    const orderList: Order[] = [];

    for (const raw of rawList) {
      const contractValue = this.takeOkxContractValueOrWarn(raw.instId, 'fetchOpenOrders');

      if (contractValue === null) {
        continue;
      }

      orderList.push(normalizeOkxOrder(raw, contractValue));
    }

    orderList.forEach((order) => this.conditionalOrderRegistry.record(order.symbol, order.id, 'plain'));

    return orderList;
  }

  private resolveContractValueByInstId(instId: string): string {
    return this.resolveContractValue(this.symbolMap.resolveSymbol(instId));
  }

  /**
   * Множитель контракта для ЧТЕНИЯ списков: инструмент не из карты (свежий листинг после последней
   * загрузки, снятый с торгов, чужой рынок) пропускается с предупреждением, а не роняет весь ответ.
   * Так уже поступают `fetchAllPositions` и `fetchOpenConditionalOrders` того же клиента; только
   * список открытых заявок падал целиком — и вызывающий терял ВСЕ свои заявки, включая те, что
   * по знакомым инструментам. У Binance и Bybit `fetchOpenOrders` метаданных инструмента не
   * требует вовсе и такой записи не боится.
   */
  private takeOkxContractValueOrWarn(instId: string, methodName: string): string | null {
    return this.takeOkxInstrumentOrWarn(instId, methodName)?.contractValue ?? null;
  }

  /** То же, когда рядом с множителем контракта нужно и ОБЩЕЕ имя инструмента. */
  private takeOkxInstrumentOrWarn(instId: string, methodName: string): OkxResolvedInstrument | null {
    try {
      const symbol = this.symbolMap.resolveSymbol(instId);

      return { symbol, contractValue: this.resolveContractValue(symbol) };
    } catch {
      this.logger.warn(`[OKX] Instrument ${instId} is not in the loaded instrument map — skipping in ${methodName}`);

      return null;
    }
  }

  /**
   * Открытые условные заявки OKX отдаёт по типам: стоп/тейк и скользящий стоп живут в разных
   * ответах, поэтому спрашиваем оба. Валюта расчёта — свойство инструмента, а не запроса,
   * поэтому отбираем сами; у спота её нет вовсе, там возвращается всё.
   */
  async fetchOpenConditionalOrders(settleCoin: string): Promise<Order[]> {
    this.logger.debug('[OKX] Fetching open conditional orders');

    // Без загруженных инструментов валюту расчёта не с чем сверить, и отбор выбросил бы ВСЁ:
    // вызывающий получил бы пустой список защитных заявок вместо отказа и решил, что стопов нет.
    if (this.isSwap && this.tradeSymbols.size === 0) {
      throw new ExchangeError(
        'OKX: the settle currency of an instrument is unknown — call loadTradeSymbols() before reading conditional orders',
        'OKX_INSTRUMENTS_NOT_LOADED',
        'OKX',
      );
    }

    const { rawList, failureList } = await this.fetchAllOpenOkxAlgoOrders();

    // Неполный список условных заявок опаснее отказа: вызывающий не увидит своей защиты и решит,
    // что её нет. Поэтому отказ хоть по одному виду — честный отказ целиком, а не короткий список.
    if (failureList.length > 0) {
      throw this.buildOkxAlgoSweepError(
        'OKX did not answer for every kind of conditional order, the list would be incomplete',
        'OKX_CONDITIONAL_ORDERS_INCOMPLETE',
        failureList,
      );
    }

    const orderList = rawList
      .filter((raw) => this.matchesOkxSettleCoin(raw, settleCoin))
      .map((raw) => normalizeOkxAlgoOrder(raw, this.resolveContractValueByInstId(raw.instId)));

    orderList.forEach((order) => this.conditionalOrderRegistry.record(order.symbol, order.id, 'conditional'));

    return orderList;
  }

  /**
   * Открытые условные заявки ВСЕХ видов, которые биржа умеет отдавать. Один запрос принимает
   * только перечисление «стоп/тейк, ОСО»; за каждым остальным видом биржа требует свой запрос,
   * поэтому их столько, сколько видов. Спрашивать два вида из семи значило не видеть плановую
   * заявку, айсберг и заявку по времени — а именно по этому списку и снимается «всё».
   */
  private async fetchAllOpenOkxAlgoOrders(instId?: string): Promise<OkxAlgoSweep> {
    const ordTypeList = this.isSwap
      ? [...OKX_PENDING_ALGO_ORD_TYPE_REQUEST_LIST, ...OKX_CONTRACT_ONLY_PENDING_ALGO_ORD_TYPE_LIST]
      : OKX_PENDING_ALGO_ORD_TYPE_REQUEST_LIST;

    const rawList: OkxAlgoOrderRaw[] = [];
    const failureList: OkxAlgoSweepFailure[] = [];

    for (const ordType of ordTypeList) {
      try {
        const pageList = await this.httpClient.fetchAllPendingAlgoOrders({ ordType, instType: this.instType, instId });

        rawList.push(...pageList);
      } catch (error) {
        const reason = toOkxErrorText(error);

        failureList.push({ ordType, reason });
        this.logger.warn(
          { ordType, instId },
          `[OKX] Open conditional orders of type ${ordType} could not be read: ${reason}`,
        );
      }
    }

    return { rawList, failureList };
  }

  private buildOkxAlgoSweepError(message: string, code: string, failureList: OkxAlgoSweepFailure[]): ExchangeError {
    const detail = failureList.map((failure) => `${failure.ordType} (${failure.reason})`).join('; ');

    return new ExchangeError(`${message}: ${detail}`, code, 'OKX');
  }

  /**
   * Инструмент, которого нет в карте (свежий листинг после последней загрузки, снятый с торгов),
   * раньше молча выпадал из ответа — ровно тот исход, от которого метод защищается собственным
   * отказом «инструменты не загружены»: вызывающий видел бы список без своей защитной заявки и
   * решил, что стопа нет.
   */
  private matchesOkxSettleCoin(raw: OkxAlgoOrderRaw, settleCoin: string): boolean {
    if (!this.isSwap) {
      return true;
    }

    const identity = parseOkxInstId(raw.instId);
    const tradeSymbol = identity !== null ? this.tradeSymbols.get(identity.symbol) : undefined;

    if (tradeSymbol === undefined) {
      this.logger.warn(
        `[OKX] Conditional order ${raw.algoId} on ${raw.instId} is not in the loaded instrument map — its settle currency is unknown, skipping in fetchOpenConditionalOrders`,
      );

      return false;
    }

    return tradeSymbol.settle === settleCoin;
  }

  /**
   * Отдельного входа «снять всё по инструменту» у OKX нет — снимаем списком то, что открыто.
   * Отказ по отдельной заявке не срывает остальные: чаще всего он означает, что её уже нет.
   */
  async cancelAllOrders(symbol: string): Promise<void> {
    this.logger.debug(`[OKX] Cancelling all orders for ${symbol}`);
    const instId = this.symbolMap.resolveInstId(symbol);

    const pendingRawList = await this.httpClient.fetchAllPendingOrders({ instType: this.instType, instId });
    const plainOrderIdList = pendingRawList.map((raw) => raw.ordId);

    for (const chunkOrderIdList of chunkList(plainOrderIdList, OKX_ORDER_BATCH_CHUNK_SIZE)) {
      const resultList = await this.cancelOkxPlainOrderChunk(instId, chunkOrderIdList);

      this.warnAboutFailedCancels(symbol, resultList);
    }

    const { rawList: algoRawList, failureList } = await this.fetchAllOpenOkxAlgoOrders(instId);
    const algoOrderIdList = algoRawList.map((raw) => raw.algoId);

    for (const chunkOrderIdList of chunkList(algoOrderIdList, OKX_ALGO_CANCEL_BATCH_CHUNK_SIZE)) {
      const resultList = await this.cancelOkxAlgoOrderChunk(instId, chunkOrderIdList);

      this.warnAboutFailedCancels(symbol, resultList);
    }

    // Исключение — ПОСЛЕ того, как снято всё остальное: отказ по одному виду прежде рвал обход из
    // середины, и счёт оставался наполовину снятым (обычные заявки сняты, защитные целы), а
    // вызывающий читал исключение как «ничего не произошло». Метод возвращает `void`, поэтому
    // неполноту сказать больше нечем — но говорит он её, уже сделав всё, что мог.
    if (failureList.length > 0) {
      throw this.buildOkxAlgoSweepError(
        `OKX cancelAllOrders for ${symbol} could not sweep every kind of conditional order`,
        'OKX_CANCEL_ALL_INCOMPLETE',
        failureList,
      );
    }
  }

  private warnAboutFailedCancels(symbol: string, resultList: CancelBatchOrdersResult): void {
    resultList
      .filter((result) => !result.isSuccess)
      .forEach((result) => {
        this.logger.warn(
          { symbol, orderId: result.orderId, code: result.errorCode },
          `[OKX] cancelAllOrders: order ${result.orderId} was not cancelled: ${result.errorText ?? 'unknown error'}`,
        );
      });
  }

  private async cancelOkxPlainOrderChunk(instId: string, orderIdList: string[]): Promise<CancelBatchOrdersResult> {
    const payloadList = orderIdList.map((orderId) => ({ instId, ordId: orderId }));

    if (this.isOrderChannelReady()) {
      return this.tradeStream.cancelBatchOrders(orderIdList, payloadList);
    }

    const response = await this.httpClient.cancelBatchOrders(payloadList);

    return orderIdList.map((orderId, index) => buildOkxBatchItemResult(orderId, response.data[index]));
  }

  private async cancelOkxAlgoOrderChunk(instId: string, orderIdList: string[]): Promise<CancelBatchOrdersResult> {
    const response = await this.httpClient.cancelAlgoOrders(
      orderIdList.map((algoId) => ({ algoId, instId })),
    );

    return orderIdList.map((orderId, index) => buildOkxBatchItemResult(orderId, response.data[index]));
  }

  /**
   * Пачка заявок. У условной службы пакетного входа нет, поэтому условные уходят по одной, а
   * обычные — пачками; исход каждой заявки кладётся на СВОЁ место входного списка, иначе
   * вызывающий сопоставит исход не с той заявкой.
   */
  async createBatchOrders(orderList: CreateOrderWebSocketArgs[]): Promise<CreateBatchOrdersResult> {
    if (orderList.length === 0) {
      return [];
    }

    this.logger.debug(`[OKX] Creating batch of ${orderList.length} orders`);
    const resultList = new Array<CreateOrderItemResult>(orderList.length);
    const conditionalIndexList: number[] = [];
    const plainIndexList: number[] = [];

    orderList.forEach((args, index) => {
      (isConditionalOrderType(args.type) ? conditionalIndexList : plainIndexList).push(index);
    });

    for (const index of conditionalIndexList) {
      try {
        resultList[index] = buildPlacedOrderOutcome(await this.createOkxConditionalOrder(orderList[index]));
      } catch (error) {
        // Отказ одной условной заявки не смеет уничтожать ответ по остальным: часть пачки к
        // этому моменту уже стоит на бирже, и потерять её из ответа значит оставить живые
        // заявки без управления.
        this.logger.warn(
          { symbol: orderList[index].symbol, error: toOkxErrorText(error) },
          '[OKX] createBatchOrders: conditional order rejected',
        );
        resultList[index] = buildOkxRejectedOutcome(error);
      }
    }

    const plannedOrderList: OkxPlannedOrder[] = [];

    for (const index of plainIndexList) {
      try {
        plannedOrderList.push({
          index,
          params: await this.buildOkxOrderParams(orderList[index]),
          amount: this.resolveOkxCreatedAmount(orderList[index]),
        });
      } catch (error) {
        // Заявку, которую нельзя собрать, на биржу не отправляем вовсе — она не должна занимать
        // место в пачке и сдвигать исходы соседей.
        resultList[index] = buildOkxRejectedOutcome(error);
      }
    }

    for (const chunk of chunkList(plannedOrderList, OKX_ORDER_BATCH_CHUNK_SIZE)) {
      const argsList = chunk.map((plannedOrder) => orderList[plannedOrder.index]);
      const paramsList = chunk.map((plannedOrder) => plannedOrder.params);
      const amountList = chunk.map((plannedOrder) => plannedOrder.amount);
      const outcomeList = await this.submitOkxOrderChunk({ argsList, paramsList, amountList });

      chunk.forEach((plannedOrder, indexInChunk) => {
        const outcome = outcomeList[indexInChunk];
        resultList[plannedOrder.index] = outcome;

        if (outcome.order !== null) {
          this.conditionalOrderRegistry.record(outcome.order.symbol, outcome.order.id, 'plain');
        }
      });
    }

    return resultList;
  }

  private async submitOkxOrderChunk(chunk: OkxOrderChunk): Promise<CreateBatchOrdersResult> {
    const { argsList, paramsList, amountList } = chunk;

    if (this.isOrderChannelReady()) {
      return this.tradeStream.createBatchOrders(argsList, paramsList, amountList);
    }

    const response = await this.httpClient.placeBatchOrders(paramsList);

    return argsList.map((args, index) => buildOkxCreateOutcome(args, response.data[index], amountList[index]));
  }

  async cancelBatchOrders(symbol: string, orderIdList: string[]): Promise<CancelBatchOrdersResult> {
    if (orderIdList.length === 0) {
      return [];
    }

    this.logger.debug(`[OKX] Cancelling batch of ${orderIdList.length} orders for ${symbol}`);
    const instId = this.symbolMap.resolveInstId(symbol);
    const resultList = new Array<ModifyOrderItemResult>(orderIdList.length);
    const conditionalIndexList: number[] = [];
    const plainIndexList: number[] = [];

    orderIdList.forEach((orderId, index) => {
      const isConditional = this.conditionalOrderRegistry.lookup(symbol, orderId) === 'conditional';

      (isConditional ? conditionalIndexList : plainIndexList).push(index);
    });

    for (const chunk of chunkList(conditionalIndexList, OKX_ALGO_CANCEL_BATCH_CHUNK_SIZE)) {
      const chunkResultList = await this.cancelOkxAlgoOrderChunk(instId, chunk.map((index) => orderIdList[index]));

      chunk.forEach((index, indexInChunk) => {
        resultList[index] = chunkResultList[indexInChunk];
      });
    }

    for (const chunk of chunkList(plainIndexList, OKX_ORDER_BATCH_CHUNK_SIZE)) {
      const chunkResultList = await this.cancelOkxPlainOrderChunk(instId, chunk.map((index) => orderIdList[index]));

      for (const [indexInChunk, index] of chunk.entries()) {
        resultList[index] = await this.retryUnknownCancelAsConditional(symbol, instId, chunkResultList[indexInChunk]);
      }
    }

    return resultList;
  }

  /**
   * Номер неизвестного происхождения, который обычная книга не нашла, вполне может быть номером
   * условной заявки — пробуем снять её там. Отказ второй попытки оставляет исход первой.
   */
  private async retryUnknownCancelAsConditional(
    symbol: string,
    instId: string,
    result: ModifyOrderItemResult,
  ): Promise<ModifyOrderItemResult> {
    // Все три ожидаемых кода, а не один: одиночная отмена уходит в условную службу при любом из
    // них, и пакетная не должна отличаться — иначе заявка, на которую биржа ответила «заявки нет»
    // (51603), в пакете остаётся неснятой, а в одиночном вызове снимается.
    const isRetryable = !result.isSuccess
      && result.errorCode !== null
      && OKX_EXPECTED_ERROR_CODE_LIST.includes(result.errorCode)
      && this.conditionalOrderRegistry.lookup(symbol, result.orderId) === null;

    if (!isRetryable) {
      return result;
    }

    const [algoResult] = await this.cancelOkxAlgoOrderChunk(instId, [result.orderId]);

    return algoResult.isSuccess ? algoResult : result;
  }

  async modifyBatchOrders(orderList: ModifyBatchOrderArgs[]): Promise<ModifyBatchOrdersResult> {
    if (orderList.length === 0) {
      return [];
    }

    this.logger.debug(`[OKX] Modifying batch of ${orderList.length} orders`);
    const resultList = new Array<ModifyOrderItemResult>(orderList.length);
    const conditionalIndexList: number[] = [];
    const plainIndexList: number[] = [];

    orderList.forEach((args, index) => {
      if (args.price === undefined && args.amount === undefined && args.triggerPrice === undefined) {
        resultList[index] = buildOkxErrorItemResult(args.orderId, this.buildOkxNothingToChangeError(args.orderId));

        return;
      }

      // Ноль в триггерной цене — команда «удалить стоп» (см. пояснение к `buildOkxStopPriceRequiredError`),
      // и пакетный путь обязан отвергать её так же, как одиночный: «подтянуть стопы пачкой» с одной
      // посчитавшейся в ноль ценой иначе снимает защиту по этой позиции, а наружу доложен успех.
      if (args.triggerPrice !== undefined && this.priceToPrecision(args.symbol, args.triggerPrice) <= 0) {
        resultList[index] = buildOkxErrorItemResult(args.orderId, this.buildOkxStopPriceRequiredError());

        return;
      }

      // Триггерная цена — тот же признак условной заявки, что и в одиночной правке: реестр живёт
      // в памяти, и после перезапуска «подвинуть стопы пачкой» иначе уходило бы в обычную книгу.
      const isConditional = args.triggerPrice !== undefined
        || this.conditionalOrderRegistry.lookup(args.symbol, args.orderId) === 'conditional';

      (isConditional ? conditionalIndexList : plainIndexList).push(index);
    });

    for (const index of conditionalIndexList) {
      const args = orderList[index];

      try {
        await this.amendOkxConditionalOrder(args);
        resultList[index] = { orderId: args.orderId, isSuccess: true, errorCode: null, errorText: null };
      } catch (error) {
        resultList[index] = buildOkxErrorItemResult(args.orderId, error);
      }
    }

    for (const chunk of chunkList(plainIndexList, OKX_ORDER_BATCH_CHUNK_SIZE)) {
      const chunkOrderList = chunk.map((index) => orderList[index]);
      const chunkResultList = await this.amendOkxPlainOrderChunk(chunkOrderList);

      chunk.forEach((index, indexInChunk) => {
        resultList[index] = chunkResultList[indexInChunk];
      });
    }

    return resultList;
  }

  private async amendOkxPlainOrderChunk(orderList: ModifyBatchOrderArgs[]): Promise<ModifyBatchOrdersResult> {
    const orderIdList = orderList.map((args) => args.orderId);
    const payloadList = orderList.map((args) => this.buildOkxAmendBatchOrderParams(args));

    if (this.isOrderChannelReady()) {
      return this.tradeStream.modifyBatchOrders(orderIdList, payloadList);
    }

    const response = await this.httpClient.amendBatchOrders(payloadList);

    return orderIdList.map((orderId, index) => buildOkxBatchItemResult(orderId, response.data[index]));
  }

  /**
   * Номер заявки уходит ВСЕГДА, а клиентский — вдобавок к нему, если задан. Дословно: «Either
   * ordId or clOrdId is required, if both are passed, ordId will be used» — то есть при обоих
   * решает номер заявки, ровно как у Bybit (`BybitBaseClient` шлёт `orderId` И `orderLinkId`).
   * Пока уходил ОДИН клиентский номер, устаревшее значение правило ДРУГУЮ заявку, а исход
   * возвращался под номером из просьбы — успех приписывался не той заявке.
   */
  private buildOkxAmendBatchOrderParams(args: ModifyBatchOrderArgs): Record<string, unknown> {
    const params: Record<string, unknown> = {
      instId: this.symbolMap.resolveInstId(args.symbol),
      ordId: args.orderId,
    };

    if (args.clientOrderId !== undefined) {
      params.clOrdId = args.clientOrderId;
    }

    if (args.amount !== undefined) {
      params.newSz = this.resolveOkxOrderSize(args.symbol, args.amount);
    }

    if (args.price !== undefined) {
      params.newPx = toDecimalNumberString(this.priceToPrecision(args.symbol, args.price));
    }

    return params;
  }

  /**
   * События счёта приходят по ДВУМ соединениям: обычные заявки, позиции и остатки — по личному,
   * условные заявки — по деловому (другой вход биржи). Без второго соединения срабатывание
   * стопа осталось бы незамеченным.
   */
  async connectUserDataStream(handler: UserDataStreamHandlerArgs): Promise<void> {
    if (this.privateStream !== null || this.algoPrivateStream !== null) {
      this.logger.warn(`[OKX] User data stream is already connected (${this.marketLabel})`);

      return;
    }

    this.privateStream = new OkxPrivateStream({
      label: this.privateStreamLabel,
      url: this.privateWebSocketUrl,
      apiKey: this.apiKey,
      secret: this.secret,
      passphrase: this.passphrase,
      logger: this.logger,
      onNotify: this.onNotify,
      subscriptionArgList: this.buildPrivateSubscriptionArgList(),
      onMessage: (message) => this.handlePrivateMessage(message, handler),
    });

    this.algoPrivateStream = new OkxPrivateStream({
      label: this.algoPrivateStreamLabel,
      url: this.businessWebSocketUrl,
      apiKey: this.apiKey,
      secret: this.secret,
      passphrase: this.passphrase,
      logger: this.logger,
      onNotify: this.onNotify,
      subscriptionArgList: [{ channel: 'orders-algo', instType: this.instType }],
      onMessage: (message) => this.handleAlgoPrivateMessage(message, handler),
    });

    this.privateStream.connect();
    this.algoPrivateStream.connect();
    this.logger.info(`[OKX] User data stream connected (${this.marketLabel})`);
  }

  private buildPrivateSubscriptionArgList(): OkxSubscriptionArg[] {
    const subscriptionArgList: OkxSubscriptionArg[] = [{ channel: 'orders', instType: this.instType }];

    if (this.isSwap) {
      subscriptionArgList.push({ channel: 'positions', instType: 'SWAP' });
    }

    subscriptionArgList.push({ channel: 'account' });

    return subscriptionArgList;
  }

  disconnectUserDataStream(): void {
    if (this.privateStream !== null) {
      this.privateStream.close();
      this.privateStream = null;
    }

    if (this.algoPrivateStream !== null) {
      this.algoPrivateStream.close();
      this.algoPrivateStream = null;
    }

    this.logger.info(`[OKX] User data stream disconnected (${this.marketLabel})`);
  }

  isUserDataStreamConnected(): boolean {
    return this.privateStream !== null
      && this.privateStream.isConnected()
      && this.algoPrivateStream !== null
      && this.algoPrivateStream.isConnected();
  }

  /** Ошибка в обработчике одного события не смеет обрывать разбор остальных. */
  private runUserDataHandler(action: () => void): void {
    try {
      action();
    } catch (error) {
      this.logger.error(`[OKX] User data handler failed: ${toOkxErrorText(error)}`);
    }
  }

  private handlePrivateMessage(message: OkxWebSocketMessage, handler: UserDataStreamHandlerArgs): void {
    const channel = message.arg?.channel;
    const dataList = message.data ?? [];

    // Множитель контракта берётся ДО вызова обработчика: инструмент не из карты (свежий листинг
    // после последней загрузки) иначе превращался в безымянную строку «обработчик отказал», и
    // вызывающий не узнавал, ПО КАКОМУ инструменту он перестал получать события.
    if (channel === 'orders') {
      for (const raw of dataList as OkxOrderRaw[]) {
        const contractValue = this.takeOkxContractValueOrWarn(raw.instId, 'the order stream');

        if (contractValue === null) {
          continue;
        }

        this.runUserDataHandler(() => {
          handler.onOrderUpdate(buildOkxOrderUpdateEvent(raw, contractValue));
        });
      }

      return;
    }

    if (channel === 'positions') {
      for (const raw of dataList as OkxPositionRaw[]) {
        if (raw.instType !== 'SWAP') {
          continue;
        }

        const contractValue = this.takeOkxContractValueOrWarn(raw.instId, 'the position stream');

        if (contractValue === null) {
          continue;
        }

        this.runUserDataHandler(() => {
          handler.onPositionUpdate(buildOkxPositionUpdateEvent(raw, contractValue));
        });
      }

      return;
    }

    if (channel === 'account') {
      const raw = (dataList as OkxBalanceRaw[])[0];

      if (raw === undefined || handler.onBalanceUpdate === undefined) {
        return;
      }

      const onBalanceUpdate = handler.onBalanceUpdate;

      this.runUserDataHandler(() => onBalanceUpdate(buildOkxBalanceUpdateEvent(raw)));
    }
  }

  private handleAlgoPrivateMessage(message: OkxWebSocketMessage, handler: UserDataStreamHandlerArgs): void {
    if (message.arg?.channel !== 'orders-algo') {
      return;
    }

    for (const raw of (message.data ?? []) as OkxAlgoOrderRaw[]) {
      const instrument = this.takeOkxInstrumentOrWarn(raw.instId, 'the conditional order stream');

      if (instrument === null) {
        continue;
      }

      const { symbol, contractValue } = instrument;

      this.runUserDataHandler(() => {
        const event = buildOkxAlgoOrderUpdateEvent(raw, contractValue);

        // Событие по условной заявке — единственный путь узнать её номер после перезапуска:
        // без пометки следующее чтение по этому номеру опрашивало бы обе службы.
        this.conditionalOrderRegistry.record(symbol, raw.algoId, 'conditional');
        handler.onOrderUpdate(event);
      });
    }
  }

  getWebSocketConnectionInfoList(): WebSocketConnectionInfo[] {
    const result = [...this.publicStream.getConnectionInfoList()];
    const tradeInfo = this.tradeStream.getConnectionInfo();

    if (tradeInfo !== null) {
      result.push(tradeInfo);
    }

    const privateInfo = this.privateStream?.getConnectionInfo() ?? null;

    if (privateInfo !== null) {
      result.push(privateInfo);
    }

    const algoPrivateInfo = this.algoPrivateStream?.getConnectionInfo() ?? null;

    if (algoPrivateInfo !== null) {
      result.push(algoPrivateInfo);
    }

    return result;
  }

  async close(): Promise<void> {
    this.logger.info(`[OKX] Closing ${this.marketLabel} connection`);
    this.tradeStream.disconnect();
    this.disconnectUserDataStream();
    this.publicStream.close();
  }
}

export { OkxBaseClient };
