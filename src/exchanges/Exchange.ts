import type { ExchangeClient, ExchangeArgs } from '../types/exchange';
import { ExchangeName } from '../types/common';
import { BinanceFutures } from './BinanceFutures';
import { BinanceSpot } from './BinanceSpot';
import { BybitLinear } from './BybitLinear';
import { BybitSpot } from './BybitSpot';

class Exchange {
  readonly name: ExchangeName;
  readonly futures: ExchangeClient;
  readonly spot: ExchangeClient;

  constructor(name: ExchangeName, args: ExchangeArgs) {
    this.name = name;

    if (name === ExchangeName.Binance) {
      this.futures = new BinanceFutures(args);
      this.spot = new BinanceSpot(args);
    } else if (name === ExchangeName.Bybit) {
      this.futures = new BybitLinear(args);
      this.spot = new BybitSpot(args);
    } else {
      const exhaustiveCheck: never = name;

      throw new Error(`Unknown exchange: ${exhaustiveCheck}`);
    }
  }

  async close(): Promise<void> {
    await Promise.all([this.futures.close(), this.spot.close()]);
  }
}

export { Exchange };
