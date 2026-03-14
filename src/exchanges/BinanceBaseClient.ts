import type { CreateOrderWebSocketArgs, FetchPageWithLimitArgs } from '../types/exchange';
import type {
  Kline,
  KlineInterval,
  TradeSymbolBySymbol,
  TickerBySymbol,
  BalanceByAsset,
  Order,
} from '../types/common';
import { OrderTypeEnum, TimeInForceEnum } from '../types/common';
import type { PublicStreamLike } from '../types/stream';
import type { BinanceBaseHttpClient } from '../http/BinanceBaseHttpClient';
import {
  normalizeBinanceTradeSymbols,
  normalizeBinanceTickers,
  normalizeBinanceKlines,
  normalizeBinanceOrder,
  normalizeBinanceBalance,
} from '../normalizers/binanceNormalizer';
import { BINANCE_ORDER_TYPE_REVERSE, BINANCE_WORKING_TYPE } from '../constants/mappings';
import { BinanceUserDataStream } from '../ws/BinanceUserDataStream';
import { BinanceTradeStream } from '../ws/BinanceTradeStream';
import { BaseExchangeClient } from './BaseExchangeClient';
import type { BinanceBaseClientArgs } from './BinanceBaseClient.types';

abstract class BinanceBaseClient<T extends BinanceBaseHttpClient> extends BaseExchangeClient {
  protected readonly exchangeLabel = 'Binance';
  protected readonly httpClient: T;
  protected userDataStream: BinanceUserDataStream | null = null;

  private readonly publicStream: PublicStreamLike;
  private readonly tradeStream: BinanceTradeStream;

  constructor(args: BinanceBaseClientArgs<T>) {
    super(args.exchangeArgs);
    this.httpClient = args.httpClient;
    this.publicStream = args.publicStream;

    this.tradeStream = new BinanceTradeStream({
      url: args.tradeWebSocketUrl,
      apiKey: args.exchangeArgs.config.apiKey,
      secret: args.exchangeArgs.config.secret,
      logger: args.exchangeArgs.logger,
      onNotify: args.exchangeArgs.onNotify,
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

  protected async fetchAndNormalizeBalance(): Promise<BalanceByAsset> {
    const raw = await this.httpClient.fetchAccount();

    return normalizeBinanceBalance(raw);
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

  async close(): Promise<void> {
    this.logger.info(`[Binance] Closing ${this.marketLabel} connection`);
    this.tradeStream.disconnect();

    if (this.userDataStream) {
      this.userDataStream.close();
    }

    this.publicStream.close();
  }
}

export { BinanceBaseClient };
