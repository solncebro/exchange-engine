import type { KlineInterval, TickerBySymbol, WebSocketConnectionInfo } from './common';
import type { KlineHandler } from './exchange';

export interface PublicStreamLike {
  subscribeAllTickers(handler: (tickers: TickerBySymbol) => void): void;
  subscribeKlines(symbol: string, interval: KlineInterval, handler: KlineHandler): void;
  unsubscribeKlines(symbol: string, interval: KlineInterval, handler: KlineHandler): void;
  getConnectionInfoList(): WebSocketConnectionInfo[];
  close(): void;
}
