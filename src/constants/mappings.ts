import { PositionSide, OrderSide, OrderType } from '../types/common';

export const BINANCE_POSITION_SIDE: Record<string, PositionSide> = {
  LONG: PositionSide.Long,
  SHORT: PositionSide.Short,
  BOTH: PositionSide.Both,
};

export const BYBIT_POSITION_SIDE: Record<string, PositionSide> = {
  Buy: PositionSide.Long,
  Sell: PositionSide.Short,
};

export const BYBIT_ORDER_STATUS: Record<string, string> = {
  New: 'open',
  PartiallyFilled: 'open',
  Untriggered: 'open',
  Filled: 'closed',
  Cancelled: 'canceled',
  PartiallyFilledCanceled: 'canceled',
  Rejected: 'rejected',
  Deactivated: 'canceled',
};

export const BINANCE_ORDER_SIDE: Record<string, OrderSide> = {
  BUY: OrderSide.Buy,
  SELL: OrderSide.Sell,
};

export const BINANCE_ORDER_TYPE: Record<string, OrderType> = {
  MARKET: OrderType.Market,
  LIMIT: OrderType.Limit,
};

export const BYBIT_ORDER_SIDE: Record<string, OrderSide> = {
  Buy: OrderSide.Buy,
  Sell: OrderSide.Sell,
};

export const BYBIT_ORDER_TYPE: Record<string, OrderType> = {
  Market: OrderType.Market,
  Limit: OrderType.Limit,
};
