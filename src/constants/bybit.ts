export const BYBIT_BASE_URL = 'https://api.bybit.com';

export const BYBIT_DEMO_BASE_URL = 'https://api-demo.bybit.com';

export const BYBIT_PUBLIC_LINEAR_WEBSOCKET_URL = 'wss://stream.bybit.com/v5/public/linear';
export const BYBIT_PUBLIC_SPOT_WEBSOCKET_URL = 'wss://stream.bybit.com/v5/public/spot';
export const BYBIT_PRIVATE_WEBSOCKET_URL = 'wss://stream.bybit.com/v5/private';
export const BYBIT_TRADE_WEBSOCKET_URL = 'wss://stream.bybit.com/v5/trade';

export const BYBIT_DEMO_PRIVATE_WEBSOCKET_URL = 'wss://stream-demo.bybit.com/v5/private';

export const BYBIT_RECV_WINDOW = 7000;
export const BYBIT_REQUEST_TIMEOUT = 30000;

export const BYBIT_LINEAR_BATCH_CHUNK_SIZE = 20;
export const BYBIT_SPOT_BATCH_CHUNK_SIZE = 10;

export const BYBIT_KLINE_INTERVAL: Record<string, string> = {
  '1m': '1',
  '3m': '3',
  '5m': '5',
  '15m': '15',
  '30m': '30',
  '1h': '60',
  '2h': '120',
  '4h': '240',
  '6h': '360',
  '12h': '720',
  '1d': 'D',
  '3d': '3D',
  '1w': 'W',
  '1M': 'M',
};

/**
 * Длительность интервала в миллисекундах. Нужна, чтобы посчитать время закрытия клайна:
 * Bybit его не присылает, но оно однозначно выводится из начала и длительности. Месяц сюда
 * не входит — он не постоянной длины, и высчитывать его так было бы неверно.
 */
export const BYBIT_KLINE_INTERVAL_MS: Record<string, number> = {
  '1m': 60_000,
  '3m': 180_000,
  '5m': 300_000,
  '15m': 900_000,
  '30m': 1_800_000,
  '1h': 3_600_000,
  '2h': 7_200_000,
  '4h': 14_400_000,
  '6h': 21_600_000,
  '12h': 43_200_000,
  '1d': 86_400_000,
  '3d': 259_200_000,
  '1w': 604_800_000,
};

export const BYBIT_TRANSACTION_LOG_MAX_LIMIT = 50;

/**
 * Потолок страниц при обходе журнала операций по курсору. Журнал один на весь счёт, а не на
 * символ, и за окно в несколько часов на живом счёте набирается больше одной страницы в 50 строк
 * (REZUSDT 10.09.2026: десять часов удержания — первая страница полная, фандинг остался за ней).
 * Окно запроса биржа сама ограничивает семью сутками; 200 страниц — это десять тысяч записей,
 * на порядок больше, чем даёт неделя, поэтому потолок ничего не отсекает и нужен лишь против
 * курсора, который биржа отдаёт бесконечно. Достигнутый потолок — отказ, а не частичный ответ:
 * по усечённому журналу посчитают фандинг и не узнают, что половины начислений в нём не было.
 */
export const BYBIT_TRANSACTION_LOG_MAX_PAGE_COUNT = 200;

/**
 * Записи журнала операций, несущие начисление фандинга. У них нулевой денежный поток, а
 * сама сумма лежит в поле `funding` (живой счёт 02.09.2026, FLOCKUSDT: `cashFlow=0`,
 * `funding=-2.3156522`). Один список на клиент и нормализатор — чтобы фильтр и чтение суммы
 * не разошлись.
 */
export const BYBIT_FUNDING_INCOME_TYPE_SET = new Set(['FUNDING', 'SETTLEMENT']);

/**
 * Потолок страниц при обходе списка инструментов. Страница — тысяча записей, а всех инструментов
 * Bybit на порядок меньше, поэтому реальный обход укладывается в одну-две страницы. Потолок нужен
 * не для отсечения данных, а чтобы сбойный курсор, который биржа отдаёт бесконечно, не крутил цикл
 * вечно: у обеих соседних бирж такой предохранитель есть, здесь он был потерян.
 */
export const BYBIT_INSTRUMENTS_MAX_PAGE_COUNT = 20;
