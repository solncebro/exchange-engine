# Exchange Layer — Bybit

Часть `exchange-layer.md` (см. индекс там). Конкретные реализации `BybitBaseClient`, `BybitLinear`, `BybitSpot`. `getOrderRateLimit` (обе биржи) — в основном файле `exchange-layer.md`.

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

Реализует методы работы с ордерами и рыночными данными (15 методов):
- `cancelOrder(symbol, orderId)` → `httpClient.cancelOrder()` → затем `getOrder(symbol, orderId)` возвращает реальный нормализованный Order (а не фабрикованный stub с `side: Buy`)
- `getOrder(symbol, orderId)` → сначала `httpClient.getOpenOrders()` (realtime), fallback на `httpClient.getOrderHistory()` → `normalizeBybitOrder()`
- `fetchOpenOrders(symbol?)` → `httpClient.getOpenOrders()` → `map(normalizeBybitOrder)`
- `fetchOpenConditionalOrders(settleCoin)` → `httpClient.getOpenOrders(category, { settleCoin, orderFilter: OrderFilterEnum.StopOrder })` → `map(normalizeBybitOrder)` (условные/стоп ордера — Bybit REST `/v5/order/realtime` с `orderFilter=StopOrder`)
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

Реализует `getWebSocketConnectionInfoList()` — агрегирует `publicStream.getConnectionInfoList()` + optional `tradeStream.getConnectionInfo()` + optional `privateStream.getConnectionInfo()`.

В demo mode `tradeStream = null` — все ордера через REST.

## Конкретные классы — Bybit

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
