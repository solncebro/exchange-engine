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
  normalizeBybitPosition,
  normalizeBybitBalance,
  buildBybitOrderFromCreateResponse,
} from '../normalizers/bybitNormalizer';
import { BybitPublicStream } from '../ws/BybitPublicStream';
import { BybitTradeStream } from '../ws/BybitTradeStream';
import {
  BYBIT_KLINE_INTERVAL,
  BYBIT_BASE_URL,
  BYBIT_DEMO_BASE_URL,
  BYBIT_PUBLIC_LINEAR_WS_URL,
  BYBIT_DEMO_PUBLIC_LINEAR_WS_URL,
  BYBIT_TRADE_WS_URL,
} from '../constants/bybit';
import { BaseExchangeClient } from './BaseExchangeClient';

class BybitLinear extends BaseExchangeClient {
  protected readonly marketLabel = 'linear';
  protected readonly klineLimit = 200;

  private readonly demoMode: boolean;
  private readonly httpClient: BybitHttpClient;
  private readonly publicStream: BybitPublicStream;
  private readonly tradeStream: BybitTradeStream | null;

  constructor(args: ExchangeArgs) {
    super(args);

    const demo = args.config.demoMode === true;
    this.demoMode = demo;
    const baseUrl = demo ? BYBIT_DEMO_BASE_URL : BYBIT_BASE_URL;
    const publicWsUrl = demo ? BYBIT_DEMO_PUBLIC_LINEAR_WS_URL : BYBIT_PUBLIC_LINEAR_WS_URL;

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

    if (demo) {
      this.tradeStream = null;
    } else {
      this.tradeStream = new BybitTradeStream({
        url: BYBIT_TRADE_WS_URL,
        apiKey: args.config.apiKey,
        secret: args.config.secret,
        logger: args.logger,
        onNotify: args.onNotify,
      });
    }
  }

  protected getPublicStream(): PublicStreamLike {
    return this.publicStream;
  }

  protected async fetchAndNormalizeMarkets(): Promise<MarketBySymbol> {
    const raw = await this.httpClient.fetchInstrumentsInfo('linear');

    return normalizeBybitMarkets(raw.result.list);
  }

  protected async fetchAndNormalizeTickers(): Promise<TickerBySymbol> {
    const raw = await this.httpClient.fetchTickers('linear');

    return normalizeBybitTickers(raw.result.list);
  }

  protected async fetchAndNormalizeKlines(
    symbol: string,
    interval: KlineInterval,
    options?: FetchKlinesArgs,
  ): Promise<Kline[]> {
    const bybitInterval = BYBIT_KLINE_INTERVAL[interval];
    const raw = await this.httpClient.fetchKline({
      category: 'linear',
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
    const orderParams: Record<string, unknown> = {
      category: 'linear',
      symbol: args.symbol,
      orderType: args.type === 'market' ? 'Market' : 'Limit',
      side: args.side === 'buy' ? 'Buy' : 'Sell',
      qty: this.amountToPrecision(args.symbol, args.amount),
      ...args.params,
    };

    if (args.price > 0) {
      orderParams.price = this.priceToPrecision(args.symbol, args.price);
    }

    if (this.tradeStream !== null) {
      this.logger.debug(`Creating order via WS: ${args.symbol}`);
      return this.tradeStream.createOrder(orderParams);
    }

    this.logger.debug(`Creating order via REST: ${args.symbol}`);
    const raw = await this.httpClient.createOrder(orderParams);

    return buildBybitOrderFromCreateResponse(args, raw.result.orderId);
  }

  async fetchPosition(symbol: string): Promise<Position> {
    this.logger.debug(`Fetching position for ${symbol}`);
    const raw = await this.httpClient.getPositionList('linear', { symbol });
    const position = raw.result.list[0];

    if (!position) {
      throw new Error(`Position not found for ${symbol}`);
    }

    return normalizeBybitPosition(position);
  }

  async setLeverage(leverage: number, symbol: string): Promise<void> {
    this.logger.info(`Setting leverage to ${leverage}x for ${symbol}`);
    await this.httpClient.setLeverage({ category: 'linear', symbol, buyLeverage: leverage, sellLeverage: leverage });
  }

  async setMarginMode(marginMode: MarginMode, symbol: string): Promise<void> {
    this.logger.info(`Setting margin mode to ${marginMode} for ${symbol}`);
    const tradeMode = marginMode === 'isolated' ? 1 : 0;
    const defaultLeverage = 10;

    await this.httpClient.switchIsolated({
      category: 'linear',
      symbol,
      tradeMode,
      buyLeverage: defaultLeverage,
      sellLeverage: defaultLeverage,
    });
  }

  async close(): Promise<void> {
    this.logger.info('Closing Bybit Linear connection');

    if (this.tradeStream !== null) {
      this.tradeStream.disconnect();
    }

    this.publicStream.close();
  }
}

export { BybitLinear };
