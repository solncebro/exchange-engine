# Exchange Layer

## Иерархия классов

```
BaseExchangeClient (abstract, implements ExchangeClient)
├── BinanceBaseClient<T extends BinanceBaseHttpClient> (abstract)
│   ├── BinanceFutures
│   └── BinanceSpot
├── BybitBaseClient (abstract)
│   ├── BybitLinear
│   └── BybitSpot
```

## ExchangeClient интерфейс (src/types/exchange.ts)

Полный контракт — все методы, которые потребитель может вызвать:

```
Свойства:
  apiKey: string (readonly)
  tradeSymbols: TradeSymbolBySymbol (readonly, Map)

Рыночные данные:
  loadTradeSymbols(): Promise<TradeSymbolBySymbol>
  fetchTickers(): Promise<TickerBySymbol>
  fetchKlines(symbol, interval, options?): Promise<Kline[]>
  fetchAllKlines(symbolList, interval, options?): Promise<Map<string, Kline[]>>

Аккаунт:
  fetchBalances(): Promise<AccountBalances>
  fetchPosition(symbol): Promise<Position>
  fetchPositionMode(): Promise<PositionModeEnum | undefined>
  fetchFundingRateHistory(symbol, options?): Promise<FundingRateHistory[]>
  fetchFundingInfo(symbol?): Promise<FundingInfo[]>

Ордера:
  createOrderWebSocket(args): Promise<Order>
  fetchOrderHistory(symbol, options?): Promise<Order[]>
  cancelOrder(symbol, orderId): Promise<Order>
  getOrder(symbol, orderId): Promise<Order>
  fetchOpenOrders(symbol?): Promise<Order[]>
  modifyOrder(args: ModifyOrderArgs): Promise<Order>
  cancelAllOrders(symbol): Promise<void>
  createBatchOrders(orderList): Promise<Order[]>
  cancelBatchOrders(symbol, orderIdList): Promise<CancelBatchOrdersResult>
  modifyBatchOrders(orderList: ModifyBatchOrderArgs[]): Promise<ModifyBatchOrdersResult>
  getOrderRateLimit(): Promise<OrderRateLimit>

Рыночные данные (расширенные):
  fetchOrderBook(symbol, limit?): Promise<OrderBook>
  fetchTrades(symbol, limit?): Promise<PublicTrade[]>
  fetchMarkPrice(symbol?): Promise<MarkPrice[]>
  fetchOpenInterest(symbol): Promise<OpenInterest>
  fetchFeeRate(symbol?): Promise<FeeRate[]>
  fetchIncome(options?): Promise<Income[]>
  fetchClosedPnl(symbol?, options?): Promise<ClosedPnl[]>

Trade WebSocket:
  isTradeWebSocketConnected(): boolean
  connectTradeWebSocket(): Promise<void>

User Data Stream:
  connectUserDataStream(handler: UserDataStreamHandlerArgs): Promise<void>
  disconnectUserDataStream(): void
  isUserDataStreamConnected(): boolean

Настройки:
  setLeverage(leverage, symbol): Promise<void>
  setMarginMode(mode, symbol): Promise<void>
  setPositionMode(mode): Promise<void>

Precision:
  amountToPrecision(symbol, amount): number
  priceToPrecision(symbol, price): number
  getMinOrderQty(symbol): number
  getMinNotional(symbol): number

Стриминг:
  watchTickers(): AsyncGenerator<TickerBySymbol>
  subscribeKlines(args): void
  unsubscribeKlines(args): void
  resubscribeKlines(args): void
  subscribeMarkPrices(handler: MarkPriceHandler): void
  unsubscribeMarkPrices(handler: MarkPriceHandler): void
  subscribeOrderbook(args: SubscribeOrderbookArgs): void
  unsubscribeOrderbook(args: SubscribeOrderbookArgs): void
  subscribePublicTrades(args: SubscribePublicTradesArgs): void
  unsubscribePublicTrades(args: SubscribePublicTradesArgs): void

WebSocket Registry:
  getWebSocketConnectionInfoList(): WebSocketConnectionInfo[]
  awaitWebSocketConnectionsReady(): Promise<void>

Жизненный цикл:
  close(): Promise<void>
```

## BaseExchangeClient — что реализовано vs что абстрактно

### Реализовано (наследуется всеми):
- `loadTradeSymbols()` — загрузка символов, очищает и перезаполняет `this.tradeSymbols` Map
- `fetchTickers()` — делегирует в абстрактный `fetchAndNormalizeTickers()`
- `fetchKlines()` — делегирует в абстрактный `fetchAndNormalizeKlines()`
- `fetchAllKlines()` — батч-загрузка через `loadKlinesInChunks` утилиту (чанки по 200)
- `fetchBalances()` — делегирует в абстрактный `fetchAndNormalizeBalances()`, логирует `"Fetching balance"`
- `watchTickers()` — подписка через `getPublicStream().subscribeAllTickers()` + yield `fetchTickers()`
- `subscribeKlines()` / `unsubscribeKlines()` — делегирует в publicStream
- `resubscribeKlines()` — принудительная переподписка на стрим (вызывает `publicStream.resubscribeStream()` если поддерживается)
- `subscribeMarkPrices()` / `unsubscribeMarkPrices()` — делегирует в `getPublicStream()`, прокидывая `Array.from(this.tradeSymbols.keys())` как `symbolList` (Binance Futures — агрегатный `!markPrice@arr@1s`, symbolList игнорируется; Bybit — per-symbol `tickers.{symbol}` по каждому символу из symbolList, агрегатного топика нет; Binance Spot — предупреждение в стриме, без подписки)
- `subscribeOrderbook()` / `subscribePublicTrades()` — делегирует в `getPublicStream()`, если метод реализован (Bybit). Если `PublicStreamLike.subscribeOrderbook`/`subscribePublicTrades` равен `undefined` (Binance) — `subscribe*` бросает `Not supported for ${marketLabel} market`, `unsubscribe*` — no-op
- `awaitWebSocketConnectionsReady()` — `publicStream.awaitConnectionsReady?.() ?? Promise.resolve()` (Binance Futures public ждёт SUBSCRIBE-батчи; остальные стримы без метода — немедленный resolve)
- `amountToPrecision()` / `priceToPrecision()` — lookup в tradeSymbols + precision utils, возвращает `number`, fallback на исходное значение
- `getMinOrderQty()` / `getMinNotional()` — lookup в tradeSymbols, fallback 0

### Абстрактно (нужно реализовать):
- `protected getPublicStream(): PublicStreamLike`
- `protected fetchAndNormalizeTradeSymbols(): Promise<TradeSymbolBySymbol>`
- `protected fetchAndNormalizeTickers(): Promise<TickerBySymbol>`
- `protected fetchAndNormalizeKlines(symbol, interval, options?): Promise<Kline[]>`
- `protected fetchAndNormalizeBalances(): Promise<AccountBalances>`
- `getWebSocketConnectionInfoList(): WebSocketConnectionInfo[]`
- `isTradeWebSocketConnected(): boolean`
- `connectTradeWebSocket(): Promise<void>`
- `createOrderWebSocket()`
- `close()`

### Поля и helpers:
- `abstract exchangeLabel: string` — строковый идентификатор биржи для логирования и ExchangeError
- `abstract marketLabel: string` — тип рынка ('futures', 'spot', 'linear') для логирования и ошибок
- `abstract klineLimit: number` — лимит свечей по умолчанию
- `onNotify` — protected, оборачивается через `createNotifyHandler()` в конструкторе
- `getTradeSymbolOrWarn(symbol, methodName)` — private helper, возвращает TradeSymbol или логирует warning и возвращает null

### createNotifyHandler (protected static)

Оборачивает пользовательский `onNotify` callback без дополнительной логики: сообщение просто проксируется в `onNotify` (если callback задан).

Binance public streams создаются до `super()`, поэтому вызывают `BaseExchangeClient.createNotifyHandler(args.onNotify)` напрямую. Остальные стримы (trade, Bybit public/trade) получают уже обёрнутый `this.onNotify`.

### Default throw (переопределяются в подклассах):
- `fetchOrderHistory()`, `fetchFundingRateHistory()`, `fetchFundingInfo()`, `fetchPositionMode()`
- `fetchPosition()`, `setLeverage()`, `setMarginMode()`
- `cancelOrder()`, `getOrder()`, `fetchOpenOrders()`, `fetchOrderBook()`, `fetchTrades()`
- `modifyOrder()`, `cancelAllOrders()`, `createBatchOrders()`, `cancelBatchOrders()`, `modifyBatchOrders()`, `getOrderRateLimit()`
- `fetchMarkPrice()`, `fetchOpenInterest()`, `fetchFeeRate()`, `fetchIncome()`, `fetchClosedPnl()`
- `setPositionMode()`, `connectUserDataStream()`, `disconnectUserDataStream()`

### Default return (переопределяются в подклассах):
- `isUserDataStreamConnected()` — возвращает `false`

## BinanceBaseClient — шаблонный метод

Обобщённый класс `<T extends BinanceBaseHttpClient>` — общий для Spot и Futures.

Реализует все `protected fetchAndNormalize*()` методы:
- `fetchAndNormalizeTradeSymbols()` → `httpClient.fetchExchangeInfo()` → `normalizeBinanceTradeSymbols()`
- `fetchAndNormalizeTickers()` → `httpClient.fetchTickers()` → `normalizeBinanceTickers()`
- `fetchAndNormalizeKlines()` → `httpClient.fetchKlines()` → `normalizeBinanceKlines()`
- `fetchAndNormalizeBalances()` → `httpClient.fetchAccount()` → `normalizeBinanceBalances()`

Реализует `createOrderWebSocket()` через `BinanceTradeStream` с fallback на REST:
1. Формирует params через `buildBinanceOrderParams()`: `{ symbol, side, type, quantity, price, timeInForce, ... }`
2. Форматирует через `amountToPrecision()` + `priceToPrecision()`
3. Для limit-like ордеров маппит `timeInForce`: **futures** через `BINANCE_FUTURES_TIME_IN_FORCE_REVERSE` (`PostOnly → GTX`, дефолт `GTC`); **spot** post-only Limit → тип `LIMIT_MAKER` (без `timeInForce`), иначе значение enum как есть (`GTC`/`IOC`/`FOK`)
4. Если `tradeStream.isConnected()` → отправляет через WebSocket
5. Иначе fallback: `httpClient.createOrder()` → `normalizeBinanceOrder()`

Реализует методы работы с ордерами (6 методов):
- `fetchOrderHistory(symbol, options?)` → `httpClient.getAllOrders()` → `map(normalizeBinanceOrder)`
- `cancelOrder(symbol, orderId)` → `httpClient.cancelOrder()` → `normalizeBinanceOrder()`
- `getOrder(symbol, orderId)` → `httpClient.getOrder()` → `normalizeBinanceOrder()`
- `fetchOpenOrders(symbol?)` → `httpClient.getOpenOrders()` → `map(normalizeBinanceOrder)`
- `fetchOrderBook(symbol, limit?)` → `httpClient.fetchOrderBook()` → `normalizeBinanceOrderBook()`
- `fetchTrades(symbol, limit?)` → `httpClient.fetchTrades()` → `normalizeBinancePublicTrades()`

Реализует `isTradeWebSocketConnected()` и `connectTradeWebSocket()` через `BinanceTradeStream`.

Реализует `connectUserDataStream(handler)` — создаёт listenKey через REST, запускает `BinanceUserDataStream`, устанавливает keepalive-таймер (`setInterval` каждые 30 мин → `keepAliveListenKey`). Защита от гонки: флаг `userDataStreamConnecting` + `try/finally` не дают создать второй стрим/таймер при параллельном вызове. **`BinanceSpot` переопределяет `connectUserDataStream` и бросает ошибку** (listenKey REST `/api/v3/userDataStream` удалён биржей 2026-02-20; нужна миграция на WS API). Обрабатывает события:
- `ORDER_TRADE_UPDATE` → `handler.onOrderUpdate` (статус через канон `BINANCE_ORDER_STATUS` из mappings — НЕ локальная карта; `REJECTED → 'rejected'`, `EXPIRED → 'canceled'`)
- `ACCOUNT_UPDATE` → `handler.onPositionUpdate` (из `event.a.P[]`)

Реализует `disconnectUserDataStream()` — очищает keepalive-таймер, закрывает стрим, удаляет listenKey через `deleteListenKey`.

Реализует `isUserDataStreamConnected()` — `userDataStream !== null && userDataStream.isConnected()`.

Реализует `getWebSocketConnectionInfoList()` — агрегирует `publicStream.getConnectionInfoList()` + `tradeStream.getConnectionInfo()` + optional `userDataStream.getConnectionInfo()`.

## Конкретные классы — отличия

### BinanceFutures
- `marketLabel = 'futures'`, `klineLimit = 499`
- Реализует все фьючерсные методы (position, leverage, funding, marginMode)
- Реализует дополнительные методы (9):
  - `modifyOrder(args)` → `httpClient.modifyOrder()` → `normalizeBinanceOrder()`
  - `cancelAllOrders(symbol)` → `httpClient.cancelAllOrders()`
  - `createBatchOrders(orderList)` → chunking по `BINANCE_FUTURES_CREATE_BATCH_CHUNK_SIZE` (5) через `chunkList` → последовательные вызовы `httpClient.createBatchOrders()` → `normalizeBinanceOrder()` per item. Per-order ошибки в ответе (элементы с `code < 0`) пропускаются с `logger.warn()` — успешные ордера возвращаются.
  - `cancelBatchOrders(symbol, orderIdList)` → chunking по `BINANCE_FUTURES_CANCEL_BATCH_CHUNK_SIZE` (10) → последовательные вызовы `httpClient.cancelBatchOrders()`; per-order success/error агрегируется в `CancelBatchOrdersResult`
  - `modifyBatchOrders(orderList)` → chunking по `BINANCE_FUTURES_MODIFY_BATCH_CHUNK_SIZE` (5) → последовательные вызовы `httpClient.modifyBatchOrders()` → per-order маппинг success/error в `ModifyBatchOrdersResult`. Каждый ордер требует `side` (обязательно для Binance PUT `/fapi/v1/batchOrders`); `clientOrderId` (если задан) маппится в `origClientOrderId`.
  - `fetchMarkPrice(symbol?)` → `httpClient.fetchMarkPrice()` → `normalizeBinanceMarkPriceList()`
  - `fetchOpenInterest(symbol)` → `httpClient.fetchOpenInterest()` → `normalizeBinanceOpenInterest()`
  - `fetchFeeRate(symbol?)` → `httpClient.fetchCommissionRate()` → `normalizeBinanceCommissionRate()`
  - `fetchIncome(options?)` → `httpClient.fetchIncome()` → `normalizeBinanceIncomeList()`
- `setPositionMode(mode)` → `httpClient.setPositionMode()`, код Binance `-4059` (`No need to change position side.`) обрабатывается как no-op без throw (логируется на HTTP-слое)
- `setMarginMode(mode, symbol)` для Binance futures: код Binance `-4046` (`No need to change margin type.`) обрабатывается как no-op без throw (логируется на HTTP-слое)
- HTTP: `BinanceFuturesHttpClient`, WS: `BinanceFuturesPublicStream`

### BinanceSpot
- `marketLabel = 'spot'`, `klineLimit = 1000`
- Фьючерсные методы → `throw new Error('Not supported for spot market')`
- HTTP: `BinanceSpotHttpClient`, WS: `BinanceSpotPublicStream`

## BybitBaseClient — общая Bybit логика

Промежуточный абстрактный класс для `BybitLinear` и `BybitSpot`. Наследует `BaseExchangeClient`.

`category` — `protected readonly` поле (доступно подклассам для передачи в HTTP-вызовы).

`batchChunkSize` — `protected abstract readonly` поле: максимальный размер чанка для batch-операций. `BybitLinear` = `BYBIT_LINEAR_BATCH_CHUNK_SIZE` (20), `BybitSpot` = `BYBIT_SPOT_BATCH_CHUNK_SIZE` (10). Используется во всех трёх batch-методах (`createBatchOrders`, `modifyBatchOrders`, `cancelBatchOrders`) через `chunkList()`.

Реализует все `protected fetchAndNormalize*()` методы через `BybitHttpClient` + `bybitNormalizer`.

Реализует `createOrderWebSocket()` через `BybitTradeStream` с fallback на REST:
1. Формирует params через `buildBybitOrderParams()`: `{ category, symbol, orderType, side, qty, ... }`
2. `submitOrder(orderParams, args: CreateOrderWebSocketArgs)` — принимает аргументы как второй параметр
3. Если `tradeStream !== null && tradeStream.isConnected()` → отправляет через WebSocket; на WS-пути `Order.rateLimit` snapshot из ответа переносится на пересобранный Order (не теряется)
4. Иначе fallback: `httpClient.createOrder()` → `buildBybitOrderFromCreateResponse()`

`fetchKlines` для Bybit интервала без маппинга в `BYBIT_KLINE_INTERVAL` (например `1s`) бросает ошибку — Bybit REST не отдаёт 1s-свечи (только WS-агрегатор).

Реализует `isTradeWebSocketConnected()` и `connectTradeWebSocket()` через `BybitTradeStream`.

Реализует `connectUserDataStream(handler)` — создаёт `BybitPrivateStream` с `topicList: ['order', 'position']` и demo-aware `url` (`privateWebSocketUrl`, выбран по `isDemoMode`). Обрабатывает события:
- `topic === 'order'` → `handler.onOrderUpdate` (статус через канон `BYBIT_ORDER_STATUS` из mappings — НЕ локальная карта; `Rejected → 'rejected'`, `Deactivated`/`PartiallyFilledCanceled → 'canceled'`, `Triggered → 'open'`)
- `topic === 'position'` → `handler.onPositionUpdate`

Реализует `disconnectUserDataStream()` — закрывает `privateStream`.

Реализует `isUserDataStreamConnected()` — `privateStream !== null && privateStream.isConnected()`.

Реализует методы работы с ордерами и рыночными данными (14 методов):
- `cancelOrder(symbol, orderId)` → `httpClient.cancelOrder()` → затем `getOrder(symbol, orderId)` возвращает реальный нормализованный Order (а не фабрикованный stub с `side: Buy`)
- `getOrder(symbol, orderId)` → сначала `httpClient.getOpenOrders()` (realtime), fallback на `httpClient.getOrderHistory()` → `normalizeBybitOrder()`
- `fetchOpenOrders(symbol?)` → `httpClient.getOpenOrders()` → `map(normalizeBybitOrder)`
- `fetchOrderHistory(symbol, options?)` → `httpClient.getOrderHistory()` → `map(normalizeBybitOrder)`
- `fetchOrderBook(symbol, limit?)` → `httpClient.fetchOrderBook()` → `normalizeBybitOrderBook()`
- `fetchTrades(symbol, limit?)` → `httpClient.fetchRecentTrades()` → `normalizeBybitPublicTradeList()`
- `fetchFeeRate(symbol?)` → `httpClient.fetchFeeRate()` → `normalizeBybitFeeRateList()`
- `modifyOrder(args)` → `httpClient.amendOrder()` → `getOrder()` для получения обновлённого ордера
- `cancelAllOrders(symbol)` → `httpClient.cancelAllOrders(category, symbol)`
- `createBatchOrders(orderList)` → chunking по `batchChunkSize` через `chunkList`. WS-routing: если `tradeStream !== null && tradeStream.isConnected()` → `tradeStream.createBatchOrders(category, originalArgsChunk, requestPayloadChunk)`; иначе `httpClient.createBatchOrders(category, request)` → `map(buildBybitOrderFromCreateResponse)`.
- `cancelBatchOrders(symbol, orderIdList)` → chunking по `batchChunkSize`. WS-routing: если активен tradeStream → `tradeStream.cancelBatchOrders(category, originalOrderIdChunk, requestPayloadChunk)`; иначе `httpClient.cancelBatchOrders()` → per-order маппинг через `retExtInfo.list`. Результат — `CancelBatchOrdersResult`.
- `modifyBatchOrders(orderList)` → chunking по `batchChunkSize`. WS-routing: если активен tradeStream → `tradeStream.modifyBatchOrders(category, originalOrderIdChunk, requestPayloadChunk)`; иначе `httpClient.amendBatchOrders(category, request)` → per-order маппинг через `retExtInfo.list` в `ModifyBatchOrdersResult`. `clientOrderId` маппится в `orderLinkId`.
- `fetchIncome(options?)` → `httpClient.fetchTransactionLog()` → `normalizeBybitIncomeList()`
- `fetchClosedPnl(symbol?, options?)` → `httpClient.getClosedPnl()` → `normalizeBybitClosedPnlList()`

**WS-routing для batch-операций**: при наличии активного `tradeStream` (`tradeStream !== null && tradeStream.isConnected()`) все три batch-метода (`createBatchOrders`, `modifyBatchOrders`, `cancelBatchOrders`) отправляются через WebSocket Trade Stream (`order.create-batch`, `order.amend-batch`, `order.cancel-batch`); иначе fallback на REST. В demo mode (`tradeStream === null`) — всегда REST. Chunking применяется на уровне `BybitBaseClient` снаружи WS/REST-вызова — каждый чанк отправляется отдельным запросом, результаты конкатенируются.

## getOrderRateLimit (per-UID write rate-limit)

Возвращает документированный или измеренный лимит RPS для order endpoints (create/cancel/modify, в т.ч. batch).

```typescript
interface OrderRateLimit {
  writeRequestsPerSecond: number;
  source: OrderRateLimitSource;  // 'binance-exchange-info' | 'bybit-documented' | 'fallback'
}
```

- **Binance Futures/Spot** (`BinanceBaseClient.getOrderRateLimit`): делает `httpClient.fetchExchangeInfo()` → `parseBinanceOrderRateLimit(raw)` (`src/normalizers/binanceNormalizer.ts:349`). Функция фильтрует `raw.rateLimits[]` по `rateLimitType === 'ORDERS'`, конвертирует все интервалы в RPS (`limit / (intervalNum * secondsInInterval)`), возвращает наиболее строгий лимит через `Math.min(...)` с `source: 'binance-exchange-info'`. Если `rateLimits` отсутствует/пуст — `{ writeRequestsPerSecond: BINANCE_ORDER_RATE_LIMIT_FALLBACK_RPS, source: 'fallback' }` (константа = 15 RPS, `src/normalizers/binanceNormalizer.ts:331`). Поддерживаемые интервалы: `SECOND` / `MINUTE` / `HOUR` / `DAY`.
- **Bybit Linear/Spot** (`BybitBaseClient.getOrderRateLimit`): возвращает `{ writeRequestsPerSecond, source: 'bybit-documented' }`, где `writeRequestsPerSecond` зависит от категории — **spot = 20, linear = 10**. Bybit не отдаёт rate-limits через GET endpoint (только через headers на actual order calls), поэтому значение — документированная константа. Источник: https://bybit-exchange.github.io/docs/v5/rate-limit. Точные per-UID лимиты (standard account): для spot `/v5/order/create`, `/cancel`, `/cancel-all`, `/create-batch`, `/amend-batch`, `/cancel-batch` = 20/s (а `/amend` = 10/s); для linear все order-эндпоинты = 10/s (inverse/option ещё строже). Берётся create-лимит категории.
- **Default**: в `BaseExchangeClient.getOrderRateLimit` — throw `Not supported for ${marketLabel} market`, но переопределяется во всех четырёх реальных классах.

Raw-тип: `BinanceRateLimitRaw { rateLimitType, interval, intervalNum, limit }` в `binanceNormalizer.ts`. `BinanceExchangeInfoRaw` имеет опциональное `rateLimits?: BinanceRateLimitRaw[]`.

Реализует `getWebSocketConnectionInfoList()` — агрегирует `publicStream.getConnectionInfoList()` + optional `tradeStream.getConnectionInfo()` + optional `privateStream.getConnectionInfo()`.

В demo mode `tradeStream = null` — все ордера через REST.

### BybitLinear
- `marketLabel = 'linear'`
- `batchChunkSize = BYBIT_LINEAR_BATCH_CHUNK_SIZE` (20) — лимит Bybit V5 на linear/inverse/option batch
- Наследует `BybitBaseClient`
- Реализует фьючерсные методы (position, leverage)
- `setMarginMode()` — no-op (Bybit Unified Account управляет margin mode на уровне аккаунта, не символа)
- `setLeverage()` — обрабатывает код Bybit `110043` (leverage not modified) как no-op без throw
- Реализует `createOrderWebSocket()` через `buildBybitOrderParams()` + `submitOrder()`
- Реализует дополнительные методы:
  - `fetchMarkPrice(symbol?)` → `httpClient.fetchTickers()` → `normalizeBybitMarkPriceList()`
  - `fetchOpenInterest(symbol)` → `httpClient.fetchOpenInterest()` → `normalizeBybitOpenInterest()`, symbol устанавливается
  - `fetchFundingRateHistory(symbol, options?)` → `httpClient.fetchFundingHistory()` → `normalizeBybitFundingRateHistoryList()`
  - `fetchFundingInfo()` → `throw new Error('Not implemented for Bybit')`
  - `fetchPositionMode()` → `httpClient.fetchPositionList({ category: 'linear', settleCoin: 'USDT' })` → инференс по `positionIdx`: Hedge если ∃ позиция с `positionIdx ∈ {1, 2}`, OneWay если все `positionIdx === 0`, `undefined` если позиций нет (Bybit V5 не даёт API для чтения mode без позиций). Сигнатура — `Promise<PositionModeEnum | undefined>` (3.4.0/0.13.0 BREAKING).
- `setPositionMode(mode)` → `httpClient.setPositionMode()`, код Bybit `110025` обрабатывается как no-op без throw

### BybitSpot
- `marketLabel = 'spot'`
- `batchChunkSize = BYBIT_SPOT_BATCH_CHUNK_SIZE` (10) — лимит Bybit V5 на spot batch
- Наследует `BybitBaseClient`
- Для market ордеров устанавливает `marketUnit = 'baseCoin'` по умолчанию (только если не задан явно через `args.marketUnit` И не используется `quoteOrderQty`)
- Фьючерсные методы наследуют default throw из `BaseExchangeClient`

## Demo mode

Проверяется **только в конструкторе** — не runtime toggle:
- Binance Futures: другой baseUrl + другой WS URL
- Binance Spot: другой baseUrl, WS URL тот же
- Bybit Linear: другой baseUrl + другой WS URL, `tradeStream = null` (REST fallback)
- Bybit Spot: другой baseUrl + другой WS URL

## tradeSymbols

- `new Map()` при создании (пустой)
- `loadTradeSymbols()` — всегда загружает свежие данные, очищает Map перед заполнением
- Используется в `amountToPrecision()`, `priceToPrecision()`, `getMinOrderQty()`, `getMinNotional()`

## Structured Logging

ExchangeLogger поддерживает overloaded signatures:
- `logger.info(message: string)` — простое сообщение
- `logger.info(context: Record<string, unknown>, message: string)` — сообщение с контекстным объектом

## CreateOrderWebSocketArgs

- `symbol: string` — торговая пара
- `type: OrderTypeEnum` — `Market`, `Limit`, `StopMarket`, `StopLimit`, `TakeProfitMarket`, `TakeProfitLimit`, `Stop`, `TakeProfit`, `TrailingStop`
- `side: OrderSideEnum` — `Buy` / `Sell`
- `amount: number` — объём в base
- `price?: number` — цена для Limit-like
- `stopPrice?: number` — триггерная цена для conditional/stop ордеров
- `triggerDirection?: 1 | 2` — направление триггера (1 = rise, 2 = fall) — Bybit Linear, не применяется на spot
- `triggerBy?: TriggerByEnum` — `MarkPrice` / `LastPrice` / `IndexPrice` (Bybit Linear, 0.13.0)
- `closePosition?: boolean` — Binance Futures STOP_MARKET/TAKE_PROFIT_MARKET закрытие всей позиции (на spot не применяется)
- `workingType?: WorkingTypeEnum` — Binance Futures: `MarkPrice`/`ContractPrice` для conditional (на spot не применяется)
- `positionSide?: PositionSideEnum` — `Long`/`Short` для Hedge mode futures. Маппится в Bybit `positionIdx` (1/2). На spot игнорируется.
- `reduceOnly?: boolean` — Bybit Linear: разрешён в обоих режимах. Binance Futures: разрешён только в OneWay (в Hedge `reduceOnly` выкидывается из wire). На spot не применяется.
- `closeOnTrigger?: boolean` — Bybit Linear conditional close (0.13.0, на spot не применяется)
- `timeInForce?: TimeInForceEnum` — `GTC`/`IOC`/`FOK`/`PostOnly`
- `clientOrderId?: string` — клиентский id (Bybit `orderLinkId`, Binance `newClientOrderId`)
- `orderFilter?: OrderFilterEnum` — Bybit Spot conditional filter: `Order` / `tpslOrder` / `StopOrder` (0.13.0, только spot)
- `marketUnit?: MarketUnitEnum` — Bybit Spot Market unit: `baseCoin` / `quoteCoin` (0.13.0, только spot)
- `trailingDelta?: number` — Binance Spot STOP_LOSS/TAKE_PROFIT trailing (0.13.0)
- `quoteOrderQty?: number` — Binance/Bybit Spot Market Buy: USDT-сумма вместо qty (0.13.0)

## ModifyOrderArgs

- `symbol: string` — символ торговой пары
- `orderId: string` — ID ордера для модификации
- `price?: number` — новая цена
- `amount?: number` — новый объём
- `triggerPrice?: number` — новая триггер-цена

## ModifyBatchOrderArgs

- `symbol: string` — символ
- `orderId: string` — ID ордера для модификации
- `side: OrderSideEnum` — обязательно (`Buy` / `Sell`); требуется для Binance Futures PUT `/fapi/v1/batchOrders` (биржа не выводит side по `origOrderId`)
- `clientOrderId?: string` — для Bybit маппится в `orderLinkId`, для Binance — в `origClientOrderId`
- `price?: number` — новая цена
- `amount?: number` — новый объём
- `triggerPrice?: number` — новая триггер-цена

## SubscribeOrderbookArgs

- `symbol: string` — торговый символ (`BTCUSDT`)
- `depth: number` — глубина orderbook (Bybit: `1` / `50` / `200` / `500` / `1000` для linear, `1` / `50` / `200` для spot)
- `handler: OrderBookHandler` — `(symbol, update: OrderBookUpdate) => void`

Поддерживается только Bybit (linear и spot). Для Binance вызов `subscribeOrderbook` бросает `Not supported for ${marketLabel} market`.

## SubscribePublicTradesArgs

- `symbol: string` — торговый символ
- `handler: PublicTradeHandler` — `(symbol, tradeList: PublicTrade[]) => void`

Поддерживается только Bybit. Сосуществует с `subscribeKlines(symbol, '1s', ...)` (`TradeToKlineAggregator`) на одном topic `publicTrade.{symbol}` — оба consumer'а получают сообщения независимо.
