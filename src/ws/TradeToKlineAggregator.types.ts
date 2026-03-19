import type { Kline } from '../types/common';

export interface AggregatedKline extends Kline {
  symbol: string;
}
