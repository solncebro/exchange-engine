import type { CreateOrderWebSocketArgs, FetchPageWithLimitArgs } from '../types/exchange';
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
} from '../normalizers/binanceNormalizer';
import { BINANCE_ORDER_TYPE_REVERSE, BINANCE_WORKING_TYPE } from '../constants/mappings';
import { BinanceUserDataStream } from '../ws/BinanceUserDataStream';
import { BinanceTradeStream } from '../ws/BinanceTradeStream';
import { BaseExchangeClient } from './BaseExchangeClient';
import type { BinanceBaseClientArgs } from './BinanceBaseClient.types';

const LISTEN_KEY_KEEPALIVE_INTERVAL_MS = 30 * 60 * 1000;

const BINANCE_ORDER_STATUS_MAP: Record<string, string> = {
  NEW: 'open',
  PARTIALLY_FILLED: 'open',
  FILLED: 'closed',
  CANCELED: 'canceled',
  EXPIRED: 'expired',
  EXPIRED_IN_MATCH: 'expired',
};

abstract class BinanceBaseClient<T extends BinanceBaseHttpClient> extends BaseExchangeClient {
  protected readonly exchangeLabel = 'Binance';
  protected readonly httpClient: T;
  protected userDataStream: BinanceUserDataStream | null = null;

  private readonly publicStream: PublicStreamLike;
  private readonly tradeStream: BinanceTradeStream;
  private readonly userDataWebSocketUrl: string;
  private listenKey: string | null = null;
  private listenKeyKeepAliveTimer: ReturnType<typeof setInterval> | null = null;

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
    const binanceType = BINANCE_ORDER_TYPE_REVERSE[args.type] ?? args.type.toUpperCase();

    const orderParams: Record<string, unknown> = {
      symbol: args.symbol,
      side: args.side.toUpperCase(),
      type: binanceType,
      quantity: String(this.amountToPrecision(args.symbol, args.amount)),
    };

    if (args.price !== undefined && args.price > 0) {
      orderParams.price = String(this.priceToPrecision(args.symbol, args.price));
    }

    if (args.stopPrice !== undefined && args.stopPrice > 0) {
      orderParams.stopPrice = String(this.priceToPrecision(args.symbol, args.stopPrice));
    }

    if (args.closePosition !== undefined) {
      orderParams.closePosition = args.closePosition;
    }

    if (args.workingType !== undefined) {
      orderParams.workingType = BINANCE_WORKING_TYPE[args.workingType] ?? args.workingType;
    }

    if (args.positionSide !== undefined) {
      orderParams.positionSide = args.positionSide.toUpperCase();
    }

    if (args.reduceOnly !== undefined) {
      orderParams.reduceOnly = args.reduceOnly;
    }

    if (args.clientOrderId !== undefined) {
      orderParams.newClientOrderId = args.clientOrderId;
    }

    if (args.type === OrderTypeEnum.Limit) {
      orderParams.timeInForce = args.timeInForce ?? TimeInForceEnum.Gtc;
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

  async fetchOpenOrders(symbol?: string): Promise<Order[]> {
    this.logger.debug('[Binance] Fetching open orders');
    const rawList = await this.httpClient.getOpenOrders(symbol);

    return rawList.map(normalizeBinanceOrder);
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

  async createOrderWebSocket(args: CreateOrderWebSocketArgs): Promise<Order> {
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
    if (this.userDataStream !== null) {
      return;
    }

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
        });
      }
    }, LISTEN_KEY_KEEPALIVE_INTERVAL_MS);

    this.logger.info(`[${this.exchangeLabel}] User data stream connected (${this.marketLabel})`);
  }

  disconnectUserDataStream(): void {
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
        status: BINANCE_ORDER_STATUS_MAP[orderData.X as string] ?? 'open',
        price: Number(orderData.p),
        avgPrice: Number(orderData.ap),
        amount: Number(orderData.q),
        filledAmount: Number(orderData.z),
        timestamp: event.T as number,
      };

      handler.onOrderUpdate(orderUpdate);
    }

    if (eventType === 'ACCOUNT_UPDATE') {
      const accountData = event.a as Record<string, unknown>;

      if (!accountData) {
        return;
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
          markPrice: 0,
          unrealisedPnl: Number(positionData.up),
          leverage: 0,
          liquidationPrice: 0,
          positionSide: positionData.ps as string,
          timestamp: event.T as number,
        };

        handler.onPositionUpdate(positionUpdate);
      }
    }
  }

  async close(): Promise<void> {
    this.logger.info(`[Binance] Closing ${this.marketLabel} connection`);
    this.tradeStream.disconnect();
    this.disconnectUserDataStream();
    this.publicStream.close();
  }
}

export { BinanceBaseClient };
