import type { ExchangeClient, ExchangeArgs } from '../types/exchange';
import { ExchangeNameEnum } from '../types/common';
import { BinanceFutures } from './BinanceFutures';
import { BinanceSpot } from './BinanceSpot';
import { BybitLinear } from './BybitLinear';
import { BybitSpot } from './BybitSpot';

class Exchange {
  readonly name: ExchangeNameEnum;
  readonly futures: ExchangeClient;
  readonly spot: ExchangeClient;

  constructor(name: ExchangeNameEnum, args: ExchangeArgs) {
    this.name = name;

    if (name === ExchangeNameEnum.Binance) {
      this.futures = new BinanceFutures(args);
      this.spot = new BinanceSpot(args);
    } else if (name === ExchangeNameEnum.Bybit) {
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
