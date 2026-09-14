import type { Order, OrderRateLimitSnapshot } from '../types/common';
import type { CancelOrderItemResult, CreateOrderItemResult, ModifyOrderItemResult } from '../types/exchange';
import type { BatchEntryStatusRaw } from './batchOrderOutcome.types';

/**
 * Сборка исхода одной заявки из пачки. Живёт отдельно от обеих бирж, потому что правило
 * общее: заявка считается поставленной ТОЛЬКО когда биржа вернула её номер. Пустой номер,
 * отсутствующая запись, слово «undefined» вместо номера — всё это отказ, а не успех.
 *
 * Раньше каждая биржа врала по-своему: Binance выбрасывал провалившиеся заявки из ответа
 * (ответ становился короче запроса, и исходы съезжали на соседние заявки), Bybit возвращал
 * провал как «открытую» заявку с пустым номером. В обоих случаях вызывающий считал стоп
 * поставленным, когда его нет.
 */
const MISSING_ORDER_ID_ERROR_TEXT = 'Exchange returned no order id for this batch entry';

function buildPlacedOrderOutcome(order: Order): CreateOrderItemResult {
  if (order.id === '' || order.id === 'undefined') {
    return buildRejectedOrderOutcome(null, MISSING_ORDER_ID_ERROR_TEXT);
  }

  return { order, isSuccess: true, errorCode: null, errorText: null };
}

function buildRejectedOrderOutcome(errorCode: number | null, errorText: string | null): CreateOrderItemResult {
  return { order: null, isSuccess: false, errorCode, errorText: errorText ?? 'Unknown error' };
}

/**
 * Сборка исхода одной записи пачки на ОТМЕНУ или ПРАВКУ: биржа отвечает по каждой записи кодом и
 * текстом. Поля объявлены обязательными, но приезжают с провода, поэтому проверяются по факту —
 * запись без числового кода считается отказом, а не молчаливым успехом.
 *
 * Один сборщик на три места, где он был выписан слово в слово: торговый канал (пачки на отмену и
 * на правку) и обычные запросы того же назначения.
 */
function buildBatchItemResult<TResult extends CancelOrderItemResult | ModifyOrderItemResult>(
  orderId: string,
  entryStatus: BatchEntryStatusRaw | undefined,
  rateLimit?: OrderRateLimitSnapshot,
): TResult {
  const hasCode = entryStatus !== undefined && typeof entryStatus.code === 'number';
  const code = hasCode ? entryStatus.code : null;
  const message = entryStatus !== undefined && typeof entryStatus.msg === 'string' ? entryStatus.msg : null;
  const isSuccess = code === 0;

  return {
    orderId,
    isSuccess,
    errorCode: isSuccess ? null : code,
    errorText: isSuccess ? null : (message ?? 'Unknown error'),
    ...(rateLimit !== undefined ? { rateLimit } : {}),
  } as TResult;
}

export { MISSING_ORDER_ID_ERROR_TEXT, buildBatchItemResult, buildPlacedOrderOutcome, buildRejectedOrderOutcome };
