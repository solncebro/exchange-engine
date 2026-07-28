const NUMERIC_ORDER_ID_PATTERN = /^\d+$/;

export function isBinanceNumericOrderId(orderId: string): boolean {
  return NUMERIC_ORDER_ID_PATTERN.test(orderId);
}

export function serializeBinanceOrderIdList(orderIdList: string[]): string {
  const invalidOrderId = orderIdList.find((orderId) => !isBinanceNumericOrderId(orderId));

  if (invalidOrderId !== undefined) {
    throw new Error(`Binance orderIdList expects numeric ids, received "${invalidOrderId}"`);
  }

  return `[${orderIdList.join(',')}]`;
}
