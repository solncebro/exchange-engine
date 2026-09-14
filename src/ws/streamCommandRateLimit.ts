export const BINANCE_WS_COMMAND_LIMIT_PER_SECOND = 10;
export const BINANCE_WS_SOCKET_CAP_PER_SECOND = 9;
export const BINANCE_WS_QUEUE_RATE_PER_SECOND = 8;
export const BINANCE_WS_COMMAND_WARN_RATIO = 0.8;
export const BINANCE_WS_CASCADE_RECREATE_STREAM_COUNT = 50;
export const BINANCE_WS_RESUBSCRIBE_COALESCE_WINDOW_MS = 250;
export const BINANCE_WS_POLICY_VIOLATION_BACKOFF_MS = 60000;
export const BINANCE_WS_POLICY_VIOLATION_CLOSE_CODE = 1008;
export const BYBIT_WS_CASCADE_RECREATE_TOPIC_COUNT = 50;
export const OKX_WS_CASCADE_RECREATE_TOPIC_COUNT = 50;

/**
 * Окно подавления повторного пересоздания соединения. Одно значение на все три публичных потока:
 * раньше число стояло тремя отдельными объявлениями в трёх файлах, и правка одного молча оставляла
 * два прежними.
 */
export const WS_RECREATE_DEDUP_WINDOW_MS = 2000;

/**
 * Длина головы сырого кадра, по которой поток бегло опознаёт тему стакана, не разбирая тело.
 * Общая для потоков с ленивым разбором стакана — по той же причине, что и окно выше.
 */
export const WS_FRAME_HEAD_SCAN_LENGTH = 200;
