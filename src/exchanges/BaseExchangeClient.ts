import type {
  ExchangeClient,
  ExchangeArgs,
  FetchKlinesArgs,
  SubscribeKlinesArgs,
} from '../types/exchange';
import type {
  ExchangeLogger,
  Kline,
  KlineInterval,
  MarketBySymbol,
  TickerBySymbol,
  BalanceByAsset,
} from '../types/common';
import type { PublicStreamLike } from '../types/stream';
import { loadKlinesInChunks } from '../utils/klineLoader';
import { amountToPrecision, priceToPrecision } from '../precision/precision';

abstract class BaseExchangeClient implements ExchangeClient {
  readonly apiKey: string;
  readonly markets: MarketBySymbol = new Map();

  protected readonly logger: ExchangeLogger;
  protected readonly onNotify?: (message: string) => void | Promise<void>;

  protected abstract readonly marketLabel: string;
  protected abstract readonly klineLimit: number;

  constructor(args: ExchangeArgs) {
    this.apiKey = args.config.apiKey;
    this.logger = args.logger;
    this.onNotify = args.onNotify;
  }

  protected abstract getPublicStream(): PublicStreamLike;
  protected abstract fetchAndNormalizeMarkets(): Promise<MarketBySymbol>;
  protected abstract fetchAndNormalizeTickers(): Promise<TickerBySymbol>;
  protected abstract fetchAndNormalizeKlines(
    symbol: string,
    interval: KlineInterval,
    options?: FetchKlinesArgs,
  ): Promise<Kline[]>;
  protected abstract fetchAndNormalizeBalance(): Promise<BalanceByAsset>;

  async loadMarkets(shouldReload: boolean = false): Promise<MarketBySymbol> {
    if (!shouldReload && this.markets.size > 0) {
      return this.markets;
    }

    this.logger.info(`Loading ${this.marketLabel} markets`);

    const normalized = await this.fetchAndNormalizeMarkets();

    for (const [symbol, market] of normalized) {
      this.markets.set(symbol, market);
    }

    this.logger.info(`Loaded ${this.markets.size} ${this.marketLabel} markets`);

    return this.markets;
  }

  async fetchTickers(): Promise<TickerBySymbol> {
    this.logger.debug(`Fetching ${this.marketLabel} tickers`);

    return this.fetchAndNormalizeTickers();
  }

  async fetchKlines(
    symbol: string,
    interval: KlineInterval,
    options?: FetchKlinesArgs,
  ): Promise<Kline[]> {
    this.logger.debug(`Fetching klines for ${symbol} ${interval}`);

    return this.fetchAndNormalizeKlines(symbol, interval, options);
  }

  async fetchAllKlines(
    symbolList: string[],
    interval: KlineInterval,
  ): Promise<Map<string, Kline[]>> {
    return loadKlinesInChunks({
      fetchKlines: (symbol) => this.fetchKlines(symbol, interval, { limit: this.klineLimit }),
      symbolList,
      logger: this.logger,
    });
  }

  async fetchBalance(): Promise<BalanceByAsset> {
    this.logger.debug('Fetching balance');

    return this.fetchAndNormalizeBalance();
  }

  async *watchTickers(): AsyncGenerator<TickerBySymbol> {
    this.getPublicStream().subscribeAllTickers(() => {});

    yield await this.fetchTickers();
  }

  subscribeKlines(args: SubscribeKlinesArgs): void {
    this.getPublicStream().subscribeKlines(args.symbol, args.interval, args.handler);
  }

  unsubscribeKlines(args: SubscribeKlinesArgs): void {
    this.getPublicStream().unsubscribeKlines(args.symbol, args.interval, args.handler);
  }

  amountToPrecision(symbol: string, amount: number): string {
    const market = this.markets.get(symbol);

    if (!market) {
      this.logger.warn(`Market ${symbol} not found, using raw amount`);

      return String(amount);
    }

    return amountToPrecision(market, amount);
  }

  priceToPrecision(symbol: string, price: number): string {
    const market = this.markets.get(symbol);

    if (!market) {
      this.logger.warn(`Market ${symbol} not found, using raw price`);

      return String(price);
    }

    return priceToPrecision(market, price);
  }

  getMinOrderQty(symbol: string): number {
    const market = this.markets.get(symbol);

    if (!market) {
      this.logger.warn(`Market ${symbol} not found, returning 0 for minOrderQty`);

      return 0;
    }

    return parseFloat(market.filter.minQty);
  }

  getMinNotional(symbol: string): number {
    const market = this.markets.get(symbol);

    if (!market) {
      this.logger.warn(`Market ${symbol} not found, returning 0 for minNotional`);

      return 0;
    }

    return parseFloat(market.filter.minNotional);
  }

  abstract createOrderWebSocket(...args: Parameters<ExchangeClient['createOrderWebSocket']>): ReturnType<ExchangeClient['createOrderWebSocket']>;
  abstract fetchPosition(...args: Parameters<ExchangeClient['fetchPosition']>): ReturnType<ExchangeClient['fetchPosition']>;
  abstract setLeverage(...args: Parameters<ExchangeClient['setLeverage']>): ReturnType<ExchangeClient['setLeverage']>;
  abstract setMarginMode(...args: Parameters<ExchangeClient['setMarginMode']>): ReturnType<ExchangeClient['setMarginMode']>;
  abstract close(): Promise<void>;
}

export { BaseExchangeClient };
