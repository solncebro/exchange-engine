import type {
  ExchangeClient,
  ExchangeArgs,
  CreateOrderWsArgs,
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
  Position,
  Order,
  MarginMode,
} from '../types/common';
import { BinanceSpotHttpClient } from '../http/BinanceSpotHttpClient';
import {
  normalizeBinanceMarkets,
  normalizeBinanceTickers,
  normalizeBinanceKlines,
  normalizeBinanceOrder,
  normalizeBinanceBalance,
} from '../normalizers/binanceNormalizer';
import type {
  BinanceRawExchangeInfo,
  BinanceRawTicker24hr,
  BinanceRawOrderResponse,
  BinanceRawAccount,
} from '../normalizers/binanceNormalizer';
import { BinanceSpotPublicStream } from '../ws/BinanceSpotPublicStream';
import { BinanceUserDataStream } from '../ws/BinanceUserDataStream';
import { BINANCE_KLINE_INTERVAL } from '../constants/binance';
import { amountToPrecision, priceToPrecision } from '../precision/precision';

class BinanceSpot implements ExchangeClient {
  readonly apiKey: string;
  readonly markets: MarketBySymbol = new Map();

  private httpClient: BinanceSpotHttpClient;
  private publicStream: BinanceSpotPublicStream;
  private userDataStream: BinanceUserDataStream | null = null;
  private logger: ExchangeLogger;
  private onNotify?: (message: string) => void | Promise<void>;

  constructor(args: ExchangeArgs) {
    this.apiKey = args.config.apiKey;
    this.logger = args.logger;
    this.onNotify = args.onNotify;

    this.httpClient = new BinanceSpotHttpClient(
      args.config.apiKey,
      args.config.secret,
      args.logger,
    );

    this.publicStream = new BinanceSpotPublicStream(args.logger, args.onNotify);
  }

  async loadMarkets(reload: boolean = false): Promise<MarketBySymbol> {
    if (!reload && this.markets.size > 0) {
      return this.markets;
    }

    this.logger.info('Loading spot markets');

    const raw = await this.httpClient.fetchExchangeInfo();
    const normalized = normalizeBinanceMarkets(raw as unknown as BinanceRawExchangeInfo);

    for (const [symbol, market] of normalized) {
      this.markets.set(symbol, market);
    }

    this.logger.info(`Loaded ${this.markets.size} spot markets`);

    return this.markets;
  }

  async fetchTickers(): Promise<TickerBySymbol> {
    this.logger.debug('Fetching spot tickers');
    const rawTickerList = await this.httpClient.fetchTickers();

    return normalizeBinanceTickers(rawTickerList as unknown as BinanceRawTicker24hr[]);
  }

  async fetchKlines(
    symbol: string,
    interval: KlineInterval,
    options?: FetchKlinesArgs,
  ): Promise<Kline[]> {
    this.logger.debug(`Fetching klines for ${symbol} ${interval}`);
    const binanceInterval = BINANCE_KLINE_INTERVAL[interval];
    const rawKlineList = await this.httpClient.fetchKlines(symbol, binanceInterval, {
      startTime: options?.startTime,
      endTime: options?.endTime,
      limit: options?.limit,
    });

    return normalizeBinanceKlines(rawKlineList);
  }

  async *watchTickers(): AsyncGenerator<TickerBySymbol> {
    this.publicStream.subscribeAllTickers(() => {});

    yield await this.fetchTickers();
  }

  subscribeKlines(args: SubscribeKlinesArgs): void {
    this.publicStream.subscribeKlines(args.symbol, args.interval, args.handler);
  }

  unsubscribeKlines(args: SubscribeKlinesArgs): void {
    this.publicStream.unsubscribeKlines(args.symbol, args.interval, args.handler);
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

    if (args.price > 0) {
      orderParams.price = this.priceToPrecision(args.symbol, args.price);
    }

    const raw = await this.httpClient.createOrder(orderParams);

    return normalizeBinanceOrder(raw as unknown as BinanceRawOrderResponse);
  }

  async fetchPosition(_symbol: string): Promise<Position> {
    throw new Error('Not supported for spot market');
  }

  async setLeverage(_leverage: number, _symbol: string): Promise<void> {
    throw new Error('Not supported for spot market');
  }

  async setMarginMode(_marginMode: MarginMode, _symbol: string): Promise<void> {
    throw new Error('Not supported for spot market');
  }

  async fetchBalance(): Promise<BalanceByAsset> {
    this.logger.debug('Fetching balance');
    const raw = await this.httpClient.fetchAccount();

    return normalizeBinanceBalance(raw as unknown as BinanceRawAccount);
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

  async close(): Promise<void> {
    this.logger.info('Closing Binance Spot connection');

    if (this.userDataStream) {
      this.userDataStream.close();
    }

    this.publicStream.close();
  }
}

export { BinanceSpot };
