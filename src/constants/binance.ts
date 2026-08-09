export const BINANCE_SPOT_BASE_URL = 'https://api.binance.com';
export const BINANCE_FUTURES_BASE_URL = 'https://fapi.binance.com';

export const BINANCE_DEMO_SPOT_BASE_URL = 'https://demo-api.binance.com';
export const BINANCE_DEMO_FUTURES_BASE_URL = 'https://demo-fapi.binance.com';

export const BINANCE_FUTURES_WEBSOCKET_STREAM_URL = 'wss://fstream.binance.com/private/ws';
export const BINANCE_FUTURES_WEBSOCKET_COMBINED_URL = 'wss://fstream.binance.com/stream';
export const BINANCE_FUTURES_WEBSOCKET_MARKET_URL = 'wss://fstream.binance.com/market/ws';
export const BINANCE_FUTURES_WEBSOCKET_MARKET_COMBINED_URL = 'wss://fstream.binance.com/market/stream';
export const BINANCE_SPOT_WEBSOCKET_STREAM_URL = 'wss://stream.binance.com:9443/ws';

export const BINANCE_DEMO_FUTURES_WEBSOCKET_COMBINED_URL = 'wss://fstream.binancefuture.com/stream';
export const BINANCE_DEMO_FUTURES_WEBSOCKET_STREAM_URL = 'wss://fstream.binancefuture.com/ws';
export const BINANCE_DEMO_FUTURES_WEBSOCKET_MARKET_URL = 'wss://fstream.binancefuture.com/market/ws';
export const BINANCE_DEMO_FUTURES_WEBSOCKET_MARKET_COMBINED_URL = 'wss://fstream.binancefuture.com/market/stream';

export const BINANCE_FUTURES_TRADE_WEBSOCKET_URL = 'wss://ws-fapi.binance.com/ws-fapi/v1';
export const BINANCE_DEMO_FUTURES_TRADE_WEBSOCKET_URL = 'wss://testnet.binancefuture.com/ws-fapi/v1';

export const BINANCE_SPOT_TRADE_WEBSOCKET_URL = 'wss://ws-api.binance.com:443/ws-api/v3';
export const BINANCE_DEMO_SPOT_TRADE_WEBSOCKET_URL = 'wss://testnet.binance.vision/ws-api/v3';

export const BINANCE_REQUEST_TIMEOUT = 30000;

export const BINANCE_KLINE_LIMIT_SPOT = 1000;
export const BINANCE_KLINE_LIMIT_FUTURES = 499;

/**
 * Спот Binance принимает отступ скользящего стопа в сотых долях процента: 100 = 1%
 * (документация «Trailing Stop FAQ», таблица перевода). Библиотека наружу говорит только
 * процентами, поэтому единица биржи заперта здесь — перевод делается на границе запроса.
 */
export const BINANCE_SPOT_TRAILING_UNITS_PER_PERCENT = 100;

// Условные заявки USDⓈ-M живут в отдельной Algo-службе с 09.12.2025; старый вход создания
// заявки и старый пакетный вход отбивают их кодом -4120 STOP_ORDER_SWITCH_ALGO.
// ВНИМАНИЕ: openAlgoOrders и algoOpenOrders — РАЗНЫЕ входы. Первый читает список (GET),
// второй отменяет всё по символу (DELETE). Перепутать = молчаливое бездействие на отмене.
export const BINANCE_FUTURES_ALGO_ORDER_PATH = '/fapi/v1/algoOrder';
// Замерено: с символом вес 1, без символа 41 — передавать символ всегда, когда он известен.
export const BINANCE_FUTURES_OPEN_ALGO_ORDERS_PATH = '/fapi/v1/openAlgoOrders';
export const BINANCE_FUTURES_ALL_ALGO_ORDERS_PATH = '/fapi/v1/allAlgoOrders';
export const BINANCE_FUTURES_CANCEL_ALL_ALGO_ORDERS_PATH = '/fapi/v1/algoOpenOrders';

export const BINANCE_ALGO_TYPE_CONDITIONAL = 'CONDITIONAL';

export const BINANCE_ORDER_PLACE_WEBSOCKET_METHOD = 'order.place';

// В торговом канале связи у Algo-службы ровно два метода. Чтения и массовой отмены там нет —
// проверено живым запросом: ответ "-5000 Method ... is invalid".
export const BINANCE_ALGO_ORDER_PLACE_WEBSOCKET_METHOD = 'algoOrder.place';
export const BINANCE_ALGO_ORDER_CANCEL_WEBSOCKET_METHOD = 'algoOrder.cancel';

// Предел условных заявок на ВЕСЬ счёт, а не на символ. Из exchangeInfo фильтр
// MAX_NUM_ALGO_ORDERS убран 11.12.2025 — узнать программно нельзя, число только из
// журнала изменений биржи.
export const BINANCE_ACCOUNT_CONDITIONAL_ORDER_LIMIT = 200;

// Algo-служба отдаёт только что поставленную заявку на чтение НЕ СРАЗУ. Замерено на живом
// счёте 07.08.2026: через 0 и 300 мс биржа отвечает «заявки не существует», через 1000 мс —
// успех. Без выдержки вызывающий счёл бы свою же заявку несуществующей и потерял её номер,
// а заявка осталась бы жить на бирже безнадзорно.
export const BINANCE_ALGO_ORDER_VISIBILITY_GRACE_MS = 5000;
export const BINANCE_ALGO_ORDER_VISIBILITY_ATTEMPT_COUNT = 5;
export const BINANCE_ALGO_ORDER_VISIBILITY_RETRY_DELAY_MS = 400;

// Память о происхождении номеров заявок. Ограничена намеренно: процесс живёт неделями.
export const BINANCE_CONDITIONAL_ORDER_REGISTRY_MAX_SIZE = 5000;
export const BINANCE_CONDITIONAL_ORDER_REGISTRY_TTL_MS = 24 * 60 * 60 * 1000;

export const BINANCE_FUTURES_CREATE_BATCH_CHUNK_SIZE = 5;
export const BINANCE_FUTURES_MODIFY_BATCH_CHUNK_SIZE = 5;
export const BINANCE_FUTURES_CANCEL_BATCH_CHUNK_SIZE = 10;
