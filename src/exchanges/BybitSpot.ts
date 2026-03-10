import type { CreateOrderWebSocketArgs, ExchangeArgs, FetchPageWithLimitArgs } from '../types/exchange';
import type {
  Kline,
  KlineInterval,
  TradeSymbolBySymbol,
  TickerBySymbol,
  BalanceByAsset,
  Position,
  Order,
  FundingRateHistory,
  FundingInfo,
} from '../types/common';
import { OrderType, OrderSide, MarginMode, PositionMode } from '../types/common';
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
import {
  BYBIT_KLINE_INTERVAL,
  BYBIT_BASE_URL,
  BYBIT_DEMO_BASE_URL,
  BYBIT_PUBLIC_SPOT_WEBSOCKET_URL,
  BYBIT_DEMO_PUBLIC_SPOT_WEBSOCKET_URL,
} from '../constants/bybit';
import { BaseExchangeClient } from './BaseExchangeClient';

class BybitSpot extends BaseExchangeClient {
  protected readonly marketLabel = 'spot';
  protected readonly klineLimit = 200;

  private readonly httpClient: BybitHttpClient;
  private readonly publicStream: BybitPublicStream;

  constructor(args: ExchangeArgs) {
    super(args);

    const isDemoMode = args.config.isDemoMode === true;
    const baseUrl = isDemoMode ? BYBIT_DEMO_BASE_URL : BYBIT_BASE_URL;
    const publicWebSocketUrl = isDemoMode ? BYBIT_DEMO_PUBLIC_SPOT_WEBSOCKET_URL : BYBIT_PUBLIC_SPOT_WEBSOCKET_URL;

    this.httpClient = new BybitHttpClient({
      baseUrl,
      apiKey: args.config.apiKey,
      secret: args.config.secret,
      logger: args.logger,
    });

    this.publicStream = new BybitPublicStream(
      publicWebSocketUrl,
      args.logger,
      args.onNotify,
    );
  }

  protected getPublicStream(): PublicStreamLike {
    return this.publicStream;
  }

  protected async fetchAndNormalizeTradeSymbols(): Promise<TradeSymbolBySymbol> {
    const raw = await this.httpClient.fetchInstrumentsInfo('spot');

    return normalizeBybitTradeSymbols(raw.result.list);
  }

  protected async fetchAndNormalizeTickers(): Promise<TickerBySymbol> {
    const raw = await this.httpClient.fetchTickers('spot');

    return normalizeBybitTickers(raw.result.list);
  }

  protected async fetchAndNormalizeKlines(
    symbol: string,
    interval: KlineInterval,
    options?: FetchPageWithLimitArgs,
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

  async createOrderWebSocket(args: CreateOrderWebSocketArgs): Promise<Order> {
    this.logger.debug(`Creating order via REST: ${args.symbol}`);

    const isMarket = args.type === OrderType.Market;

    const orderParams: Record<string, unknown> = {
      category: 'spot',
      symbol: args.symbol,
      orderType: isMarket ? 'Market' : 'Limit',
      side: args.side === OrderSide.Buy ? 'Buy' : 'Sell',
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

  async fetchFundingRateHistory(): Promise<FundingRateHistory[]> {
    throw new Error('Not supported for spot market');
  }

  async fetchFundingInfo(): Promise<FundingInfo[]> {
    throw new Error('Not supported for spot market');
  }

  async fetchPositionMode(): Promise<PositionMode> {
    throw new Error('Not supported for spot market');
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
