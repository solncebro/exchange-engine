import type { BinancePositionRiskRaw, BinanceUserTradeRaw } from '../normalizers/binanceNormalizer';
import type { BinancePositionSettings } from '../normalizers/binanceNormalizer.types';

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

interface BinanceUserTradeHistory {
  tradeList: BinanceUserTradeRaw[];
  isComplete: boolean;
}

interface BinancePositionRiskWithSettings {
  positionRiskList: BinancePositionRiskRaw[];
  settingsBySymbol: Map<string, BinancePositionSettings>;
  symbolConfigFailureReason: string | null;
}

export type { AxiosLikeError, BinanceModifyOrderParams, BinanceModifyBatchOrderParams, BinancePositionRiskWithSettings, BinanceUserTradeHistory };
