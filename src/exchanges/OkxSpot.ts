import type { ExchangeArgs } from '../types/exchange';
import { OkxBaseClient } from './OkxBaseClient';

class OkxSpot extends OkxBaseClient {
  protected readonly marketLabel = 'spot';

  /** У спота нет режимов маржи: заявка расплачивается наличным остатком счёта. */
  protected async resolveTradeMode(): Promise<string> {
    return 'cash';
  }

  constructor(args: ExchangeArgs) {
    super({
      exchangeArgs: args,
      instType: 'SPOT',
      publicStreamLabel: 'OKX Spot Public WebSocket',
      tradeStreamLabel: 'OKX Spot Order WebSocket',
      privateStreamLabel: 'OKX Spot Private WebSocket',
      algoPrivateStreamLabel: 'OKX Spot Algo WebSocket',
    });
  }
}

export { OkxSpot };
