import type { BinanceOrderResponseRaw } from '../normalizers/binanceNormalizer';

export interface BinanceWebSocketError {
  code: number;
  msg: string;
}

export interface BinanceWebSocketRateLimitEntry {
  rateLimitType: string;
  interval: string;
  intervalNum: number;
  limit: number;
  count: number;
}

export interface BinanceTradeWebSocketResponse {
  id: string;
  status: number;
  result?: BinanceOrderResponseRaw;
  error?: BinanceWebSocketError;
  rateLimits?: BinanceWebSocketRateLimitEntry[];
}
