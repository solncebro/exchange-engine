# Exchange Layer — Binance

Часть `exchange-layer.md` (см. индекс там). Конкретные реализации `BinanceBaseClient`, `BinanceFutures`, `BinanceSpot`.

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

Реализует методы работы с ордерами (7 методов):
- `fetchOrderHistory(symbol, options?)` → `httpClient.getAllOrders()` → `map(normalizeBinanceOrder)`
- `cancelOrder(symbol, orderId)` → `httpClient.cancelOrder()` → `normalizeBinanceOrder()`
- `getOrder(symbol, orderId)` → `httpClient.getOrder()` → `normalizeBinanceOrder()`
- `fetchOpenOrders(symbol?)` → `httpClient.getOpenOrders()` → `map(normalizeBinanceOrder)`
- `fetchOpenConditionalOrders(_settleCoin)` → `httpClient.getOpenOrders(undefined)` (все открытые ордера, без символа) → `map(normalizeBinanceOrder)` → `.filter(order => order.stopPrice > 0)` (Binance не отдаёт отдельный список условных ордеров — фильтруется по наличию `stopPrice`; `settleCoin` не используется, параметр есть для паритета с Bybit)
- `fetchOrderBook(symbol, limit?)` → `httpClient.fetchOrderBook()` → `normalizeBinanceOrderBook()`
- `fetchTrades(symbol, limit?)` → `httpClient.fetchTrades()` → `normalizeBinancePublicTrades()`

Реализует `isTradeWebSocketConnected()` и `connectTradeWebSocket()` через `BinanceTradeStream`.

Реализует `connectUserDataStream(handler)` — создаёт listenKey через REST, запускает `BinanceUserDataStream`, устанавливает keepalive-таймер (`setInterval` каждые 30 мин → `keepAliveListenKey`). Защита от гонки: флаг `userDataStreamConnecting` + `try/finally` не дают создать второй стрим/таймер при параллельном вызове. **`BinanceSpot` переопределяет `connectUserDataStream` и бросает ошибку** (listenKey REST `/api/v3/userDataStream` удалён биржей 2026-02-20; нужна миграция на WS API). Обрабатывает события:
- `ORDER_TRADE_UPDATE` → `handler.onOrderUpdate` (статус через канон `BINANCE_ORDER_STATUS` из mappings — НЕ локальная карта; `REJECTED → 'rejected'`, `EXPIRED → 'canceled'`)
- `ACCOUNT_UPDATE` → `handler.onPositionUpdate` (из `event.a.P[]`)

Реализует `disconnectUserDataStream()` — очищает keepalive-таймер, закрывает стрим, удаляет listenKey через `deleteListenKey`.

Реализует `isUserDataStreamConnected()` — `userDataStream !== null && userDataStream.isConnected()`.

Реализует `getWebSocketConnectionInfoList()` — агрегирует `publicStream.getConnectionInfoList()` + `tradeStream.getConnectionInfo()` + optional `userDataStream.getConnectionInfo()`.

## Конкретные классы — Binance

### BinanceFutures
- `marketLabel = 'futures'`, `klineLimit = 499`
- Реализует все фьючерсные методы (position, leverage, funding, marginMode)
- Реализует дополнительные методы (9):
  - `modifyOrder(args)` → `httpClient.modifyOrder()` → `normalizeBinanceOrder()`
  - `cancelAllOrders(symbol)` → `httpClient.cancelAllOrders()`
  - `createBatchOrders(orderList)` → chunking по `BINANCE_FUTURES_CREATE_BATCH_CHUNK_SIZE` (5) через `chunkList` → последовательные вызовы `httpClient.createBatchOrders()` → `normalizeBinanceOrder()` per item. Per-order ошибки в ответе (элементы с `code < 0`) пропускаются с `logger.warn()` — успешные ордера возвращаются.
  - `cancelBatchOrders(symbol, orderIdList)` → chunking по `BINANCE_FUTURES_CANCEL_BATCH_CHUNK_SIZE` (10) через `chunkList` → последовательные вызовы `httpClient.cancelBatchOrders()`; per-order success/error агрегируется в `CancelBatchOrdersResult`. Нечисловые идентификаторы (`isBinanceNumericOrderId`) на биржу НЕ отправляются, но занимают своё место в результате как неуспешные (`errorText: 'Binance requires a numeric orderId'`) — ответ биржи маппится по позиции в чанке, поэтому выпадение элемента сдвинуло бы все последующие. Если чанк целиком нечисловой, HTTP-запрос не выполняется
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
