import type { CreateOrderWebSocketArgs, ExchangeArgs, FetchPageWithLimitArgs } from '../types/exchange';
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
import { BaseExchangeClient } from './BaseExchangeClient';

abstract class BinanceBaseClient<T extends BinanceBaseHttpClient> extends BaseExchangeClient {
  protected readonly httpClient: T;
  protected userDataStream: BinanceUserDataStream | null = null;

  private readonly publicStream: PublicStreamLike;

  constructor(args: ExchangeArgs, httpClient: T, publicStream: PublicStreamLike) {
    super(args);
    this.httpClient = httpClient;
    this.publicStream = publicStream;
  }

  protected getPublicStream(): PublicStreamLike {
    return this.publicStream;
  }

  protected async fetchAndNormalizeTradeSymbols(): Promise<TradeSymbolBySymbol> {
    const raw = await this.httpClient.fetchExchangeInfo();

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

  async createOrderWebSocket(args: CreateOrderWebSocketArgs): Promise<Order> {
    this.logger.debug(`Creating order via REST: ${args.symbol}`);

    const binanceType = BINANCE_ORDER_TYPE_REVERSE[args.type] ?? args.type.toUpperCase();

    const orderParams: Record<string, unknown> = {
      symbol: args.symbol,
      side: args.side.toUpperCase(),
      type: binanceType,
      quantity: this.amountToPrecision(args.symbol, args.amount),
    };

    if (args.price !== undefined && args.price > 0) {
      orderParams.price = this.priceToPrecision(args.symbol, args.price);
    }

    if (args.stopPrice !== undefined && args.stopPrice > 0) {
      orderParams.stopPrice = this.priceToPrecision(args.symbol, args.stopPrice);
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

    const raw = await this.httpClient.createOrder(orderParams);

    return normalizeBinanceOrder(raw);
  }

  async close(): Promise<void> {
    this.logger.info(`Closing Binance ${this.marketLabel} connection`);

    if (this.userDataStream) {
      this.userDataStream.close();
    }

    this.publicStream.close();
  }
}

export { BinanceBaseClient };
