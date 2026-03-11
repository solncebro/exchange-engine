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
import { MarginModeEnum, OrderTypeEnum, OrderSideEnum, PositionModeEnum } from '../types/common';
import type { PublicStreamLike } from '../types/stream';
import { BybitHttpClient } from '../http/BybitHttpClient';
import {
  normalizeBybitTradeSymbols,
  normalizeBybitTickers,
  normalizeBybitKlines,
  normalizeBybitPosition,
  normalizeBybitOrder,
  normalizeBybitBalance,
  buildBybitOrderFromCreateResponse,
} from '../normalizers/bybitNormalizer';
import { BybitPublicStream } from '../ws/BybitPublicStream';
import { BybitTradeStream } from '../ws/BybitTradeStream';
import {
  BYBIT_KLINE_INTERVAL,
  BYBIT_BASE_URL,
  BYBIT_DEMO_BASE_URL,
  BYBIT_PUBLIC_LINEAR_WEBSOCKET_URL,
  BYBIT_DEMO_PUBLIC_LINEAR_WEBSOCKET_URL,
  BYBIT_TRADE_WEBSOCKET_URL,
} from '../constants/bybit';
import { BaseExchangeClient } from './BaseExchangeClient';

class BybitLinear extends BaseExchangeClient {
  protected readonly marketLabel = 'linear';
  protected readonly klineLimit = 200;

  private readonly isDemoMode: boolean;
  private readonly httpClient: BybitHttpClient;
  private readonly publicStream: BybitPublicStream;
  private readonly tradeStream: BybitTradeStream | null;

  constructor(args: ExchangeArgs) {
    super(args);

    const isDemoMode = args.config.isDemoMode === true;
    this.isDemoMode = isDemoMode;
    const baseUrl = isDemoMode ? BYBIT_DEMO_BASE_URL : BYBIT_BASE_URL;
    const publicWebSocketUrl = isDemoMode ? BYBIT_DEMO_PUBLIC_LINEAR_WEBSOCKET_URL : BYBIT_PUBLIC_LINEAR_WEBSOCKET_URL;

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

    if (isDemoMode) {
      this.tradeStream = null;
    } else {
      this.tradeStream = new BybitTradeStream({
        url: BYBIT_TRADE_WEBSOCKET_URL,
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

  protected async fetchAndNormalizeTradeSymbols(): Promise<TradeSymbolBySymbol> {
    const raw = await this.httpClient.fetchInstrumentsInfo('linear');

    return normalizeBybitTradeSymbols(raw.result.list);
  }

  protected async fetchAndNormalizeTickers(): Promise<TickerBySymbol> {
    const raw = await this.httpClient.fetchTickers('linear');

    return normalizeBybitTickers(raw.result.list);
  }

  protected async fetchAndNormalizeKlines(
    symbol: string,
    interval: KlineInterval,
    options?: FetchPageWithLimitArgs,
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

  async createOrderWebSocket(args: CreateOrderWebSocketArgs): Promise<Order> {
    const isMarket = args.type === OrderTypeEnum.Market;
    const bybitOrderType = isMarket ? 'Market' : 'Limit';

    const orderParams: Record<string, unknown> = {
      category: 'linear',
      symbol: args.symbol,
      orderType: bybitOrderType,
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

    if (this.tradeStream !== null) {
      this.logger.debug(`Creating order via WebSocket: ${args.symbol}`);

      return this.tradeStream.createOrder(orderParams);
    }

    this.logger.debug(`Creating order via REST: ${args.symbol}`);
    const raw = await this.httpClient.createOrder(orderParams);

    return buildBybitOrderFromCreateResponse(args, raw.result.orderId);
  }

  async fetchOrderHistory(symbol: string, options?: FetchPageWithLimitArgs): Promise<Order[]> {
    this.logger.debug(`Fetching order history for ${symbol}`);
    const raw = await this.httpClient.getOrderHistory('linear', { symbol, limit: options?.limit });
    const rawList = raw.result.list;

    return rawList.map(normalizeBybitOrder);
  }

  async fetchFundingRateHistory(): Promise<FundingRateHistory[]> {
    throw new Error('Not implemented for Bybit');
  }

  async fetchFundingInfo(): Promise<FundingInfo[]> {
    throw new Error('Not implemented for Bybit');
  }

  async fetchPositionMode(): Promise<PositionModeEnum> {
    throw new Error('Not implemented for Bybit');
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

  async setMarginMode(marginMode: MarginModeEnum, symbol: string): Promise<void> {
    this.logger.info(`Setting margin mode to ${marginMode} for ${symbol}`);
    const tradeMode = marginMode === MarginModeEnum.Isolated ? 1 : 0;
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
