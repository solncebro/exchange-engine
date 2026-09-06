import type {
  CancelBatchOrdersResult,
  CreateBatchOrdersResult,
  CreateOrderWebSocketArgs,
  FetchIncomeArgs,
  FetchPageWithLimitArgs,
  ModifyBatchOrderArgs,
  ModifyBatchOrdersResult,
  ModifyOrderArgs,
  OrderRateLimit,
} from '../types/exchange';
import type {
  Kline,
  KlineInterval,
  TradeSymbolBySymbol,
  TickerBySymbol,
  AccountBalances,
  Order,
  OrderBook,
  PublicTrade,
  FeeRate,
  Income,
  ClosedPnl,
  WebSocketConnectionInfo,
  UserDataStreamHandlerArgs,
  OrderUpdateEvent,
  PositionUpdateEvent,
} from '../types/common';
import { OrderTypeEnum, OrderSideEnum, PositionSideEnum, OrderFilterEnum, MarketUnitEnum } from '../types/common';
import { isConditionalOrderType } from '../constants/orderTypes';
import { ExchangeError } from '../errors/ExchangeError';
import type { PublicStreamLike } from '../types/stream';
import { BybitHttpClient } from '../http/BybitHttpClient';
import {
  normalizeBybitTradeSymbols,
  normalizeBybitTickers,
  normalizeBybitKlines,
  normalizeBybitBalances,
  normalizeBybitOrder,
  normalizeBybitOrderBook,
  normalizeBybitPublicTradeList,
  normalizeBybitFeeRateList,
  normalizeBybitClosedPnlList,
  normalizeBybitIncomeList,
  buildBybitCreateOutcome,
  buildBybitCommissionIncomeList,
  buildBybitOrderFromCreateResponse,
} from '../normalizers/bybitNormalizer';
import { BybitPublicStream } from '../ws/BybitPublicStream';
import { BybitTradeStream } from '../ws/BybitTradeStream';
import { BybitPrivateStream } from '../ws/BybitPrivateStream';
import {
  BYBIT_KLINE_INTERVAL,
  BYBIT_KLINE_INTERVAL_MS,
  BYBIT_BASE_URL,
  BYBIT_DEMO_BASE_URL,
  BYBIT_TRADE_WEBSOCKET_URL,
  BYBIT_PRIVATE_WEBSOCKET_URL,
  BYBIT_DEMO_PRIVATE_WEBSOCKET_URL,
  BYBIT_TRANSACTION_LOG_MAX_LIMIT,
  BYBIT_FUNDING_INCOME_TYPE_SET,
} from '../constants/bybit';
import { BYBIT_ORDER_STATUS, BYBIT_WORKING_TYPE_TRIGGER_BY } from '../constants/mappings';
import { chunkList as chunkListUtil } from '../utils/chunkList';
import { BaseExchangeClient } from './BaseExchangeClient';
import type { BybitBaseClientArgs } from './BybitBaseClient.types';

/** Записи, несущие реализованный итог сделки: поток денег по ним и есть этот итог. */
const BYBIT_TRADE_INCOME_TYPE_SET = new Set(['TRADE', 'SETTLEMENT']);

/** Стоп-подобные типы: срабатывают, когда цена ДОХОДИТ до уровня со стороны позиции. */
const BYBIT_STOP_LIKE_ORDER_TYPE_SET: ReadonlySet<OrderTypeEnum> = new Set([
  OrderTypeEnum.StopMarket,
  OrderTypeEnum.StopLimit,
  OrderTypeEnum.Stop,
  OrderTypeEnum.TrailingStop,
]);

/**
 * С какой стороны цена подходит к уровню срабатывания: 1 — снизу вверх, 2 — сверху вниз.
 * Выводится из типа и стороны заявки, других сведений для этого не нужно:
 *   стоп + покупка  = закрываем шорт, цена растёт  -> 1
 *   стоп + продажа  = закрываем лонг,  цена падает -> 2
 *   тейк + покупка  = закрываем шорт, цена падает  -> 2
 *   тейк + продажа  = закрываем лонг,  цена растёт -> 1
 */
function resolveBybitTriggerDirection(type: OrderTypeEnum, side: OrderSideEnum): 1 | 2 {
  const isRisingToTrigger = BYBIT_STOP_LIKE_ORDER_TYPE_SET.has(type)
    ? side === OrderSideEnum.Buy
    : side === OrderSideEnum.Sell;

  return isRisingToTrigger ? 1 : 2;
}

abstract class BybitBaseClient extends BaseExchangeClient {
  protected readonly exchangeLabel = 'Bybit';
  protected readonly klineLimit = 200;
  protected readonly httpClient: BybitHttpClient;

  protected readonly category: string;
  protected abstract readonly batchChunkSize: number;
  private readonly secret: string;
  private readonly privateWebSocketUrl: string;
  private readonly publicStream: BybitPublicStream;
  private readonly tradeStream: BybitTradeStream | null;
  private privateStream: BybitPrivateStream | null = null;

  constructor(args: BybitBaseClientArgs) {
    super(args.exchangeArgs);

    const isDemoMode = args.exchangeArgs.config.isDemoMode === true;
    const baseUrl = isDemoMode ? BYBIT_DEMO_BASE_URL : BYBIT_BASE_URL;
    this.category = args.category;
    this.secret = args.exchangeArgs.config.secret;
    this.privateWebSocketUrl = isDemoMode ? BYBIT_DEMO_PRIVATE_WEBSOCKET_URL : BYBIT_PRIVATE_WEBSOCKET_URL;

    this.httpClient = new BybitHttpClient({
      baseUrl,
      apiKey: args.exchangeArgs.config.apiKey,
      secret: args.exchangeArgs.config.secret,
      logger: args.exchangeArgs.logger,
      httpsAgent: args.exchangeArgs.config.httpsAgent,
    });

    this.publicStream = new BybitPublicStream({
      url: args.publicWebSocketUrl,
      logger: args.exchangeArgs.logger,
      onNotify: this.onNotify,
      label: args.publicStreamLabel,
      connectionPacking: args.exchangeArgs.config.publicStreamConnectionPacking,
      lazyOrderbookParse: args.exchangeArgs.config.lazyOrderbookParse,
    });

    if (isDemoMode) {
      // Торгового канала в демо у Bybit нет — так решила биржа («WS Trade is not supported»
      // в её документации по демо-торговле), обойти это нечем. Но следствие обязано быть
      // видимым: проверенное в демо в бою пойдёт ДРУГИМ путём — обычными запросами вместо
      // канала, — и разницы в поведении под нагрузкой демо не покажет.
      args.exchangeArgs.logger.warn(
        `[Bybit] Demo mode has no order WebSocket — orders go over plain requests, unlike production (${args.tradeStreamLabel})`,
      );
      this.tradeStream = null;
    } else {
      this.tradeStream = new BybitTradeStream({
        url: BYBIT_TRADE_WEBSOCKET_URL,
        label: args.tradeStreamLabel,
        apiKey: args.exchangeArgs.config.apiKey,
        secret: args.exchangeArgs.config.secret,
        logger: args.exchangeArgs.logger,
        onNotify: this.onNotify,
      });
    }
  }

  protected getPublicStream(): PublicStreamLike {
    return this.publicStream;
  }

  protected async fetchAndNormalizeTradeSymbols(): Promise<TradeSymbolBySymbol> {
    const rawList = await this.httpClient.fetchAllInstrumentsInfo(this.category);
    this.logger.info(
      { instrumentCount: rawList.length },
      `[Bybit] Fetched ${rawList.length} ${this.category} instruments`,
    );

    return normalizeBybitTradeSymbols(rawList);
  }

  protected async fetchAndNormalizeTickers(): Promise<TickerBySymbol> {
    const raw = await this.httpClient.fetchTickers(this.category);

    return normalizeBybitTickers(raw.result.list);
  }

  protected async fetchAndNormalizeKlines(
    symbol: string,
    interval: KlineInterval,
    options?: FetchPageWithLimitArgs,
  ): Promise<Kline[]> {
    const bybitInterval = BYBIT_KLINE_INTERVAL[interval];

    if (bybitInterval === undefined) {
      throw new Error(`Kline interval '${interval}' is not supported by Bybit REST`);
    }

    const raw = await this.httpClient.fetchKline({
      category: this.category,
      symbol,
      interval: bybitInterval,
      options,
    });

    return normalizeBybitKlines(raw.result.list, BYBIT_KLINE_INTERVAL_MS[interval]);
  }

  protected async fetchAndNormalizeBalances(): Promise<AccountBalances> {
    const raw = await this.httpClient.fetchWalletBalance('UNIFIED');

    return normalizeBybitBalances(raw.result);
  }

  protected buildBybitOrderParams(args: CreateOrderWebSocketArgs): Record<string, unknown> {
    const isSpot = this.category === 'spot';
    const isLinear = this.category === 'linear';

    // Скольжение у Bybit живёт на позиции, а не в книге заявок, и обычной заявкой не
    // выражается вовсе. Раньше такой запрос молча собирался в рыночный стоп — потребитель
    // просил вести стоп за ценой и получал неподвижный. Отказ здесь закрывает и пакетный
    // путь: он зовёт этот сборщик напрямую.
    if (args.type === OrderTypeEnum.TrailingStop) {
      throw new ExchangeError(
        isSpot
          ? 'Bybit spot has no trailing stop at all — there is nothing to fall back to'
          : 'Bybit: a trailing stop is a position property, not an order — createOrderWebSocket handles it',
        isSpot ? 'TRAILING_STOP_UNSUPPORTED' : 'TRAILING_STOP_WRONG_ENDPOINT',
        'bybit',
      );
    }

    const isLimitLike =
      args.type === OrderTypeEnum.Limit ||
      args.type === OrderTypeEnum.StopLimit ||
      args.type === OrderTypeEnum.TakeProfitLimit;

    const bybitOrderType = isLimitLike ? 'Limit' : 'Market';

    const orderParams: Record<string, unknown> = {
      category: this.category,
      symbol: args.symbol,
      orderType: bybitOrderType,
      side: args.side === OrderSideEnum.Buy ? 'Buy' : 'Sell',
    };

    // «Закрыть всю позицию» Bybit выражает нулевым объёмом, но принимает его ТОЛЬКО вместе
    // с двумя признаками закрывающей заявки (документация create-order, раздел qty). Без
    // такой сборки намерение просто терялось, стоп становился заявкой фиксированного объёма,
    // и подросшая позиция оставалась без защиты.
    const isClosePosition = isLinear && args.closePosition === true;

    // Сумма в котируемой валюте — свойство РЫНОЧНОЙ заявки: она измеряется единицей, которую
    // биржа принимает только там. На лимитной та же сумма стала бы количеством монет.
    const isQuoteSized = isSpot && args.quoteOrderQty !== undefined && args.quoteOrderQty > 0;

    if (isQuoteSized && args.type !== OrderTypeEnum.Market) {
      throw new ExchangeError(
        'Bybit spot accepts an amount in quote currency on MARKET orders only',
        'QUOTE_AMOUNT_MARKET_ONLY',
        'bybit',
      );
    }

    if (isClosePosition) {
      orderParams.qty = '0';
    } else if (isQuoteSized) {
      orderParams.qty = String(args.quoteOrderQty);
    } else {
      orderParams.qty = String(this.amountToPrecision(args.symbol, args.amount));
    }

    // Price applies to limit-like orders only. Market orders must not carry a price:
    // callers often reuse limit-priced params for market pieces, and a stray (stale)
    // price on a market request is wire garbage at best.
    if (isLimitLike && args.price !== undefined && args.price > 0) {
      orderParams.price = String(this.priceToPrecision(args.symbol, args.price));
    }

    if (args.stopPrice !== undefined && args.stopPrice > 0) {
      orderParams.triggerPrice = String(this.priceToPrecision(args.symbol, args.stopPrice));
    }

    const isConditional = isConditionalOrderType(args.type);

    // С какой стороны цена подходит к уровню — сведения, которые здесь уже есть: у стопа
    // заявка на покупку означает «цена растёт до уровня», на продажу — «падает»; у тейка
    // наоборот. Раньше это вычислял потребитель, то есть держал у себя знание об устройстве
    // одной конкретной биржи. Явно переданное значение по-прежнему главнее.
    const triggerDirection = args.triggerDirection
      ?? (isConditional ? resolveBybitTriggerDirection(args.type, args.side) : undefined);

    if (!isSpot && triggerDirection !== undefined) {
      orderParams.triggerDirection = triggerDirection;
    }

    // По какой цене сверять срабатывание, потребитель может выразить любым из двух полей —
    // понимаем оба, иначе биржевой диалект соседа теряется молча и стоп уезжает на
    // умолчание биржи. Явно названный тип цены главнее.
    const triggerBy = args.triggerBy
      ?? (args.workingType === undefined ? undefined : BYBIT_WORKING_TYPE_TRIGGER_BY[args.workingType]);

    if (!isSpot && triggerBy !== undefined) {
      orderParams.triggerBy = triggerBy;
    }

    // Закрывающая заявка не смеет наращивать позицию, поэтому запрет на увеличение здесь
    // не обсуждается: он часть самого намерения «закрыть всю позицию», а не пожелание.
    const reduceOnly = isClosePosition ? true : args.reduceOnly;

    if (!isSpot && reduceOnly !== undefined) {
      orderParams.reduceOnly = reduceOnly;
    }

    // Условная заявка, которая только уменьшает позицию, — защитная: при срабатывании она
    // закрывает позицию. Это тоже выводится здесь, а не приходит снаружи.
    const closeOnTrigger = isClosePosition
      ? true
      : args.closeOnTrigger ?? (isConditional && args.reduceOnly === true ? true : undefined);

    if (!isSpot && closeOnTrigger !== undefined) {
      orderParams.closeOnTrigger = closeOnTrigger;
    }

    if (args.timeInForce !== undefined) {
      orderParams.timeInForce = args.timeInForce;
    }

    if (args.clientOrderId !== undefined) {
      orderParams.orderLinkId = args.clientOrderId;
    }

    if (isSpot && args.orderFilter !== undefined) {
      orderParams.orderFilter = args.orderFilter;
    }

    // Чем меряется объём рыночной спотовой заявки, Bybit сам не угадывает: без единицы
    // «купить на 100 долларов» уходит как «купить 100 монет». Умолчание живёт ЗДЕСЬ, а не
    // в одиночном пути постановки, потому что пакетный путь зовёт этот сборщик напрямую и
    // мимо любой доводки снаружи.
    if (isSpot && args.type === OrderTypeEnum.Market) {
      orderParams.marketUnit = args.marketUnit
        ?? (args.quoteOrderQty !== undefined && args.quoteOrderQty > 0
          ? MarketUnitEnum.QuoteCoin
          : MarketUnitEnum.BaseCoin);
    }

    if (isLinear && args.positionSide !== undefined) {
      if (args.positionSide === PositionSideEnum.Long) {
        orderParams.positionIdx = 1;
      } else if (args.positionSide === PositionSideEnum.Short) {
        orderParams.positionIdx = 2;
      }
    }

    return orderParams;
  }

  async cancelOrder(symbol: string, orderId: string): Promise<Order> {
    this.logger.debug(`[Bybit] Cancelling order ${orderId} for ${symbol}`);
    await this.httpClient.cancelOrder({ category: this.category, symbol, orderId });

    return this.getOrder(symbol, orderId);
  }

  async getOrder(symbol: string, orderId: string): Promise<Order> {
    this.logger.debug(`[Bybit] Fetching order ${orderId} for ${symbol}`);

    const realtimeRaw = await this.httpClient.getOpenOrders(this.category, { symbol, orderId });
    const realtimeOrder = realtimeRaw.result.list[0];

    if (realtimeOrder) {
      return normalizeBybitOrder(realtimeOrder);
    }

    const historyRaw = await this.httpClient.getOrderHistory(this.category, { symbol, orderId });
    const historyOrder = historyRaw.result.list[0];

    if (historyOrder) {
      return normalizeBybitOrder(historyOrder);
    }

    throw new Error(`Order ${orderId} not found for ${symbol}`);
  }

  async getOrderByClientOrderId(symbol: string, clientOrderId: string): Promise<Order> {
    this.logger.debug(`[Bybit] Fetching order by client id ${clientOrderId} for ${symbol}`);

    const realtimeRaw = await this.httpClient.getOpenOrders(this.category, { symbol, orderLinkId: clientOrderId });
    const realtimeOrder = realtimeRaw.result.list[0];

    if (realtimeOrder) {
      return normalizeBybitOrder(realtimeOrder);
    }

    const historyRaw = await this.httpClient.getOrderHistory(this.category, { symbol, orderLinkId: clientOrderId });
    const historyOrder = historyRaw.result.list[0];

    if (historyOrder) {
      return normalizeBybitOrder(historyOrder);
    }

    throw new Error(`Order with client id ${clientOrderId} not found for ${symbol}`);
  }

  async fetchOpenOrders(symbol?: string): Promise<Order[]> {
    this.logger.debug('[Bybit] Fetching open orders');
    const raw = await this.httpClient.getOpenOrders(this.category, { symbol });

    return raw.result.list.map(normalizeBybitOrder);
  }

  async fetchOpenConditionalOrders(settleCoin: string): Promise<Order[]> {
    this.logger.debug('[Bybit] Fetching open conditional (stop) orders');
    const raw = await this.httpClient.getOpenOrders(this.category, { settleCoin, orderFilter: OrderFilterEnum.StopOrder });

    return raw.result.list.map(normalizeBybitOrder);
  }

  async fetchOrderBook(symbol: string, limit?: number): Promise<OrderBook> {
    this.logger.debug(`[Bybit] Fetching order book for ${symbol}`);
    const raw = await this.httpClient.fetchOrderBook(this.category, symbol, limit);

    return normalizeBybitOrderBook(raw.result, symbol);
  }

  async fetchTrades(symbol: string, limit?: number): Promise<PublicTrade[]> {
    this.logger.debug(`[Bybit] Fetching trades for ${symbol}`);
    const raw = await this.httpClient.fetchRecentTrades(this.category, symbol, limit);

    return normalizeBybitPublicTradeList(raw.result.list);
  }

  async fetchFeeRate(symbol?: string): Promise<FeeRate[]> {
    this.logger.debug('[Bybit] Fetching fee rate');
    const raw = await this.httpClient.fetchFeeRate(this.category, { symbol });

    return normalizeBybitFeeRateList(raw.result.list);
  }

  async fetchOrderHistory(symbol: string, options?: FetchPageWithLimitArgs): Promise<Order[]> {
    this.logger.debug(`[Bybit] Fetching order history for ${symbol}`);
    // Границы времени биржа принимает и уважает (проверено живым запросом 08.08.2026).
    // Раньше они молча выбрасывались, и «заявки за вчера» отдавали последние N записей
    // независимо от дат.
    const raw = await this.httpClient.getOrderHistory(this.category, {
      symbol,
      limit: options?.limit,
      startTime: options?.startTime,
      endTime: options?.endTime,
    });

    return raw.result.list.map(normalizeBybitOrder);
  }

  async modifyOrder(args: ModifyOrderArgs): Promise<Order> {
    this.logger.debug(`[Bybit] Modifying order ${args.orderId} for ${args.symbol}`);
    const params: Record<string, unknown> = {
      category: this.category,
      symbol: args.symbol,
      orderId: args.orderId,
    };

    if (args.price !== undefined) {
      params.price = String(this.priceToPrecision(args.symbol, args.price));
    }

    if (args.amount !== undefined) {
      params.qty = String(this.amountToPrecision(args.symbol, args.amount));
    }

    if (args.triggerPrice !== undefined) {
      params.triggerPrice = String(this.priceToPrecision(args.symbol, args.triggerPrice));
    }

    await this.httpClient.amendOrder(params);

    return this.getOrder(args.symbol, args.orderId);
  }

  async cancelAllOrders(symbol: string): Promise<void> {
    this.logger.debug(`[Bybit] Cancelling all orders for ${symbol}`);
    await this.httpClient.cancelAllOrders(this.category, symbol);
  }

  async createBatchOrders(orderList: CreateOrderWebSocketArgs[]): Promise<CreateBatchOrdersResult> {
    if (orderList.length === 0) {
      return [];
    }

    this.logger.debug(`[Bybit] Creating batch of ${orderList.length} orders`);
    const chunkedOrderList = chunkListUtil(orderList, this.batchChunkSize);
    const aggregatedResultList: CreateBatchOrdersResult = [];

    for (const chunk of chunkedOrderList) {
      const requestList = chunk.map((args) => this.buildBybitOrderParams(args));

      if (this.tradeStream !== null && this.tradeStream.isConnected()) {
        aggregatedResultList.push(...await this.tradeStream.createBatchOrders(this.category, chunk, requestList));

        continue;
      }

      const raw = await this.httpClient.createBatchOrders(this.category, requestList);
      // Исход каждой заявки Bybit кладёт в отдельный список, выровненный с ответом по месту
      // (документация batch-place). Раньше он не читался вовсе, и отказ возвращался как
      // «открытая» заявка с пустым номером — бот считал стоп поставленным, а его не было.
      const extInfoList = raw.retExtInfo?.list ?? [];

      chunk.forEach((args, indexInChunk) => {
        aggregatedResultList.push(
          buildBybitCreateOutcome(args, raw.result.list[indexInChunk], extInfoList[indexInChunk]),
        );
      });
    }

    return aggregatedResultList;
  }

  async getOrderRateLimit(): Promise<OrderRateLimit> {
    // Число в коде — лишь запасной вариант: биржа меняет пределы, а константа нет. Сама
    // биржа называет предел заголовком ответа на заявку, и торговый канал его уже разбирает.
    const reported = this.tradeStream?.getLastReportedOrderRateLimit() ?? null;

    if (reported !== null && reported.limit > 0) {
      return { writeRequestsPerSecond: reported.limit, source: 'bybit-exchange-header' };
    }

    return {
      writeRequestsPerSecond: this.category === 'spot' ? 20 : 10,
      source: 'bybit-documented',
    };
  }

  async cancelBatchOrders(symbol: string, orderIdList: string[]): Promise<CancelBatchOrdersResult> {
    this.logger.debug(`[Bybit] Cancelling batch of ${orderIdList.length} orders for ${symbol}`);

    if (orderIdList.length === 0) {
      return [];
    }

    const chunkedOrderIdList = chunkListUtil(orderIdList, this.batchChunkSize);
    const aggregatedResultList: CancelBatchOrdersResult = [];

    for (const chunkOrderIdList of chunkedOrderIdList) {
      const requestList = chunkOrderIdList.map((orderId) => ({ category: this.category, symbol, orderId }));

      if (this.tradeStream !== null && this.tradeStream.isConnected()) {
        const wsResultList = await this.tradeStream.cancelBatchOrders(this.category, chunkOrderIdList, requestList);
        aggregatedResultList.push(...wsResultList);

        continue;
      }

      const raw = await this.httpClient.cancelBatchOrders(this.category, requestList);
      const extInfoList = raw.retExtInfo?.list ?? [];

      chunkOrderIdList.forEach((orderId, indexInChunk) => {
        const extInfo = extInfoList[indexInChunk];
        const hasCode = extInfo !== undefined && typeof extInfo.code === 'number';
        const code = hasCode ? extInfo.code : null;
        const msg = extInfo !== undefined && typeof extInfo.msg === 'string' ? extInfo.msg : null;
        const isSuccess = code === 0;

        aggregatedResultList.push({
          orderId,
          isSuccess,
          errorCode: isSuccess ? null : code,
          errorText: isSuccess ? null : (msg ?? 'Unknown error'),
        });
      });
    }

    return aggregatedResultList;
  }

  async modifyBatchOrders(orderList: ModifyBatchOrderArgs[]): Promise<ModifyBatchOrdersResult> {
    if (orderList.length === 0) {
      return [];
    }

    this.logger.debug(`[Bybit] Modifying batch of ${orderList.length} orders`);
    const chunkedOrderList = chunkListUtil(orderList, this.batchChunkSize);
    const aggregatedResultList: ModifyBatchOrdersResult = [];

    for (const chunk of chunkedOrderList) {
      const requestList = chunk.map((args) => this.buildBybitAmendBatchOrderParams(args));

      if (this.tradeStream !== null && this.tradeStream.isConnected()) {
        const orderIdList = chunk.map((requestedOrder) => requestedOrder.orderId);
        const wsResultList = await this.tradeStream.modifyBatchOrders(this.category, orderIdList, requestList);
        aggregatedResultList.push(...wsResultList);

        continue;
      }

      const raw = await this.httpClient.amendBatchOrders(this.category, requestList);
      const extInfoList = raw.retExtInfo?.list ?? [];

      chunk.forEach((requestedOrder, indexInChunk) => {
        const extInfo = extInfoList[indexInChunk];
        const hasCode = extInfo !== undefined && typeof extInfo.code === 'number';
        const code = hasCode ? extInfo.code : null;
        const msg = extInfo !== undefined && typeof extInfo.msg === 'string' ? extInfo.msg : null;
        const isSuccess = code === 0;

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

  private buildBybitAmendBatchOrderParams(args: ModifyBatchOrderArgs): Record<string, unknown> {
    const params: Record<string, unknown> = {
      symbol: args.symbol,
      orderId: args.orderId,
    };

    if (args.clientOrderId !== undefined) {
      params.orderLinkId = args.clientOrderId;
    }

    if (args.price !== undefined) {
      params.price = String(this.priceToPrecision(args.symbol, args.price));
    }

    if (args.amount !== undefined) {
      params.qty = String(this.amountToPrecision(args.symbol, args.amount));
    }

    if (args.triggerPrice !== undefined) {
      params.triggerPrice = String(this.priceToPrecision(args.symbol, args.triggerPrice));
    }

    return params;
  }

  async fetchIncome(options?: FetchIncomeArgs): Promise<Income[]> {
    this.logger.debug('[Bybit] Fetching income');
    // Умолчание биржи — 20 записей на страницу, и постраничного дочитывания здесь нет.
    // Поэтому всегда просим максимум, а полную страницу считаем признаком того, что часть
    // записей осталась за кадром: молча отдать усечённый ответ хуже, чем отказать —
    // потребитель посчитает по неполным данным и не узнает об этом.
    const limit = Math.min(options?.limit ?? BYBIT_TRANSACTION_LOG_MAX_LIMIT, BYBIT_TRANSACTION_LOG_MAX_LIMIT);
    const raw = await this.httpClient.fetchTransactionLog({
      category: this.category,
      limit,
      startTime: options?.startTime,
      endTime: options?.endTime,
    });
    const rawList = raw.result.list;

    if (rawList.length >= limit) {
      throw new Error(
        `[Bybit] transaction log returned a full page of ${limit} entries — the answer would be incomplete`,
      );
    }
    // Символ этот вход биржи не принимает — отбираем сами; у Binance то же самое делает биржа.
    const symbolFilteredList = options?.symbol === undefined
      ? rawList
      : rawList.filter((entry) => entry.symbol === options.symbol);

    if (options?.incomeType === undefined) {
      return normalizeBybitIncomeList(symbolFilteredList);
    }

    const windowFilteredList = symbolFilteredList.filter((entry) => {
      const timestamp = parseFloat(entry.transactionTime);

      return (options.startTime === undefined || timestamp >= options.startTime)
        && (options.endTime === undefined || timestamp <= options.endTime);
    });

    if (options.incomeType === 'funding') {
      return normalizeBybitIncomeList(
        windowFilteredList.filter((entry) => BYBIT_FUNDING_INCOME_TYPE_SET.has(entry.type)),
      );
    }

    if (options.incomeType === 'realizedPnl') {
      // Поток денег по записи и есть реализованный итог, комиссия в него не входит —
      // ровно тот же смысл, что у Binance под словом REALIZED_PNL (проверено живьём).
      return normalizeBybitIncomeList(
        windowFilteredList.filter((entry) => BYBIT_TRADE_INCOME_TYPE_SET.has(entry.type) && parseFloat(entry.cashFlow) !== 0),
      );
    }

    return buildBybitCommissionIncomeList(windowFilteredList);
  }

  async fetchClosedPnl(symbol?: string, options?: FetchPageWithLimitArgs): Promise<ClosedPnl[]> {
    // Спотовой категории этот вход у биржи не существует (проверено живым запросом
    // 08.08.2026: «Closed pnl not support category»). Прямой отказ понятнее, чем биржевой
    // код, и совпадает с тем, что отвечает спот соседней биржи.
    if (this.category === 'spot') {
      throw new Error('Not supported for spot market');
    }

    this.logger.debug('[Bybit] Fetching closed PnL');
    const raw = await this.httpClient.getClosedPnl(this.category, {
      symbol,
      limit: options?.limit,
      startTime: options?.startTime,
      endTime: options?.endTime,
    });

    return normalizeBybitClosedPnlList(raw.result.list);
  }

  isTradeWebSocketConnected(): boolean {
    return this.tradeStream?.isConnected() ?? false;
  }

  async connectTradeWebSocket(): Promise<void> {
    if (this.tradeStream === null) {
      return;
    }

    await this.tradeStream.connect();
  }

  protected async submitOrder(orderParams: Record<string, unknown>, args: CreateOrderWebSocketArgs): Promise<Order> {
    if (this.tradeStream !== null && this.tradeStream.isConnected()) {
      this.logger.debug(`[Bybit] Creating order via WebSocket: ${args.symbol}`);
      const order = await this.tradeStream.createOrder(orderParams);
      const rebuiltOrder = buildBybitOrderFromCreateResponse(args, order.id);

      if (order.rateLimit !== undefined) {
        rebuiltOrder.rateLimit = order.rateLimit;
      }

      return rebuiltOrder;
    }

    this.logger.debug(`[Bybit] Creating order via REST: ${args.symbol}`);
    const raw = await this.httpClient.createOrder(orderParams);

    return buildBybitOrderFromCreateResponse(args, raw.result.orderId);
  }

  async connectUserDataStream(handler: UserDataStreamHandlerArgs): Promise<void> {
    if (this.privateStream !== null) {
      return;
    }

    this.privateStream = new BybitPrivateStream({
      label: `Bybit ${this.marketLabel} UserData`,
      url: this.privateWebSocketUrl,
      apiKey: this.apiKey,
      secret: this.secret,
      logger: this.logger,
      onNotify: this.onNotify,
      topicList: ['order', 'position', 'wallet'],
      onMessage: (event) => this.handlePrivateMessage(event, handler),
    });

    this.privateStream.connect();
    this.logger.info(`[Bybit] User data stream connected (${this.marketLabel})`);
  }

  disconnectUserDataStream(): void {
    if (this.privateStream) {
      this.privateStream.close();
      this.privateStream = null;
    }

    this.logger.info(`[Bybit] User data stream disconnected (${this.marketLabel})`);
  }

  isUserDataStreamConnected(): boolean {
    return this.privateStream !== null && this.privateStream.isConnected();
  }

  private handlePrivateMessage(event: Record<string, unknown>, handler: UserDataStreamHandlerArgs): void {
    const topic = event.topic as string;

    if (topic === 'order') {
      const dataList = event.data as Array<Record<string, unknown>>;

      if (!Array.isArray(dataList)) {
        return;
      }

      for (const orderData of dataList) {
        const side = orderData.side as string;
        const orderUpdate: OrderUpdateEvent = {
          symbol: orderData.symbol as string,
          orderId: orderData.orderId as string,
          clientOrderId: (orderData.orderLinkId as string) ?? '',
          side: side === 'Buy' ? OrderSideEnum.Buy : OrderSideEnum.Sell,
          status: BYBIT_ORDER_STATUS[orderData.orderStatus as string] ?? 'open',
          price: Number(orderData.price),
          avgPrice: Number(orderData.avgPrice),
          amount: Number(orderData.qty),
          filledAmount: Number(orderData.cumExecQty),
          timestamp: Number(orderData.updatedTime),
          cancelType: (orderData.cancelType as string) || undefined,
          rejectReason: (orderData.rejectReason as string) || undefined,
        };

        handler.onOrderUpdate(orderUpdate);
      }
    }

    if (topic === 'position') {
      const dataList = event.data as Array<Record<string, unknown>>;

      if (!Array.isArray(dataList)) {
        return;
      }

      for (const positionData of dataList) {
        const positionUpdate: PositionUpdateEvent = {
          symbol: positionData.symbol as string,
          side: positionData.side as string,
          size: Number(positionData.size),
          entryPrice: Number(positionData.entryPrice),
          unrealisedPnl: Number(positionData.unrealisedPnl),
          positionSide: (positionData.positionIdx as string) ?? '',
          timestamp: Number(positionData.updatedTime),
          // Эти три Bybit сообщает — отдаём как есть; у соседней биржи их в событии нет.
          markPrice: Number(positionData.markPrice),
          leverage: Number(positionData.leverage),
          liquidationPrice: Number(positionData.liqPrice),
        };

        handler.onPositionUpdate(positionUpdate);
      }
    }

    if (topic === 'wallet' && handler.onBalanceUpdate !== undefined) {
      const dataList = event.data as Array<Record<string, unknown>>;

      if (!Array.isArray(dataList)) {
        return;
      }

      // Bybit кладёт монеты внутрь записи счёта. Свободное здесь не называется так же, как
      // на споте (у единого счёта «доступное к выводу» — это другая величина), поэтому
      // сообщаем только то, что означает ровно себя: остаток кошелька.
      const balanceList = dataList.flatMap((accountData) => {
        const coinList = accountData.coin;

        return Array.isArray(coinList)
          ? (coinList as Array<Record<string, unknown>>).map((coinData) => ({
            asset: coinData.coin as string,
            free: null,
            locked: null,
            total: Number(coinData.walletBalance),
          }))
          : [];
      });

      handler.onBalanceUpdate({ balanceList, timestamp: Number(event.creationTime ?? Date.now()) });
    }
  }

  getWebSocketConnectionInfoList(): WebSocketConnectionInfo[] {
    const result = [...this.publicStream.getConnectionInfoList()];

    if (this.tradeStream !== null) {
      const tradeInfo = this.tradeStream.getConnectionInfo();

      if (tradeInfo !== null) {
        result.push(tradeInfo);
      }
    }

    if (this.privateStream !== null) {
      const privateInfo = this.privateStream.getConnectionInfo();

      if (privateInfo !== null) {
        result.push(privateInfo);
      }
    }

    return result;
  }

  async close(): Promise<void> {
    this.logger.info(`[Bybit] Closing ${this.marketLabel} connection`);

    if (this.tradeStream !== null) {
      this.tradeStream.disconnect();
    }

    this.disconnectUserDataStream();
    this.publicStream.close();
  }
}

export { BybitBaseClient };
