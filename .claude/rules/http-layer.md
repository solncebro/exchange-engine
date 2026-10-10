# HTTP Layer

Файл разросся за 30k знаков и разделён по теме (07.09.2026) — оба читать как один документ:

| Файл | О чём |
|---|---|
| `http-layer.md` (этот файл) | иерархия классов, `BaseHttpClient` (retry, rate-limit extension points), `BybitHttpClient`, `OkxHttpClient`, общие паттерны, type extraction |
| [`http-layer-binance.md`](http-layer-binance.md) | `BinanceBaseHttpClient`/`BinanceFuturesHttpClient`/`BinanceSpotHttpClient`: подпись, пересдача при протухшей отметке, rate-limit awareness (REQUEST_WEIGHT/HTTP 418/429) |

## Иерархия классов

```
BaseHttpClient (abstract)
├── BinanceBaseHttpClient (abstract)
│   ├── BinanceFuturesHttpClient
│   └── BinanceSpotHttpClient
│       └── BinanceSubAccountHttpClient (подсчёты, /sapi)
├── BybitHttpClient
│   └── BybitSubAccountHttpClient (подсчёты)
└── OkxHttpClient
```

## BaseHttpClient (src/http/BaseHttpClient.ts)

Базовый HTTP-клиент с retry-логикой и обработкой ошибок.
Ответы разбираются общей функцией `parseJsonPreservingLargeIntegers` через `transformResponse` Axios: целые числа вне безопасного диапазона JavaScript остаются точными десятичными строками до нормализации заявок. Дробные числа и исходные строки не меняются; пустой и не-JSON ответ ведут себя как прежде. Это относится также к телам ошибок.

### Защищённые методы (все HTTP-глаголы):
- `get<T>(url, params?, headers?): Promise<T>` — **единственный с retry**. `params`/`headers` принимают либо готовое значение, либо фабрику (`HttpQueryParamsSource`/`HttpHeadersSource` из `BaseHttpClient.types.ts`: `T | (() => T)`) — фабрика вызывается заново на КАЖДОЙ попытке, непосредственно перед отправкой (после `beforeRequest()`, то есть после ожидания по rate-limit). Нужно это подписанным запросам: подпись, собранная заранее, успевала протухнуть за время ожидания по весу (до 2s) и паузы перед повтором (до 4s) — биржа меряет возраст отметки времени на приёме, не на отправке
- `post<T>(url, data?, headers?): Promise<T>` — без retry, `data`/`headers` только готовым значением (фабрики не поддерживает)
- `postWithParams<T>(url, params?, headers?): Promise<T>` — параметры в query string
- `put<T>(url, data?, headers?): Promise<T>`
- `putWithParams<T>(url, params?, headers?): Promise<T>`
- `delete<T>(url, params?, headers?): Promise<T>`

### Private хелперы:
- `executeRequest<T>(label, fn): Promise<T>` — общая обёртка для non-GET методов (logging + error handling). Все методы кроме `get` делегируют в `executeRequest`. **С 07.09.2026 тоже проходит через `beforeRequest()`/`onResponse()`** — раньше паузу по rate-limit знали только чтения, и пока биржа держала адрес закрытым, постановка/отмена заявок продолжали стучаться, чем сам запрет и продлевали (см. «Rate-limit awareness» ниже)
- `enrichError(error: AxiosError): Error` — трансформирует AxiosError в читаемый Error перед re-throw. Используется в `executeRequest`. Логика:
  1. Binance no-op ошибки (`-4046`, `-4059`) — возвращает оригинальный error без изменений
  2. Тело со СВОИМ кодом биржи — `ExchangeError("[code] msg")` с этим кодом (`buildStructuredError`): `code`+`msg` у Binance и OKX, `retCode`+`retMsg` у Bybit. Текст сообщения тот же, что и прежде, а `ExchangeError` наследует `Error` — для тех, кто читает `message`, не изменилось ничего. Код с провода, пришедший строкой, приводится к числу общим `toWireErrorCode` (`src/utils/wireErrorCode.ts`; `toOkxErrorCode` — его переименовывающий вывоз): вызывающие сравнивают код с числовой константой, и строка `'50102'` такому сравнению не отвечает. **Зачем:** отказ, пришедший с кодом 200 в теле, разбирался по полю `code`, а тот же отказ с HTTP-статусом — только разбором текста; у OKX предел частоты 50011 документирован в обоих видах
  3. HTTP-ответ без структурированной ошибки — `Error("HTTP {status}: {message}")`
  4. Fallback (нет response) — оригинальный error
- `protected get errorExchangeLabel(): string` — обозначение биржи для `ExchangeError` из `enrichError`. База отдаёт пустую строку; называют его КОНКРЕТНЫЕ клиенты: `BinanceFuturesHttpClient` / `BinanceSpotHttpClient` (`'binance'`), `BybitHttpClient` (`'bybit'`), `OkxHttpClient` (`'OKX'`)

### Специальная обработка no-op ошибок Binance:
- `BaseHttpClient.handleError()` не логирует как error ответы Binance с кодами `-4046` и `-4059`
- Для этих кодов пишется `info`-лог с текстом `msg`, который вернула биржа
- Поведение применяется ко всем HTTP-методам (`get`, `post`, `put`, `delete`)

### Rate-limit extension points (`beforeRequest` / `onResponse`)
- `protected async beforeRequest(): Promise<void>` — no-op хук, вызывается в `get()` **перед** каждой попыткой (включая retry)
- `protected onResponse(status: number | undefined, headers: unknown, body?: unknown): void` — no-op хук (07.09.2026 добавлен третий параметр — `body`), вызывается после ответа: и на успехе (`response.status/headers/data`), и на ошибке (`axiosError.response?.status/headers/data`). Тело нужно наравне с заголовками: настоящий срок бана Binance называет в тексте ошибки `-1003`, не только в заголовке
- **Оба хука с 07.09.2026 вызываются и из `get()`, и из `executeRequest()`** — то есть из ВСЕХ HTTP-глаголов, не только из чтения. Раньше их вызывал только `get()`, и `post`/`put`/`delete` не ждали и не сообщали о запрете вовсе
- `BaseHttpClient` не переопределяет ни один из хуков (пустое тело); `BinanceBaseHttpClient` переопределяет оба для проактивного троттлинга (`http-layer-binance.md`, раздел «Rate-limit awareness»). Bybit и прочие наследники `BaseHttpClient` не переопределяют — поведение не меняется

### BybitHttpClient ошибки:
- Выбрасывает `ExchangeError` (из `src/errors/ExchangeError.ts`) с полями `code` и `exchange` для структурированной обработки ошибок.

### Retry-логика (только для GET)

Константы:
- `MAX_RETRIES = 3` (4 попытки: initial + 3 retry)
- `RETRY_BASE_DELAY_MS = 1000`

Что ретраится:
- Нет ответа от сервера (сетевые ошибки)
- HTTP 429 (rate limit)
- HTTP 5xx (серверные ошибки)

Задержка:
- **Exponential backoff**: 1s → 2s → 4s
- **429 с Retry-After**: используется значение заголовка (в секундах → ms)

Rate limiting в `BaseHttpClient` — **только реактивный** (нет proactive throttling). `BinanceBaseHttpClient` добавляет поверх проактивный троттлинг по REQUEST_WEIGHT через `beforeRequest`/`onResponse` (`http-layer-binance.md`, раздел «Rate-limit awareness») — Bybit и прочие наследники `BaseHttpClient` этим не затронуты.

## BybitHttpClient (src/http/BybitHttpClient.ts)

Независимый от Binance — наследует `BaseHttpClient` напрямую.

### Bybit signing (src/auth/bybitAuth.ts):
1. Формирует строку: `${timestamp}${apiKey}${recvWindow}${payload}`
2. `signature = HMAC-SHA256(signPayload, secret)` → hex
3. Возвращает заголовки:
   - `X-BAPI-API-KEY`, `X-BAPI-TIMESTAMP`, `X-BAPI-SIGN`, `X-BAPI-RECV-WINDOW`

Ключевое отличие от Binance: **signature в заголовках**, а не в query string.

### Валидация ответов:
- `validateResponse(data)` — бросает `ExchangeError` при `retCode !== 0` в ответе Bybit API

### Защищённые хелперы (protected с 0.26.0 — ими пользуется `BybitSubAccountHttpClient`):
- `authenticatedGet<T>(path, params)` — GET с подписью в заголовке, построенной фабрикой в момент отправки (см. «Подпись строится непосредственно перед отправкой» выше) — не заранее
- `authenticatedPost<T>(path, body)` — JSON.stringify body → подписывает → POST

### BybitSubAccountHttpClient (0.26.0, `extends BybitHttpClient`)
- `fetchSubMemberList()` → `GET /v5/user/query-sub-members`; `fetchApiKeyInfo()` → `GET /v5/user/query-api` (номер главного счёта `userID`, признак `isMaster`); `createUniversalTransfer(params)` → `POST /v5/asset/transfer/universal-transfer` (оба номера пользователя — числами); `fetchUniversalTransferList(transferId)` → `GET /v5/asset/transfer/query-universal-transfer-list`; `fetchAccountCoinsBalance({ memberId, accountType })` → `GET /v5/asset/transfer/query-account-coins-balance`. Демо-служба этих путей не обслуживает.

### Private хелпер:
- `buildCategoryParams(category, options?)` → `Record<string, ...>` — строит params с `{ category }` + optional `symbol`, `limit`, `orderId`, `settleCoin`, `baseCoin` и `orderFilter`. Используется в 7 методах: `fetchInstrumentsInfo`, `fetchTickers`, `getOpenOrders`, `getOrderHistory`, `getPositionList`, `getClosedPnl`, `fetchFeeRate`. `orderFilter` (0.16.0) — для `fetchOpenConditionalOrders(settleCoin)` (`BybitBaseClient`), передаётся как `OrderFilterEnum.StopOrder` через `getOpenOrders(category, { settleCoin, orderFilter })`

### Все методы используют категорию:
- `fetchInstrumentsInfo(category, options?)` → `BybitListResponse<BybitInstrumentInfoRaw>` — GET `/v5/market/instruments-info`
- `fetchTickers(category, options?)` → `BybitListResponse<BybitTickerRaw>` — GET `/v5/market/tickers`
- `fetchOrderBook(category, symbol, limit?)` → `BybitResponse<BybitOrderBookRaw>` — GET `/v5/market/orderbook`
- `fetchKline(args)` → `BybitListResponse<string[]>` — GET `/v5/market/kline` (с конвертацией интервалов)
- `fetchRecentTrades(category, symbol, limit?)` → `BybitListResponse<BybitPublicTradeRaw>` — GET `/v5/market/recent-trade`
- `fetchFundingHistory(category, symbol, options?)` → `BybitListResponse<BybitFundingRateHistoryRaw>` — GET `/v5/market/funding/history`
- `fetchOpenInterest(category, symbol, options?)` → `BybitListResponse<BybitOpenInterestRaw>` — GET `/v5/market/open-interest`
- `createOrder(params)` → `BybitResponse<BybitOrderResponseRaw>` — POST `/v5/order/create`
- `amendOrder(params)` → POST `/v5/order/amend`
- `cancelOrder(params)` → `BybitResponse<{ orderId, orderLinkId }>` — POST `/v5/order/cancel`
- `cancelAllOrders(category, symbol?)` → POST `/v5/order/cancel-all`
- `getOpenOrders(category, options?)` → `BybitListResponse<BybitOrderResponseRaw>` — GET `/v5/order/realtime`
- `getOrderHistory(category, options?)` → `BybitListResponse<BybitOrderResponseRaw>` — GET `/v5/order/history`
- `createBatchOrders(category, requestList)` → POST `/v5/order/create-batch`. Max 20 ордеров (linear/inverse/option), 10 (spot). Chunking — на уровне `BybitBaseClient.createBatchOrders` через `batchChunkSize`.
- `cancelBatchOrders(category, requestList)` → POST `/v5/order/cancel-batch`. Те же лимиты. Chunking — на уровне `BybitBaseClient.cancelBatchOrders`.
- `amendBatchOrders(category, requestList)` → `BybitAmendBatchOrdersResponse` — POST `/v5/order/amend-batch`. Max 20 ордеров (linear/inverse/option), 10 (spot). Per-order success/error в `retExtInfo.list[]` (`code === 0` = успех). Chunking — на уровне `BybitBaseClient.modifyBatchOrders`.
- `getPositionList(category, options?)` → `BybitListResponse<BybitPositionRaw>` — GET `/v5/position/list`
- `getClosedPnl(category, options?)` → `BybitListResponse<BybitClosedPnlRaw>` — GET `/v5/position/closed-pnl`
- `fetchFeeRate(category, options?)` → `BybitListResponse<BybitFeeRateRaw>` — GET `/v5/account/fee-rate`
- `fetchTransactionLog(options?: FetchTransactionLogArgs)` → `BybitListResponse<BybitTransactionLogRaw>` — GET `/v5/account/transaction-log`, ОДНА страница. `FetchTransactionLogArgs extends CategoryFilterArgs` добавляет `startTime?`/`endTime?`/`cursor?` (10.09.2026), пробрасываемые как есть в params
- `fetchAllTransactionLog(options?: FetchTransactionLogArgs)` → `BybitTransactionLogRaw[]` — журнал операций за окно ЦЕЛИКОМ: страницы дочитываются по `nextPageCursor` (конец — отсутствие поля или пустая строка), потолок `BYBIT_TRANSACTION_LOG_MAX_PAGE_COUNT` (200, `src/constants/bybit.ts`). В отличие от списка инструментов при потолке НЕ возвращает частичный результат, а бросает «reached the page count limit»: по усечённому журналу посчитают фандинг и не узнают, что половины начислений в нём не было. Единственный потребитель — `BybitBaseClient.fetchIncome`
- `setLeverage(args)` → POST `/v5/position/set-leverage`
- `switchIsolated(args)` → POST `/v5/position/switch-isolated`
- `fetchWalletBalance(accountType)` → `BybitResponse<BybitWalletBalanceRaw>` — GET `/v5/account/wallet-balance`
- `fetchAccountInfo()` → GET `/v5/account/info`
- `setMarginMode(mode)` → POST `/v5/account/set-margin-mode`
- `setPositionMode(category, mode, coin?)` → POST `/v5/position/switch-mode`
- `setTradingStop(params)` → POST `/v5/position/trading-stop`
- `fetchAllInstrumentsInfo(category)` → `BybitInstrumentInfoRaw[]` — пагинация через cursor, возвращает полный список инструментов. Число страниц ограничено `BYBIT_INSTRUMENTS_MAX_PAGE_COUNT` (20, `src/constants/bybit.ts`): страница — 1000 записей, всех инструментов на порядок меньше, поэтому потолок ничего не отсекает — он останавливает сбойный курсор, который биржа отдаёт бесконечно. При достижении потолка — `logger.warn(... reached the page count limit ...; returning a partial result)`, как у OKX (`OKX_MAX_PAGE_COUNT`) и Binance (`USER_TRADE_MAX_PAGE_COUNT`)
- `buildCategoryParams(category, options?)` собирает необязательные параметры общим `buildOptionalParams` (`src/utils/httpParams.ts`) вместо девяти написанных вручную проверок. Помощник кладёт только заданные значения и СОХРАНЯЕТ порядок объявления — по той же строке строится подпись Bybit. Числа НЕ приводит к строкам: приведение — необязательный преобразователь помощника, и его подставляет только OKX

## OkxHttpClient (src/http/OkxHttpClient.ts)

Независимый от Binance и Bybit — наследует `BaseHttpClient` напрямую. Один клиент на оба рынка: инструмент задаётся параметром `instType` (`'SWAP' | 'SPOT'`).

### Кодовая фраза
Конструктор бросает `ExchangeError('OKX API requires a passphrase (ExchangeConfig.passphrase)', 'OKX_PASSPHRASE_REQUIRED', 'OKX')` при пустой строке. Это и есть точка, где `new Exchange(ExchangeNameEnum.Okx, ...)` отказывает без кодовой фразы.

### OKX signing (src/auth/okxAuth.ts):
1. Строка для подписи: `${timestamp}${method}${requestPath}${body}` — путь берётся ВМЕСТЕ с параметрами запроса (`buildRequestPath` сериализует их тем же `serializeQueryParams`, что и axios: подписанная и отправленная строки байт-в-байт совпадают).
2. `sign = HMAC-SHA256(...)` → **base64** (не hex, как у соседей).
3. Заголовки: `OK-ACCESS-KEY`, `OK-ACCESS-SIGN`, `OK-ACCESS-TIMESTAMP` (ISO 8601 от `Date.now()`), `OK-ACCESS-PASSPHRASE`.
4. В демо-режиме ко ВСЕМ запросам (в том числе публичным) добавляется `x-simulated-trading: 1` — адрес REST у OKX один и тот же.

Подпись собирается **в момент отправки**: `signedGet` передаёт в `get()` фабрику заголовков, поэтому на каждой повторной попытке отметка времени свежая.

### Валидация ответов
- `validateResponse(response)` — сначала СТОРОЖ ФОРМАТА (`isOkxApiResponseShape`): тело обязано быть объектом с текстовым полем `code`, иначе `ExchangeError('OKX_UNEXPECTED_RESPONSE_FORMAT')`. Без него тело с кодом 200, но не в формате OKX (страница защиты перед биржей, посредник со своим текстом) роняло клиент внутренней ошибкой языка «Cannot read properties of undefined (reading 'trim')», а повтор по превышению частоты, ловящий только `ExchangeError` с кодом 50011, мимо неё пролетал. Соседи защищены так же: Bybit смотрит `retCode !== undefined`, Binance — `'code' in response`. Дальше `code !== '0'` → `ExchangeError` с числовым кодом (`toOkxErrorCode`).
- `validateOrderResponse(response)` — исход ОТДЕЛЬНОЙ заявки лежит в поэлементном `sCode`/`sMsg`, и он проверяется ВСЕГДА, а не только при неуспешном конверте: биржа отвечает `code: '0'` и кладёт в запись отказ (`sCode: '51008'`) с пустым номером заявки. Пустой ответ → `OKX_EMPTY_ORDER_RESPONSE`.
- `validateBatchResponse(response)` — пропускает коды из `OKX_BATCH_ACCEPTED_CODE_LIST` (`'0'`, `'1'`, `'2'`): при частичном и даже полном отказе поэлементные исходы лежат внутри, и отдать их вызывающему важнее, чем бросить исключение. **Но если записей нет вовсе, а код не успешный**, пакет отвергнут ДО поштучной обработки, и единственная причина лежит в `msg` конверта — тогда бросается `ExchangeError` с этим текстом; иначе текст биржи не доходил до вызывающего никогда.
- `logExpectedErrorCode` — коды из `OKX_EXPECTED_ERROR_CODE_LIST` (51603, 51400, 51503) пишутся уровнем info: их разбирает вызывающий, это не аварии.

### Повтор при пределе частоты и пересдача при протухшей отметке
- `getValidated` — при `ExchangeError` с кодом `OKX_RATE_LIMIT_ERROR_CODE` (50011) ждёт `OKX_RATE_LIMIT_RETRY_DELAY_MS` (1000 мс) и повторяет запрос ОДИН раз.
- `signedRequest(send)` — обёртка всех подписанных запросов: при отказе, распознанном `isOkxStaleTimestampError` (`src/http/okxTimestampError.ts`, код 50102), запрос собирается и подписывается заново; попыток `OKX_STALE_TIMESTAMP_ATTEMPT_LIMIT` (2), то есть одна пересдача.
- `signedPost` дополнительно превращает `code === '50102'` в исключение ДАЖЕ при HTTP 200: OKX отвечает на протухшую отметку успешным HTTP-кодом, и без этого пересдача не сработала бы.

### Постраничное дочитывание
- `fetchAllPendingOrders(args)` — страницы по `OKX_ORDER_PAGE_LIMIT` (100), следующая адресуется последним `ordId`; потолок `OKX_MAX_PAGE_COUNT` (50) с предупреждением о неполном результате.
- `fetchAllPendingAlgoOrders(args)` — то же по `algoId`. Без дочитывания список защитных заявок молча обрывался бы на сотне. Вызывается клиентом по одному разу на КАЖДЫЙ вид условной заявки — вход `orders-algo-pending` принимает перечисление через запятую только для пары `conditional,oco`.
- `fetchIndexTickers({ instId?, quoteCcy? })` → `GET /api/v5/market/index-tickers` (публичная, «Either quoteCcy or instId is required»). Индексная цена приходит ТОЛЬКО отсюда: ответ цены маркировки её не несёт. Обозначение индекса — контракт без хвоста `-SWAP`.
- `fetchInstruments`, `fetchBills` и прочее постранично НЕ дочитываются (у журнала начислений полная страница даёт отказ на уровне клиента — см. `exchange-layer-okx.md`).

### Приватные хелперы
- `buildRequestPath(path, params)` — путь с сериализованной строкой запроса (нужен для подписи).
- `buildOkxOptionalParams(entryList)` — тот же общий `buildOptionalParams` (`src/utils/httpParams.ts`), что и у Bybit, но с преобразователем `toOkxParamValue`: OKX ждёт параметры строками. Преобразователь — необязательный второй аргумент помощника (`HttpParamValueTransform`), без него значения идут как есть (Bybit оставляет числа числами).
- `buildTimeRangeParams(options)` — `after` / `before` / `limit`.
- `publicGet` / `signedGet` / `signedPost` — три способа отправки.

### Эндпоинты

Публичные (`publicGet`):
- `fetchInstruments(instType)` → `/api/v5/public/instruments`
- `fetchTickers(instType)` → `/api/v5/market/tickers`
- `fetchCandles(args)` / `fetchHistoryCandles(args)` → `/api/v5/market/candles` и `/api/v5/market/history-candles`
- `fetchOrderBook(instId, depth?)` → `/api/v5/market/books`
- `fetchTrades(instId, limit?)` → `/api/v5/market/trades`
- `fetchMarkPrice(instType, instId?)` → `/api/v5/public/mark-price`
- `fetchOpenInterest(instType, instId)` → `/api/v5/public/open-interest`
- `fetchFundingRate(instId)` → `/api/v5/public/funding-rate`
- `fetchFundingRateHistory(args)` → `/api/v5/public/funding-rate-history`

Счёт и позиции (`signedGet` / `signedPost`):
- `fetchBalance()` → `/api/v5/account/balance`
- `fetchPositions(args)` → `/api/v5/account/positions`
- `fetchPositionsHistory(args)` / `fetchAllPositionsHistory(args)` → `/api/v5/account/positions-history` (постранично, курсор — `uTime` закрытия)
- `fetchAccountConfig()` → `/api/v5/account/config`
- `setPositionMode(posMode)` → `/api/v5/account/set-position-mode`
- `setLeverage(args)` → `/api/v5/account/set-leverage`
- `fetchTradeFee(args)` → `/api/v5/account/trade-fee`
- `fetchBills(args)` → `/api/v5/account/bills` либо `/api/v5/account/bills-archive` (по признаку `isArchive`)

Обычная книга заявок:
- `placeOrder(params)` → `/api/v5/trade/order`
- `placeBatchOrders(paramsList)` → `/api/v5/trade/batch-orders`
- `cancelOrder(params)` → `/api/v5/trade/cancel-order`
- `cancelBatchOrders(paramsList)` → `/api/v5/trade/cancel-batch-orders`
- `amendOrder(params)` / `amendBatchOrders(paramsList)` → `/api/v5/trade/amend-order` и `/api/v5/trade/amend-batch-orders`
- `fetchOrder(args)` → `/api/v5/trade/order`
- `fetchPendingOrders(args)` / `fetchAllPendingOrders(args)` → `/api/v5/trade/orders-pending`
- `fetchOrderHistory(args)` / `fetchAllOrderHistory(args)` → `/api/v5/trade/orders-history` либо `-archive` (постранично, курсор — `ordId`)

Условная (algo) служба:
- `placeAlgoOrder(params)` → `/api/v5/trade/order-algo`
- `cancelAlgoOrders(paramsList)` → `/api/v5/trade/cancel-algos`
- `amendAlgoOrder(params)` → `/api/v5/trade/amend-algos`
- `fetchAlgoOrder(args)` → `/api/v5/trade/order-algo`
- `fetchPendingAlgoOrders(args)` / `fetchAllPendingAlgoOrders(args)` → `/api/v5/trade/orders-algo-pending`
- `fetchAlgoOrderHistory(args)` / `fetchAllAlgoOrderHistory(args)` → `/api/v5/trade/orders-algo-history` (постранично, курсор — `algoId`; окна по времени этот вход не принимает)

Все пять постраничных чтений (`fetchAllPendingOrders`, `fetchAllPendingAlgoOrders`, `fetchAllOrderHistory`, `fetchAllAlgoOrderHistory`, `fetchAllPositionsHistory`) идут через один приватный `fetchAllPages<T>(args: FetchOkxAllPagesArgs<T>)`: страница читается через `fetchPage(after)`, курсор берётся из последней записи (`resolveCursor`), чтение прекращается на короткой странице, по достижении `maxRecordCount` (если задан) либо на `OKX_MAX_PAGE_COUNT` — в последнем случае с предупреждением в журнал.

Пакетные ручки принимают тело-МАССИВ (`HttpPostBody` в `BaseHttpClient.types.ts` допускает и объект, и массив) — у OKX пачка передаётся именно так.

## Паттерн для optional symbol

```typescript
async fetchSomething(symbol?: string): Promise<...> {
  const params: Record<string, string | number | boolean> = {};

  if (symbol !== undefined) {
    params.symbol = symbol;
  }

  return this.get<...>('/endpoint', params);
}
```

## Паттерн для time range options

```typescript
async fetchSomething(symbol: string, options?: FetchPageWithLimitArgs): Promise<...> {
  const params: Record<string, string | number | boolean> = { symbol };
  applyTimeRangeOptions(params, options);

  return this.get<...>('/endpoint', params);
}
```

## Type Extraction

Типы вынесены в co-located `.types.ts` файлы:
- `BaseHttpClient.types.ts` — BaseHttpClientArgs
- `BinanceBaseHttpClient.types.ts` — BinanceEndpoints, BinanceHttpClientArgs, BinanceErrorResponse, BinanceListenKeyResponse
- `BybitHttpClient.types.ts` — BybitHttpClientArgs, BybitApiResponse, BybitListResponse, BybitResponse, BybitOrderBookRaw (дублируется из normalizer), FetchBybitKlineArgs, SetBybitLeverageArgs, SwitchBybitIsolatedArgs, SymbolFilterArgs, SymbolLimitFilterArgs (`orderFilter?: string` — 0.16.0, для `fetchOpenConditionalOrders`), PeriodFilterArgs, CategoryFilterArgs, FetchTransactionLogArgs (`extends CategoryFilterArgs`, добавляет `startTime?`/`endTime?` — 0.18.2, для `fetchTransactionLog`), BybitAmendBatchOrderRaw, BybitAmendBatchOrderExtInfo, BybitAmendBatchOrdersResponse (структура аналогична `BybitCancelBatchOrdersResponse`: `result.list[]` — основные данные с `orderId`/`orderLinkId`, `retExtInfo.list[]` — per-order success/error через `{ code, msg }`)
- `OkxHttpClient.types.ts` — OkxHttpClientArgs, OkxApiResponse<T> (`{ code, msg, data }`), OkxInstrumentType (`'SWAP' | 'SPOT'`), OkxTimeRangeArgs (`after`/`before`/`limit`) и наследующие его Fetch*Args, SetOkxLeverageArgs, FetchOkxTradeFeeArgs, FetchOkxBillsArgs, FetchOkxOrderArgs, FetchOkxPendingOrdersArgs, FetchOkxOrderHistoryArgs, CancelOkxOrderParams, CancelOkxAlgoOrderParams, FetchOkxAlgoOrderArgs, FetchOkxPendingAlgoOrdersArgs, FetchOkxAlgoOrderHistoryArgs
- `okxTimestampError.ts` — `isOkxStaleTimestampError(error)` (код 50102 в `ExchangeError` или в тексте обогащённой ошибки)
- `binanceRateLimit.ts` (не `.types.ts`, но чистый модуль без класса) — константы + чистые функции `parseUsedWeight1m`, `parseRetryAfterMs`, `parseBinanceBanUntilMs`, `observeRateLimitResponse` для проактивного троттлинга Binance (см. «Rate-limit awareness» выше)
- `binanceRequestGate.ts` — класс `BinanceRequestGate` (память лимитов и очередь ожидания, общая на адрес) + реестр `getBinanceRequestGate(baseUrl)`/`resetBinanceRequestGateRegistry()`
