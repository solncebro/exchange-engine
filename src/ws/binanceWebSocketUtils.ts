import type { KlineInterval } from '../types/common';

function resolveUnifiedBinanceInterval(binanceInterval: string): KlineInterval {
  return binanceInterval as KlineInterval;
}

export { resolveUnifiedBinanceInterval };
