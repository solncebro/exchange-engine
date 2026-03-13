import type { CreateOrderWebSocketArgs, ExchangeArgs, FetchPageWithLimitArgs } from '../types/exchange';
import type {
  Kline,
  KlineInterval,
  TradeSymbolBySymbol,
  TickerBySymbol,
  BalanceByAsset,
  Order,
} from '../types/common';
import { OrderTypeEnum, OrderSideEnum } from '../types/common';
import type { PublicStreamLike } from '../types/stream';
import { BybitHttpClient } from '../http/BybitHttpClient';
import {
  normalizeBybitTradeSymbols,
  normalizeBybitTickers,
  normalizeBybitKlines,
  normalizeBybitBalance,
  buildBybitOrderFromCreateResponse,
} from '../normalizers/bybitNormalizer';
import { BybitPublicStream } from '../ws/BybitPublicStream';
import { BybitTradeStream } from '../ws/BybitTradeStream';
import {
  BYBIT_KLINE_INTERVAL,
  BYBIT_BASE_URL,
  BYBIT_DEMO_BASE_URL,
  BYBIT_TRADE_WEBSOCKET_URL,
} from '../constants/bybit';
import { BaseExchangeClient } from './BaseExchangeClient';

interface BybitBaseClientArgs {
  exchangeArgs: ExchangeArgs;
  category: string;
  publicWebSocketUrl: string;
}

abstract class BybitBaseClient extends BaseExchangeClient {
  protected readonly klineLimit = 200;
  protected readonly httpClient: BybitHttpClient;

  private readonly category: string;
  private readonly publicStream: BybitPublicStream;
  private readonly tradeStream: BybitTradeStream | null;

  constructor(args: BybitBaseClientArgs) {
    super(args.exchangeArgs);

    const isDemoMode = args.exchangeArgs.config.isDemoMode === true;
    const baseUrl = isDemoMode ? BYBIT_DEMO_BASE_URL : BYBIT_BASE_URL;
    this.category = args.category;

    this.httpClient = new BybitHttpClient({
      baseUrl,
      apiKey: args.exchangeArgs.config.apiKey,
      secret: args.exchangeArgs.config.secret,
      logger: args.exchangeArgs.logger,
      httpsAgent: args.exchangeArgs.config.httpsAgent,
    });

    this.publicStream = new BybitPublicStream(
      args.publicWebSocketUrl,
      args.exchangeArgs.logger,
      args.exchangeArgs.onNotify,
    );

    if (isDemoMode) {
      this.tradeStream = null;
    } else {
      this.tradeStream = new BybitTradeStream({
        url: BYBIT_TRADE_WEBSOCKET_URL,
        apiKey: args.exchangeArgs.config.apiKey,
        secret: args.exchangeArgs.config.secret,
        logger: args.exchangeArgs.logger,
        onNotify: args.exchangeArgs.onNotify,
      });
    }
  }

  protected getPublicStream(): PublicStreamLike {
    return this.publicStream;
  }

  protected async fetchAndNormalizeTradeSymbols(): Promise<TradeSymbolBySymbol> {
    const raw = await this.httpClient.fetchInstrumentsInfo(this.category);

    return normalizeBybitTradeSymbols(raw.result.list);
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

  protected async fetchAndNormalizeBalance(): Promise<BalanceByAsset> {
    const raw = await this.httpClient.fetchWalletBalance('UNIFIED');

    return normalizeBybitBalance(raw.result);
  }

  protected buildBybitOrderParams(args: CreateOrderWebSocketArgs): Record<string, unknown> {
    const isMarket = args.type === OrderTypeEnum.Market;

    const orderParams: Record<string, unknown> = {
      category: this.category,
      symbol: args.symbol,
      orderType: isMarket ? 'Market' : 'Limit',
      side: args.side === OrderSideEnum.Buy ? 'Buy' : 'Sell',
      qty: this.amountToPrecision(args.symbol, args.amount),
    };

    if (args.price !== undefined && args.price > 0) {
      orderParams.price = this.priceToPrecision(args.symbol, args.price);
    }

    if (args.stopPrice !== undefined && args.stopPrice > 0) {
      orderParams.triggerPrice = this.priceToPrecision(args.symbol, args.stopPrice);
    }

    if (args.reduceOnly !== undefined) {
      orderParams.reduceOnly = args.reduceOnly;
    }

    if (args.timeInForce !== undefined) {
      orderParams.timeInForce = args.timeInForce;
    }

    if (args.clientOrderId !== undefined) {
      orderParams.orderLinkId = args.clientOrderId;
    }

    return orderParams;
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

  protected async submitOrder(orderParams: Record<string, unknown>, symbol: string): Promise<Order> {
    if (this.tradeStream !== null) {
      this.logger.debug(`Creating order via WebSocket: ${symbol}`);

      return this.tradeStream.createOrder(orderParams);
    }

    this.logger.debug(`Creating order via REST: ${symbol}`);
    const raw = await this.httpClient.createOrder(orderParams);

    return buildBybitOrderFromCreateResponse(
      { symbol, type: orderParams.orderType as string, side: orderParams.side as string } as CreateOrderWebSocketArgs,
      raw.result.orderId,
    );
  }

  async close(): Promise<void> {
    this.logger.info(`Closing Bybit ${this.marketLabel} connection`);

    if (this.tradeStream !== null) {
      this.tradeStream.disconnect();
    }

    this.publicStream.close();
  }
}

export { BybitBaseClient };
