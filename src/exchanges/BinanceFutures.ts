import type {
  CancelBatchOrdersResult,
  CreateBatchOrdersResult,
  CreateOrderItemResult,
  CreateOrderWebSocketArgs,
  ExchangeArgs,
  FetchIncomeArgs,
  FetchPageWithLimitArgs,
  ModifyBatchOrderArgs,
  ModifyBatchOrdersResult,
  ModifyOrderArgs,
  SetLeverageResult,
} from '../types/exchange';
import type { Position, Order, FundingRateHistory, FundingInfo, AccountBalances, MarkPrice, OpenInterest, FeeRate, Income, ClosedPnl, LeverageTier, LeverageTierListBySymbol } from '../types/common';
import { MarginModeEnum, PositionModeEnum, OrderTypeEnum, TimeInForceEnum, TriggerByEnum } from '../types/common';
import { ExchangeError } from '../errors/ExchangeError';
import { isConditionalOrderType } from '../constants/orderTypes';
import {
  MISSING_ORDER_ID_ERROR_TEXT,
  buildPlacedOrderOutcome,
  buildRejectedOrderOutcome,
} from '../normalizers/batchOrderOutcome';
import { BinanceFuturesHttpClient } from '../http/BinanceFuturesHttpClient';
import type { BinanceOrderResponseRaw, BinanceUserTradeRaw } from '../normalizers/binanceNormalizer';
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
  normalizeBinanceAlgoOrder,
  normalizeBinanceLeverageBracketList,
  buildBinanceClosedPnlList,
  mergeBinanceTriggeredOrder,
  isBinanceAlgoOrderRaw,
  isBinanceOrderResponseRaw,
} from '../normalizers/binanceNormalizer';
import { BinanceConditionalOrderRegistry } from './BinanceConditionalOrderRegistry';
import type { BinanceOrderKind } from './BinanceConditionalOrderRegistry';
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
  BINANCE_FUTURES_WEBSOCKET_COMBINED_URL,
  BINANCE_DEMO_FUTURES_WEBSOCKET_COMBINED_URL,
  BINANCE_FUTURES_CANCEL_BATCH_CHUNK_SIZE,
  BINANCE_FUTURES_CREATE_BATCH_CHUNK_SIZE,
  BINANCE_FUTURES_MODIFY_BATCH_CHUNK_SIZE,
  BINANCE_ALGO_TYPE_CONDITIONAL,
  BINANCE_ALGO_ORDER_VISIBILITY_GRACE_MS,
  BINANCE_ALGO_ORDER_VISIBILITY_ATTEMPT_COUNT,
  BINANCE_ALGO_ORDER_VISIBILITY_RETRY_DELAY_MS,
} from '../constants/binance';
import {
  BINANCE_ORDER_SIDE_REVERSE,
  BINANCE_ALGO_ORDER_TYPE_REVERSE,
  BINANCE_WORKING_TYPE,
  BINANCE_TRIGGER_BY_WORKING_TYPE,
  BINANCE_FUTURES_TIME_IN_FORCE_REVERSE,
} from '../constants/mappings';
import { chunkList as chunkListUtil } from '../utils/chunkList';
import { isBinanceNumericOrderId } from '../utils/binanceOrderId';
import { sleep } from '../utils/sleep';
import { BinanceBaseClient } from './BinanceBaseClient';
import { BaseExchangeClient } from './BaseExchangeClient';
import { resolveTwoServiceOrderFailure } from './twoServiceOrderLookup';
import type { AxiosLikeError, BinanceModifyBatchOrderParams, BinanceModifyOrderParams } from './BinanceFutures.types';

/** Условные типы, которые принимают срок действия: у них после срабатывания рождается лимит. */
const BINANCE_ALGO_LIMIT_LIKE_ORDER_TYPE_SET: ReadonlySet<OrderTypeEnum> = new Set([
  OrderTypeEnum.StopLimit,
  OrderTypeEnum.TakeProfitLimit,
  OrderTypeEnum.Stop,
  OrderTypeEnum.TakeProfit,
]);

/** «Такой заявки нет» — одинаково отвечают обе службы, отличить по коду невозможно. */
const BINANCE_MISSING_ORDER_ERROR_CODE_LIST = [-2011, -2013];

/** Потолок строк в одном ответе списка собственных сделок (документация биржи: по умолчанию 500,
 *  максимум 1000). Берём максимум: одно закрытие неликвида — это уже сотня исполнений. */
const USER_TRADE_PAGE_SIZE = 1000;

/** Предохранитель постраничного добора: 30 страниц — это 30 тысяч исполнений по одному символу
 *  за окно сделки. Столько не бывает; потолок нужен, чтобы сбойный ответ не крутил цикл вечно. */
const USER_TRADE_MAX_PAGE_COUNT = 30;

function isBinanceMissingOrderError(error: unknown): boolean {
  const code = parseBinanceErrorCode(error);

  if (code !== null && BINANCE_MISSING_ORDER_ERROR_CODE_LIST.includes(code)) {
    return true;
  }

  if (error instanceof ExchangeError && typeof error.code === 'number') {
    return BINANCE_MISSING_ORDER_ERROR_CODE_LIST.includes(error.code);
  }

  // Числовой код теряется при переносе ошибки в текст — приходится смотреть и на текст.
  return error instanceof Error && /-2011|-2013|does not exist|unknown order/i.test(error.message);
}

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
  private readonly conditionalOrderRegistry = new BinanceConditionalOrderRegistry();

  /**
   * Собирает условную заявку для Algo-службы. Отдельная функция, а не ветка в общем сборщике:
   * общий делится со спотом Binance, и лишние ветки в нём — готовая регрессия.
   */
  private buildBinanceAlgoOrderParams(args: CreateOrderWebSocketArgs): Record<string, unknown> {
    const algoOrderType = BINANCE_ALGO_ORDER_TYPE_REVERSE[args.type];

    if (algoOrderType === undefined) {
      throw new ExchangeError(
        `Binance futures: order type ${args.type} is not a conditional type`,
        'ALGO_ORDER_TYPE_UNSUPPORTED',
        'binance',
      );
    }

    const params: Record<string, unknown> = {
      algoType: BINANCE_ALGO_TYPE_CONDITIONAL,
      symbol: args.symbol,
      side: BINANCE_ORDER_SIDE_REVERSE[args.side] ?? args.side.toUpperCase(),
      type: algoOrderType,
    };

    // «Закрыть всю позицию» несовместимо с объёмом — их нельзя слать вместе.
    if (args.closePosition === true) {
      params.closePosition = true;
    } else {
      params.quantity = String(this.amountToPrecision(args.symbol, args.amount));
    }

    if (args.price !== undefined && args.price > 0) {
      params.price = String(this.priceToPrecision(args.symbol, args.price));
    }

    if (args.stopPrice !== undefined && args.stopPrice > 0) {
      params.triggerPrice = String(this.priceToPrecision(args.symbol, args.stopPrice));
    }

    // Явно заданный тип цены срабатывания главнее; иначе выводим его из намерения
    // «сверять по такой-то цене» — потребителю знать про биржевые имена не нужно.
    const workingType = args.workingType
      ?? (args.triggerBy === undefined ? undefined : BINANCE_TRIGGER_BY_WORKING_TYPE[args.triggerBy]);

    if (args.triggerBy === TriggerByEnum.IndexPrice) {
      this.logger.warn(
        `[Binance] ${args.symbol}: index price triggers do not exist on Binance futures — falling back to the contract price`,
      );
    }

    if (workingType !== undefined) {
      params.workingType = BINANCE_WORKING_TYPE[workingType] ?? workingType;
    }

    const isHedgeMode = args.positionSide !== undefined;

    if (isHedgeMode && args.positionSide !== undefined) {
      params.positionSide = args.positionSide.toUpperCase();
    }

    // reduceOnly запрещён в хеджевом режиме и несовместим с «закрыть всю позицию».
    if (!isHedgeMode && args.closePosition !== true && args.reduceOnly !== undefined) {
      params.reduceOnly = args.reduceOnly;
    }

    if (args.clientOrderId !== undefined) {
      params.clientAlgoId = args.clientOrderId;
    }

    if (args.activationPrice !== undefined && args.activationPrice > 0) {
      params.activatePrice = String(this.priceToPrecision(args.symbol, args.activationPrice));
    }

    if (args.callbackRate !== undefined) {
      params.callbackRate = String(args.callbackRate);
    }

    // Срок действия принимают только лимитные условные типы; у рыночных биржа сама
    // ставит GTE_GTC — заявку, живущую столько же, сколько позиция.
    if (BINANCE_ALGO_LIMIT_LIKE_ORDER_TYPE_SET.has(args.type)) {
      const timeInForce = args.timeInForce ?? TimeInForceEnum.Gtc;
      params.timeInForce = BINANCE_FUTURES_TIME_IN_FORCE_REVERSE[timeInForce] ?? timeInForce;
    }

    return params;
  }

  /**
   * Происхождение СВОЕЙ заявки известно в момент создания — запоминаем его сразу (обычная ветка;
   * условная записывает себя в tryCreateConditionalOrder). Иначе первое же чтение по номеру
   * опрашивает обе службы, и вторая отвечает −2013: лишний круг по сети прямо в горячем пути
   * постановки лесенки плюс пугающая строка в логе на каждую заявку (прод rubber, 14.08.2026).
   */
  override async createOrderWebSocket(args: CreateOrderWebSocketArgs): Promise<Order> {
    const order = await super.createOrderWebSocket(args);

    if (!isConditionalOrderType(args.type)) {
      this.conditionalOrderRegistry.record(order.symbol, order.id, 'plain');
    }

    return order;
  }

  protected async tryCreateConditionalOrder(args: CreateOrderWebSocketArgs): Promise<Order | null> {
    if (!isConditionalOrderType(args.type)) {
      return null;
    }

    const algoParams = this.buildBinanceAlgoOrderParams(args);
    const order = this.tradeStream.isConnected()
      ? await this.tradeStream.createConditionalOrder(algoParams)
      : normalizeBinanceAlgoOrder(await this.httpClient.createAlgoOrder(algoParams));

    this.conditionalOrderRegistry.record(order.symbol, order.id, 'conditional');

    return order;
  }

  /** Дочитывает фактическое исполнение из порождённой заявки, если условная уже сработала. */
  private async hydrateTriggeredOrder(conditionalOrder: Order): Promise<Order> {
    if (conditionalOrder.triggeredOrderId === undefined) {
      return conditionalOrder;
    }

    try {
      const triggeredRaw = await this.httpClient.getOrder(
        conditionalOrder.symbol,
        conditionalOrder.triggeredOrderId,
      );

      return mergeBinanceTriggeredOrder(conditionalOrder, triggeredRaw);
    } catch (error) {
      // Не срываем чтение: без исполнения потребитель откатится на цену маркировки, а
      // выдуманное заполнение попало бы в журнал как закрытие, которого не было.
      this.logger.warn(
        `[Binance] Could not read the order triggered by ${conditionalOrder.id}: ${error instanceof Error ? error.message : String(error)}`,
      );

      return conditionalOrder;
    }
  }

  /**
   * Читает условную заявку, чьё происхождение нам известно, с выдержкой на «ещё не видна».
   *
   * Algo-служба отдаёт только что поставленную заявку на чтение не сразу (замерено: 0 и 300 мс —
   * «не существует», 1000 мс — успех). Мы ЗНАЕМ, что заявка есть: мы её поставили или прочитали
   * в списке. Поэтому короткий ответ «нет такой» вскоре после этого — не отсутствие заявки, а
   * незавершённое распространение; принять его за отсутствие значит потерять номер живого стопа.
   * Выдержка действует только в окне после того, как происхождение стало известно.
   */
  private async readAlgoOrderWithVisibilityGrace(symbol: string, orderId: string): Promise<Order> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return normalizeBinanceAlgoOrder(await this.httpClient.fetchAlgoOrder({ algoId: orderId }));
      } catch (error) {
        const ageMs = this.conditionalOrderRegistry.ageMs(symbol, orderId);
        const isWithinGrace = ageMs !== null && ageMs <= BINANCE_ALGO_ORDER_VISIBILITY_GRACE_MS;
        const hasAttemptLeft = attempt < BINANCE_ALGO_ORDER_VISIBILITY_ATTEMPT_COUNT;

        if (!isBinanceMissingOrderError(error) || !isWithinGrace || !hasAttemptLeft) {
          throw error;
        }

        this.logger.debug(
          `[Binance] ${symbol}: conditional order ${orderId} is not visible yet (attempt ${attempt}), retrying`,
        );
        await sleep(BINANCE_ALGO_ORDER_VISIBILITY_RETRY_DELAY_MS);
      }
    }
  }

  /**
   * Читает заявку из той службы, которой она принадлежит.
   * Помним происхождение — один запрос. Не помним — спрашиваем обе и запоминаем ответ.
   * Ответили ОБЕ — это столкновение номеров, и мы отказываемся выбирать: молча вернуть
   * чужую заявку хуже, чем честно сообщить о неоднозначности.
   */
  private async readOrderFromOwningService(
    symbol: string,
    orderId: string,
  ): Promise<{ order: Order; kind: BinanceOrderKind }> {
    const knownKind = this.conditionalOrderRegistry.lookup(symbol, orderId);

    if (knownKind === 'conditional') {
      return { order: await this.readAlgoOrderWithVisibilityGrace(symbol, orderId), kind: 'conditional' };
    }

    if (knownKind === 'plain') {
      return { order: normalizeBinanceOrder(await this.httpClient.getOrder(symbol, orderId)), kind: 'plain' };
    }

    const [rawPlainOutcome, rawConditionalOutcome] = await Promise.allSettled([
      this.httpClient.getOrder(symbol, orderId),
      this.httpClient.fetchAlgoOrder({ algoId: orderId }),
    ]);

    // Успешный ответ ещё не значит, что он от той службы, которую мы спрашивали, — сверяем
    // форму с обеих сторон, иначе чужой или пустой ответ был бы принят за свой.
    const reject = (reason: string) => ({ status: 'rejected' as const, reason: new Error(reason) });
    const plainOutcome =
      rawPlainOutcome.status === 'fulfilled' && !isBinanceOrderResponseRaw(rawPlainOutcome.value)
        ? reject(`Binance futures: order ${orderId} not found in the plain order book`)
        : rawPlainOutcome;
    const conditionalOutcome =
      rawConditionalOutcome.status === 'fulfilled' && !isBinanceAlgoOrderRaw(rawConditionalOutcome.value)
        ? reject(`Binance futures: order ${orderId} not found in the conditional service`)
        : rawConditionalOutcome;

    if (plainOutcome.status === 'fulfilled' && conditionalOutcome.status === 'fulfilled') {
      throw new ExchangeError(
        `Binance futures: order id ${orderId} exists in both the plain and the conditional service for ${symbol}`,
        'CONDITIONAL_ORDER_ID_AMBIGUOUS',
        'binance',
      );
    }

    if (conditionalOutcome.status === 'fulfilled') {
      this.conditionalOrderRegistry.record(symbol, orderId, 'conditional');

      return { order: normalizeBinanceAlgoOrder(conditionalOutcome.value), kind: 'conditional' };
    }

    if (plainOutcome.status === 'fulfilled') {
      this.conditionalOrderRegistry.record(symbol, orderId, 'plain');

      return { order: normalizeBinanceOrder(plainOutcome.value), kind: 'plain' };
    }

    throw resolveTwoServiceOrderFailure({
      exchangeLabel: this.exchangeLabel,
      logger: this.logger,
      symbol,
      orderId,
      action: 'reading',
      errorList: [plainOutcome.reason, conditionalOutcome.reason],
      missingOrderError: plainOutcome.reason,
      isMissingOrderError: isBinanceMissingOrderError,
    });
  }

  private async cancelConditionalOrderById(orderId: string): Promise<Order> {
    if (this.tradeStream.isConnected()) {
      await this.tradeStream.cancelConditionalOrder({ algoId: orderId });
    } else {
      await this.httpClient.cancelAlgoOrder({ algoId: orderId });
    }

    // Отмена условной заявки возвращает короткую расписку, а не снимок заявки, поэтому
    // отдаём наружу перечитанное состояние — контракт метода прежний.
    return normalizeBinanceAlgoOrder(await this.httpClient.fetchAlgoOrder({ algoId: orderId }));
  }

  async getOrder(symbol: string, orderId: string): Promise<Order> {
    const { order } = await this.readOrderFromOwningService(symbol, orderId);

    return this.hydrateTriggeredOrder(order);
  }

  async getOrderByClientOrderId(symbol: string, clientOrderId: string): Promise<Order> {
    // Наша собственная пометка — пространство без столкновений, поэтому спрашиваем обе
    // службы сразу и берём ту, что ответила.
    const [plainOutcome, rawConditionalOutcome] = await Promise.allSettled([
      this.httpClient.getOrderByClientOrderId(symbol, clientOrderId),
      this.httpClient.fetchAlgoOrder({ clientAlgoId: clientOrderId }),
    ]);

    if (rawConditionalOutcome.status === 'fulfilled' && isBinanceAlgoOrderRaw(rawConditionalOutcome.value)) {
      const order = normalizeBinanceAlgoOrder(rawConditionalOutcome.value);
      this.conditionalOrderRegistry.record(symbol, order.id, 'conditional');

      return this.hydrateTriggeredOrder(order);
    }

    if (plainOutcome.status === 'fulfilled') {
      const order = normalizeBinanceOrder(plainOutcome.value);

      // Происхождение выяснено — следующие обращения по номеру пойдут одним запросом.
      this.conditionalOrderRegistry.record(symbol, order.id, 'plain');

      return order;
    }

    // Отдать причину ОБЫЧНОЙ книги значило бы выдать «такой заявки нет» за общий ответ, тогда как
    // условную службу могло просто не удаться спросить, — и вызывающий счёл бы защитную заявку
    // снятой. Ровно тот же разбор, что у чтения и отмены по номеру заявки.
    const conditionalOutcome =
      rawConditionalOutcome.status === 'fulfilled'
        ? { status: 'rejected' as const, reason: new Error(`Binance futures: order ${clientOrderId} not found in the conditional service`) }
        : rawConditionalOutcome;

    throw resolveTwoServiceOrderFailure({
      exchangeLabel: this.exchangeLabel,
      logger: this.logger,
      symbol,
      orderId: clientOrderId,
      action: 'reading',
      errorList: [plainOutcome.reason, conditionalOutcome.reason],
      missingOrderError: plainOutcome.reason,
      isMissingOrderError: isBinanceMissingOrderError,
    });
  }

  async fetchOpenConditionalOrders(_settleCoin: string): Promise<Order[]> {
    // Читаем ИМЕННО отдельную службу: в общем списке заявок условных больше нет.
    const rawList = await this.httpClient.fetchOpenAlgoOrders();
    const orderList = rawList.map(normalizeBinanceAlgoOrder);

    // Заодно наполняем память о происхождении — после перезапуска она пуста, и это
    // единственный путь узнать номера своих условных заявок заново.
    orderList.forEach((order) => this.conditionalOrderRegistry.record(order.symbol, order.id, 'conditional'));

    return orderList;
  }

  async cancelOrder(symbol: string, orderId: string): Promise<Order> {
    this.logger.debug(`[Binance] Cancelling order ${orderId} for ${symbol}`);

    // Помним происхождение — отменяем адресно, одним запросом. Так идёт подавляющее
    // большинство отмен: свою условную заявку мы либо сами поставили, либо прочитали
    // из списка, и оба пути происхождение запоминают.
    const knownKind = this.conditionalOrderRegistry.lookup(symbol, orderId);

    if (knownKind === 'conditional') {
      return this.cancelConditionalOrderById(orderId);
    }

    // Происхождение неизвестно. Сначала обычная книга — так сохраняется прежнее поведение
    // для обычных заявок, включая ответ биржи «заявки уже нет», по которому вызывающий
    // отличает успешную отмену от настоящей ошибки.
    try {
      return normalizeBinanceOrder(await this.httpClient.cancelOrder(symbol, orderId));
    } catch (plainCancelError) {
      if (knownKind === 'plain' || !isBinanceMissingOrderError(plainCancelError)) {
        throw plainCancelError;
      }

      try {
        return await this.cancelConditionalOrderById(orderId);
      } catch (conditionalCancelError) {
        // Ни в одной службе заявки нет: наружу отдаём ИСХОДНУЮ ошибку обычной книги,
        // иначе вызывающий не узнает свой случай «заявки уже нет». Но отказ условной службы
        // ПО СВЯЗИ — это не «заявки нет», и выдать его за отсутствие значит сказать вызывающему,
        // что защитная заявка снята, когда она жива.
        throw resolveTwoServiceOrderFailure({
          exchangeLabel: this.exchangeLabel,
          logger: this.logger,
          symbol,
          orderId,
          action: 'cancelling',
          errorList: [plainCancelError, conditionalCancelError],
          missingOrderError: plainCancelError,
          isMissingOrderError: isBinanceMissingOrderError,
        });
      }
    }
  }

  constructor(args: ExchangeArgs) {
    const isDemoMode = args.config.isDemoMode === true;

    const baseUrl = isDemoMode
      ? BINANCE_DEMO_FUTURES_BASE_URL
      : BINANCE_FUTURES_BASE_URL;

    const webSocketStreamUrl = isDemoMode
      ? BINANCE_DEMO_FUTURES_WEBSOCKET_MARKET_URL
      : BINANCE_FUTURES_WEBSOCKET_MARKET_URL;

    // Depth streams: the market endpoint acknowledges the subscription and streams nothing (verified
    // live 06.09.2026), the combined endpoint streams the book wrapped — the shape the router reads.
    const orderbookWebSocketUrl = isDemoMode
      ? BINANCE_DEMO_FUTURES_WEBSOCKET_COMBINED_URL
      : BINANCE_FUTURES_WEBSOCKET_COMBINED_URL;

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
      orderbookWebSocketUrl,
      logger: args.logger,
      onNotify: BaseExchangeClient.createNotifyHandler(args.onNotify),
      label: 'Binance Futures Public WebSocket',
      maxStreamsPerConnection:
        args.config.publicStreamConnectionPacking?.maxTopicsPerConnection,
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

    return normalizeBinancePosition(matched);
  }

  async fetchPositionList(symbol: string): Promise<Position[]> {
    this.logger.debug(`Fetching position list for ${symbol}`);
    const rawPositionList = await this.httpClient.fetchPositionRisk(symbol);
    const filteredList = rawPositionList.filter((p) => p.symbol === symbol);

    return filteredList.map(normalizeBinancePosition);
  }

  async fetchAllPositions(): Promise<Position[]> {
    this.logger.debug('[Binance] Fetching all positions');
    const rawPositionList = await this.httpClient.fetchPositionRisk(undefined);

    return rawPositionList
      .filter((raw) => Math.abs(parseFloat(raw.positionAmt)) > 0)
      .map(normalizeBinancePosition);
  }

  async setLeverage(leverage: number, symbol: string): Promise<SetLeverageResult> {
    this.logger.info(`Setting leverage to ${leverage}x for ${symbol}`);
    const raw = await this.httpClient.setLeverage(symbol, leverage);
    // Подтверждение — ТОЛЬКО значение из ответа /fapi/v1/leverage. Ответ без числа не превращается
    // в эхо запроса: вызывающий должен увидеть «не подтверждено» и не полагаться на такое плечо.
    const confirmed = Number((raw as { leverage?: unknown }).leverage);

    // Плечо всегда ≥ 1: Number(null) даёт 0, и без нижней границы пустое поле сошло бы за факт.
    return { confirmedLeverage: Number.isFinite(confirmed) && confirmed >= 1 ? confirmed : null };
  }

  async fetchLeverageTierList(symbol: string): Promise<LeverageTier[]> {
    this.logger.debug(`[Binance] Fetching leverage tiers for ${symbol}`);
    const rawList = await this.httpClient.fetchLeverageBracket(symbol);

    return normalizeBinanceLeverageBracketList(rawList).get(symbol) ?? [];
  }

  async fetchAllLeverageTierList(): Promise<LeverageTierListBySymbol> {
    this.logger.debug('[Binance] Fetching leverage tiers for all symbols');
    const rawList = await this.httpClient.fetchLeverageBracket();

    return normalizeBinanceLeverageBracketList(rawList);
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
    // У условной заявки изменения не существует ВООБЩЕ — ни обычным запросом, ни через
    // канал связи. Снятие-и-постановку внутри библиотеки не делаем: это открыло бы окно
    // без защиты, которого вызывающий не видит и не может отследить.
    const isConditional =
      args.triggerPrice !== undefined ||
      this.conditionalOrderRegistry.lookup(args.symbol, args.orderId) === 'conditional';

    if (isConditional) {
      throw new ExchangeError(
        `Binance futures: conditional orders cannot be modified — cancel and place a new one (order ${args.orderId}, ${args.symbol})`,
        'CONDITIONAL_ORDER_MODIFY_UNSUPPORTED',
        'binance',
      );
    }

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
    // Две службы — две отмены. Старый вход условных заявок не видит, и без второго вызова
    // «отменить всё» молча оставляло бы стопы висеть.
    await this.httpClient.cancelAllOrders(symbol);
    await this.httpClient.cancelAllAlgoOrders(symbol);
  }

  async createBatchOrders(orderList: CreateOrderWebSocketArgs[]): Promise<CreateBatchOrdersResult> {
    if (orderList.length === 0) {
      return [];
    }

    this.logger.debug(`[Binance] Creating batch of ${orderList.length} orders`);

    // Одна запись на каждую входную заявку, в исходном порядке. Заявки уходят двумя разными
    // путями (см. ниже) и возвращаются вперемешку, поэтому исход кладётся на СВОЁ место, а не
    // дописывается в конец: иначе вызывающий сопоставит исход не с той заявкой.
    const resultList: CreateBatchOrdersResult = new Array<CreateOrderItemResult>(orderList.length);

    // У Algo-службы пакетного входа НЕТ, а старый пакетный вход условные типы отбивает
    // кодом -4120. Поэтому условные заявки уходят по одной, обычные — прежним пакетом.
    const conditionalIndexList: number[] = [];
    const plainIndexList: number[] = [];

    orderList.forEach((args, index) => {
      (isConditionalOrderType(args.type) ? conditionalIndexList : plainIndexList).push(index);
    });

    for (const index of conditionalIndexList) {
      try {
        const conditionalOrder = await this.tryCreateConditionalOrder(orderList[index]);

        resultList[index] = conditionalOrder === null
          ? buildRejectedOrderOutcome(null, 'Conditional order was not accepted by the conditional service')
          : buildPlacedOrderOutcome(conditionalOrder);
      } catch (error) {
        // Отказ одной условной заявки не смеет уничтожать ответ по остальным: часть пачки
        // к этому моменту уже стоит на бирже, и потерять её из ответа — значит оставить
        // живые заявки без управления.
        this.logger.warn(
          { symbol: orderList[index].symbol, error: String(error) },
          '[Binance] createBatchOrders: conditional order rejected',
        );
        resultList[index] = buildRejectedOrderOutcome(
          error instanceof ExchangeError && typeof error.code === 'number' ? error.code : null,
          error instanceof Error ? error.message : String(error),
        );
      }
    }

    const chunkedIndexList = chunkListUtil(plainIndexList, BINANCE_FUTURES_CREATE_BATCH_CHUNK_SIZE);

    for (const chunk of chunkedIndexList) {
      const paramsList = chunk.map((index) => this.buildBinanceOrderParams(orderList[index]));
      const rawList = await this.httpClient.createBatchOrders(paramsList);

      chunk.forEach((index, indexInChunk) => {
        const rawItem = rawList[indexInChunk];

        if (rawItem === undefined) {
          // Ответ короче запроса: про эту заявку биржа не сказала ничего. Молчание — не успех.
          this.logger.warn(
            { symbol: orderList[index].symbol },
            '[Binance] createBatchOrders: exchange answered nothing for this order',
          );
          resultList[index] = buildRejectedOrderOutcome(null, MISSING_ORDER_ID_ERROR_TEXT);

          return;
        }

        if (this.isBinanceBatchErrorItem(rawItem)) {
          this.logger.warn(
            { code: rawItem.code, msg: rawItem.msg, symbol: orderList[index].symbol },
            '[Binance] createBatchOrders: per-order error',
          );
          resultList[index] = buildRejectedOrderOutcome(rawItem.code, rawItem.msg ?? null);

          return;
        }

        const placedOrder = normalizeBinanceOrder(rawItem as unknown as BinanceOrderResponseRaw);

        // Пакет — основной путь постановки лесенки: его заявки запоминают происхождение так же,
        // как одиночные (см. createOrderWebSocket), иначе проверка постановки снова опрашивает
        // обе службы по каждому номеру.
        this.conditionalOrderRegistry.record(placedOrder.symbol, placedOrder.id, 'plain');
        resultList[index] = buildPlacedOrderOutcome(placedOrder);
      });
    }

    return resultList;
  }

  async cancelBatchOrders(symbol: string, orderIdList: string[]): Promise<CancelBatchOrdersResult> {
    this.logger.debug(`[Binance] Cancelling batch of ${orderIdList.length} orders for ${symbol}`);

    if (orderIdList.length === 0) {
      return [];
    }

    const aggregatedResultList: CancelBatchOrdersResult = [];

    // Условные заявки живут в отдельной службе, и пакетный вход обычной книги их НЕ снимает:
    // раньше просьба снять пачку стопов оставляла их висеть. Известные условные снимаем по
    // одной их собственным входом — ровно так же, как это делает одиночная отмена.
    const conditionalOrderIdList = orderIdList.filter(
      (orderId) => this.conditionalOrderRegistry.lookup(symbol, orderId) === 'conditional',
    );
    const plainOrderIdList = orderIdList.filter(
      (orderId) => this.conditionalOrderRegistry.lookup(symbol, orderId) !== 'conditional',
    );

    for (const orderId of conditionalOrderIdList) {
      try {
        // Именно вход отмены, без перечитывания заявки обратно: пакетной отмене нужен
        // только исход, а лишнее чтение на каждую заявку — это N запросов из лимита счёта.
        await this.httpClient.cancelAlgoOrder({ algoId: orderId });
        aggregatedResultList.push({ orderId, isSuccess: true, errorCode: null, errorText: null });
      } catch (error) {
        aggregatedResultList.push({
          orderId,
          isSuccess: false,
          errorCode: error instanceof ExchangeError && typeof error.code === 'number' ? error.code : null,
          errorText: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const chunkedOrderIdList = chunkListUtil(plainOrderIdList, BINANCE_FUTURES_CANCEL_BATCH_CHUNK_SIZE);

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
    // Символ этот вход требует обязательно (проверено живым запросом 08.08.2026: без него
    // биржа отвечает -1102). Соседняя биржа отдаёт ставки по всем символам сразу, поэтому
    // говорим о разнице прямо, а не пропускаем наружу невнятный биржевой код.
    if (symbol === undefined) {
      throw new ExchangeError(
        'Binance futures reports the fee rate per symbol only — pass a symbol',
        'FEE_RATE_SYMBOL_REQUIRED',
        'binance',
      );
    }

    this.logger.debug('[Binance] Fetching fee rate');
    const raw = await this.httpClient.fetchCommissionRate(symbol);

    return normalizeBinanceCommissionRate(raw);
  }

  async fetchIncome(options?: FetchIncomeArgs): Promise<Income[]> {
    this.logger.debug('[Binance] Fetching income');
    const rawList = await this.httpClient.fetchIncome(options);

    return normalizeBinanceIncomeList(rawList);
  }

  /**
   * Готовой ручки «итоги закрытия» у Binance нет — собираем их из собственных сделок счёта.
   * Раньше метод не существовал вовсе: базовый класс просто отказывал, и потребитель писал
   * итоги сделок расчётными, без комиссии.
   *
   * `limit` значит РОВНО то же, что у соседней биржи: сколько строк итога вернуть, а не сколько
   * сырых исполнений прочитать. Раньше он уезжал прямо в запрос исполнений, и «50» превращалось
   * в «50 исполнений»: закрытие тонкой монеты биржа дробит на сотню исполнений, из которых
   * потребитель видел половину и записывал заниженный итог (VELVETUSDT/ACEUSDT 14.08.2026 —
   * закрытия из 129 и 91 исполнения, в журнале осело меньше половины убытка).
   */
  async fetchClosedPnl(symbol?: string, options?: FetchPageWithLimitArgs): Promise<ClosedPnl[]> {
    this.logger.debug(`[Binance] Building closed PnL for ${symbol ?? 'the whole account'} from account trades`);
    // Символ необязателен — проверено живым запросом 08.08.2026: без него вход отвечает
    // сделками всего счёта. Соседняя биржа тоже позволяет его не называть.
    const rawList = await this.fetchUserTradeHistory(symbol, options);
    const closedPnlList = buildBinanceClosedPnlList(rawList);

    if (options?.limit === undefined || closedPnlList.length <= options.limit) {
      return closedPnlList;
    }

    // Оставляем самые свежие строки — так же, как отдаёт соседняя биржа; порядок не трогаем.
    const cutoffList = [...closedPnlList].sort((left, right) => right.timestamp - left.timestamp).slice(0, options.limit);
    const keptSet = new Set(cutoffList);

    return closedPnlList.filter((row) => keptSet.has(row));
  }

  /**
   * Все исполнения счёта за окно. С указанным началом окна идём постранично: биржа отдаёт не
   * больше USER_TRADE_PAGE_SIZE строк за раз, а одна закрывающая заявка на неликвиде столько и
   * даёт. Следующая страница адресуется номером сделки — окно времени с ним сочетать нельзя
   * (запрет документации биржи), поэтому конец окна досекаем у себя.
   */
  private async fetchUserTradeHistory(symbol?: string, options?: FetchPageWithLimitArgs): Promise<BinanceUserTradeRaw[]> {
    if (options?.startTime === undefined) {
      return this.httpClient.fetchUserTrades({ symbol, endTime: options?.endTime, limit: USER_TRADE_PAGE_SIZE });
    }

    const collectedList: BinanceUserTradeRaw[] = [];
    const seenIdSet = new Set<number>();
    let fromId: number | undefined;

    for (let pageIndex = 0; pageIndex < USER_TRADE_MAX_PAGE_COUNT; pageIndex++) {
      const pageList = await this.httpClient.fetchUserTrades(
        fromId === undefined
          ? { symbol, startTime: options.startTime, endTime: options.endTime, limit: USER_TRADE_PAGE_SIZE }
          : { symbol, fromId, limit: USER_TRADE_PAGE_SIZE },
      );

      const windowEnd = options.endTime ?? Number.POSITIVE_INFINITY;
      let hasPassedWindowEnd = false;

      for (const raw of pageList) {
        if (raw.time > windowEnd) {
          hasPassedWindowEnd = true;
          continue;
        }

        // Страницы стыкуются по номеру, и повтор на стыке дублировал бы исполнение в итоге.
        if (Number.isFinite(raw.id)) {
          if (seenIdSet.has(raw.id)) {
            continue;
          }

          seenIdSet.add(raw.id);
        }

        collectedList.push(raw);
      }

      // Страница по номеру конца окна не знает: биржа отбирает по нему только первую страницу.
      // Как только исполнения перешагнули конец, дальше заведомо только более поздние.
      if (pageList.length < USER_TRADE_PAGE_SIZE || hasPassedWindowEnd) {
        return collectedList;
      }

      const lastId = pageList.reduce((latest, raw) => Math.max(latest, raw.id), 0);

      // Без номера следующую страницу не адресовать — дальше идти нечем, отдаём собранное.
      if (!Number.isFinite(lastId) || lastId <= 0) {
        return collectedList;
      }

      fromId = lastId + 1;
    }

    this.logger.warn(
      `[Binance] Account trade history for ${symbol ?? 'the whole account'} hit the ${USER_TRADE_MAX_PAGE_COUNT}-page ceiling — the closed PnL below may be incomplete`,
    );

    return collectedList;
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
