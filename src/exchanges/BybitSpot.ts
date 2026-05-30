import type { CreateOrderWebSocketArgs, ExchangeArgs } from '../types/exchange';
import type { Order } from '../types/common';
import { MarketUnitEnum, OrderTypeEnum } from '../types/common';
import {
  BYBIT_PUBLIC_SPOT_WEBSOCKET_URL,
  BYBIT_DEMO_PUBLIC_SPOT_WEBSOCKET_URL,
  BYBIT_SPOT_BATCH_CHUNK_SIZE,
} from '../constants/bybit';
import { BybitBaseClient } from './BybitBaseClient';

class BybitSpot extends BybitBaseClient {
  protected readonly marketLabel = 'spot';
  protected readonly batchChunkSize = BYBIT_SPOT_BATCH_CHUNK_SIZE;

  constructor(args: ExchangeArgs) {
    const isDemoMode = args.config.isDemoMode === true;
    const publicWebSocketUrl = isDemoMode ? BYBIT_DEMO_PUBLIC_SPOT_WEBSOCKET_URL : BYBIT_PUBLIC_SPOT_WEBSOCKET_URL;

    super({
      exchangeArgs: args,
      category: 'spot',
      publicWebSocketUrl,
      publicStreamLabel: 'Bybit Spot Public WebSocket',
      tradeStreamLabel: 'Bybit Spot Order WebSocket',
    });
  }

  async createOrderWebSocket(args: CreateOrderWebSocketArgs): Promise<Order> {
    const orderParams = this.buildBybitOrderParams(args);

    if (args.type === OrderTypeEnum.Market && orderParams.marketUnit === undefined && args.quoteOrderQty === undefined) {
      orderParams.marketUnit = MarketUnitEnum.BaseCoin;
    }

    return this.submitOrder(orderParams, args);
  }
}

export { BybitSpot };
