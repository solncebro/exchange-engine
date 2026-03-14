# HTTP Layer

## Иерархия классов

```
BaseHttpClient (abstract)
├── BinanceBaseHttpClient (abstract)
│   ├── BinanceFuturesHttpClient
│   └── BinanceSpotHttpClient
└── BybitHttpClient
```

## BaseHttpClient (src/http/BaseHttpClient.ts)

Базовый HTTP-клиент с retry-логикой и обработкой ошибок.

### Защищённые методы (все HTTP-глаголы):
- `get<T>(url, params?, headers?): Promise<T>` — **единственный с retry**
- `post<T>(url, data?, headers?): Promise<T>` — без retry
- `postWithParams<T>(url, params?, headers?): Promise<T>` — параметры в query string
- `put<T>(url, data?, headers?): Promise<T>`
- `putWithParams<T>(url, params?, headers?): Promise<T>`
- `delete<T>(url, params?, headers?): Promise<T>`

### Private хелпер:
- `executeRequest<T>(label, fn): Promise<T>` — общая обёртка для non-GET методов (logging + error handling). Все методы кроме `get` делегируют в `executeRequest`.

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

Rate limiting — **только реактивный** (нет proactive throttling).

## BinanceBaseHttpClient (src/http/BinanceBaseHttpClient.ts)

Добавляет Binance-специфичное:

### Signing-обёртки:
- `signedGet<T>(path, params?)` — добавляет timestamp, recvWindow, signature к params
- `signedPost<T>(path, params?)` — то же для POST
- `signedDelete<T>(path, params?)` — то же для DELETE
- `authHeaders()` → `{ 'X-MBX-APIKEY': apiKey }`

### Валидация ответов:
- `validateResponse(data)` — бросает `ExchangeError` при `code < 0` в ответе Binance API

### Private хелперы:
- `signRequest(params)` → `{ signedParams, headers }` — единая точка подписи, используется всеми signed-методами
- `buildOptionalSymbolParams(symbol?)` → `Record<string, ...>` — protected, строит params с optional symbol (используется в `getOpenOrders` и наследниках)

### Binance signing (src/auth/binanceAuth.ts):
1. Добавить `timestamp = Date.now()` и `recvWindow = 5000` к params
2. Собрать query string через `URLSearchParams` (автоматическая сортировка по ключу)
3. `signature = HMAC-SHA256(queryString, secret)` → hex
4. Добавить `signature` к params

### Общие эндпоинты (реализованы в base):
- `fetchExchangeInfo()` → GET `endpoints.exchangeInfo`
- `fetchTickers()` → GET `endpoints.ticker24hr`
- `fetchKlines(symbol, interval, options?)` → GET `endpoints.klines`
- `fetchAccount()` → signedGet `endpoints.account`
- `createOrder(params)` → signedPost `endpoints.order`
- `cancelOrder(symbol, orderId)` → signedDelete `endpoints.order`
- `getOrder(symbol, orderId)` → signedGet `endpoints.order`
- `getOpenOrders(symbol?)` → signedGet `endpoints.openOrders`
- `createListenKey()` / `keepAliveListenKey()` / `deleteListenKey()` — для user data stream

### BinanceEndpoints интерфейс:
```
exchangeInfo, ticker24hr, depth, klines, trades,
order, openOrders, account, listenKey
```

Реализация в подклассах — разные префиксы путей:
- Futures: `/fapi/v1/*` и `/fapi/v2/account`
- Spot: `/api/v3/*`

## BinanceFuturesHttpClient

Дополнительные методы (фьючерсные):
- `fetchFundingInfo(symbol?)` → GET `/fapi/v1/fundingInfo` (public)
- `fetchPositionMode()` → signedGet `/fapi/v1/positionSide/dual`
- `fetchMarkPrice(symbol?)` → GET `/fapi/v1/premiumIndex`
- `fetchFundingRateHistory(symbol, options?)` → GET `/fapi/v1/fundingRate`
- `fetchPositionRisk(symbol?)` → signedGet `/fapi/v2/positionRisk`
- `fetchOpenInterest(symbol)` → GET `/fapi/v1/openInterest`
- `setLeverage(symbol, leverage)` → signedPost `/fapi/v1/leverage`
- `setMarginType(symbol, marginType)` → signedPost `/fapi/v1/marginType`
- `setPositionMode(dualSidePosition)` → signedPost `/fapi/v1/positionSide/dual`
- `modifyOrder(params)` → PUT с ручным signing через `buildBinanceSignedParams`
- `cancelAllOrders(symbol)` → signedDelete `/fapi/v1/allOpenOrders`
- `getAllOrders(symbol, options?)` → signedGet `/fapi/v1/allOrders`
- `createBatchOrders(orderList)` → signedPost `/fapi/v1/batchOrders`
- `cancelBatchOrders(symbol, orderIdList)` → signedDelete `/fapi/v1/batchOrders`
- `fetchCommissionRate(symbol)` → signedGet `/fapi/v1/commissionRate`
- `fetchIncome(options?)` → signedGet `/fapi/v1/income`
- `modifyPositionMargin(symbol, amount, type)` → signedPost `/fapi/v1/positionMargin`

## BinanceSpotHttpClient

Только переопределяет `endpoints` (все методы из base). Нет дополнительных методов.

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

### Приватные хелперы:
- `authenticatedGet<T>(path, params)` — строит query string → подписывает → GET
- `authenticatedPost<T>(path, body)` — JSON.stringify body → подписывает → POST

### Private хелпер:
- `buildCategoryParams(category, options?)` → `Record<string, ...>` — строит params с `{ category }` + optional `symbol` и `limit`. Используется в 7 методах: `fetchInstrumentsInfo`, `fetchTickers`, `getOpenOrders`, `getOrderHistory`, `getPositionList`, `getClosedPnl`, `fetchFeeRate`.

### Все методы используют категорию:
- `fetchInstrumentsInfo(category, options?)` — market data
- `fetchTickers(category, options?)` — тикеры
- `fetchKline(args)` — свечи (с конвертацией интервалов)
- `createOrder(params)` → POST `/v5/order/create`
- `getOpenOrders(category, options?)` → GET `/v5/order/realtime`
- `getOrderHistory(category, options?)` → GET `/v5/order/history`
- `getPositionList(category, options?)` → GET `/v5/position/list`
- `getClosedPnl(category, options?)` → GET `/v5/position/closed-pnl`
- `fetchFeeRate(category, options?)` → GET `/v5/account/fee-rate`
- `setLeverage(args)` → POST `/v5/position/set-leverage`
- `switchIsolated(args)` → POST `/v5/position/switch-isolated`
- `fetchWalletBalance(accountType)` → GET `/v5/account/wallet-balance`
- `fetchAllInstrumentsInfo(category)` → пагинация через cursor, возвращает полный список инструментов

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
- `BinanceBaseHttpClient.types.ts` — BinanceEndpoints, BinanceBaseHttpClientArgs
- `BybitHttpClient.types.ts` — BybitHttpClientArgs
