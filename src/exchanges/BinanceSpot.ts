import type { ExchangeArgs } from '../types/exchange';
import type {
  UserDataStreamHandlerArgs,
  WebSocketConnectionInfo,
  OrderUpdateEvent,
  BalanceUpdateEvent,
  BalanceUpdateItem,
} from '../types/common';
import { OrderSideEnum } from '../types/common';
import { BinanceSpotHttpClient } from '../http/BinanceSpotHttpClient';
import { BinanceSpotPublicStream } from '../ws/BinanceSpotPublicStream';
import { BinanceSpotUserDataStream } from '../ws/BinanceSpotUserDataStream';
import {
  BINANCE_KLINE_LIMIT_SPOT,
  BINANCE_SPOT_BASE_URL,
  BINANCE_DEMO_SPOT_BASE_URL,
  BINANCE_SPOT_WEBSOCKET_STREAM_URL,
  BINANCE_SPOT_TRADE_WEBSOCKET_URL,
  BINANCE_DEMO_SPOT_TRADE_WEBSOCKET_URL,
} from '../constants/binance';
import { BINANCE_ORDER_STATUS } from '../constants/mappings';
import { BinanceBaseClient } from './BinanceBaseClient';
import { BaseExchangeClient } from './BaseExchangeClient';

class BinanceSpot extends BinanceBaseClient<BinanceSpotHttpClient> {
  protected readonly marketLabel = 'spot';
  protected readonly klineLimit = BINANCE_KLINE_LIMIT_SPOT;

  private readonly secret: string;
  private readonly userDataWebSocketApiUrl: string;
  private spotUserDataStream: BinanceSpotUserDataStream | null = null;
  private spotUserDataStreamConnecting = false;

  constructor(args: ExchangeArgs) {
    const isDemoMode = args.config.isDemoMode === true;

    const baseUrl = isDemoMode
      ? BINANCE_DEMO_SPOT_BASE_URL
      : BINANCE_SPOT_BASE_URL;

    const tradeWebSocketUrl = isDemoMode
      ? BINANCE_DEMO_SPOT_TRADE_WEBSOCKET_URL
      : BINANCE_SPOT_TRADE_WEBSOCKET_URL;

    const httpClient = new BinanceSpotHttpClient({
      baseUrl,
      apiKey: args.config.apiKey,
      secret: args.config.secret,
      logger: args.logger,
      httpsAgent: args.config.httpsAgent,
    });

    const publicStream = new BinanceSpotPublicStream({
      webSocketUrl: BINANCE_SPOT_WEBSOCKET_STREAM_URL,
      logger: args.logger,
      onNotify: BaseExchangeClient.createNotifyHandler(args.onNotify),
      label: 'Binance Spot Public WebSocket',
    });

    super({
      exchangeArgs: args,
      httpClient,
      publicStream,
      tradeWebSocketUrl,
      tradeStreamLabel: 'Binance Spot Order WebSocket',
      userDataWebSocketUrl: BINANCE_SPOT_WEBSOCKET_STREAM_URL,
    });

    this.secret = args.config.secret;
    this.userDataWebSocketApiUrl = tradeWebSocketUrl;
  }

  async connectUserDataStream(handler: UserDataStreamHandlerArgs): Promise<void> {
    if (this.spotUserDataStream !== null || this.spotUserDataStreamConnecting) {
      return;
    }

    this.spotUserDataStreamConnecting = true;

    try {
      this.spotUserDataStream = new BinanceSpotUserDataStream({
        label: 'Binance Spot UserData WebSocket',
        url: this.userDataWebSocketApiUrl,
        apiKey: this.apiKey,
        secret: this.secret,
        logger: this.logger,
        onNotify: this.onNotify,
        onMessage: (event) => this.handleSpotUserDataMessage(event, handler),
      });

      this.spotUserDataStream.connect();
      this.logger.info('[Binance] Spot user data stream connected (WebSocket API)');
    } finally {
      this.spotUserDataStreamConnecting = false;
    }
  }

  disconnectUserDataStream(): void {
    if (this.spotUserDataStream !== null) {
      this.spotUserDataStream.close();
      this.spotUserDataStream = null;
    }

    this.logger.info('[Binance] Spot user data stream disconnected');
  }

  isUserDataStreamConnected(): boolean {
    return this.spotUserDataStream !== null && this.spotUserDataStream.isConnected();
  }

  getWebSocketConnectionInfoList(): WebSocketConnectionInfo[] {
    const result = super.getWebSocketConnectionInfoList();

    if (this.spotUserDataStream !== null) {
      const info = this.spotUserDataStream.getConnectionInfo();

      if (info !== null) {
        result.push(info);
      }
    }

    return result;
  }

  private handleSpotUserDataMessage(event: Record<string, unknown>, handler: UserDataStreamHandlerArgs): void {
    const eventType = event.e as string;

    if (eventType === 'executionReport') {
      handler.onOrderUpdate(this.buildOrderUpdateFromExecutionReport(event));

      return;
    }

    if (eventType === 'outboundAccountPosition' && handler.onBalanceUpdate !== undefined) {
      handler.onBalanceUpdate(this.buildBalanceUpdateFromAccountPosition(event));
    }
  }

  private buildOrderUpdateFromExecutionReport(event: Record<string, unknown>): OrderUpdateEvent {
    const filledAmount = Number(event.z);
    const cumulativeQuote = Number(event.Z);
    const avgPrice = filledAmount > 0 ? cumulativeQuote / filledAmount : 0;
    const side = (event.S as string).toLowerCase() === 'buy' ? OrderSideEnum.Buy : OrderSideEnum.Sell;

    return {
      symbol: event.s as string,
      orderId: String(event.i),
      clientOrderId: (event.c as string) ?? '',
      side,
      status: BINANCE_ORDER_STATUS[event.X as string] ?? 'open',
      price: Number(event.p),
      avgPrice,
      amount: Number(event.q),
      filledAmount,
      timestamp: Number(event.E ?? event.T),
    };
  }

  private buildBalanceUpdateFromAccountPosition(event: Record<string, unknown>): BalanceUpdateEvent {
    const rawBalanceList = Array.isArray(event.B) ? (event.B as Array<Record<string, unknown>>) : [];

    // Спот называет свободное и заблокированное, но не остаток кошелька — его не выдумываем.
    const balanceList: BalanceUpdateItem[] = rawBalanceList.map((rawBalance) => ({
      asset: rawBalance.a as string,
      free: Number(rawBalance.f),
      locked: Number(rawBalance.l),
      total: null,
    }));

    return {
      balanceList,
      timestamp: Number(event.E),
    };
  }
}

export { BinanceSpot };
