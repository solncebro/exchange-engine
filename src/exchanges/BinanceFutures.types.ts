interface BinanceNoopErrorResponseData {
  code?: unknown;
  msg?: unknown;
}

interface AxiosLikeError {
  response?: {
    data?: BinanceNoopErrorResponseData;
  };
}

interface BinanceModifyOrderParams {
  [key: string]: unknown;
}

interface BinanceModifyBatchOrderParams {
  symbol: string;
  orderId?: number | string;
  origClientOrderId?: string;
  side: string;
  quantity?: string;
  price?: string;
  stopPrice?: string;
  priceMatch?: string;
}

export type { AxiosLikeError, BinanceModifyOrderParams, BinanceModifyBatchOrderParams };
