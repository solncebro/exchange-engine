import type { KlineInterval, MarkPriceHandler, OrderBookHandler, PublicTradeHandler, TickerBySymbol, WebSocketConnectionInfo } from './common';
import type { KlineHandler } from './exchange';

export interface PublicStreamLike {
  subscribeAllTickers(handler: (tickers: TickerBySymbol) => void, symbolList: string[]): void;
  unsubscribeAllTickers?(handler: (tickers: TickerBySymbol) => void): void;
  subscribeMarkPrices(handler: MarkPriceHandler, symbolList: string[]): void;
  unsubscribeMarkPrices(handler: MarkPriceHandler): void;
  subscribeKlines(symbol: string, interval: KlineInterval, handler: KlineHandler): void;
  unsubscribeKlines(symbol: string, interval: KlineInterval, handler: KlineHandler): void;
  subscribeOrderbook?(symbol: string, depth: number, handler: OrderBookHandler): void;
  unsubscribeOrderbook?(symbol: string, depth: number, handler: OrderBookHandler): void;
  subscribePublicTrades?(symbol: string, handler: PublicTradeHandler): void;
  unsubscribePublicTrades?(symbol: string, handler: PublicTradeHandler): void;
  resubscribeStream?(symbol: string, interval: string): void;
  resubscribeOrderbook?(symbol: string, depth: number): void;
  resubscribePublicTrades?(symbol: string): void;
  resubscribeMarkPrices?(): void;
  getConnectionInfoList(): WebSocketConnectionInfo[];
  awaitConnectionsReady?(): Promise<void>;
  close(): void;
}
