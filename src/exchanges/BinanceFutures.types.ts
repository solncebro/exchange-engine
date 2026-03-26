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

export type { AxiosLikeError, BinanceModifyOrderParams };
