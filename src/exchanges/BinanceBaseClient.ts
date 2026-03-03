import type { CreateOrderWsArgs, ExchangeArgs, FetchKlinesArgs } from '../types/exchange';
import type {
  Kline,
  KlineInterval,
  MarketBySymbol,
  TickerBySymbol,
  BalanceByAsset,
  Order,
} from '../types/common';
import type { PublicStreamLike } from '../types/stream';
import type { BinanceBaseHttpClient } from '../http/BinanceBaseHttpClient';
import {
  normalizeBinanceMarkets,
  normalizeBinanceTickers,
  normalizeBinanceKlines,
  normalizeBinanceOrder,
  normalizeBinanceBalance,
} from '../normalizers/binanceNormalizer';
import { BinanceUserDataStream } from '../ws/BinanceUserDataStream';
import { BINANCE_KLINE_INTERVAL } from '../constants/binance';
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

  protected async fetchAndNormalizeMarkets(): Promise<MarketBySymbol> {
    const raw = await this.httpClient.fetchExchangeInfo();

    return normalizeBinanceMarkets(raw);
  }

  protected async fetchAndNormalizeTickers(): Promise<TickerBySymbol> {
    const rawTickerList = await this.httpClient.fetchTickers();

    return normalizeBinanceTickers(rawTickerList);
  }

  protected async fetchAndNormalizeKlines(
    symbol: string,
    interval: KlineInterval,
    options?: FetchKlinesArgs,
  ): Promise<Kline[]> {
    const binanceInterval = BINANCE_KLINE_INTERVAL[interval];
    const rawKlineList = await this.httpClient.fetchKlines(symbol, binanceInterval, options);

    return normalizeBinanceKlines(rawKlineList);
  }

  protected async fetchAndNormalizeBalance(): Promise<BalanceByAsset> {
    const raw = await this.httpClient.fetchAccount();

    return normalizeBinanceBalance(raw);
  }

  async createOrderWs(args: CreateOrderWsArgs): Promise<Order> {
    this.logger.debug(`Creating order via REST: ${args.symbol}`);

    const orderParams: Record<string, unknown> = {
      symbol: args.symbol,
      side: args.side.toUpperCase(),
      type: args.type.toUpperCase(),
      quantity: this.amountToPrecision(args.symbol, args.amount),
      ...args.params,
    };

    if (args.type === 'limit') {
      if (args.price > 0) {
        orderParams.price = this.priceToPrecision(args.symbol, args.price);
      }

      if (orderParams.timeInForce === undefined) {
        orderParams.timeInForce = 'GTC';
      }
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
