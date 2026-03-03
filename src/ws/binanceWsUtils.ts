import type { KlineInterval } from '../types/common';
import { BINANCE_KLINE_INTERVAL } from '../constants/binance';

function resolveUnifiedBinanceInterval(binanceInterval: string): KlineInterval {
  for (const [unified, binance] of Object.entries(BINANCE_KLINE_INTERVAL)) {
    if (binance === binanceInterval) {
      return unified as KlineInterval;
    }
  }

  return '1m';
}

export { resolveUnifiedBinanceInterval };
