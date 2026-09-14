# Константы, URL и маппинги

## Binance URL (src/constants/binance.ts)

| Константа | Значение |
|-----------|----------|
| BINANCE_SPOT_BASE_URL | https://api.binance.com |
| BINANCE_FUTURES_BASE_URL | https://fapi.binance.com |
| BINANCE_DEMO_SPOT_BASE_URL | https://demo-api.binance.com |
| BINANCE_DEMO_FUTURES_BASE_URL | https://demo-fapi.binance.com |
| BINANCE_FUTURES_WEBSOCKET_STREAM_URL | wss://fstream.binance.com/private/ws (user-data; legacy `/ws` выведен 2026-04-23) |
| BINANCE_FUTURES_WEBSOCKET_COMBINED_URL | wss://fstream.binance.com/stream |
| BINANCE_FUTURES_WEBSOCKET_MARKET_URL | wss://fstream.binance.com/market/ws |
| BINANCE_FUTURES_WEBSOCKET_MARKET_COMBINED_URL | wss://fstream.binance.com/market/stream |
| BINANCE_SPOT_WEBSOCKET_STREAM_URL | wss://stream.binance.com:9443/ws |
| BINANCE_DEMO_FUTURES_WEBSOCKET_COMBINED_URL | wss://fstream.binancefuture.com/stream |
| BINANCE_DEMO_FUTURES_WEBSOCKET_MARKET_URL | wss://fstream.binancefuture.com/market/ws |
| BINANCE_DEMO_FUTURES_WEBSOCKET_MARKET_COMBINED_URL | wss://fstream.binancefuture.com/market/stream |
| BINANCE_FUTURES_TRADE_WEBSOCKET_URL | wss://ws-fapi.binance.com/ws-fapi/v1 |
| BINANCE_DEMO_FUTURES_TRADE_WEBSOCKET_URL | wss://testnet.binancefuture.com/ws-fapi/v1 |
| BINANCE_SPOT_TRADE_WEBSOCKET_URL | wss://ws-api.binance.com:443/ws-api/v3 |
| BINANCE_DEMO_SPOT_TRADE_WEBSOCKET_URL | wss://testnet.binance.vision/ws-api/v3 |
| BINANCE_REQUEST_TIMEOUT | 30000 ms |
| BINANCE_KLINE_LIMIT_SPOT | 1000 |
| BINANCE_KLINE_LIMIT_FUTURES | 499 |

## Bybit URL (src/constants/bybit.ts)

| Константа | Значение |
|-----------|----------|
| BYBIT_BASE_URL | https://api.bybit.com |
| BYBIT_DEMO_BASE_URL | https://api-demo.bybit.com |
| BYBIT_PUBLIC_LINEAR_WEBSOCKET_URL | wss://stream.bybit.com/v5/public/linear |
| BYBIT_PUBLIC_SPOT_WEBSOCKET_URL | wss://stream.bybit.com/v5/public/spot |
| BYBIT_PRIVATE_WEBSOCKET_URL | wss://stream.bybit.com/v5/private |
| BYBIT_TRADE_WEBSOCKET_URL | wss://stream.bybit.com/v5/trade |
| BYBIT_DEMO_PRIVATE_WEBSOCKET_URL | wss://stream-demo.bybit.com/v5/private |
| BYBIT_RECV_WINDOW | 7000 ms (используется в REST-подписи) |
| BYBIT_REQUEST_TIMEOUT | 30000 ms |
| BYBIT_PING_INTERVAL | 20000 ms |
| BYBIT_TRANSACTION_LOG_MAX_LIMIT | 50 (максимум `limit` для `/v5/account/transaction-log`, `fetchIncome` клампит к этому значению) |
| BYBIT_INSTRUMENTS_MAX_PAGE_COUNT | 20 — потолок страниц в `fetchAllInstrumentsInfo`; страница = 1000 записей, всех инструментов на порядок меньше, поэтому потолок ничего не отсекает, а останавливает бесконечный курсор |
| BYBIT_FUNDING_INCOME_TYPE_SET | `Set(['FUNDING', 'SETTLEMENT'])` — типы записи журнала, несущие начисление фандинга (нулевой `cashFlow`, сумма в поле `funding`); общий список для `BybitBaseClient.fetchIncome` (фильтрация) и `normalizeBybitIncomeList` (чтение суммы) |

## Конвертация интервалов Bybit

```
BYBIT_KLINE_INTERVAL: Record<string, string>
'1m' → '1'    '3m' → '3'    '5m' → '5'    '15m' → '15'   '30m' → '30'
'1h' → '60'   '2h' → '120'  '4h' → '240'  '6h' → '360'   '12h' → '720'
'1d' → 'D'    '3d' → '3D'   '1w' → 'W'    '1M' → 'M'
```

## OKX URL и величины (src/constants/okx.ts)

| Константа | Значение |
|-----------|----------|
| OKX_BASE_URL | https://www.okx.com |
| OKX_PUBLIC_WEBSOCKET_URL | wss://ws.okx.com:8443/ws/v5/public |
| OKX_BUSINESS_WEBSOCKET_URL | wss://ws.okx.com:8443/ws/v5/business (свечи и события условных заявок) |
| OKX_PRIVATE_WEBSOCKET_URL | wss://ws.okx.com:8443/ws/v5/private (торговый канал и личные события) |
| OKX_DEMO_PUBLIC_WEBSOCKET_URL | wss://wspap.okx.com:8443/ws/v5/public |
| OKX_DEMO_BUSINESS_WEBSOCKET_URL | wss://wspap.okx.com:8443/ws/v5/business |
| OKX_DEMO_PRIVATE_WEBSOCKET_URL | wss://wspap.okx.com:8443/ws/v5/private |
| OKX_DEMO_TRADING_HEADER_NAME / _VALUE | `x-simulated-trading` / `1` — демо у OKX выражается заголовком, адрес REST тот же |
| OKX_REQUEST_TIMEOUT | 30000 ms |
| OKX_PING_INTERVAL | 20000 ms — шаг проверки живости, отдаётся движку как `configuration.pingInterval`; на провод уходит голая строка `ping` (`OKX_HEARTBEAT_CONFIG`) |
| OKX_STALE_THRESHOLD_MS / OKX_STALE_CHECK_INTERVAL_MS | 45000 / 5000 ms — отдаются движку как `configuration.staleThreshold` / `staleCheckInterval` (иначе взялись бы его умолчания 60000 / 5000). Порогом меряется отметка «сокет отвечает», которую движок двигает на ЛЮБОМ входящем кадре, включая `pong`; разрыв и переподключение при её превышении — тоже дело движка. Шаг вдобавок задаёт частоту опроса сторожа тишины по данным (`OkxSilenceWatchdog`) |
| OKX_SILENT_THRESHOLD_MS | 120000 ms — порог отметки «идут данные» (`OkxSilenceWatchdog.onSilent`, только публичный поток; движку не передаётся). Вдвое больше собственного «я жив» биржи: молчащий стакан она подпирает пустым приращением «Around 60 seconds», индекс — «once a minute». На общем пороге 45 с здоровое соединение лечилось каждую минуту без повода (замер: 20 ложных тревог и 40 команд подписки за 20 минут — четверть часового бюджета) |
| OKX_WEBSOCKET_LOGIN_TIMEOUT_MS | 10000 ms |
| OKX_MAX_TOPICS_PER_CONNECTION | 100 — **внутренний потолок библиотеки** для лёгких тем, не предел биржи (OKX документирует только 64 КБ на сообщение и 480 операций подписки в час на соединение) |
| OKX_MAX_ORDERBOOK_TOPICS_PER_CONNECTION | 29 — потолок для ГЛУБОКОГО стакана (канал `books`, 400 уровней) по прямой рекомендации биржи: «If you need to subscribe to many 50 or 400 depth level channels, it is recommended to subscribe through multiple websocket connections, with each of less than 30 channels». `books5` и `bbo-tbt` в рекомендации не названы и считаются лёгкими |
| OKX_MAX_TOPICS_PER_SUBSCRIBE | 50 тем в одном кадре подписки |
| OKX_PAUSE_BETWEEN_CONNECTIONS_MS | 350 ms между созданием соединений |
| OKX_CONNECTION_OPERATION_LIMIT_PER_HOUR / _WINDOW_MS / _WARN_RATIO | 480 / 3600000 ms / 0.8 — документированный предел «480 операций подписки, отписки и входа в час на соединение», окно счёта и порог предупреждения (384-я операция) |
| OKX_SERVICE_UPGRADE_NOTICE_CODE | `64008` — код уведомления «соединение скоро закроется на обслуживание, переподключитесь», биржа шлёт его за 60 секунд до разрыва |
| OKX_SERVICE_UPGRADE_RECONNECT_DEADLINE_MS | 40000 ms — докуда торговый канал ждёт освобождения, получив это уведомление с заявкой в полёте: после тайм-аута запроса (30 с) и заведомо раньше биржевых 60 с. Не уложились — разрыв остаётся за биржей |
| OKX_ORDERBOOK_RESYNC_MIN_INTERVAL_MS | 5000 ms — не чаще этого переподписываем стакан после разрыва номеров; тем же окном меряется «чистый ход», стирающий счёт разрывов |
| OKX_ORDERBOOK_GAP_RECREATE_THRESHOLD | 3 разрыва → пересоздание соединения (счёт не обнуляется снимком, поэтому ступень достижима) |
| OKX_ORDER_BATCH_CHUNK_SIZE | 20 — обычные заявки в пачке |
| OKX_ALGO_CANCEL_BATCH_CHUNK_SIZE | 10 — условные заявки в пачке отмены |
| OKX_ALGO_CONDITIONAL_ORD_TYPE / OKX_ALGO_TRAILING_ORD_TYPE | `conditional` / `move_order_stop` |
| OKX_PENDING_ALGO_ORD_TYPE_FILTER | `conditional,oco` — перечисление для чтения открытых условных; скользящий стоп в него не входит и читается отдельным запросом |
| OKX_MARKET_ORDER_PRICE | `-1` — цена исполнения условной заявки, означающая «рыночно» |
| OKX_CLOSE_WHOLE_POSITION_FRACTION | `1` — доля позиции для «закрыть всю» |
| OKX_KLINE_LIMIT | 300 |
| OKX_ORDER_PAGE_LIMIT / OKX_MAX_PAGE_COUNT | 100 записей на страницу / 50 страниц потолок дочитывания |
| OKX_BILLS_PAGE_LIMIT | 100 (журнал начислений; дочитывания нет — полная страница даёт отказ) |
| OKX_POSITIONS_HISTORY_PAGE_LIMIT | 100 |
| OKX_FUNDING_RATE_HISTORY_LIMIT | 400 |
| OKX_ORDER_BOOK_MAX_DEPTH | 400 |
| OKX_TRADES_MAX_LIMIT | 500 |
| OKX_ORDER_RATE_LIMIT_RPS | 30 (документированный предел НА ИНСТРУМЕНТ: 60 запросов за 2 секунды) |
| OKX_CONNECTION_CREATE_ATTEMPT_LIMIT | 5 — сколько раз очередь пробует создать соединение для пула, прежде чем признать темы потерянными |
| OKX_ALGO_HISTORY_ORD_TYPE_LIST / OKX_ALGO_HISTORY_STATE_LIST | `conditional,oco` и `move_order_stop` / `effective`, `canceled`, `order_failed` — по этим парам спрашивается история условных заявок |
| OKX_RECENT_HISTORY_RETENTION_MS | 7 суток — старше уходит в архивные ручки |
| OKX_SUCCESS_CODE / OKX_BATCH_ACCEPTED_CODE_LIST | `'0'`; список принимаемых кодов пачки — `'0'`, `'1'`, `'2'` (сами коды пачки наружу не выводятся) |
| OKX_RATE_LIMIT_ERROR_CODE / OKX_RATE_LIMIT_RETRY_DELAY_MS | 50011 / 1000 ms — один повтор при превышении частоты |
| OKX_STALE_TIMESTAMP_ERROR_CODE / OKX_STALE_TIMESTAMP_ATTEMPT_LIMIT | 50102 / 2 — одна пересдача с новой отметкой времени |
| OKX_ORDER_NOT_FOUND_ERROR_CODE | 51603 |
| OKX_CANCEL_ORDER_GONE_ERROR_CODE / OKX_AMEND_ORDER_GONE_ERROR_CODE | 51400 / 51503 — «уже исполнена, снята или не существует» |
| OKX_EXPECTED_ERROR_CODE_LIST | собран ИЗ ИМЁН трёх величин выше (51603, 51400, 51503) — пишутся уровнем info, их разбирает вызывающий |
| OKX_ORDER_CHANNEL_INSTID_ISSUE_CODE_LIST / _TEXT | `'50014'`, `'51000'`, `'51001'` / `instIdCode` — признак непригодности торгового канала (инструмент в канале адресуется числовым кодом) |
| OKX_FUNDING_BILL_TYPE / OKX_TRADE_BILL_TYPE | `'8'` / `'2'` — типы записи журнала счёта |
| OKX_LINEAR_SETTLE_CURRENCY_LIST / OKX_QUOTE_CURRENCY_LIST | USDT, USDC |
| OKX_CLIENT_ORDER_ID_PATTERN | `/^[A-Za-z0-9]{1,32}$/` |
| OKX_CONDITIONAL_ORDER_REGISTRY_MAX_SIZE / _TTL_MS | 5000 записей / сутки |

## Конвертация интервалов OKX

```
OKX_KLINE_INTERVAL: Record<string, string>
'1s' → '1s'   '1m' → '1m'   '3m' → '3m'   '5m' → '5m'   '15m' → '15m'  '30m' → '30m'
'1h' → '1H'   '2h' → '2H'   '4h' → '4H'   '6h' → '6Hutc'  '12h' → '12Hutc'
'1d' → '1Dutc'  '3d' → '3Dutc'  '1w' → '1Wutc'  '1M' → '1Mutc'
```

`OKX_KLINE_INTERVAL_REVERSE` — обратная карта (строится из прямой). `OKX_KLINE_INTERVAL_MS` — длительность интервала в миллисекундах (те же ключи плюс `1s`, БЕЗ месяца: он непостоянной длины); используется для расчёта времени закрытия свечи и верхней границы окна при дозагрузке.

**Обозначения от шести часов и крупнее берутся ТОЛЬКО с суффиксом `utc`** — свечи выровнены с Binance и Bybit, сутки начинаются в полночь всемирного времени. Без суффикса OKX режет такую свечу от полуночи по UTC+8 (16:00 всемирного времени): «UTC+8 opening price k-line: [6H/12H/1D/2D/3D/1W/1M/3M] UTC+0 opening price k-line: [6Hutc/12Hutc/1Dutc/2Dutc/3Dutc/1Wutc/1Mutc/3Mutc]» — дословно у обеих ручек свечей (`/api/v5/market/candles`, `/api/v5/market/history-candles`) и в списке каналов потока (`candle6Hutc` … `candle1Mutc`). Интервалы в четыре часа и мельче суффикса не имеют и не нуждаются в нём: их сетка делит восьмичасовой сдвиг нацело.

## Retry

```
MAX_RETRIES = 3 (4 попытки: initial + 3)
RETRY_BASE_DELAY_MS = 1000
Backoff: 1s → 2s → 4s (exponential)
```

## Signing defaults

| Параметр | Binance | Bybit | OKX |
|----------|---------|-------|-----|
| recvWindow | 5000 ms | 5000 ms (в коде), 7000 ms (в константе) | не используется |
| timestamp | `Date.now()` | `Date.now()` | `Date.now()` в виде строки ISO 8601 (для входа в WebSocket — секунды) |
| Алгоритм | HMAC-SHA256 | HMAC-SHA256 | HMAC-SHA256, результат в base64 (не hex) |
| Расположение подписи | query string param `signature` | заголовок `X-BAPI-SIGN` | заголовок `OK-ACCESS-SIGN` (плюс `OK-ACCESS-KEY`, `OK-ACCESS-TIMESTAMP`, `OK-ACCESS-PASSPHRASE`) |
| Что подписывается | строка запроса | отметка+ключ+окно+тело | отметка + метод + путь с параметрами + тело |

## Маппинги (src/constants/mappings.ts)

### Position Side
- Binance: `LONG → Long`, `SHORT → Short`, `BOTH → Both`
- Bybit: `Buy → Long`, `Sell → Short`
- OKX: `long → Long`, `short → Short`, `net → Both`; отдельно `OKX_POSITION_IDX` (`net → 0`, `long → 1`, `short → 2`)

### Order Side
- Binance: `BUY → Buy`, `SELL → Sell`
- Bybit: `Buy → Buy`, `Sell → Sell`
- OKX: `buy → Buy`, `sell → Sell` (и обратная карта `OKX_ORDER_SIDE_REVERSE`)

### Order Type
- Binance: `MARKET → Market`, `LIMIT → Limit`, `STOP_MARKET → StopMarket`, `TAKE_PROFIT_MARKET → TakeProfitMarket`, `STOP → Stop`, `TAKE_PROFIT → TakeProfit`, `TRAILING_STOP_MARKET → TrailingStop`
- Bybit: `Market → Market`, `Limit → Limit`

### Order Type Reverse (Binance only)
- `market → 'MARKET'`, `limit → 'LIMIT'`, `stopMarket → 'STOP_MARKET'`, `takeProfitMarket → 'TAKE_PROFIT_MARKET'`, `stop → 'STOP'`, `takeProfit → 'TAKE_PROFIT'`, `trailingStop → 'TRAILING_STOP_MARKET'`

### Order Status
- Binance: `NEW` / `PARTIALLY_FILLED` → `'open'`, `FILLED` → `'closed'`, `CANCELED` / `EXPIRED` / `EXPIRED_IN_MATCH` → `'canceled'`, `REJECTED` → `'rejected'`
- Bybit: `New` / `PartiallyFilled` / `Untriggered` → `'open'`, `Filled` → `'closed'`, `Cancelled` / `PartiallyFilledCanceled` / `Deactivated` → `'canceled'`, `Rejected` → `'rejected'`

### Time In Force
- Binance: `GTC → Gtc`, `IOC → Ioc`, `FOK → Fok`, `GTX → PostOnly`
- Bybit: `GTC → Gtc`, `IOC → Ioc`, `FOK → Fok`, `PostOnly → PostOnly`

### Working Type (Binance only)
- `markPrice → 'MARK_PRICE'`, `contractPrice → 'CONTRACT_PRICE'`

## Precision (src/precision/precision.ts)

```
countDecimalPlaces("0.001") → 3
countDecimalPlaces("0.10") → 1  (trailing zeros removed)
countDecimalPlaces("1") → 0

roundToStep(value, step): number
  1. stepValue = parseFloat(step)
  2. Если stepValue === 0 или NaN → возвращает value
  3. decimals = countDecimalPlaces(step)
  4. rounded = Math.round(value / stepValue) * stepValue
  5. return parseFloat(rounded.toFixed(decimals))

amountToPrecision(tradeSymbol, amount): number → roundToStep(amount, filter.stepSize)
priceToPrecision(tradeSymbol, price): number → roundToStep(price, filter.tickSize)
```

## WebSocket sharding и Binance rate-limit константы (0.15.0–0.16.0)

| Константа | Значение | Где |
|-----------|----------|-----|
| DEFAULT_MAX_STREAMS_PER_CONNECTION | 900 | `src/ws/BinanceFuturesPublicStream.ts` (не в `src/constants/`) — дефолт для `maxStreamsPerConnection`, под лимит Binance 1024 стрима/соединение |
| BINANCE_REQUEST_WEIGHT_LIMIT_PER_MIN | 2400 | `src/http/binanceRateLimit.ts` |
| BINANCE_WEIGHT_THROTTLE_RATIO | 0.8 | `src/http/binanceRateLimit.ts` — порог троттлинга = `LIMIT × RATIO` = 1920 |
| BINANCE_WEIGHT_NEAR_CAP_COOLDOWN_MS | 2000 | `src/http/binanceRateLimit.ts` — пауза перед следующим `get()` при приближении к порогу |
| BINANCE_BAN_DEFAULT_COOLDOWN_MS | 30000 | `src/http/binanceRateLimit.ts` — запасной срок бана, когда ни заголовок, ни текст ошибки его не назвали |
| BINANCE_BAN_MAX_WAIT_MS | 900000 | `src/http/binanceRateLimit.ts` (07.09.2026, заменила `BINANCE_BAN_MAX_COOLDOWN_MS`=60000) — 15 минут: дольше запрос не ждёт даже названный биржей срок, сверх — честный отказ без отправки |
| BINANCE_BAN_RELEASE_SPACING_MS | 250 | `src/http/binanceRateLimit.ts` (07.09.2026) — шаг, с которым накопившиеся за время запрета ожидания выпускаются по одному, а не разом |
| WS_RECREATE_DEDUP_WINDOW_MS | 2000 | `src/ws/streamCommandRateLimit.ts` (0.25.0) — окно подавления повторного пересоздания соединения. ОДНО значение на все три публичных потока; до этого было объявлено трижды в трёх файлах |
| WS_FRAME_HEAD_SCAN_LENGTH | 200 | `src/ws/streamCommandRateLimit.ts` (0.25.0) — длина головы сырого кадра при беглом опознании темы стакана (ленивый разбор). Общая для Bybit и OKX |
| BINANCE_WS_CASCADE_RECREATE_STREAM_COUNT / BYBIT_WS_CASCADE_RECREATE_TOPIC_COUNT / OKX_WS_CASCADE_RECREATE_TOPIC_COUNT | 50 | `src/ws/streamCommandRateLimit.ts` — с этого числа тем переподписка заменяется пересозданием соединения. Три копии лежат рядом (у бирж разные потолки соединений, поэтому значение может разойтись), OKX переехала сюда из `src/constants/okx.ts` |

Подробности логики — `http-layer-binance.md` (раздел «Rate-limit awareness») и `websocket-layer-binance.md` (раздел «Binance Futures Public Stream»).

## Kline Loader (src/utils/klineLoader.ts)

```
KLINE_CHUNK_SIZE = 200

loadKlinesInChunks({ fetchKlines, symbolList, logger, chunkSize?, pauseBetweenChunksMs?, trimLastKline?, onChunkLoaded? }):
  1. Разбивает symbolList на чанки по chunkSize
  2. Каждый чанк — Promise.all() (параллельная загрузка)
  3. Чанки обрабатываются последовательно
  4. Если trimLastKline — удаляет последнюю (незакрытую) свечу
  5. Если onChunkLoaded — вызывает callback с Map результатами чанка
  6. Если pauseBetweenChunksMs > 0 — пауза между чанками
  7. Логирует прогресс: "Loaded klines for X/Y symbols"
  8. Возвращает Map<string, Kline[]>
```
