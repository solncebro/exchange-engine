import type { ExchangeArgs } from '../types/exchange';
import type { Position } from '../types/common';
import { MarginMode } from '../types/common';
import { BinanceFuturesHttpClient } from '../http/BinanceFuturesHttpClient';
import { normalizeBinancePosition } from '../normalizers/binanceNormalizer';
import { BinanceFuturesPublicStream } from '../ws/BinanceFuturesPublicStream';
import {
  BINANCE_KLINE_LIMIT_FUTURES,
  BINANCE_FUTURES_BASE_URL,
  BINANCE_DEMO_FUTURES_BASE_URL,
  BINANCE_FUTURES_WEBSOCKET_COMBINED_URL,
  BINANCE_DEMO_FUTURES_WEBSOCKET_COMBINED_URL,
} from '../constants/binance';
import { BinanceBaseClient } from './BinanceBaseClient';

class BinanceFutures extends BinanceBaseClient<BinanceFuturesHttpClient> {
  protected readonly marketLabel = 'futures';
  protected readonly klineLimit = BINANCE_KLINE_LIMIT_FUTURES;

  constructor(args: ExchangeArgs) {
    const baseUrl = args.config.isDemoMode === true
      ? BINANCE_DEMO_FUTURES_BASE_URL
      : BINANCE_FUTURES_BASE_URL;

    const webSocketCombinedUrl = args.config.isDemoMode === true
      ? BINANCE_DEMO_FUTURES_WEBSOCKET_COMBINED_URL
      : BINANCE_FUTURES_WEBSOCKET_COMBINED_URL;

    const httpClient = new BinanceFuturesHttpClient({
      baseUrl,
      apiKey: args.config.apiKey,
      secret: args.config.secret,
      logger: args.logger,
    });

    const publicStream = new BinanceFuturesPublicStream(webSocketCombinedUrl, args.logger, args.onNotify);

    super(args, httpClient, publicStream);
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

  async setMarginMode(marginMode: MarginMode, symbol: string): Promise<void> {
    this.logger.info(`Setting margin mode to ${marginMode} for ${symbol}`);
    const marginType = marginMode === MarginMode.Isolated ? 'ISOLATED' : 'CROSSED';
    await this.httpClient.setMarginType(symbol, marginType);
  }
}

export { BinanceFutures };
