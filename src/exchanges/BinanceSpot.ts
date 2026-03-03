import type { ExchangeArgs } from '../types/exchange';
import type { Position, MarginMode } from '../types/common';
import { BinanceSpotHttpClient } from '../http/BinanceSpotHttpClient';
import { BinanceSpotPublicStream } from '../ws/BinanceSpotPublicStream';
import {
  BINANCE_KLINE_LIMIT_SPOT,
  BINANCE_SPOT_BASE_URL,
  BINANCE_DEMO_SPOT_BASE_URL,
  BINANCE_SPOT_WS_STREAM_URL,
} from '../constants/binance';
import { BinanceBaseClient } from './BinanceBaseClient';

class BinanceSpot extends BinanceBaseClient<BinanceSpotHttpClient> {
  protected readonly marketLabel = 'spot';
  protected readonly klineLimit = BINANCE_KLINE_LIMIT_SPOT;

  constructor(args: ExchangeArgs) {
    const baseUrl = args.config.demoMode === true
      ? BINANCE_DEMO_SPOT_BASE_URL
      : BINANCE_SPOT_BASE_URL;

    const httpClient = new BinanceSpotHttpClient({
      baseUrl,
      apiKey: args.config.apiKey,
      secret: args.config.secret,
      logger: args.logger,
    });

    const publicStream = new BinanceSpotPublicStream(BINANCE_SPOT_WS_STREAM_URL, args.logger, args.onNotify);

    super(args, httpClient, publicStream);
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
}

export { BinanceSpot };
