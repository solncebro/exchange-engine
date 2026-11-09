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
 * Пауза между страницами журнала операций. Биржа пускает этот запрос не чаще 25 раз в секунду на
 * счёт (заголовок `X-Bapi-Limit: 25`, 17.09.2026), а следующая страница отвечает за ~25 мс — без
 * паузы длинное окно само выбивает лимит и оставляет без чтений остальные пути бота. 60 мс держат
 * листание ниже 17 запросов в секунду.
 */
export const BYBIT_TRANSACTION_LOG_PAGE_INTERVAL_MS = 60;

/**
 * Пауза между открытыми чтениями отметочной цены для истории фандинга — тот же темп, что у
 * остальных повторных чтений Bybit: долгое окно даёт десятки начислений, и запросы подряд без
 * паузы расходуют общий лимит адреса, нужный остальным путям бота.
 */
export const BYBIT_MARK_PRICE_KLINE_READ_INTERVAL_MS = 60;

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

/**
 * Потолок страниц при обходе ступеней риска по курсору. Страница — 15 символов, у linear
 * ~450 символов.
 */
export const BYBIT_RISK_LIMIT_MAX_PAGE_COUNT = 100;

/**
 * Пауза между страницами ступеней риска — тот же лимит запросов, что у листания журнала
 * операций (`BYBIT_TRANSACTION_LOG_PAGE_INTERVAL_MS`).
 */
export const BYBIT_RISK_LIMIT_PAGE_INTERVAL_MS = 60;

/** Максимум страницы `/v5/order/realtime` — без него ответ молча режется до 20 заявок. */
export const BYBIT_OPEN_ORDERS_PAGE_LIMIT = 50;

/** Пауза между страницами открытых заявок — тот же лимит запросов, что у журнала операций. */
export const BYBIT_OPEN_ORDERS_PAGE_INTERVAL_MS = 60;

/**
 * Потолок страниц при обходе открытых заявок по курсору. Последняя заполненная страница тоже
 * отдаёт непустой курсор, и конец виден только по следующей, пустой странице, поэтому 40 страниц
 * по 50 вмещают 39 полных — 1950 заявок; дальше отказ, а не неполный список (незамеченная своя
 * заявка живёт на бирже без учёта ботом).
 */
export const BYBIT_OPEN_ORDERS_MAX_PAGE_COUNT = 40;

/** Валюта расчётов линейных фьючерсов Bybit — единственная на счёте USDT-перпетуалов. */
export const BYBIT_LINEAR_SETTLE_COIN = 'USDT';

// Подсчёты главного счёта. Демо-служба этих путей не обслуживает — их нет в её списке доступных
// входов (https://bybit-exchange.github.io/docs/v5/demo).
export const BYBIT_SUB_MEMBER_LIST_PATH = '/v5/user/query-sub-members';
export const BYBIT_API_KEY_INFO_PATH = '/v5/user/query-api';
export const BYBIT_UNIVERSAL_TRANSFER_PATH = '/v5/asset/transfer/universal-transfer';
export const BYBIT_UNIVERSAL_TRANSFER_LIST_PATH = '/v5/asset/transfer/query-universal-transfer-list';
export const BYBIT_ACCOUNT_COINS_BALANCE_PATH = '/v5/asset/transfer/query-account-coins-balance';

export const BYBIT_ISOLATED_MARGIN_MODE = 'ISOLATED_MARGIN';
export const BYBIT_CROSS_MARGIN_MODE = 'REGULAR_MARGIN';
export const BYBIT_PORTFOLIO_MARGIN_MODE = 'PORTFOLIO_MARGIN';
export const BYBIT_CLASSIC_ACCOUNT_STATUS = 1;

/** `/v5/position/add-margin`: «Support up to 4 decimal»; пятый знак биржа отвергает кодом 10001. */
export const BYBIT_POSITION_MARGIN_DECIMAL_PLACES = 4;

/** Максимум страницы `/v5/position/list` («[1, 200]. Default: 20») — без него ответ режется до 20 позиций. */
export const BYBIT_POSITION_LIST_PAGE_LIMIT = 200;

/** Пауза между страницами позиций — тот же темп, что у листания открытых заявок. */
export const BYBIT_POSITION_LIST_PAGE_INTERVAL_MS = 60;

/**
 * Потолок страниц при обходе позиций по курсору. Последняя заполненная страница тоже отдаёт
 * непустой курсор (живой демо-счёт 05.11.2026), и конец виден только по следующей, пустой
 * странице, поэтому 20 страниц по 200 вмещают 19 полных — 3800 позиций; дальше отказ, а не
 * неполный список.
 */
export const BYBIT_POSITION_LIST_MAX_PAGE_COUNT = 20;

/** Максимум страницы `/v5/execution/list` («[1, 100]. Default: 50»). */
export const BYBIT_ORDER_EXECUTION_PAGE_LIMIT = 100;

/** Пауза между страницами исполнений заявки — тот же темп, что у листания открытых заявок. */
export const BYBIT_ORDER_EXECUTION_PAGE_INTERVAL_MS = 60;

/** Потолок страниц исполнений заявки в одном семидневном окне — дальше отказ, а не неполная сводка. */
export const BYBIT_ORDER_EXECUTION_MAX_PAGE_COUNT = 1000;

/** Код отказа, когда режим маржи единого счёта не из известных (или биржа его не прислала). */
export const BYBIT_MARGIN_MODE_UNKNOWN_ERROR_CODE = 'MARGIN_MODE_UNKNOWN';
