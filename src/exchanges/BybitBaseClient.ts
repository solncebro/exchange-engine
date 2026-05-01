import type { CreateOrderWebSocketArgs, FetchPageWithLimitArgs, ModifyOrderArgs } from '../types/exchange';
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
import { OrderTypeEnum, OrderSideEnum, PositionSideEnum, TimeInForceEnum } from '../types/common';
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
  buildBybitOrderFromCreateResponse,
} from '../normalizers/bybitNormalizer';
import { BybitPublicStream } from '../ws/BybitPublicStream';
import { BybitTradeStream } from '../ws/BybitTradeStream';
import { BybitPrivateStream } from '../ws/BybitPrivateStream';
import {
  BYBIT_KLINE_INTERVAL,
  BYBIT_BASE_URL,
  BYBIT_DEMO_BASE_URL,
  BYBIT_TRADE_WEBSOCKET_URL,
} from '../constants/bybit';
import { BaseExchangeClient } from './BaseExchangeClient';
import type { BybitBaseClientArgs } from './BybitBaseClient.types';

const BYBIT_ORDER_STATUS_MAP: Record<string, string> = {
  New: 'open',
  PartiallyFilled: 'open',
  Untriggered: 'open',
  Filled: 'closed',
  Cancelled: 'canceled',
  Rejected: 'canceled',
  Deactivated: 'expired',
  Expired: 'expired',
};

abstract class BybitBaseClient extends BaseExchangeClient {
  protected readonly exchangeLabel = 'Bybit';
  protected readonly klineLimit = 200;
  protected readonly httpClient: BybitHttpClient;

  protected readonly category: string;
  private readonly secret: string;
  private readonly publicStream: BybitPublicStream;
  private readonly tradeStream: BybitTradeStream | null;
  private privateStream: BybitPrivateStream | null = null;

  constructor(args: BybitBaseClientArgs) {
    super(args.exchangeArgs);

    const isDemoMode = args.exchangeArgs.config.isDemoMode === true;
    const baseUrl = isDemoMode ? BYBIT_DEMO_BASE_URL : BYBIT_BASE_URL;
    this.category = args.category;
    this.secret = args.exchangeArgs.config.secret;

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
    });

    if (isDemoMode) {
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
    const raw = await this.httpClient.fetchKline({
      category: this.category,
      symbol,
      interval: bybitInterval,
      options,
    });

    return normalizeBybitKlines(raw.result.list);
  }

  protected async fetchAndNormalizeBalances(): Promise<AccountBalances> {
    const raw = await this.httpClient.fetchWalletBalance('UNIFIED');

    return normalizeBybitBalances(raw.result);
  }

  protected buildBybitOrderParams(args: CreateOrderWebSocketArgs): Record<string, unknown> {
    const isSpot = this.category === 'spot';
    const isLinear = this.category === 'linear';

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

    if (isSpot && args.quoteOrderQty !== undefined && args.quoteOrderQty > 0) {
      orderParams.qty = String(args.quoteOrderQty);
    } else {
      orderParams.qty = String(this.amountToPrecision(args.symbol, args.amount));
    }

    if (args.price !== undefined && args.price > 0) {
      orderParams.price = String(this.priceToPrecision(args.symbol, args.price));
    }

    if (args.stopPrice !== undefined && args.stopPrice > 0) {
      orderParams.triggerPrice = String(this.priceToPrecision(args.symbol, args.stopPrice));
    }

    if (!isSpot && args.triggerDirection !== undefined) {
      orderParams.triggerDirection = args.triggerDirection;
    }

    if (!isSpot && args.triggerBy !== undefined) {
      orderParams.triggerBy = args.triggerBy;
    }

    if (!isSpot && args.reduceOnly !== undefined) {
      orderParams.reduceOnly = args.reduceOnly;
    }

    if (!isSpot && args.closeOnTrigger !== undefined) {
      orderParams.closeOnTrigger = args.closeOnTrigger;
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

    if (isSpot && args.marketUnit !== undefined) {
      orderParams.marketUnit = args.marketUnit;
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

    return {
      id: orderId,
      clientOrderId: '',
      symbol,
      side: OrderSideEnum.Buy,
      type: OrderTypeEnum.Limit,
      timeInForce: TimeInForceEnum.Gtc,
      price: 0,
      avgPrice: 0,
      stopPrice: 0,
      amount: 0,
      filledAmount: 0,
      filledQuoteAmount: 0,
      status: 'canceled',
      reduceOnly: false,
      timestamp: Date.now(),
      updatedTimestamp: Date.now(),
    };
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

  async fetchOpenOrders(symbol?: string): Promise<Order[]> {
    this.logger.debug('[Bybit] Fetching open orders');
    const raw = await this.httpClient.getOpenOrders(this.category, { symbol });

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
    const raw = await this.httpClient.getOrderHistory(this.category, { symbol, limit: options?.limit });

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

  async createBatchOrders(orderList: CreateOrderWebSocketArgs[]): Promise<Order[]> {
    this.logger.debug(`[Bybit] Creating batch of ${orderList.length} orders`);
    const requestList = orderList.map((args) => this.buildBybitOrderParams(args));
    const raw = await this.httpClient.createBatchOrders(this.category, requestList);

    return raw.result.list.map((entry, index) =>
      buildBybitOrderFromCreateResponse(orderList[index], String(entry['orderId'])),
    );
  }

  async cancelBatchOrders(symbol: string, orderIdList: string[]): Promise<void> {
    this.logger.debug(`[Bybit] Cancelling batch of ${orderIdList.length} orders for ${symbol}`);
    const requestList = orderIdList.map((orderId) => ({ category: this.category, symbol, orderId }));
    await this.httpClient.cancelBatchOrders(this.category, requestList);
  }

  async fetchIncome(options?: FetchPageWithLimitArgs): Promise<Income[]> {
    this.logger.debug('[Bybit] Fetching income');
    const raw = await this.httpClient.fetchTransactionLog({ category: this.category, limit: options?.limit });

    return normalizeBybitIncomeList(raw.result.list);
  }

  async fetchClosedPnl(symbol?: string, options?: FetchPageWithLimitArgs): Promise<ClosedPnl[]> {
    this.logger.debug('[Bybit] Fetching closed PnL');
    const raw = await this.httpClient.getClosedPnl(this.category, { symbol, limit: options?.limit });

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

      return buildBybitOrderFromCreateResponse(args, order.id);
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
      apiKey: this.apiKey,
      secret: this.secret,
      logger: this.logger,
      onNotify: this.onNotify,
      topicList: ['order', 'position'],
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
          status: BYBIT_ORDER_STATUS_MAP[orderData.orderStatus as string] ?? 'open',
          price: Number(orderData.price),
          avgPrice: Number(orderData.avgPrice),
          amount: Number(orderData.qty),
          filledAmount: Number(orderData.cumExecQty),
          timestamp: Number(orderData.updatedTime),
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
          markPrice: Number(positionData.markPrice),
          unrealisedPnl: Number(positionData.unrealisedPnl),
          leverage: Number(positionData.leverage),
          liquidationPrice: Number(positionData.liqPrice),
          positionSide: (positionData.positionIdx as string) ?? '',
          timestamp: Number(positionData.updatedTime),
        };

        handler.onPositionUpdate(positionUpdate);
      }
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
