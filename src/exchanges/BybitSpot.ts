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
import { BybitHttpClient } from '../http/BybitHttpClient';
import {
  normalizeBybitMarkets,
  normalizeBybitTickers,
  normalizeBybitKlines,
  normalizeBybitOrder,
  normalizeBybitBalance,
} from '../normalizers/bybitNormalizer';
import type {
  BybitRawInstrumentInfo,
  BybitRawTicker,
  BybitRawOrderResponse,
  BybitRawWalletBalance,
} from '../normalizers/bybitNormalizer';
import { BybitPublicStream } from '../ws/BybitPublicStream';
import { BYBIT_KLINE_INTERVAL, BYBIT_PUBLIC_SPOT_WS_URL } from '../constants/bybit';
import { amountToPrecision, priceToPrecision } from '../precision/precision';

class BybitSpot implements ExchangeClient {
  readonly apiKey: string;
  readonly markets: MarketBySymbol = new Map();

  private httpClient: BybitHttpClient;
  private publicStream: BybitPublicStream;
  private logger: ExchangeLogger;
  private onNotify?: (message: string) => void | Promise<void>;

  constructor(args: ExchangeArgs) {
    this.apiKey = args.config.apiKey;
    this.logger = args.logger;
    this.onNotify = args.onNotify;

    this.httpClient = new BybitHttpClient(
      args.config.apiKey,
      args.config.secret,
      args.logger,
    );

    this.publicStream = new BybitPublicStream(
      BYBIT_PUBLIC_SPOT_WS_URL,
      args.logger,
      args.onNotify,
    );
  }

  async loadMarkets(reload: boolean = false): Promise<MarketBySymbol> {
    if (!reload && this.markets.size > 0) {
      return this.markets;
    }

    this.logger.info('Loading spot markets');

    const raw = await this.httpClient.fetchInstrumentsInfo('spot');
    const normalized = normalizeBybitMarkets(
      raw.result.list as unknown as BybitRawInstrumentInfo[],
    );

    for (const [symbol, market] of normalized) {
      this.markets.set(symbol, market);
    }

    this.logger.info(`Loaded ${this.markets.size} spot markets`);

    return this.markets;
  }

  async fetchTickers(): Promise<TickerBySymbol> {
    this.logger.debug('Fetching spot tickers');
    const raw = await this.httpClient.fetchTickers('spot');

    return normalizeBybitTickers(raw.result.list as unknown as BybitRawTicker[]);
  }

  async fetchKlines(
    symbol: string,
    interval: KlineInterval,
    options?: FetchKlinesArgs,
  ): Promise<Kline[]> {
    this.logger.debug(`Fetching klines for ${symbol} ${interval}`);
    const bybitInterval = BYBIT_KLINE_INTERVAL[interval];
    const raw = await this.httpClient.fetchKline('spot', symbol, bybitInterval, {
      startTime: options?.startTime,
      endTime: options?.endTime,
      limit: options?.limit,
    });

    return normalizeBybitKlines(raw.result.list);
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
      category: 'spot',
      symbol: args.symbol,
      orderType: args.type === 'market' ? 'Market' : 'Limit',
      side: args.side === 'buy' ? 'Buy' : 'Sell',
      qty: this.amountToPrecision(args.symbol, args.amount),
      ...args.params,
    };

    if (args.price > 0) {
      orderParams.price = this.priceToPrecision(args.symbol, args.price);
    }

    const raw = await this.httpClient.createOrder(orderParams);

    return normalizeBybitOrder(raw.result as unknown as BybitRawOrderResponse);
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
    const raw = await this.httpClient.fetchWalletBalance('UNIFIED');

    return normalizeBybitBalance(raw.result as unknown as BybitRawWalletBalance);
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
    this.logger.info('Closing Bybit Spot connection');

    this.publicStream.close();
  }
}

export { BybitSpot };
