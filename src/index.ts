export { ExchangeError } from './errors/ExchangeError';
export { Exchange } from './exchanges/Exchange';
export { parseBybitOrderbookRawFrame } from './normalizers/bybitNormalizer';
export type { ParseBybitOrderbookRawFrameArgs } from './normalizers/bybitNormalizer';
export { parseOkxOrderbookRawFrame } from './normalizers/okxNormalizer';
export type { ParseOkxOrderbookRawFrameArgs } from './normalizers/okxNormalizer.types';
export { formatWebSocketConnectionsReport } from './utils/formatWebSocketConnectionsReport';
export type { FormatWebSocketConnectionsReportArgs } from './utils/formatWebSocketConnectionsReport';

// Публичная поверхность отдаётся ЦЕЛИКОМ, а не поимённым перечнем. Перечень уже разъезжался:
// рядом жил второй список (`./types/index`), который никто не импортировал, и четыре типа из
// СИГНАТУР `ExchangeClient` не выходили наружу вовсе — `FetchIncomeArgs`, `IncomeTypeFilter`,
// `ResubscribeOrderbookArgs`, `ResubscribePublicTradesArgs`. Потребитель мог вызвать метод, но не
// мог назвать тип его аргументов, и лечилось это каждый раз новой публикацией пакета (в верхней
// библиотеке — восемь выпусков за пять месяцев, один из них в тот же день, что и предыдущий).
// Сквозной реэкспорт делает такую потерю невозможной: новый тип в этих файлах виден снаружи сам.
// Имена двух файлов не пересекаются — проверено; сторож-тест держит это правило.
export type { StepRounding } from './precision/precision';
export * from './types/common';
export * from './types/exchange';
