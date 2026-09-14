import type { FetchPageWithLimitArgs } from '../types/exchange';
import type { HttpParamValueTransform } from './httpParams.types';

export function applyTimeRangeOptions(
  params: Record<string, string | number | boolean>,
  options?: FetchPageWithLimitArgs,
): void {
  if (options?.startTime !== undefined) {
    params.startTime = options.startTime;
  }

  if (options?.endTime !== undefined) {
    params.endTime = options.endTime;
  }

  if (options?.limit !== undefined) {
    params.limit = options.limit;
  }
}

/**
 * Кладёт в параметры запроса только заданные значения, сохраняя порядок объявления. Заменяет
 * россыпь одинаковых проверок «если задано — положить»: их легко забыть или перепутать местами,
 * а порядок ключей у Bybit важен — по нему строится подпись и та же строка уходит на провод.
 *
 * `transformValue` — для бирж, кладущих значения на провод по-своему: OKX ждёт все параметры
 * строками, Bybit оставляет числа числами (и его проверки это утверждают). Без него значение
 * идёт как есть.
 */
export function buildOptionalParams(
  entryList: Record<string, string | number | boolean | undefined>,
  transformValue?: HttpParamValueTransform,
): Record<string, string | number | boolean> {
  const params: Record<string, string | number | boolean> = {};

  for (const [key, value] of Object.entries(entryList)) {
    if (value !== undefined) {
      params[key] = transformValue === undefined ? value : transformValue(value);
    }
  }

  return params;
}
