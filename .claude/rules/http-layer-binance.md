# HTTP Layer — Binance

Часть `http-layer.md` (см. индекс там). `BinanceBaseHttpClient`, `BinanceFuturesHttpClient`, `BinanceSpotHttpClient` — всё специфичное для Binance: подпись, пересдача при протухшей отметке, rate-limit awareness (REQUEST_WEIGHT/HTTP 418/429).

## BinanceBaseHttpClient (src/http/BinanceBaseHttpClient.ts)

Добавляет Binance-специфичное:

### Signing-обёртки:
- `signedGet<T>(path, params?)` — подпись строится фабрикой внутри `get()`: `signRequest(params).signedParams` вызывается заново на каждой попытке (retry `get()` и пересдача при протухшей отметке, см. ниже), заголовки — статический `authHeaders()`
- `signedPost<T>(path, params?)` — то же для POST, через `signedSend` (подпись строится один раз непосредственно перед отправкой — `postWithParams` без внутреннего retry)
- `signedPut<T>(path, params?)` — то же для PUT (через `putWithParams` + `validateResponse`); используется в `modifyOrder`/`modifyBatchOrders`
- `signedDelete<T>(path, params?)` — то же для DELETE
- `authHeaders()` → `{ 'X-MBX-APIKEY': apiKey }`

### Валидация ответов:
- `validateResponse(data)` — бросает `ExchangeError` при `code < 0` в ответе Binance API

### Private хелперы:
- `signRequest(params)` → `{ signedParams, headers }` — единая точка подписи (`timestamp = Date.now()` берётся в момент вызова), используется всеми signed-методами
- `signedSend<T>(params, send)` — подписывает `params` один раз и сразу передаёт в `send(signedParams, headers)`; используется `signedPost`/`signedPut`/`signedDelete`
- `signedRequest<T>(send: () => Promise<T>)` — общая точка для всех signed-методов (включая `signedGet`, где `send` сам оборачивает лениво пересобираемую подпись): выполняет `send()`, валидирует ответ через `validateResponse`, и при отказе биржи по протухшей отметке времени (см. «Пересдача при протухшей отметке» ниже) пересобирает запрос через повторный вызов `send()` — до `STALE_TIMESTAMP_ATTEMPT_LIMIT` (2) попыток
- `buildOptionalSymbolParams(symbol?)` → `Record<string, ...>` — protected, строит params с optional symbol (используется в `getOpenOrders` и наследниках)

### Binance signing (src/auth/binanceAuth.ts):
1. Добавить `timestamp = Date.now()` и `recvWindow = BINANCE_RECV_WINDOW_MS` (5000) к params
2. Собрать query string через `serializeQueryParams` (`src/utils/serializeQueryParams.ts`) — `URLSearchParams` поверх `Object.entries`, сохраняет порядок вставки
3. `signature = HMAC-SHA256(queryString, secret)` → hex
4. Добавить `signature` к params

**Wire-parity (критично):** `BaseHttpClient` настраивает axios `paramsSerializer.serialize = serializeQueryParams` — та же функция, что и при подписи. Это гарантирует, что строка, реально отправляемая axios, байт-в-байт совпадает с подписанной (иначе спецсимволы `,`/`:` в payload, например JSON batch-ордеров, ломают подпись → Binance `-1022`). Тот же сериализатор применяется к Bybit GET (`BybitHttpClient.authenticatedGet`), где Bybit REST recvWindow = `BYBIT_RECV_WINDOW` (7000).

### Подпись строится непосредственно перед отправкой (0.22.0)

И Binance, и Bybit подписывают запрос заново на каждую фактическую отправку, а не один раз заранее — иначе отметка времени, поставленная до ожидания по rate-limit/паузы перед повтором, приезжает на биржу уже протухшей (биржа меряет возраст на приёме).

- **Binance**: `signedGet` передаёт в `get()` фабрику параметров (`() => this.signRequest(params).signedParams`) — она вызывается на каждой попытке внутри `get()`. `signedPost`/`signedPut`/`signedDelete` подписывают один раз внутри `signedSend`, но сам `signedSend` обёрнут в `signedRequest` — при отказе по протухшей отметке `signedRequest` вызывает `send` заново, и та же замыкающая функция пересобирает подпись со свежим `timestamp`
- **Bybit**: `authenticatedGet` передаёт в `get()` фабрику заголовков (`() => this.buildAuthHeaders(serializeQueryParams(params))`) — подпись в заголовке (`X-BAPI-SIGN`/`X-BAPI-TIMESTAMP`) пересобирается на каждой попытке `get()`. Query-параметры не несут отметку времени у Bybit (она только в заголовках), поэтому им фабрика не нужна

### Пересдача при протухшей отметке времени (-1021, src/http/binanceTimestampError.ts)

Только Binance (Bybit-эквивалента нет — не требуется, т.к. отдельного HTTP 400 «stale timestamp» кода в текущем флоу не встречалось).

- `BINANCE_STALE_TIMESTAMP_CODE = -1021` — код Binance «Timestamp for this request is outside of the recvWindow»
- `isBinanceStaleTimestampError(error)` → `boolean` — распознаёт код и в `ExchangeError.code`, и в тексте обогащённого `Error` (`enrichError` в `BaseHttpClient` форматирует его как `[-1021] ...`)
- `signedRequest` в `BinanceBaseHttpClient` — единственное место, где это используется: при поимке ошибки, если `isBinanceStaleTimestampError(error)` истинно и попыток ещё не исчерпано (`STALE_TIMESTAMP_ATTEMPT_LIMIT = 2` — то есть одна пересдача), запрос собирается и подписывается заново с текущим `Date.now()`. HTTP 400 не входит в `isRetryable()` `BaseHttpClient`, поэтому обычный retry-механизм `get()` эту ошибку не трогает — пересдача идёт отдельным, более узким путём
- Применяется ко всем четырём signed-обёрткам: `signedGet`/`signedPost`/`signedPut`/`signedDelete` — включая постановку заявки (`createOrder` → `signedPost`), где повтор безопасен именно потому, что отвергнутый запрос до книги биржи не дошёл

### Rate-limit awareness (REQUEST_WEIGHT / HTTP 418, src/http/binanceRateLimit.ts + src/http/binanceRequestGate.ts)

Binance банит IP по совокупному весу запросов (`REQUEST_WEIGHT`, 2400/мин) и отвечает HTTP 418 при уже случившемся бане (429 — предупреждение перед 418). `BinanceBaseHttpClient` переопределяет `beforeRequest`/`onResponse`, подключая проактивный троттлинг поверх реактивного retry `BaseHttpClient`.

**Память лимитов — ОБЩАЯ на адрес, а не на экземпляр клиента (07.09.2026, `BinanceRequestGate`, `getBinanceRequestGate(baseUrl)`).** И вес, и запрет биржа считает по хосту целиком, а подключений в процессе больше одного (рыночные данные и ордера — разные коннекторы); пока память жила в поле instance `BinanceBaseHttpClient`, запрет, увиденный одним подключением, второго не останавливал. Реестр `gateByHost: Map<string, BinanceRequestGate>` — один сторож на хост (`new URL(baseUrl).host`) на весь процесс; `resetBinanceRequestGateRegistry()` — только для тестов.

- `beforeRequest()` → `requestGate.waitForTurn(logger)` — открытая дверь не стоит ничего; закрытая ставит вызывающего в очередь (`releaseTail`) и усыпляет до настоящего срока снятия
- `onResponse(status, headers, body)` → `requestGate.observe({ status, headers, body, logger })` — чистая `observeRateLimitResponse({ status, headers, body, nowMs })` (`binanceRateLimit.ts`) разбирает ответ и отдаёт `{ usedWeight, banUntilMs, throttleUntilMs }`:
  - `usedWeight` — из заголовка `x-mbx-used-weight-1m` (`parseUsedWeight1m`)
  - `banUntilMs` — при `status === 418 || status === 429`, ИЛИ когда тело несёт срок само по себе: **берётся ПОЗДНИЙ** из заголовка `retry-after` (`parseRetryAfterMs`) и текста ошибки `-1003` (`parseBinanceBanUntilMs`, ищет `banned until (\d{10,})` в поле `msg`) — они приходят не всегда вместе, а верить надо тому, что дальше, иначе стук возобновится раньше времени. Ни то ни другое не названо → запасной `BINANCE_BAN_DEFAULT_COOLDOWN_MS` (30s) от текущего момента
  - `throttleUntilMs` — `usedWeight >= BINANCE_REQUEST_WEIGHT_LIMIT_PER_MIN * BINANCE_WEIGHT_THROTTLE_RATIO` (2400 × 0.8 = 1920) → `nowMs + BINANCE_WEIGHT_NEAR_CAP_COOLDOWN_MS` (2000ms)
- **Потолок ожидания — 15 минут (`BINANCE_BAN_MAX_WAIT_MS`), не минута.** До 07.09.2026 любой названный срок обрезался до `BINANCE_BAN_MAX_COOLDOWN_MS` (60s, константа удалена) — и 06.09.2026 биржа просила подождать 8 минут, клиент ждал одну и стучался снова, 252 попытки в закрытую дверь, а такие попытки запрет по правилам биржи ПРОДЛЕВАЮТ. Срок дальше 15 минут (наказание на часы/сутки) — не ожидание, а честный отказ без отправки: `waitOutStop` бросает `ExchangeError` с датой снятия и кодом `-1003`
- **Накопившиеся за время запрета ожидания выпускаются ПО ОДНОМУ, с шагом `BINANCE_BAN_RELEASE_SPACING_MS` = 250 мс**, а не разом — за восемь минут запрета одних только периодических сверок набирается несколько десятков, и выпуск залпом в первый же миг после снятия дал бы ровно тот залп, за который запрет и выдали
- Про сам запрет и его снятие сторож говорит РОВНО ОДИН РАЗ (`announceBan`/`announceBanLifted`) — `logger.error(...until <ISO>... holding every request for Ns)` при обнаружении, `logger.warn('Binance lifted the refusal — requests are going out again')` при снятии; про приближение к потолку веса — не чаще раза в минуту (`THROTTLE_LOG_WINDOW_MS`)
- **Пауза с 07.09.2026 держит и `executeRequest()`** (см. выше) — то есть запросы на запись (`post`/`put`/`delete`: постановка заявки, отмена, batch) тоже ждут своей очереди, а не продолжают стучаться в закрытую дверь
- `readState(): ExchangeRateLimitState` (`getRateLimitState()` у клиента, см. `exchange-layer.md`) — `usedWeight`/`weightLimit`/`observedAtMs` последнего наблюдения плюс `bannedUntilMs` (`null`, если срок уже прошёл); наружу это единственный способ спросить биржевой слой «сколько запаса осталось», не делая сетевого запроса
- Константы: `BINANCE_REQUEST_WEIGHT_LIMIT_PER_MIN = 2400`, `BINANCE_WEIGHT_THROTTLE_RATIO = 0.8`, `BINANCE_WEIGHT_NEAR_CAP_COOLDOWN_MS = 2000`, `BINANCE_BAN_DEFAULT_COOLDOWN_MS = 30000`, `BINANCE_BAN_MAX_WAIT_MS = 900000` (15 мин), `BINANCE_BAN_RELEASE_SPACING_MS = 250`
- HTTP 418/429 не входят в `isRetryable()` (`BaseHttpClient`) — не ретраятся автоматически; ожидание применяется к СЛЕДУЮЩЕМУ запросу через `beforeRequest`, а не к текущему
- Логика разбора ответа вынесена в чистые функции без побочных эффектов (`parseUsedWeight1m`, `parseRetryAfterMs`, `parseBinanceBanUntilMs`, `observeRateLimitResponse`) — тестируются изолированно (`test/http/binanceRateLimit.test.ts`); сам сторож с очередью ожидания и реестром по хосту — `test/http/binanceRequestGate.test.ts`

### Общие эндпоинты (реализованы в base):
- `fetchExchangeInfo()` → `BinanceExchangeInfoRaw` — GET `endpoints.exchangeInfo`
- `fetchTickers()` → `BinanceTicker24hrRaw[]` — GET `endpoints.ticker24hr`
- `fetchOrderBook(symbol, limit?)` → `BinanceOrderBookRaw` — GET `endpoints.depth`
- `fetchKlines(symbol, interval, options?)` → GET `endpoints.klines`
- `fetchTrades(symbol, limit?)` → `BinancePublicTradeRaw[]` — GET `endpoints.trades`
- `fetchAccount()` → `BinanceAccountRaw` — signedGet `endpoints.account`
- `createOrder(params)` → `BinanceOrderResponseRaw` — signedPost `endpoints.order`
- `cancelOrder(symbol, orderId)` → `BinanceOrderResponseRaw` — signedDelete `endpoints.order`
- `getOrder(symbol, orderId)` → `BinanceOrderResponseRaw` — signedGet `endpoints.order`
- `getOpenOrders(symbol?)` → `BinanceOrderResponseRaw[]` — signedGet `endpoints.openOrders`
- `getAllOrders(symbol, options?)` → `BinanceOrderResponseRaw[]` — signedGet `endpoints.allOrders`
- `createListenKey()` / `keepAliveListenKey()` / `deleteListenKey()` — для user data stream

### BinanceEndpoints интерфейс:
```
exchangeInfo, ticker24hr, depth, klines, trades,
order, openOrders, allOrders, account, listenKey
```

Реализация в подклассах — разные префиксы путей:
- Futures: `/fapi/v1/*` и `/fapi/v3/account`
- Spot: `/api/v3/*`

## BinanceFuturesHttpClient

Дополнительные методы (фьючерсные):
- `fetchFuturesAccount()` → `BinanceFuturesAccountRaw` — signedGet `endpoints.account`
- `fetchFundingInfo(symbol?)` → `BinanceFundingInfoRaw[]` — GET `/fapi/v1/fundingInfo` (public)
- `fetchPositionMode()` → signedGet `/fapi/v1/positionSide/dual`
- `fetchMarkPrice(symbol?)` → `BinanceMarkPriceRaw | BinanceMarkPriceRaw[]` — GET `/fapi/v1/premiumIndex`
- `fetchFundingRateHistory(symbol, options?)` → `BinanceFundingRateHistoryRaw[]` — GET `/fapi/v1/fundingRate`
- `fetchPositionRisk(symbol?)` → `BinancePositionRiskRaw[]` — signedGet `/fapi/v3/positionRisk`
- `fetchOpenInterest(symbol)` → `BinanceOpenInterestRaw` — GET `/fapi/v1/openInterest`
- `setLeverage(symbol, leverage)` → signedPost `/fapi/v1/leverage`
- `setMarginType(symbol, marginType)` → signedPost `/fapi/v1/marginType`
- `setPositionMode(dualSidePosition)` → signedPost `/fapi/v1/positionSide/dual`
- `modifyOrder(params)` → `BinanceOrderResponseRaw` — PUT с ручным signing через `buildBinanceSignedParams`
- `cancelAllOrders(symbol)` → signedDelete `/fapi/v1/allOpenOrders`
- `createBatchOrders(orderList)` → `BinanceOrderResponseRaw[]` — signedPost `/fapi/v1/batchOrders`. Max 5 ордеров на запрос (chunking — на уровне `BinanceFutures.createBatchOrders`)
- `cancelBatchOrders(symbol, orderIdList)` → signedDelete `/fapi/v1/batchOrders`. Max 10 ордеров (chunking — на уровне `BinanceFutures.cancelBatchOrders`). Параметр `orderIdList` сериализуется через `serializeBinanceOrderIdList` (`src/utils/binanceOrderId.ts`) — массив **чисел** без кавычек (`[123,456]`), НЕ `JSON.stringify` строкового массива: строковый вариант (`["123"]`) Binance отвергает кодом `-1130` («Data sent for parameter 'orderidlist' is not valid»), и весь запрос падает исключением из `validateResponse`. Нечисловой идентификатор бросает ошибку в сериализаторе (защита от `JSON.stringify([NaN]) === '[null]'`)
- `modifyBatchOrders(orderList)` → `Array<Record<string, unknown>>` (смесь успехов и ошибок per-order; элементы с `code < 0` — ошибки) — PUT `/fapi/v1/batchOrders` с ручным signing через `buildBinanceSignedParams` (аналогично `modifyOrder`). Max 5 ордеров (chunking — на уровне `BinanceFutures.modifyBatchOrders`)
- `fetchCommissionRate(symbol?)` → `BinanceCommissionRateRaw` — signedGet `/fapi/v1/commissionRate`
- `fetchIncome(options?: FetchIncomeArgs)` → `BinanceIncomeRaw[]` — signedGet `/fapi/v1/income`. При `options.incomeType === 'funding'` добавляет параметр `incomeType=FUNDING_FEE` (пробрасывается на биржу для серверной фильтрации)
- `modifyPositionMargin(symbol, amount, type)` → signedPost `/fapi/v1/positionMargin`

## BinanceSpotHttpClient

Только переопределяет `endpoints` (все методы из base). Нет дополнительных методов.

