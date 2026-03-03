import type { CreateOrderWsArgs, ExchangeArgs, FetchKlinesArgs } from '../types/exchange';
import type {
  Kline,
  KlineInterval,
  MarketBySymbol,
  TickerBySymbol,
  BalanceByAsset,
  Position,
  Order,
  MarginMode,
} from '../types/common';
import type { PublicStreamLike } from '../types/stream';
import { BybitHttpClient } from '../http/BybitHttpClient';
import {
  normalizeBybitMarkets,
  normalizeBybitTickers,
  normalizeBybitKlines,
  normalizeBybitBalance,
  buildBybitOrderFromCreateResponse,
} from '../normalizers/bybitNormalizer';
import { BybitPublicStream } from '../ws/BybitPublicStream';
import {
  BYBIT_KLINE_INTERVAL,
  BYBIT_BASE_URL,
  BYBIT_DEMO_BASE_URL,
  BYBIT_PUBLIC_SPOT_WS_URL,
  BYBIT_DEMO_PUBLIC_SPOT_WS_URL,
} from '../constants/bybit';
import { BaseExchangeClient } from './BaseExchangeClient';

class BybitSpot extends BaseExchangeClient {
  protected readonly marketLabel = 'spot';
  protected readonly klineLimit = 200;

  private readonly httpClient: BybitHttpClient;
  private readonly publicStream: BybitPublicStream;

  constructor(args: ExchangeArgs) {
    super(args);

    const demo = args.config.demoMode === true;
    const baseUrl = demo ? BYBIT_DEMO_BASE_URL : BYBIT_BASE_URL;
    const publicWsUrl = demo ? BYBIT_DEMO_PUBLIC_SPOT_WS_URL : BYBIT_PUBLIC_SPOT_WS_URL;

    this.httpClient = new BybitHttpClient({
      baseUrl,
      apiKey: args.config.apiKey,
      secret: args.config.secret,
      logger: args.logger,
    });

    this.publicStream = new BybitPublicStream(
      publicWsUrl,
      args.logger,
      args.onNotify,
    );
  }

  protected getPublicStream(): PublicStreamLike {
    return this.publicStream;
  }

  protected async fetchAndNormalizeMarkets(): Promise<MarketBySymbol> {
    const raw = await this.httpClient.fetchInstrumentsInfo('spot');

    return normalizeBybitMarkets(raw.result.list);
  }

  protected async fetchAndNormalizeTickers(): Promise<TickerBySymbol> {
    const raw = await this.httpClient.fetchTickers('spot');

    return normalizeBybitTickers(raw.result.list);
  }

  protected async fetchAndNormalizeKlines(
    symbol: string,
    interval: KlineInterval,
    options?: FetchKlinesArgs,
  ): Promise<Kline[]> {
    const bybitInterval = BYBIT_KLINE_INTERVAL[interval];
    const raw = await this.httpClient.fetchKline({
      category: 'spot',
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

  async createOrderWs(args: CreateOrderWsArgs): Promise<Order> {
    this.logger.debug(`Creating order via REST: ${args.symbol}`);

    const isMarket = args.type === 'market';

    const orderParams: Record<string, unknown> = {
      category: 'spot',
      symbol: args.symbol,
      orderType: isMarket ? 'Market' : 'Limit',
      side: args.side === 'buy' ? 'Buy' : 'Sell',
      qty: this.amountToPrecision(args.symbol, args.amount),
      ...args.params,
    };

    if (isMarket) {
      orderParams.marketUnit = 'baseCoin';
    }

    if (args.price > 0) {
      orderParams.price = this.priceToPrecision(args.symbol, args.price);
    }

    const raw = await this.httpClient.createOrder(orderParams);

    return buildBybitOrderFromCreateResponse(args, raw.result.orderId);
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

  async close(): Promise<void> {
    this.logger.info('Closing Bybit Spot connection');

    this.publicStream.close();
  }
}

export { BybitSpot };
