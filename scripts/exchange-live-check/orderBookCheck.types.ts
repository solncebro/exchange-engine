import type { BybitApiResponse, BybitOrderBookRaw } from '../../src/http/BybitHttpClient.types';
import type { OrderBookLevel } from '../../src/types/common';

export interface BybitOrderBookEnvelopeRaw extends BybitApiResponse {
  result: BybitOrderBookRaw;
}

export interface RawOrderBookInCoins {
  bidList: OrderBookLevel[];
  askList: OrderBookLevel[];
  coinsPerRawUnit: number;
}
