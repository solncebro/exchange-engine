export const OKX_BASE_URL = 'https://www.okx.com';

export const OKX_PUBLIC_WEBSOCKET_URL = 'wss://ws.okx.com:8443/ws/v5/public';
export const OKX_BUSINESS_WEBSOCKET_URL = 'wss://ws.okx.com:8443/ws/v5/business';
export const OKX_PRIVATE_WEBSOCKET_URL = 'wss://ws.okx.com:8443/ws/v5/private';

export const OKX_DEMO_PUBLIC_WEBSOCKET_URL = 'wss://wspap.okx.com:8443/ws/v5/public';
export const OKX_DEMO_BUSINESS_WEBSOCKET_URL = 'wss://wspap.okx.com:8443/ws/v5/business';
export const OKX_DEMO_PRIVATE_WEBSOCKET_URL = 'wss://wspap.okx.com:8443/ws/v5/private';

export const OKX_DEMO_TRADING_HEADER_NAME = 'x-simulated-trading';
export const OKX_DEMO_TRADING_HEADER_VALUE = '1';

export const OKX_REQUEST_TIMEOUT = 30000;
export const OKX_PING_INTERVAL = 20000;
export const OKX_WEBSOCKET_LOGIN_TIMEOUT_MS = 10000;

/**
 * Internal library cap on topics per WebSocket connection — NOT an OKX-documented limit.
 * OKX only documents a 64 KB message-size cap and a 480 subscribe/unsubscribe operations
 * per hour cap per connection; this number just keeps a single connection's subscription
 * list from growing unbounded.
 */
export const OKX_MAX_TOPICS_PER_CONNECTION = 100;

/**
 * Отдельный, более строгий потолок для ГЛУБОКОГО стакана — единственное место, где у биржи есть
 * прямая рекомендация: «If you need to subscribe to many 50 or 400 depth level channels, it is
 * recommended to subscribe through multiple websocket connections, with each of less than 30
 * channels» (раздел канала стакана). «Less than 30» — значит 29.
 *
 * Рекомендация названа именно для каналов на 50 и 400 уровней; у нас это канал `books` (400
 * уровней). Пятиуровневый `books5` и однострочный `bbo-tbt` в ней не упомянуты и считаются
 * лёгкими наравне с тикерами — придумывать за биржу более жёсткий предел для них не за что.
 */
export const OKX_MAX_ORDERBOOK_TOPICS_PER_CONNECTION = 29;
export const OKX_MAX_TOPICS_PER_SUBSCRIBE = 50;
export const OKX_PAUSE_BETWEEN_CONNECTIONS_MS = 350;

/**
 * «The total number of 'subscribe'/'unsubscribe'/'login' requests per connection is limited to 480
 * times per hour» — предел биржи на ОПЕРАЦИИ подписки, не на число активных каналов. Считается
 * скользящим часом: одна отправленная команда (пачка тем — одна команда) на соединение.
 */
export const OKX_CONNECTION_OPERATION_LIMIT_PER_HOUR = 480;
export const OKX_CONNECTION_OPERATION_WINDOW_MS = 60 * 60 * 1000;
export const OKX_CONNECTION_OPERATION_WARN_RATIO = 0.8;

/**
 * «60 seconds prior to the upgrade of the WebSocket service, the notification message will be sent
 * to users indicating that the connection will soon be disconnected»:
 * `{"event":"notice","code":"64008","msg":"The connection will soon be closed for a service
 * upgrade. Please reconnect."}`. Целая минута, чтобы переоткрыться заранее и не терять данные в
 * разрыве.
 */
export const OKX_SERVICE_UPGRADE_NOTICE_CODE = '64008';

/**
 * Докуда торговый канал ждёт освобождения, получив уведомление о плановом разрыве с заявкой в
 * полёте. Уведомление приходит РОВНО ОДИН раз, за минуту до разрыва; рвать соединение с заявкой в
 * полёте нельзя — разрыв отверг бы её, хотя биржа могла её принять. Заявка живёт не дольше
 * тайм-аута запроса (30 с), поэтому срок взят с запасом после него и заведомо раньше биржевых
 * шестидесяти секунд. Не уложились — разрыв остаётся за биржей, как было до правки.
 */
export const OKX_SERVICE_UPGRADE_RECONNECT_DEADLINE_MS = 40000;

/**
 * Сколько раз подряд очередь пробует создать соединение для одного пула, прежде чем признать
 * темы потерянными. Возврат тем в очередь без предела превратил бы стойкий отказ создания в
 * бесконечный круг попыток каждые `OKX_PAUSE_BETWEEN_CONNECTIONS_MS`.
 */
export const OKX_CONNECTION_CREATE_ATTEMPT_LIMIT = 5;
export const OKX_STALE_THRESHOLD_MS = 45000;

/**
 * Порог «данных нет» — ОТДЕЛЬНЫЙ от порога «сокет не отвечает» (`OKX_STALE_THRESHOLD_MS`) и
 * заведомо больше собственного «я жив» биржи. Молчащий стакан она подпирает пустым приращением
 * сама: «If there are no updates to the depth for an extended period(Around 60 seconds) … OKX will
 * send a message with 'asks': [], 'bids': [] to inform users that the connection is still active»
 * (раздел канала стакана). Индекс подпирается ровно так же: «Push data every 100ms if there are any
 * changes, otherwise push once a minute» (канал `index-tickers`).
 *
 * Пока оба порога были одним числом (45 с), здоровое соединение попадало в промежуток 45…60 с
 * гарантированно: замер проверяющего — двадцать ложных тревог и сорок команд подписки за двадцать
 * минут, то есть четверть часового бюджета в 480 операций, потраченная на лечение того, что не
 * болело. Берём двойной запас к шестидесяти секундам биржи.
 */
export const OKX_SILENT_THRESHOLD_MS = 120000;
export const OKX_STALE_CHECK_INTERVAL_MS = 5000;
export const OKX_ORDERBOOK_RESYNC_MIN_INTERVAL_MS = 5000;
export const OKX_ORDERBOOK_GAP_RECREATE_THRESHOLD = 3;

export const OKX_ORDER_BATCH_CHUNK_SIZE = 20;
export const OKX_ALGO_CANCEL_BATCH_CHUNK_SIZE = 10;

/** Хвост обозначения бессрочного контракта: `BTC-USDT-SWAP` без него — это ИНДЕКС `BTC-USDT`. */
export const OKX_SWAP_INST_ID_SUFFIX = '-SWAP';

export const OKX_ALGO_CONDITIONAL_ORD_TYPE = 'conditional';
export const OKX_ALGO_TRAILING_ORD_TYPE = 'move_order_stop';

/**
 * Открытые условные заявки OKX отдаёт по типам, и один запрос принимает только перечисление
 * через запятую: `conditional` — односторонний стоп/тейк, `oco` — пара из обоих. Скользящий
 * стоп (`move_order_stop`) в это перечисление не входит — за ним идёт отдельный запрос.
 */
export const OKX_PENDING_ALGO_ORD_TYPE_FILTER = 'conditional,oco';

/**
 * ВСЕ виды условной заявки, которые вход `GET /api/v5/trade/orders-algo-pending` умеет отдавать:
 * дословно «conditional : One-way stop order oco : One-cancels-the-other order chase : chase
 * order, only applicable to FUTURES and SWAP trigger : Trigger order move_order_stop : Trailing
 * order iceberg : Iceberg order twap : TWAP order smart_iceberg : Iceberg order. For every
 * request, unlike other ordType which only can use one type, conditional and oco both can be used
 * and separated with comma».
 *
 * Спрашивать только пару «стоп/тейк» и скользящий стоп значит НЕ ВИДЕТЬ плановую заявку
 * (`trigger`), заявку-преследование, айсберг и заявку по времени — а «снять всё по инструменту»
 * при этом отчитывается успехом, и заявка остаётся жить на бирже. У обеих соседних бирж «снять
 * всё» значит всё: Binance зовёт два входа, Bybit вовсе не сужает вид заявки клиентом.
 *
 * Заявка-преследование существует только у контрактов, поэтому у спота она не спрашивается —
 * иначе биржа ответила бы отказом на заведомо непригодный вид.
 */
export const OKX_PENDING_ALGO_ORD_TYPE_REQUEST_LIST: readonly string[] = [
  OKX_PENDING_ALGO_ORD_TYPE_FILTER,
  OKX_ALGO_TRAILING_ORD_TYPE,
  'trigger',
  'iceberg',
  'twap',
  'smart_iceberg',
];

export const OKX_CONTRACT_ONLY_PENDING_ALGO_ORD_TYPE_LIST: readonly string[] = ['chase'];

/**
 * История условных заявок спрашивается по видам и по состояниям: перечисление видов в одном
 * запросе допускает только пару `conditional,oco`, скользящий стоп идёт отдельно, а состояние
 * принимается ровно одно за запрос («Either state or algoId is required»). Терминальных
 * состояний три: сработала, снята, отвергнута.
 */
export const OKX_ALGO_HISTORY_ORD_TYPE_LIST: readonly string[] = [OKX_PENDING_ALGO_ORD_TYPE_FILTER, OKX_ALGO_TRAILING_ORD_TYPE];
export const OKX_ALGO_HISTORY_STATE_LIST: readonly string[] = ['effective', 'canceled', 'order_failed'];

export const OKX_MARKET_ORDER_PRICE = '-1';
export const OKX_CLOSE_WHOLE_POSITION_FRACTION = '1';

export const OKX_KLINE_LIMIT = 300;
export const OKX_ORDER_PAGE_LIMIT = 100;
export const OKX_MAX_PAGE_COUNT = 50;
export const OKX_BILLS_PAGE_LIMIT = 100;
export const OKX_POSITIONS_HISTORY_PAGE_LIMIT = 100;
export const OKX_FUNDING_RATE_HISTORY_LIMIT = 400;
export const OKX_ORDER_BOOK_MAX_DEPTH = 400;
export const OKX_TRADES_MAX_LIMIT = 500;

export const OKX_ORDER_RATE_LIMIT_RPS = 30;

/**
 * Сколько сработавших условных заявок история дочитывает порождённой заявкой за один вызов.
 * Без дочитывания сработавший стоп остаётся в истории «открытым» с нулевым исполнением навсегда
 * (состояние `effective` у OKX терминальное, а не мимолётное, как `TRIGGERED` у соседей), но
 * дочитывание — отдельный запрос на КАЖДУЮ такую заявку, и история за месяц превратилась бы в
 * лавину. Упёрлись в предел — остальные остаются недочитанными, и об этом пишем в журнал.
 */
export const OKX_HISTORY_TRIGGERED_ORDER_READ_LIMIT = 20;

export const OKX_RECENT_HISTORY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export const OKX_SUCCESS_CODE = '0';
const OKX_BATCH_ALL_FAILED_CODE = '1';
const OKX_BATCH_PARTIAL_CODE = '2';
export const OKX_BATCH_ACCEPTED_CODE_LIST: readonly string[] = [OKX_SUCCESS_CODE, OKX_BATCH_ALL_FAILED_CODE, OKX_BATCH_PARTIAL_CODE];
export const OKX_RATE_LIMIT_ERROR_CODE = 50011;
export const OKX_RATE_LIMIT_RETRY_DELAY_MS = 1000;
export const OKX_STALE_TIMESTAMP_ERROR_CODE = 50102;
export const OKX_STALE_TIMESTAMP_ATTEMPT_LIMIT = 2;
export const OKX_ORDER_NOT_FOUND_ERROR_CODE = 51603;
export const OKX_CANCEL_ORDER_GONE_ERROR_CODE = 51400;
export const OKX_AMEND_ORDER_GONE_ERROR_CODE = 51503;

export const OKX_EXPECTED_ERROR_CODE_LIST: readonly number[] = [
  OKX_ORDER_NOT_FOUND_ERROR_CODE,
  OKX_CANCEL_ORDER_GONE_ERROR_CODE,
  OKX_AMEND_ORDER_GONE_ERROR_CODE,
];

/**
 * `code`/`sCode`, которыми OKX отвергает запрос торгового канала из-за адреса инструмента. Канал
 * адресует инструмент числовым `instIdCode` (живая проба 09.09.2026: заявка с именем инструмента
 * отвергнута кодом `50014` — «Parameter instIdCode can not be empty»), и библиотека шлёт именно
 * его. Отказ по этому полю остаётся возможным: код меняется при перелистинге инструмента, а карта
 * имён обновляется только загрузкой списка инструментов. Такой отказ объявляет канал непригодным —
 * дальше всё уходит обычными запросами, которые работают по имени.
 */
export const OKX_ORDER_CHANNEL_INSTID_ISSUE_CODE_LIST: readonly string[] = ['50014', '51000', '51001'];
export const OKX_ORDER_CHANNEL_INSTID_ISSUE_TEXT = 'instIdCode';

/**
 * Отказы, после которых заявка ТОЧНО не попала в книгу биржи: канал не смог адресовать инструмент —
 * либо сам не собрал числовой код (`OKX_INSTRUMENTS_NOT_LOADED` / `OKX_SYMBOL_UNRESOLVED`, кадр не
 * отправлялся вовсе), либо биржа ответила отказом по этому полю. Только их и разрешено повторять
 * обычным запросом: на любом ДРУГОМ отказе канала биржа могла заявку принять, и повтор поставил бы
 * вторую.
 */
export const OKX_ORDER_CHANNEL_UNSENT_CODE_LIST: readonly string[] = [
  ...OKX_ORDER_CHANNEL_INSTID_ISSUE_CODE_LIST,
  'OKX_INSTRUMENTS_NOT_LOADED',
  'OKX_SYMBOL_UNRESOLVED',
];

export const OKX_FUNDING_BILL_TYPE = '8';
export const OKX_TRADE_BILL_TYPE = '2';

/**
 * Режимы счёта OKX («1: Spot mode, 2: Futures mode, 3: Multi-currency margin, 4: Portfolio
 * margin»), в которых изолированной маржи не существует: «isolated is not available in
 * multi-currency margin mode and portfolio margin mode».
 */
export const OKX_ISOLATED_MARGIN_UNAVAILABLE_ACCOUNT_LEVEL_LIST: readonly string[] = ['3', '4'];

/**
 * Состояния инструмента, при которых он считается «живым» наружу. `preopen` — «There will be
 * preopen before the Futures and Options new contracts state is live», то есть инструмент вот-вот
 * запустится; именно такие интересны отбору новых листингов, и Bybit в тех же обстоятельствах
 * считает `PreLaunch` активным. Биржа отдельно советует убедиться, что состояние `live`, ПЕРЕД
 * постановкой заявки — это решение вызывающего, а не повод прятать инструмент из списка.
 */
export const OKX_TRADABLE_INSTRUMENT_STATE_SET: ReadonlySet<string> = new Set(['live', 'preopen']);

/**
 * Категории базового актива, которые НЕ являются криптой: «1 : Crypto 3 : Stocks 4 : Commodities
 * 5 : Forex 6 : Bonds». Валютные и облигационные бессрочные без этого уходили наружу как обычная
 * крипта.
 */
export const OKX_TRADIFI_INST_CATEGORY_SET: ReadonlySet<string> = new Set(['3', '4', '5', '6']);

export const OKX_LINEAR_SETTLE_CURRENCY_LIST: readonly string[] = ['USDT', 'USDC'];
export const OKX_QUOTE_CURRENCY_LIST: readonly string[] = ['USDT', 'USDC'];

export const OKX_CLIENT_ORDER_ID_PATTERN = /^[A-Za-z0-9]{1,32}$/;

export const OKX_CONDITIONAL_ORDER_REGISTRY_MAX_SIZE = 5000;
export const OKX_CONDITIONAL_ORDER_REGISTRY_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Обозначения от шести часов и крупнее берутся с суффиксом `utc`. Без суффикса OKX режет такую
 * свечу от полуночи по UTC+8, то есть от 16:00 всемирного времени: «UTC+8 opening price k-line:
 * [6H/12H/1D/2D/3D/1W/1M/3M] UTC+0 opening price k-line: [6Hutc/12Hutc/1Dutc/2Dutc/3Dutc/1Wutc/
 * 1Mutc/3Mutc]» — дословно у обеих ручек свечей (`/market/candles`, `/market/history-candles`) и
 * в списке каналов потока (`candle1Dutc`, `candle6Hutc`, …). У Binance и Bybit сутки начинаются в
 * полночь всемирного времени, поэтому без суффикса ряды трёх бирж не совпадали НИ В ОДНОЙ точке,
 * и расхождение выглядело рыночным. Интервалы в четыре часа и мельче суффикса не имеют и не
 * нуждаются в нём: их сетка делит восемь часов сдвига нацело.
 */
export const OKX_KLINE_INTERVAL: Record<string, string> = {
  '1s': '1s',
  '1m': '1m',
  '3m': '3m',
  '5m': '5m',
  '15m': '15m',
  '30m': '30m',
  '1h': '1H',
  '2h': '2H',
  '4h': '4H',
  '6h': '6Hutc',
  '12h': '12Hutc',
  '1d': '1Dutc',
  '3d': '3Dutc',
  '1w': '1Wutc',
  '1M': '1Mutc',
};

export const OKX_KLINE_INTERVAL_REVERSE: Record<string, string> = Object.fromEntries(
  Object.entries(OKX_KLINE_INTERVAL).map(([unified, okxInterval]) => [okxInterval, unified]),
);

/**
 * Длительность интервала в миллисекундах — те же ключи, что у `BYBIT_KLINE_INTERVAL_MS`,
 * плюс `1s`. Месяц сюда не входит — он не постоянной длины (см. пояснение у Bybit).
 */
export const OKX_KLINE_INTERVAL_MS: Record<string, number> = {
  '1s': 1_000,
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
