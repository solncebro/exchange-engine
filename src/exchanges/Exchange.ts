import type { ExchangeClient, ExchangeArgs, SubAccountClient } from '../types/exchange';
import type { WebSocketConnectionInfo } from '../types/common';
import { ExchangeNameEnum } from '../types/common';
import { BinanceFutures } from './BinanceFutures';
import { BinanceSpot } from './BinanceSpot';
import { BybitLinear } from './BybitLinear';
import { BybitSpot } from './BybitSpot';
import { OkxSwap } from './OkxSwap';
import { OkxSpot } from './OkxSpot';
import { BinanceSubAccount } from './BinanceSubAccount';
import { BybitSubAccount } from './BybitSubAccount';
import { UnsupportedSubAccount } from './UnsupportedSubAccount';

class Exchange {
  readonly name: ExchangeNameEnum;
  readonly futures: ExchangeClient;
  readonly spot: ExchangeClient;
  /**
   * Подсчёты главного счёта — уровень СЧЁТА, а не рынка: ключ один на спот и фьючерсы, а перевод
   * не принадлежит ни одному рынку. В демо-режиме и на OKX — отказ с объяснением: демо-службы
   * Binance и Bybit этих входов не обслуживают, OKX не реализован.
   */
  readonly subAccount: SubAccountClient;

  constructor(name: ExchangeNameEnum, args: ExchangeArgs) {
    this.name = name;

    if (name === ExchangeNameEnum.Binance) {
      this.futures = new BinanceFutures(args);
      this.spot = new BinanceSpot(args);
      this.subAccount = Exchange.createSubAccountClient(args, () => new BinanceSubAccount(args), 'binance');
    } else if (name === ExchangeNameEnum.Bybit) {
      this.futures = new BybitLinear(args);
      this.spot = new BybitSpot(args);
      this.subAccount = Exchange.createSubAccountClient(args, () => new BybitSubAccount(args), 'bybit');
    } else if (name === ExchangeNameEnum.Okx) {
      this.futures = new OkxSwap(args);
      this.spot = new OkxSpot(args);
      this.subAccount = new UnsupportedSubAccount({ exchange: 'okx', reason: 'not implemented for OKX' });
    } else {
      const exhaustiveCheck: never = name;

      throw new Error(`Unknown exchange: ${exhaustiveCheck}`);
    }
  }

  private static createSubAccountClient(
    args: ExchangeArgs,
    createLiveClient: () => SubAccountClient,
    exchange: string,
  ): SubAccountClient {
    if (args.config.isDemoMode === true) {
      return new UnsupportedSubAccount({ exchange, reason: 'the demo trading service does not serve sub-account endpoints' });
    }

    return createLiveClient();
  }

  getWebSocketConnectionInfoList(): WebSocketConnectionInfo[] {
    return [
      ...this.futures.getWebSocketConnectionInfoList(),
      ...this.spot.getWebSocketConnectionInfoList(),
    ];
  }

  async close(): Promise<void> {
    await Promise.allSettled([this.futures.close(), this.spot.close()]);
  }
}

export { Exchange };
