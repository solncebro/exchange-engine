import { PositionSideEnum, OrderSideEnum, OrderTypeEnum, TimeInForceEnum, WorkingTypeEnum } from '../types/common';

export const BINANCE_POSITION_SIDE: Record<string, PositionSideEnum> = {
  LONG: PositionSideEnum.Long,
  SHORT: PositionSideEnum.Short,
  BOTH: PositionSideEnum.Both,
};

export const BYBIT_POSITION_SIDE: Record<string, PositionSideEnum> = {
  Buy: PositionSideEnum.Long,
  Sell: PositionSideEnum.Short,
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

export const BINANCE_ORDER_STATUS: Record<string, string> = {
  NEW: 'open',
  PARTIALLY_FILLED: 'open',
  FILLED: 'closed',
  CANCELED: 'canceled',
  REJECTED: 'rejected',
  EXPIRED: 'canceled',
  EXPIRED_IN_MATCH: 'canceled',
};

export const BINANCE_ORDER_SIDE: Record<string, OrderSideEnum> = {
  BUY: OrderSideEnum.Buy,
  SELL: OrderSideEnum.Sell,
};

export const BINANCE_ORDER_TYPE: Record<string, OrderTypeEnum> = {
  MARKET: OrderTypeEnum.Market,
  LIMIT: OrderTypeEnum.Limit,
  STOP_MARKET: OrderTypeEnum.StopMarket,
  TAKE_PROFIT_MARKET: OrderTypeEnum.TakeProfitMarket,
  STOP: OrderTypeEnum.StopLimit,
  TAKE_PROFIT: OrderTypeEnum.TakeProfit,
  STOP_LOSS: OrderTypeEnum.StopMarket,
  STOP_LOSS_LIMIT: OrderTypeEnum.StopLimit,
  TAKE_PROFIT_LIMIT: OrderTypeEnum.TakeProfitLimit,
  TRAILING_STOP_MARKET: OrderTypeEnum.TrailingStop,
};

export const BINANCE_FUTURES_ORDER_TYPE_REVERSE: Record<string, string> = {
  [OrderTypeEnum.Market]: 'MARKET',
  [OrderTypeEnum.Limit]: 'LIMIT',
  [OrderTypeEnum.StopMarket]: 'STOP_MARKET',
  [OrderTypeEnum.StopLimit]: 'STOP',
  [OrderTypeEnum.TakeProfitMarket]: 'TAKE_PROFIT_MARKET',
  [OrderTypeEnum.TakeProfitLimit]: 'TAKE_PROFIT',
  [OrderTypeEnum.Stop]: 'STOP',
  [OrderTypeEnum.TakeProfit]: 'TAKE_PROFIT',
  [OrderTypeEnum.TrailingStop]: 'TRAILING_STOP_MARKET',
};

export const BINANCE_SPOT_ORDER_TYPE_REVERSE: Record<string, string> = {
  [OrderTypeEnum.Market]: 'MARKET',
  [OrderTypeEnum.Limit]: 'LIMIT',
  [OrderTypeEnum.StopMarket]: 'STOP_LOSS',
  [OrderTypeEnum.StopLimit]: 'STOP_LOSS_LIMIT',
  [OrderTypeEnum.TakeProfitMarket]: 'TAKE_PROFIT',
  [OrderTypeEnum.TakeProfitLimit]: 'TAKE_PROFIT_LIMIT',
  [OrderTypeEnum.Stop]: 'STOP_LOSS_LIMIT',
  [OrderTypeEnum.TakeProfit]: 'TAKE_PROFIT_LIMIT',
};

export const BINANCE_ORDER_TYPE_REVERSE = BINANCE_FUTURES_ORDER_TYPE_REVERSE;

export const BINANCE_TIME_IN_FORCE: Record<string, TimeInForceEnum> = {
  GTC: TimeInForceEnum.Gtc,
  IOC: TimeInForceEnum.Ioc,
  FOK: TimeInForceEnum.Fok,
  GTX: TimeInForceEnum.PostOnly,
};

export const BINANCE_WORKING_TYPE: Record<string, string> = {
  [WorkingTypeEnum.MarkPrice]: 'MARK_PRICE',
  [WorkingTypeEnum.ContractPrice]: 'CONTRACT_PRICE',
};

export const BYBIT_ORDER_SIDE: Record<string, OrderSideEnum> = {
  Buy: OrderSideEnum.Buy,
  Sell: OrderSideEnum.Sell,
};

export const BYBIT_ORDER_TYPE: Record<string, OrderTypeEnum> = {
  Market: OrderTypeEnum.Market,
  Limit: OrderTypeEnum.Limit,
};

export const BYBIT_TIME_IN_FORCE: Record<string, TimeInForceEnum> = {
  GTC: TimeInForceEnum.Gtc,
  IOC: TimeInForceEnum.Ioc,
  FOK: TimeInForceEnum.Fok,
  PostOnly: TimeInForceEnum.PostOnly,
};
