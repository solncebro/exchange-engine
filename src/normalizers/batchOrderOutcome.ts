import type { Order } from '../types/common';
import type { CreateOrderItemResult } from '../types/exchange';

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

export { MISSING_ORDER_ID_ERROR_TEXT, buildPlacedOrderOutcome, buildRejectedOrderOutcome };
