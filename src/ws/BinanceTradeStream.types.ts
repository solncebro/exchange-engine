import type { BinanceOrderResponseRaw, BinanceAlgoOrderRaw } from '../normalizers/binanceNormalizer';

/**
 * Ответ на отмену условной заявки — короткая расписка, а не снимок заявки, как у обычной
 * отмены. Успех подтверждается ВЛОЖЕННЫМ полем code (строка "200"), внешнего status мало.
 */
export interface BinanceAlgoOrderCancelAckRaw {
  algoId: number | string;
  clientAlgoId: string;
  code: string;
  msg: string;
}

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
  result?: BinanceOrderResponseRaw | BinanceAlgoOrderRaw | BinanceAlgoOrderCancelAckRaw;
  error?: BinanceWebSocketError;
  rateLimits?: BinanceWebSocketRateLimitEntry[];
}
