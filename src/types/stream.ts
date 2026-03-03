import type { KlineInterval, TickerBySymbol } from './common';
import type { KlineHandler } from './exchange';

export interface PublicStreamLike {
  subscribeAllTickers(handler: (tickers: TickerBySymbol) => void): void;
  subscribeKlines(symbol: string, interval: KlineInterval, handler: KlineHandler): void;
  unsubscribeKlines(symbol: string, interval: KlineInterval, handler: KlineHandler): void;
  close(): void;
}
