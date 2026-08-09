import { OrderTypeEnum } from '../types/common';

/**
 * Условная заявка — та, что ждёт срабатывания по цене, а не идёт в стакан сразу.
 * Понятие общее для всех бирж; чем оно исполняется, решает биржевой слой:
 * на Binance USDⓈ-M с 09.12.2025 это отдельная Algo-служба, на Bybit — отдельная
 * книга условных заявок, на споте Binance — прежний вход создания заявки.
 */
export const CONDITIONAL_ORDER_TYPE_SET: ReadonlySet<OrderTypeEnum> = new Set([
  OrderTypeEnum.StopMarket,
  OrderTypeEnum.StopLimit,
  OrderTypeEnum.TakeProfitMarket,
  OrderTypeEnum.TakeProfitLimit,
  OrderTypeEnum.Stop,
  OrderTypeEnum.TakeProfit,
  OrderTypeEnum.TrailingStop,
]);

export function isConditionalOrderType(type: OrderTypeEnum): boolean {
  return CONDITIONAL_ORDER_TYPE_SET.has(type);
}
