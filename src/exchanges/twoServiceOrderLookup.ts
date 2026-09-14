import type { TwoServiceOrderFailure } from './twoServiceOrderLookup.types';

function toTwoServiceErrorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * «Биржа ответила: такой заявки нет» и «спросить не удалось» — разные вещи, и путать их нельзя:
 * «заявки нет» вызывающий читает как команду — сочтёт защитную заявку снятой и либо поставит
 * вторую, либо закроет позицию. Отказ ЛЮБОЙ из двух служб по связи выходит наружу своей исходной
 * причиной, и любая причина попадает в журнал. Отказ с кодом «заявки уже нет» — это ответ биржи,
 * а не сбой связи, и он складывается в «нет такой заявки» (`missingOrderError`), по которому
 * вызывающий отличает успешную отмену от настоящей ошибки.
 *
 * Уровень записи различает эти же две вещи. Ожидаемое «заявки нет» — обычный ход двухслужебного
 * чтения: спросили заявку, которой уже нет, обе службы ответили отсутствием. Писать его
 * предупреждением значило давать по два пугающих предупреждения на самый частый вызов, тогда как
 * слой запросов тот же ответ давно понижает до сведений. Предупреждение остаётся за НАСТОЯЩИМ
 * отказом службы — тем, из-за которого судьба заявки неизвестна.
 *
 * Одна точка на все пути, ходящие в обе службы, — общая для бирж с раздельными службами обычных
 * и условных заявок.
 */
export function resolveTwoServiceOrderFailure(failure: TwoServiceOrderFailure): Error {
  const { symbol, orderId, action, errorList, missingOrderError } = failure;

  for (const error of errorList) {
    const text = `[${failure.exchangeLabel}] ${action} order ${orderId} failed in one of the two services: ${toTwoServiceErrorText(error)}`;

    if (failure.isMissingOrderError(error)) {
      failure.logger.info({ symbol, orderId }, text);
    } else {
      failure.logger.warn({ symbol, orderId }, text);
    }
  }

  const outcomeError = errorList.find((error) => !failure.isMissingOrderError(error)) ?? missingOrderError;

  return outcomeError instanceof Error ? outcomeError : new Error(toTwoServiceErrorText(outcomeError));
}
