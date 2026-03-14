import type { BinanceOrderResponseRaw } from '../normalizers/binanceNormalizer';

export interface BinanceWebSocketError {
  code: number;
  msg: string;
}

export interface BinanceTradeWebSocketResponse {
  id: string;
  status: number;
  result?: BinanceOrderResponseRaw;
  error?: BinanceWebSocketError;
}
