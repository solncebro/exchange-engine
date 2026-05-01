import type { KlineInterval, MarkPriceHandler, TickerBySymbol, WebSocketConnectionInfo } from './common';
import type { KlineHandler } from './exchange';

export interface PublicStreamLike {
  subscribeAllTickers(handler: (tickers: TickerBySymbol) => void): void;
  unsubscribeAllTickers?(handler: (tickers: TickerBySymbol) => void): void;
  subscribeMarkPrices(handler: MarkPriceHandler): void;
  unsubscribeMarkPrices(handler: MarkPriceHandler): void;
  subscribeKlines(symbol: string, interval: KlineInterval, handler: KlineHandler): void;
  unsubscribeKlines(symbol: string, interval: KlineInterval, handler: KlineHandler): void;
  resubscribeStream?(symbol: string, interval: string): void;
  getConnectionInfoList(): WebSocketConnectionInfo[];
  awaitConnectionsReady?(): Promise<void>;
  close(): void;
}
