import { ExchangeError } from '../errors/ExchangeError';

/**
 * Отказ Binance «отметка времени вне окна приёма». Приходит с HTTP 400, поэтому обычный повтор его
 * не касается — и правильно: повторять ТУ ЖЕ подпись бессмысленно, отметка в ней уже старая.
 * Осмысленный повтор только один — собрать запрос заново (см. `BinanceBaseHttpClient`).
 */
export const BINANCE_STALE_TIMESTAMP_CODE = -1021;

/**
 * Ошибка уже прошла обогащение в `BaseHttpClient`, где тело ответа превращается в текст вида
 * `[-1021] Timestamp for this request is outside of the recvWindow.` — отсюда разбор по тексту.
 * Тот же отказ может прийти и телом успешного ответа: тогда его несёт `ExchangeError` с кодом.
 */
export function isBinanceStaleTimestampError(error: unknown): boolean {
  if (error instanceof ExchangeError) {
    return error.code === BINANCE_STALE_TIMESTAMP_CODE;
  }

  if (error instanceof Error) {
    return error.message.includes(`[${BINANCE_STALE_TIMESTAMP_CODE}]`);
  }

  return false;
}
