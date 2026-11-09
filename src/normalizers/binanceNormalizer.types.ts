import type { BinanceUserTradeRaw } from './binanceNormalizer';
import type { MarginModeEnum } from '../types/common';

export interface BinancePositionSettings {
  leverage: number;
  marginMode: MarginModeEnum;
}

export interface BinanceClosingGroup {
  fillList: BinanceUserTradeRaw[];
  openingCommission: number;
  closingCommission: number;
  isTradingFeeComplete: boolean;
}

export interface BinanceOpeningPool {
  isTradingFeeComplete: boolean;
  commission: number;
  quantity: number;
}

