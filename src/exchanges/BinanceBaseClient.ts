import type { CreateOrderWebSocketArgs, FetchPageWithLimitArgs, OrderRateLimit } from '../types/exchange';
import type {
  Kline,
  KlineInterval,
  TradeSymbolBySymbol,
  TickerBySymbol,
  AccountBalances,
  Order,
  OrderBook,
  PublicTrade,
  WebSocketConnectionInfo,
  UserDataStreamHandlerArgs,
  OrderUpdateEvent,
  PositionUpdateEvent,
  ExchangeRateLimitState,
} from '../types/common';
import { OrderTypeEnum, TimeInForceEnum, OrderSideEnum } from '../types/common';
import type { PublicStreamLike } from '../types/stream';
import type { BinanceBaseHttpClient } from '../http/BinanceBaseHttpClient';
import {
  normalizeBinanceTradeSymbols,
  normalizeBinanceTickers,
  normalizeBinanceKlines,
  normalizeBinanceOrder,
  normalizeBinanceBalances,
  normalizeBinanceOrderBook,
  normalizeBinancePublicTrades,
  parseBinanceOrderRateLimit,
} from '../normalizers/binanceNormalizer';
import {
  BINANCE_FUTURES_ORDER_TYPE_REVERSE,
  BINANCE_SPOT_ORDER_TYPE_REVERSE,
  BINANCE_ORDER_STATUS,
  BINANCE_ALGO_STATUS,
  BINANCE_FUTURES_TIME_IN_FORCE_REVERSE,
} from '../constants/mappings';
import { BINANCE_SPOT_TRAILING_UNITS_PER_PERCENT } from '../constants/binance';
import { isConditionalOrderType } from '../constants/orderTypes';
import { ExchangeError } from '../errors/ExchangeError';
import { BinanceUserDataStream } from '../ws/BinanceUserDataStream';
import { BinanceTradeStream } from '../ws/BinanceTradeStream';
import { BaseExchangeClient } from './BaseExchangeClient';
import type { BinanceBaseClientArgs } from './BinanceBaseClient.types';

const LISTEN_KEY_KEEPALIVE_INTERVAL_MS = 30 * 60 * 1000;
const USER_DATA_STREAM_RECREATE_RETRY_MS = 60 * 1000;

abstract class BinanceBaseClient<T extends BinanceBaseHttpClient> extends BaseExchangeClient {
  protected readonly exchangeLabel = 'Binance';
  protected readonly httpClient: T;
  protected userDataStream: BinanceUserDataStream | null = null;

  private readonly publicStream: PublicStreamLike;
  protected readonly tradeStream: BinanceTradeStream;
  private readonly userDataWebSocketUrl: string;
  private listenKey: string | null = null;
  private listenKeyKeepAliveTimer: ReturnType<typeof setInterval> | null = null;
  private userDataStreamRecreateTimer: ReturnType<typeof setTimeout> | null = null;
  private userDataStreamConnecting = false;

  constructor(args: BinanceBaseClientArgs<T>) {
    super(args.exchangeArgs);
    this.httpClient = args.httpClient;
    this.publicStream = args.publicStream;
    this.userDataWebSocketUrl = args.userDataWebSocketUrl;

    this.tradeStream = new BinanceTradeStream({
      url: args.tradeWebSocketUrl,
      label: args.tradeStreamLabel,
      apiKey: args.exchangeArgs.config.apiKey,
      secret: args.exchangeArgs.config.secret,
      logger: args.exchangeArgs.logger,
      onNotify: this.onNotify,
    });
  }

  protected getPublicStream(): PublicStreamLike {
    return this.publicStream;
  }

  protected async fetchAndNormalizeTradeSymbols(): Promise<TradeSymbolBySymbol> {
    const raw = await this.httpClient.fetchExchangeInfo();
    this.logger.info(
      { instrumentCount: raw.symbols.length },
      `[Binance] Fetched ${raw.symbols.length} instruments`,
    );

    return normalizeBinanceTradeSymbols(raw);
  }

  async getOrderRateLimit(): Promise<OrderRateLimit> {
    const raw = await this.httpClient.fetchExchangeInfo();

    return parseBinanceOrderRateLimit(raw);
  }

  /** Расход веса и срок запрета — из того, что биржа сама сказала в заголовках последних ответов. */
  override getRateLimitState(): ExchangeRateLimitState {
    return this.httpClient.getRateLimitState();
  }

  protected async fetchAndNormalizeTickers(): Promise<TickerBySymbol> {
    const rawTickerList = await this.httpClient.fetchTickers();

    return normalizeBinanceTickers(rawTickerList);
  }

  protected async fetchAndNormalizeKlines(
    symbol: string,
    interval: KlineInterval,
    options?: FetchPageWithLimitArgs,
  ): Promise<Kline[]> {
    const rawKlineList = await this.httpClient.fetchKlines(symbol, interval, options);

    return normalizeBinanceKlines(rawKlineList);
  }

  protected async fetchAndNormalizeBalances(): Promise<AccountBalances> {
    const raw = await this.httpClient.fetchAccount();

    return normalizeBinanceBalances(raw);
  }

  protected buildBinanceOrderParams(args: CreateOrderWebSocketArgs): Record<string, unknown> {
    const isSpot = this.marketLabel === 'spot';

    // На фьючерсах условные заявки живут в отдельной службе и сюда попасть не должны:
    // развилка уводит их раньше. Если попали — это ошибка в самой библиотеке, и честнее
    // сказать об этом громко, чем собрать запрос, который биржа отобьёт кодом -4120.
    if (!isSpot && isConditionalOrderType(args.type)) {
      throw new ExchangeError(
        `Binance futures: conditional order type ${args.type} must go to the conditional service, not the plain order endpoint`,
        'CONDITIONAL_ORDER_WRONG_ENDPOINT',
        'binance',
      );
    }

    const typeMap = isSpot ? BINANCE_SPOT_ORDER_TYPE_REVERSE : BINANCE_FUTURES_ORDER_TYPE_REVERSE;
    const binanceType = typeMap[args.type] ?? args.type.toUpperCase();

    const orderParams: Record<string, unknown> = {
      symbol: args.symbol,
      side: args.side.toUpperCase(),
      type: binanceType,
    };

    // Сумму в котируемой валюте биржа принимает ТОЛЬКО на рыночной заявке — её собственный
    // признак так и называется, «разрешено для рыночных», лимитного соответствия нет
    // (сверено с данными биржи 08.08.2026). Раньше сумма проходила и на лимитной, и заявка
    // уходила вообще без объёма.
    const isQuoteSized = isSpot && args.quoteOrderQty !== undefined && args.quoteOrderQty > 0;

    if (isQuoteSized && args.type !== OrderTypeEnum.Market) {
      throw new ExchangeError(
        'Binance spot accepts an amount in quote currency on MARKET orders only',
        'QUOTE_AMOUNT_MARKET_ONLY',
        'binance',
      );
    }

    if (isQuoteSized) {
      orderParams.quoteOrderQty = String(args.quoteOrderQty);
    } else {
      orderParams.quantity = String(this.amountToPrecision(args.symbol, args.amount));
    }

    if (args.price !== undefined && args.price > 0) {
      orderParams.price = String(this.priceToPrecision(args.symbol, args.price));
    }

    // Цена срабатывания и запас скольжения — параметры СПОТА: там условные заявки
    // по-прежнему ставятся этим входом. На фьючерсах таких параметров у обычной заявки нет,
    // и запас скольжения раньше уходил туда без всякого ограждения — это чинится здесь.
    if (isSpot && args.stopPrice !== undefined && args.stopPrice > 0) {
      orderParams.stopPrice = String(this.priceToPrecision(args.symbol, args.stopPrice));
    }

    // Отступ скольжения снаружи ВСЕГДА в процентах — единственная единица во всей библиотеке.
    // Спот Binance считает его в своих сотых долях процента; перевод живёт здесь, на границе,
    // и наружу биржевая единица не выходит.
    if (isSpot && args.callbackRate !== undefined && args.callbackRate > 0) {
      orderParams.trailingDelta = String(Math.round(args.callbackRate * BINANCE_SPOT_TRAILING_UNITS_PER_PERCENT));
    }

    const positionSide = args.positionSide;
    const isHedgeMode = !isSpot && positionSide !== undefined;

    if (isHedgeMode && positionSide !== undefined) {
      orderParams.positionSide = positionSide.toUpperCase();
    }

    if (!isSpot && args.reduceOnly !== undefined && !isHedgeMode) {
      orderParams.reduceOnly = args.reduceOnly;
    }

    if (args.clientOrderId !== undefined) {
      orderParams.newClientOrderId = args.clientOrderId;
    }

    const isLimitLike =
      args.type === OrderTypeEnum.Limit ||
      args.type === OrderTypeEnum.StopLimit ||
      args.type === OrderTypeEnum.TakeProfitLimit;

    if (isLimitLike) {
      const timeInForce = args.timeInForce ?? TimeInForceEnum.Gtc;
      const isPostOnly = timeInForce === TimeInForceEnum.PostOnly;

      if (isSpot && isPostOnly && args.type === OrderTypeEnum.Limit) {
        orderParams.type = 'LIMIT_MAKER';
      } else if (isSpot) {
        orderParams.timeInForce = isPostOnly ? TimeInForceEnum.Gtc : timeInForce;
      } else {
        orderParams.timeInForce = BINANCE_FUTURES_TIME_IN_FORCE_REVERSE[timeInForce] ?? timeInForce;
      }
    }

    return orderParams;
  }

  async fetchOrderHistory(symbol: string, options?: FetchPageWithLimitArgs): Promise<Order[]> {
    this.logger.debug(`Fetching order history for ${symbol}`);
    const rawList = await this.httpClient.getAllOrders(symbol, options);

    return rawList.map(normalizeBinanceOrder);
  }

  async cancelOrder(symbol: string, orderId: string): Promise<Order> {
    this.logger.debug(`[Binance] Cancelling order ${orderId} for ${symbol}`);
    const raw = await this.httpClient.cancelOrder(symbol, orderId);

    return normalizeBinanceOrder(raw);
  }

  async getOrder(symbol: string, orderId: string): Promise<Order> {
    this.logger.debug(`[Binance] Fetching order ${orderId} for ${symbol}`);
    const raw = await this.httpClient.getOrder(symbol, orderId);

    return normalizeBinanceOrder(raw);
  }

  async getOrderByClientOrderId(symbol: string, clientOrderId: string): Promise<Order> {
    this.logger.debug(`[Binance] Fetching order by client id ${clientOrderId} for ${symbol}`);
    const raw = await this.httpClient.getOrderByClientOrderId(symbol, clientOrderId);

    return normalizeBinanceOrder(raw);
  }

  async fetchOpenOrders(symbol?: string): Promise<Order[]> {
    this.logger.debug('[Binance] Fetching open orders');
    const rawList = await this.httpClient.getOpenOrders(symbol);

    return rawList.map(normalizeBinanceOrder);
  }

  async fetchOpenConditionalOrders(_settleCoin: string): Promise<Order[]> {
    this.logger.debug('[Binance] Fetching open conditional (stop) orders');
    const rawList = await this.httpClient.getOpenOrders(undefined);

    return rawList.map(normalizeBinanceOrder).filter((order) => order.isConditional === true);
  }

  async fetchOrderBook(symbol: string, limit?: number): Promise<OrderBook> {
    this.logger.debug(`[Binance] Fetching order book for ${symbol}`);
    const raw = await this.httpClient.fetchOrderBook(symbol, limit);

    return normalizeBinanceOrderBook(raw, symbol);
  }

  async fetchTrades(symbol: string, limit?: number): Promise<PublicTrade[]> {
    this.logger.debug(`[Binance] Fetching trades for ${symbol}`);
    const rawList = await this.httpClient.fetchTrades(symbol, limit);

    return normalizeBinancePublicTrades(rawList, symbol);
  }

  isTradeWebSocketConnected(): boolean {
    return this.tradeStream.isConnected();
  }

  async connectTradeWebSocket(): Promise<void> {
    await this.tradeStream.connect();
  }

  /**
   * Условная заявка на той бирже/рынке, где она исполняется отдельной службой.
   * Основание всегда отдаёт null — спот Binance условные заявки ставит прежним входом,
   * поэтому его путь этой развилкой доказуемо не затрагивается.
   */
  protected async tryCreateConditionalOrder(_args: CreateOrderWebSocketArgs): Promise<Order | null> {
    return null;
  }

  async createOrderWebSocket(args: CreateOrderWebSocketArgs): Promise<Order> {
    // Развилка берётся ДО выбора транспорта: у условной заявки собственные методы и в
    // канале связи, и среди обычных запросов.
    const conditionalOrder = await this.tryCreateConditionalOrder(args);

    if (conditionalOrder !== null) {
      return conditionalOrder;
    }

    const orderParams = this.buildBinanceOrderParams(args);

    if (this.tradeStream.isConnected()) {
      this.logger.debug(`[Binance] Creating order via WebSocket: ${args.symbol}`);

      return this.tradeStream.createOrder(orderParams);
    }

    this.logger.debug(`[Binance] Creating order via REST: ${args.symbol}`);
    const raw = await this.httpClient.createOrder(orderParams);

    return normalizeBinanceOrder(raw);
  }

  getWebSocketConnectionInfoList(): WebSocketConnectionInfo[] {
    const result = [...this.publicStream.getConnectionInfoList()];

    const tradeInfo = this.tradeStream.getConnectionInfo();

    if (tradeInfo !== null) {
      result.push(tradeInfo);
    }

    if (this.userDataStream !== null) {
      const userDataInfo = this.userDataStream.getConnectionInfo();

      if (userDataInfo !== null) {
        result.push(userDataInfo);
      }
    }

    return result;
  }

  async connectUserDataStream(handler: UserDataStreamHandlerArgs): Promise<void> {
    if (this.userDataStream !== null || this.userDataStreamConnecting) {
      return;
    }

    this.userDataStreamConnecting = true;

    try {
      const response = await this.httpClient.createListenKey();
      this.listenKey = response.listenKey;

      this.userDataStream = new BinanceUserDataStream({
        label: `${this.exchangeLabel} ${this.marketLabel} UserData`,
        listenKey: this.listenKey,
        baseWebSocketUrl: this.userDataWebSocketUrl,
        logger: this.logger,
        onNotify: this.onNotify,
        onMessage: (event) => this.handleUserDataMessage(event, handler),
      });

      this.userDataStream.connect();

      this.listenKeyKeepAliveTimer = setInterval(() => {
        if (this.listenKey) {
          this.httpClient.keepAliveListenKey(this.listenKey).catch((error) => {
            this.logger.error(`[${this.exchangeLabel}] Failed to keep alive listenKey: ${error instanceof Error ? error.message : String(error)}`);
            this.scheduleUserDataStreamRecreate(handler, 0);
          });
        }
      }, LISTEN_KEY_KEEPALIVE_INTERVAL_MS);

      this.logger.info(`[${this.exchangeLabel}] User data stream connected (${this.marketLabel})`);
    } finally {
      this.userDataStreamConnecting = false;
    }
  }

  private scheduleUserDataStreamRecreate(handler: UserDataStreamHandlerArgs, delayMs: number): void {
    if (this.userDataStreamRecreateTimer) {
      return;
    }

    this.userDataStreamRecreateTimer = setTimeout(() => {
      this.userDataStreamRecreateTimer = null;
      void this.recreateUserDataStream(handler);
    }, delayMs);
  }

  private async recreateUserDataStream(handler: UserDataStreamHandlerArgs): Promise<void> {
    if (this.userDataStreamConnecting) {
      return;
    }

    this.logger.warn(`[${this.exchangeLabel}] Recreating user data stream after listenKey keepAlive failure (${this.marketLabel})`);
    this.disconnectUserDataStream();

    try {
      await this.connectUserDataStream(handler);
    } catch (error) {
      this.logger.error(`[${this.exchangeLabel}] Failed to recreate user data stream: ${error instanceof Error ? error.message : String(error)}`);
      this.scheduleUserDataStreamRecreate(handler, USER_DATA_STREAM_RECREATE_RETRY_MS);
    }
  }

  disconnectUserDataStream(): void {
    if (this.userDataStreamRecreateTimer) {
      clearTimeout(this.userDataStreamRecreateTimer);
      this.userDataStreamRecreateTimer = null;
    }

    if (this.listenKeyKeepAliveTimer) {
      clearInterval(this.listenKeyKeepAliveTimer);
      this.listenKeyKeepAliveTimer = null;
    }

    if (this.userDataStream) {
      this.userDataStream.close();
      this.userDataStream = null;
    }

    if (this.listenKey) {
      this.httpClient.deleteListenKey(this.listenKey).catch((error) => {
        this.logger.error(`[${this.exchangeLabel}] Failed to delete listenKey: ${error instanceof Error ? error.message : String(error)}`);
      });
      this.listenKey = null;
    }

    this.logger.info(`[${this.exchangeLabel}] User data stream disconnected (${this.marketLabel})`);
  }

  isUserDataStreamConnected(): boolean {
    return this.userDataStream !== null && this.userDataStream.isConnected();
  }

  private handleUserDataMessage(event: Record<string, unknown>, handler: UserDataStreamHandlerArgs): void {
    const eventType = event.e as string;

    if (eventType === 'ORDER_TRADE_UPDATE') {
      const orderData = event.o as Record<string, unknown>;

      if (!orderData) {
        return;
      }

      const orderUpdate: OrderUpdateEvent = {
        symbol: orderData.s as string,
        orderId: String(orderData.i),
        clientOrderId: orderData.c as string,
        side: (orderData.S as string).toLowerCase() === 'buy' ? OrderSideEnum.Buy : OrderSideEnum.Sell,
        status: BINANCE_ORDER_STATUS[orderData.X as string] ?? 'open',
        price: Number(orderData.p),
        avgPrice: Number(orderData.ap),
        amount: Number(orderData.q),
        filledAmount: Number(orderData.z),
        timestamp: event.T as number,
      };

      handler.onOrderUpdate(orderUpdate);

      return;
    }

    if (eventType === 'ACCOUNT_UPDATE') {
      const accountData = event.a as Record<string, unknown>;

      if (!accountData) {
        return;
      }

      const balanceList = accountData.B;

      if (Array.isArray(balanceList) && handler.onBalanceUpdate !== undefined) {
        // Фьючерсы называют остаток кошелька; свободного и заблокированного здесь нет —
        // выдавать их нулями значило бы придумать числа, которых биржа не присылала.
        handler.onBalanceUpdate({
          balanceList: (balanceList as Array<Record<string, unknown>>).map((rawBalance) => ({
            asset: rawBalance.a as string,
            free: null,
            locked: null,
            total: Number(rawBalance.wb),
          })),
          timestamp: event.T as number,
        });
      }

      const positionList = accountData.P as Array<Record<string, unknown>>;

      if (!Array.isArray(positionList)) {
        return;
      }

      for (const positionData of positionList) {
        const positionUpdate: PositionUpdateEvent = {
          symbol: positionData.s as string,
          side: Number(positionData.pa) > 0 ? 'Buy' : (Number(positionData.pa) < 0 ? 'Sell' : ''),
          size: Math.abs(Number(positionData.pa)),
          entryPrice: Number(positionData.ep),
          unrealisedPnl: Number(positionData.up),
          positionSide: positionData.ps as string,
          timestamp: event.T as number,
          // Этих трёх в событии Binance нет вовсе — раньше здесь стояли нули, неотличимые
          // от настоящих значений. Пусто честнее: сторож видит «не сообщили» и может
          // дочитать позицию, а не сравнивать с нулём.
          markPrice: null,
          leverage: null,
          liquidationPrice: null,
        };

        handler.onPositionUpdate(positionUpdate);
      }

      return;
    }

    if (eventType === 'ALGO_UPDATE') {
      const algoData = event.o as Record<string, unknown>;

      if (!algoData) {
        return;
      }

      const triggeredOrderId = algoData.ai === undefined || algoData.ai === '' ? undefined : String(algoData.ai);
      const rejectReason = typeof algoData.rm === 'string' && algoData.rm !== '' ? algoData.rm : undefined;

      const orderUpdate: OrderUpdateEvent = {
        symbol: algoData.s as string,
        // Номер СОБСТВЕННО условной заявки, а не порождённой: вызывающий помнит именно его.
        orderId: String(algoData.aid),
        clientOrderId: algoData.caid as string,
        side: (algoData.S as string).toLowerCase() === 'buy' ? OrderSideEnum.Buy : OrderSideEnum.Sell,
        status: BINANCE_ALGO_STATUS[algoData.X as string] ?? 'open',
        price: Number(algoData.p),
        avgPrice: Number(algoData.ap ?? 0),
        amount: Number(algoData.q),
        filledAmount: Number(algoData.aq ?? 0),
        timestamp: event.T as number,
        isConditional: true,
        ...(triggeredOrderId === undefined ? {} : { triggeredOrderId }),
        // Отказ приходит на СРАБАТЫВАНИИ: маржа проверяется только в этот момент, и позиция
        // остаётся без защиты. Прежнее отдельное событие отказа упразднено 15.12.2025.
        ...(rejectReason === undefined ? {} : { rejectReason }),
      };

      handler.onOrderUpdate(orderUpdate);

      return;
    }

    // Неопознанные типы раньше исчезали бесследно — из-за этого смену формата потока
    // не заметили бы второй раз.
    this.logger.debug(`[${this.exchangeLabel}] Unhandled user data event type: ${eventType}`);
  }

  async close(): Promise<void> {
    this.logger.info(`[Binance] Closing ${this.marketLabel} connection`);
    this.tradeStream.disconnect();
    this.disconnectUserDataStream();
    this.publicStream.close();
  }
}

export { BinanceBaseClient };
