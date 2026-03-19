import type { CreateOrderWebSocketArgs, ExchangeArgs } from '../types/exchange';
import type { Order } from '../types/common';
import { OrderTypeEnum } from '../types/common';
import {
  BYBIT_PUBLIC_SPOT_WEBSOCKET_URL,
  BYBIT_DEMO_PUBLIC_SPOT_WEBSOCKET_URL,
} from '../constants/bybit';
import { BybitBaseClient } from './BybitBaseClient';

class BybitSpot extends BybitBaseClient {
  protected readonly marketLabel = 'spot';

  constructor(args: ExchangeArgs) {
    const isDemoMode = args.config.isDemoMode === true;
    const publicWebSocketUrl = isDemoMode ? BYBIT_DEMO_PUBLIC_SPOT_WEBSOCKET_URL : BYBIT_PUBLIC_SPOT_WEBSOCKET_URL;

    super({
      exchangeArgs: args,
      category: 'spot',
      publicWebSocketUrl,
      publicStreamLabel: '[Bybit Spot] Public',
      tradeStreamLabel: '[Bybit] Orders',
    });
  }

  async createOrderWebSocket(args: CreateOrderWebSocketArgs): Promise<Order> {
    const orderParams = this.buildBybitOrderParams(args);

    if (args.type === OrderTypeEnum.Market) {
      orderParams.marketUnit = 'baseCoin';
    }

    return this.submitOrder(orderParams, args);
  }
}

export { BybitSpot };
