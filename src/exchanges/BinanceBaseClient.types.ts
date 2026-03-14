import type { ExchangeArgs } from '../types/exchange';
import type { PublicStreamLike } from '../types/stream';
import type { BinanceBaseHttpClient } from '../http/BinanceBaseHttpClient';

export interface BinanceBaseClientArgs<T extends BinanceBaseHttpClient> {
  exchangeArgs: ExchangeArgs;
  httpClient: T;
  publicStream: PublicStreamLike;
  tradeWebSocketUrl: string;
}
