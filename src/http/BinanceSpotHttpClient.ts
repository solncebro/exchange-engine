import type { BinanceEndpoints, BinanceHttpClientArgs } from './BinanceBaseHttpClient';
import { BinanceBaseHttpClient } from './BinanceBaseHttpClient';
import { BINANCE_REQUEST_TIMEOUT } from '../constants/binance';

export class BinanceSpotHttpClient extends BinanceBaseHttpClient {
  protected readonly endpoints: BinanceEndpoints = {
    exchangeInfo: '/api/v3/exchangeInfo',
    ticker24hr: '/api/v3/ticker/24hr',
    depth: '/api/v3/depth',
    klines: '/api/v3/klines',
    trades: '/api/v3/trades',
    order: '/api/v3/order',
    openOrders: '/api/v3/openOrders',
    allOrders: '/api/v3/allOrders',
    account: '/api/v3/account',
    listenKey: '/api/v3/userDataStream',
  };

  constructor(args: BinanceHttpClientArgs) {
    super(args, BINANCE_REQUEST_TIMEOUT);
  }
}
