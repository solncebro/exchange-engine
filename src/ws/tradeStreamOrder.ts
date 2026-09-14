import type { Order } from '../types/common';
import { OrderSideEnum, OrderTypeEnum, TimeInForceEnum } from '../types/common';

function buildMinimalTradeStreamOrder(id: string, clientOrderId: string): Order {
  return {
    id,
    clientOrderId,
    symbol: '',
    side: OrderSideEnum.Buy,
    type: OrderTypeEnum.Market,
    timeInForce: TimeInForceEnum.Gtc,
    price: 0,
    avgPrice: 0,
    stopPrice: 0,
    amount: 0,
    filledAmount: 0,
    filledQuoteAmount: 0,
    status: 'open',
    reduceOnly: false,
    timestamp: Date.now(),
    updatedTimestamp: Date.now(),
  };
}

export { buildMinimalTradeStreamOrder };
