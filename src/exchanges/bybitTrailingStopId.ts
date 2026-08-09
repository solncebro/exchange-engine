import { PositionSideEnum } from '../types/common';

/**
 * Скользящий стоп на Bybit — не заявка, а свойство позиции: собственного номера у него нет,
 * а потребитель обязан видеть на обеих биржах одно и то же (поставил — получил номер, по
 * номеру снял). Номер поэтому собирается ЗДЕСЬ и выводится из адреса самой позиции.
 *
 * Почему выводится, а не запоминается: у одной позиции скольжение ровно одно, поэтому адрес
 * позиции и есть его тождество. Номер, выведенный из адреса, переживает перезапуск процесса —
 * память бы опустела, и снять поставленное до перезапуска стало бы нечем.
 */
const BYBIT_TRAILING_STOP_ID_PREFIX = 'bybitTrailingStop';

/** 0 — односторонний режим, 1 — лонг в двустороннем, 2 — шорт (нумерация Bybit). */
type BybitPositionIdx = 0 | 1 | 2;

function resolveBybitPositionIdx(positionSide?: PositionSideEnum): BybitPositionIdx {
  if (positionSide === PositionSideEnum.Long) {
    return 1;
  }

  if (positionSide === PositionSideEnum.Short) {
    return 2;
  }

  return 0;
}

function buildBybitTrailingStopId(positionIdx: BybitPositionIdx): string {
  return `${BYBIT_TRAILING_STOP_ID_PREFIX}|${positionIdx}`;
}

/** Адрес позиции из номера; null — номер не наш, это обычная заявка. */
function parseBybitTrailingStopId(orderId: string): BybitPositionIdx | null {
  const [prefix, rawPositionIdx] = orderId.split('|');

  if (prefix !== BYBIT_TRAILING_STOP_ID_PREFIX) {
    return null;
  }

  const positionIdx = Number(rawPositionIdx);

  return positionIdx === 0 || positionIdx === 1 || positionIdx === 2 ? positionIdx : null;
}

export type { BybitPositionIdx };
export { buildBybitTrailingStopId, parseBybitTrailingStopId, resolveBybitPositionIdx };
