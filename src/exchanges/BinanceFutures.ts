import type { ExchangeArgs, FetchPageWithLimitArgs } from '../types/exchange';
import type { Position, Order, FundingRateHistory, FundingInfo } from '../types/common';
import { MarginModeEnum, PositionModeEnum } from '../types/common';
import { BinanceFuturesHttpClient } from '../http/BinanceFuturesHttpClient';
import {
  normalizeBinancePosition,
  normalizeBinanceOrder,
  normalizeBinanceFundingRateHistory,
  normalizeBinanceFundingInfo,
} from '../normalizers/binanceNormalizer';
import { BinanceFuturesPublicStream } from '../ws/BinanceFuturesPublicStream';
import {
  BINANCE_KLINE_LIMIT_FUTURES,
  BINANCE_FUTURES_BASE_URL,
  BINANCE_DEMO_FUTURES_BASE_URL,
  BINANCE_FUTURES_WEBSOCKET_COMBINED_URL,
  BINANCE_DEMO_FUTURES_WEBSOCKET_COMBINED_URL,
  BINANCE_FUTURES_TRADE_WEBSOCKET_URL,
  BINANCE_DEMO_FUTURES_TRADE_WEBSOCKET_URL,
} from '../constants/binance';
import { BinanceBaseClient } from './BinanceBaseClient';

class BinanceFutures extends BinanceBaseClient<BinanceFuturesHttpClient> {
  protected readonly marketLabel = 'futures';
  protected readonly klineLimit = BINANCE_KLINE_LIMIT_FUTURES;

  constructor(args: ExchangeArgs) {
    const isDemoMode = args.config.isDemoMode === true;

    const baseUrl = isDemoMode
      ? BINANCE_DEMO_FUTURES_BASE_URL
      : BINANCE_FUTURES_BASE_URL;

    const webSocketCombinedUrl = isDemoMode
      ? BINANCE_DEMO_FUTURES_WEBSOCKET_COMBINED_URL
      : BINANCE_FUTURES_WEBSOCKET_COMBINED_URL;

    const tradeWebSocketUrl = isDemoMode
      ? BINANCE_DEMO_FUTURES_TRADE_WEBSOCKET_URL
      : BINANCE_FUTURES_TRADE_WEBSOCKET_URL;

    const httpClient = new BinanceFuturesHttpClient({
      baseUrl,
      apiKey: args.config.apiKey,
      secret: args.config.secret,
      logger: args.logger,
      httpsAgent: args.config.httpsAgent,
    });

    const publicStream = new BinanceFuturesPublicStream({
      webSocketCombinedUrl,
      logger: args.logger,
      onNotify: args.onNotify,
      label: '[Binance Futures] Public',
    });

    super({
      exchangeArgs: args,
      httpClient,
      publicStream,
      tradeWebSocketUrl,
      tradeStreamLabel: '[Binance Futures] Orders',
    });
  }

  async fetchFundingRateHistory(
    symbol: string,
    options?: FetchPageWithLimitArgs,
  ): Promise<FundingRateHistory[]> {
    this.logger.debug(`Fetching funding rate history for ${symbol}`);
    const raw = await this.httpClient.fetchFundingRateHistory(symbol, options);

    return normalizeBinanceFundingRateHistory(raw);
  }

  async fetchFundingInfo(symbol?: string): Promise<FundingInfo[]> {
    this.logger.debug('Fetching funding info');
    const raw = await this.httpClient.fetchFundingInfo(symbol);

    return normalizeBinanceFundingInfo(raw);
  }

  async fetchPositionMode(): Promise<PositionModeEnum> {
    this.logger.debug('Fetching position mode');
    const raw = await this.httpClient.fetchPositionMode();

    return raw.dualSidePosition === true ? PositionModeEnum.Hedge : PositionModeEnum.OneWay;
  }

  async fetchPosition(symbol: string): Promise<Position> {
    this.logger.debug(`Fetching position for ${symbol}`);
    const rawPositionList = await this.httpClient.fetchPositionRisk(symbol);
    const position = rawPositionList.find((p) => p.symbol === symbol);

    if (!position) {
      throw new Error(`Position not found for ${symbol}`);
    }

    return normalizeBinancePosition(position);
  }

  async setLeverage(leverage: number, symbol: string): Promise<void> {
    this.logger.info(`Setting leverage to ${leverage}x for ${symbol}`);
    await this.httpClient.setLeverage(symbol, leverage);
  }

  async setMarginMode(marginMode: MarginModeEnum, symbol: string): Promise<void> {
    this.logger.info(`Setting margin mode to ${marginMode} for ${symbol}`);
    const marginType = marginMode === MarginModeEnum.Isolated ? 'ISOLATED' : 'CROSSED';
    await this.httpClient.setMarginType(symbol, marginType);
  }

  async fetchOrderHistory(symbol: string, options?: FetchPageWithLimitArgs): Promise<Order[]> {
    this.logger.debug(`Fetching order history for ${symbol}`);
    const rawList = await this.httpClient.getAllOrders(symbol, options);

    return rawList.map(normalizeBinanceOrder);
  }
}

export { BinanceFutures };
