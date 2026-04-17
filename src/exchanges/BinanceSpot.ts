import type { ExchangeArgs } from '../types/exchange';
import { BinanceSpotHttpClient } from '../http/BinanceSpotHttpClient';
import { BinanceSpotPublicStream } from '../ws/BinanceSpotPublicStream';
import {
  BINANCE_KLINE_LIMIT_SPOT,
  BINANCE_SPOT_BASE_URL,
  BINANCE_DEMO_SPOT_BASE_URL,
  BINANCE_SPOT_WEBSOCKET_STREAM_URL,
  BINANCE_SPOT_TRADE_WEBSOCKET_URL,
  BINANCE_DEMO_SPOT_TRADE_WEBSOCKET_URL,
} from '../constants/binance';
import { BinanceBaseClient } from './BinanceBaseClient';
import { BaseExchangeClient } from './BaseExchangeClient';

class BinanceSpot extends BinanceBaseClient<BinanceSpotHttpClient> {
  protected readonly marketLabel = 'spot';
  protected readonly klineLimit = BINANCE_KLINE_LIMIT_SPOT;

  constructor(args: ExchangeArgs) {
    const isDemoMode = args.config.isDemoMode === true;

    const baseUrl = isDemoMode
      ? BINANCE_DEMO_SPOT_BASE_URL
      : BINANCE_SPOT_BASE_URL;

    const tradeWebSocketUrl = isDemoMode
      ? BINANCE_DEMO_SPOT_TRADE_WEBSOCKET_URL
      : BINANCE_SPOT_TRADE_WEBSOCKET_URL;

    const httpClient = new BinanceSpotHttpClient({
      baseUrl,
      apiKey: args.config.apiKey,
      secret: args.config.secret,
      logger: args.logger,
      httpsAgent: args.config.httpsAgent,
    });

    const publicStream = new BinanceSpotPublicStream({
      webSocketUrl: BINANCE_SPOT_WEBSOCKET_STREAM_URL,
      logger: args.logger,
      onNotify: BaseExchangeClient.createNotifyHandler(args.onNotify),
      label: 'Binance Spot Public WebSocket',
    });

    super({
      exchangeArgs: args,
      httpClient,
      publicStream,
      tradeWebSocketUrl,
      tradeStreamLabel: 'Binance Spot Order WebSocket',
      userDataWebSocketUrl: BINANCE_SPOT_WEBSOCKET_STREAM_URL,
    });
  }
}

export { BinanceSpot };
