# WebSocket Layer

## Зависимость

Все стримы используют `ReliableWebSocket<TMessage>` из `@solncebro/websocket-engine` — автоматический reconnect, heartbeat, backoff.

## PublicStreamLike интерфейс (src/types/stream.ts)

```
subscribeAllTickers(handler: (tickers: TickerBySymbol) => void): void
unsubscribeAllTickers?(handler): void  // снять хендлер all-tickers; у Bybit может отписать topic, если нет mark-price хендлеров
subscribeMarkPrices(handler: MarkPriceHandler): void
unsubscribeMarkPrices(handler: MarkPriceHandler): void
subscribeKlines(symbol, interval, handler): void
unsubscribeKlines(symbol, interval, handler): void
subscribeOrderbook?(symbol, depth, handler: OrderBookHandler): void  // опциональный, реализован у Bybit
unsubscribeOrderbook?(symbol, depth, handler: OrderBookHandler): void
subscribePublicTrades?(symbol, handler: PublicTradeHandler): void  // опциональный, реализован у Bybit
unsubscribePublicTrades?(symbol, handler: PublicTradeHandler): void
resubscribeStream?(symbol, interval): void  // опциональный, для принудительной переподписки
getConnectionInfoList(): WebSocketConnectionInfo[]
awaitConnectionsReady?(): Promise<void>
close(): void
```

Optional методы `subscribe*Orderbook` / `subscribe*PublicTrades` объявлены опциональными, поэтому Binance public streams без реализации продолжают удовлетворять контракту. На уровне `BaseExchangeClient` отсутствие optional-метода → `subscribe*` бросает `Not supported for ${marketLabel} market`, `unsubscribe*` — no-op.

## Хранение хендлеров

- **Тикеры**: `Set<Handler>` — все хендлеры получают одни и те же данные
- **Klines**: `Map<"SYMBOL_INTERVAL", Set<Handler>>` — группировка по стриму
- **Orderbook** (Bybit): `Map<"orderbook.{depth}.{symbol}", Set<OrderBookHandler>>` — ключ совпадает с topic
- **PublicTrade** (Bybit, custom subscribers): `Map<symbol, Set<PublicTradeHandler>>` — отдельно от `TradeToKlineAggregator`. Topic `publicTrade.{symbol}` снимается только когда у символа нет ни одного custom subscriber'а И не активен 1s kline aggregator (`tradeSubscribedSymbolSet`)

## WebSocket Connection Registry

Все стримы реализуют `getConnectionInfoList()` или `getConnectionInfo()`, возвращающие `WebSocketConnectionInfo`:
- `label` — человекочитаемый лейбл: `[Binance Futures] Public`, `[Bybit Linear] Public`, `[Binance Spot] Orders` и т.д.
- `url` — URL WebSocket-соединения
- `isConnected` — текущее состояние (через `WebSocketStatus.CONNECTED`)
- `type` — `WebSocketConnectionTypeEnum` (Public / Trade / UserData)
- `subscriptionList` — список подписок: `'Tickers'`, `'Klines BTCUSDT 30m'`, `'Trades ETHUSDT'`, или `[]` для trade/userData стримов
- `messageCount?`, `lastMessageTimestamp?` — опциональная диагностика per-connection (Binance Futures public заполняет)

Лейблы передаются в стримы через конструктор (Args-паттерн), формируются в exchange-классах.

`BinanceFuturesPublicStream`: лейбл соединения включает `groupKey` (например `tickers-markprices`, `interval-1m`).

Exchange-классы агрегируют через `getWebSocketConnectionInfoList()`: public + trade + optional userData.

## Binance Futures Public Stream

- **URL**: `wss://fstream.binance.com/market/ws` (demo: `wss://fstream.binancefuture.com/market/ws`) — один endpoint без списка стримов в query; подписка только через JSON после `onOpen`
- **Группировка соединений**: одно соединение на не-kline стримы (`!miniTicker@arr`, при необходимости `!markPrice@arr@1s`); отдельное соединение на каждый kline interval (все символы этого интервала в одном `connectionList`-элементе). TRADIFI perpetual использует `{symbol}@kline_{interval}` вместо `continuousKline`
- **Kline стрим**: `{symbol}_perpetual@continuousKline_{interval}` или spot-формат для TRADIFI
- **Тикер стрим**: `!miniTicker@arr`
- **Mark/index стрим** (если есть подписчики `subscribeMarkPrices`): `!markPrice@arr@1s` — в `subscriptionList` как `MarkPrices`; payload → `MarkPriceUpdate[]`
- **Подписка**: в `onOpen` батчами `{"method":"SUBSCRIBE","params":[...streams],"id"}` (`subscribeBatchSize`, пауза `pauseBetweenSubscribeBatchesMs` между батчами). У каждого соединения свой `readyPromise`, резолвится после отправки всех батчей
- **Deferred connect**: `scheduleConnect()` через `queueMicrotask`; между созданием соединений — `pauseBetweenConnectionsMs` (rate limit)
- **Динамические kline**: `addStreamToIntervalGroup` / удаление — пересоздание соединения группы; гонка с незавершённым `onOpen` обрабатывается через `readyPromise.then(...)` перед `SUBSCRIBE`
- **Stale watcher**: периодически проверяет возраст `lastMessageTimestamp`; при превышении `staleThresholdMs` — `recreateConnection` (с дедупом и grace после recreate)
- **Диагностика**: `messageCount`, `lastMessageTimestamp` на `FuturesConnection` и в `WebSocketConnectionInfo`
- **Heartbeat**: ReliableWebSocket ping 30s
- **Методы**: `awaitConnectionsReady()` — `Promise.all` по `readyPromise` активных соединений; `resubscribeStream(symbol, interval)` — `recreateConnection` для соединения, где есть стрим
- **Аргументы** (`BinanceFuturesPublicStreamArgs`): опционально `pauseBetweenConnectionsMs`, `staleThresholdMs`, `staleCheckIntervalMs`, `subscribeBatchSize`, `pauseBetweenSubscribeBatchesMs`

## Binance Spot Public Stream

- **URL**: `wss://stream.binance.com:9443/ws`
- **Одно соединение**, lazy-initialized через `ensureConnected()`
- **Kline стрим**: `{symbol.toLowerCase()}@kline_{interval}`
- **Тикер стрим**: `!miniTicker@arr`
- **Mark price**: не поддерживается — `subscribeMarkPrices` логирует предупреждение и не подписывается; `unsubscribeMarkPrices` — no-op
- **Подписка**: динамическая через JSON: `{ method: 'SUBSCRIBE', params: [...], id }`
- **Reconnect**: `onReconnectSuccess → resubscribeAll()` — переподписка всех стримов
- **Heartbeat**: `{ method: 'PING' }` → ответ с `id` и `result: null`, интервал 30s
- **Методы**: `resubscribeStream(symbol, interval)` — принудительная переподписка на конкретный стрим через SUBSCRIBE

## Bybit Public Stream

- **URL**: `wss://stream.bybit.com/v5/public/linear` или `.../spot`
- **Multi-connection**: `connectionList: BybitConnection[]`, чанкинг при превышении лимита
- **Лимит**: 200 topics на соединение (`MAX_TOPICS_PER_CONNECTION`), 10 topics на SUBSCRIBE сообщение (`MAX_TOPICS_PER_SUBSCRIBE`)
- **Kline topic**: `kline.{bybitInterval}.{symbol}` (интервал конвертируется через `BYBIT_KLINE_INTERVAL`)
- **1s kline**: через `TradeToKlineAggregator` — подписка на `publicTrade.{symbol}`, агрегация трейдов в 1-секундные свечи
- **Тикер topic**: per-symbol `tickers.{symbol}` — у Bybit V5 нет агрегатного ticker-топика (`tickers.linear`/`tickers.spot` отвечают `handler not found`). `subscribeAllTickers(handler, symbolList)` и `subscribeMarkPrices(handler, symbolList)` принимают `symbolList` и подписывают `tickers.{symbol}` для каждого символа через `subscribeTickerSymbols`. Один `tickers.{symbol}` обслуживает обоих consumer'ов (ticker + mark price): ref-count в `releaseTickerSymbolsIfUnused` снимает топики только когда пусты ОБА — `markPriceHandlerSet` И `tickerHandlerSet`. Подписанные символы хранятся в `tickerSubscribedSymbolSet`
- **Mark/index**: не отдельный topic — переиспользует `tickers.{symbol}`; в `handleMessage` ветка `tickers.` идёт ДО guard'а `!Array.isArray(message.data)` и coerce'ит объект в одноэлементный список (per-symbol Bybit шлёт `data` объектом, не массивом); из элементов с валидным `markPrice` → `MarkPriceUpdate[]`
- **Orderbook topic**: `orderbook.{depth}.{symbol}` (`subscribeOrderbook(symbol, depth, handler)`); `handleMessage` обрабатывает orderbook ДО проверки `Array.isArray(message.data)` — Bybit отдаёт `data` как объект, не массив. `type` из сырого сообщения нормализуется в `'snapshot' | 'delta'`. Symbol берётся из `data.s`, fallback — последний сегмент topic. Уровни `bidList`/`askList` сохраняются как пары decimal-строк (`OrderBookRawLevel = [string, string]`) — без `parseFloat`, чтобы не терять точность
- **PublicTrade topic**: `publicTrade.{symbol}`. Два независимых consumer'а на один topic:
  1. `TradeToKlineAggregator` (1s klines) — подписка через `subscribeKlines(symbol, '1s', handler)`
  2. Custom subscribers через `subscribePublicTrades(symbol, handler)` — получают `PublicTrade[]` нормализованный через `normalizeBybitPublicTradeFromStream`
  Topic снимается только когда отписались оба consumer'а; защита: `unsubscribeKlines('1s')` и `unsubscribePublicTrades` проверяют наличие другого consumer'а перед `removeTopicFromConnection`
- **Подписка**: батчами по 10 topics через `sendSubscribeInBatches()`: `{ op: 'subscribe', args: [batch] }`
- **Deferred connection**: `queueMicrotask()` для батчинга подписок (через `scheduleConnect()`)
- **onOpen**: при открытии соединения подписывает все topics этого соединения через `sendSubscribeInBatches()` с `context.send()`
- **Reconnect**: `onReconnectSuccess → resubscribeConnection(index)` — переподписка topics конкретного соединения, `tradeAggregator.clearSymbol()` для trade-подписок
- **Dynamic topics**: новые подписки добавляются в соединение с наименьшим количеством topics (через `addTopicToConnection`); если все полны — создаётся новое
- **Heartbeat**: `{ op: 'ping' }` → `{ op: 'pong' }`, интервал 20s
- **subscriptionList отображение**: `Tickers`, `MarkPrices`, `Klines {symbol} {interval}`, `Orderbook {symbol} depth={depth}`, `Trades {symbol}` (для `publicTrade.*`)
- **Методы**: `resubscribeStream(symbol, interval)` — находит соединение с соответствующим kline topic. Если WS соединения CONNECTED — light-resubscribe: отправляет `{ op: 'unsubscribe', args: [topic] }` + `{ op: 'subscribe', args: [topic] }` на уже открытый сокет (без пересоздания). Если сокет не CONNECTED или `sendToConnectedSocket` бросает — fallback на `recreateConnection` (полное пересоздание `ReliableWebSocket` с тем же `topicList`); дедуп recreate в окне 2000ms по `lastRecreateTimestamp` на `BybitConnection`; для топиков `publicTrade.*` перед recreate — `tradeAggregator.clearSymbol`
- **Внутреннее**: `buildWebSocket(connectionIndex, label)`, `recreateConnection(connectionIndex, reason)`, `handleOrderBookMessage(topic, message)`, `extractSymbolFromOrderbookTopic(topic)`, `hasPublicTradeConsumer(symbol)`

## TradeToKlineAggregator (src/ws/TradeToKlineAggregator.ts)

Агрегирует Bybit public trade данные в 1-секундные klines:
- `setHandler(handler)` — устанавливает callback для эмита klines
- `processTrade(tradeData)` — обрабатывает один трейд: первый трейд для символа пропускается (неполная секунда), далее агрегация OHLCV
- `forceEmitPendingKlineList()` — принудительно эмитит все накопленные klines (вызывается при `close()`)
- `clearSymbol(symbol)` — сбрасывает состояние символа (вызывается при reconnect)
- Эмитит kline с `isClosed: true` при переходе на следующую секунду
- Не эмитит kline с `volume = 0` (секунда без трейдов)

## Binance User Data Stream

- **URL**: `wss://stream.binance.com:9443/ws/{listenKey}`
- listenKey получается внешне (REST API), передаётся в конструкторе
- Все сообщения передаются в `onMessage` хендлер без фильтрации
- **listenKey refresh** НЕ управляется этим классом — ответственность вызывающего (каждые 30 мин)
- `getConnectionInfo()` → `WebSocketConnectionInfo | null` — возвращает null если не подключён

## BaseTradeStream<T> (src/ws/BaseTradeStream.ts)

Абстрактный базовый класс для `BinanceTradeStream` и `BybitTradeStream`.

Общая инфраструктура:
- `connect()` / `disconnect()` / `isConnected()` — управление жизненным циклом
- `createOrder(orderParams)` → `Promise<Order>` — async request-response (single order)
- `getConnectionInfo()` → `WebSocketConnectionInfo | null` — info о текущем соединении
- `ensureConnected()` — lazy connection с dedup промисов
- `sendRequest<TResult>(request, requestId, kind: PendingRequestKind): Promise<TResult>` — generic helper для всех request-response типов (single и batch). Timeout 30s, pending requests хранятся в `Map<reqId, PendingRequest>`.
- `sendOrderRequest(request, requestId): Promise<Order>` — private wrapper над `sendRequest<Order>(..., PendingRequestKind.SingleOrder)` (обратная совместимость для single create)
- `takePendingRequest(requestId)` — protected метод, возвращает и удаляет pending request из Map
- `ensureConnectedHook()` — protected helper для подклассов, отправляющих batch-запросы (форсирует lazy connect перед отправкой)
- `generateReqId()` — protected helper для генерации уникального `requestId` (используется в batch-методах `BybitTradeStream`)

`PendingRequest` теперь kind-tagged: discriminated union по полю `kind: PendingRequestKind`, где `PendingRequestKind` = enum `SingleOrder | CreateBatch | ModifyBatch | CancelBatch`. Поле `resolve: (data: unknown) => void` (раньше `(order: Order) => void`) — подкласс приводит к нужному типу в handler.

`label` передаётся через `BaseTradeStreamArgs` (не абстрактное свойство).

Абстрактные методы (реализуются подклассами):
- `initConnection()` — создание WebSocket и подключение
- `buildOrderRequest(orderParams, requestId)` — формирование single-order запроса

## Binance Trade Stream

Наследует `BaseTradeStream<BinanceTradeWebSocketResponse>`.

- **URL futures**: `wss://ws-fapi.binance.com/ws-fapi/v1`
- **URL spot**: `wss://ws-api.binance.com:443/ws-api/v3`
- **Demo URLs**: testnet-варианты обоих
- Создаётся в `BinanceBaseClient` — одинаково для spot и futures
- Signing: HMAC-SHA256 через `buildBinanceWebSocketSignedParams()` — params в payload
- Request format: `{ id, method: 'order.place', params: { ...orderParams, apiKey, signature, timestamp } }`
- Response matching по `id` = `requestId`
- Нормализация ответа через `normalizeBinanceOrder()`
- Ошибки выбрасываются как `ExchangeError` с полями `code` и `exchange`
- **Per-response rate-limit snapshot**: `handleMessage` парсит `message.rateLimits[]` через `parseBinanceRateLimitArray`. Функция ищет entry с `rateLimitType === 'ORDERS' && interval === 'SECOND'`. Результат: `{ limit: entry.limit, remaining: max(0, entry.limit - entry.count), resetMs: Date.now() + entry.intervalNum * 1000 }` — присваивается `Order.rateLimit?`. Если `rateLimits` отсутствует, пуст, или нет ORDERS/SECOND entry → snapshot не присваивается.
- **Batch через WS не поддерживается**: Binance WebSocket API содержит только одиночные `order.place / order.modify / order.cancel` — batch-операции доступны исключительно через REST
- **handleMessage**: маршрутизирует ответы `order.place` как single-order. Защита: если `pending.kind !== PendingRequestKind.SingleOrder` → reject pending с ошибкой (некорректный kind для Binance)

## Bybit Trade Stream

Наследует `BaseTradeStream<BybitTradeMessage>`.

- **URL**: `wss://stream.bybit.com/v5/trade`
- **Только production** — в demo mode `tradeStream = null`, fallback на REST
- Аутентификация при каждом open через `authenticateBybitWebSocket()` (`expires = Date.now() + 10000`)
- Single create: request format `{ op: 'order.create', args: [...], reqId, header: { X-BAPI-* } }`
- Response matching по `reqId` = `requestId`
- Возвращает минимальный Order (только id + clientOrderId), не полную нормализацию
- **Per-response rate-limit snapshot**: `handleSingleOrderResponse` парсит `message.header` через `parseBybitHeaderRateLimit` — читает `X-Bapi-Limit` (общий лимит per-UID на эту группу ордеров), `X-Bapi-Limit-Status` (remaining), `X-Bapi-Limit-Reset-Timestamp` (resetMs unix ms). Результат `OrderRateLimitSnapshot` присваивается `Order.rateLimit?`. Если хоть одно поле отсутствует или не parseable как число → snapshot не присваивается (поле остаётся undefined).
- **Heartbeat**: `{ op: 'ping' }`, интервал 20s
- Ошибки выбрасываются как `ExchangeError` с полями `code` и `exchange`
- **handleMessage**: маршрутизирует по `op` сообщения:
  - `order.create` → handler для `PendingRequestKind.SingleOrder`
  - `order.create-batch` → handler для `PendingRequestKind.CreateBatch`
  - `order.amend-batch` → handler для `PendingRequestKind.ModifyBatch`
  - `order.cancel-batch` → handler для `PendingRequestKind.CancelBatch`
  - Auth-ответы (`op: 'auth'`) — фильтруются
- **Auto-cleanup**: после resolve/reject batch-запроса соответствующая запись удаляется из `pendingBatchContextByReqId`. Orphan-сценарии (ответ без pending) — лог warn и игнор.

## Bybit Trade Stream Batch

Bybit V5 WebSocket Trade поддерживает batch-операции (Binance WebSocket API не имеет batch — там только одиночные `order.place / order.modify / order.cancel`).

**Поддерживаемые ops:**
- `order.create-batch` — создание пачкой
- `order.amend-batch` — модификация пачкой
- `order.cancel-batch` — отмена пачкой

**Структура запроса:**
```
{
  op: 'order.create-batch' | 'order.amend-batch' | 'order.cancel-batch',
  args: [{ category, request: [...] }],  // массив из ОДНОГО элемента с category + массивом ордеров
  header: { 'X-BAPI-TIMESTAMP': ..., 'X-BAPI-RECV-WINDOW': '7000' },
  reqId: string,
}
```

**Структура ответа:**
- `data.list[]` — основные данные (orderId, orderLinkId)
- `retExtInfo.list[]` — per-order success/error (`code === 0` = успех)

**Лимиты:** linear/inverse/option = 20 ордеров на batch, spot = 10. Chunking применяется на уровне `BybitBaseClient` снаружи WS-вызова через `batchChunkSize`.

**Методы (только Bybit):**
- `BybitTradeStream.createBatchOrders(category, originalArgsList, requestPayloadList): Promise<Order[]>` — `originalArgsList` (`CreateOrderWebSocketArgs[]`) нужен для построения Order через `buildBybitOrderFromCreateResponse` (ответ содержит только `orderId`/`orderLinkId`, остальные поля Order берутся из аргументов)
- `BybitTradeStream.modifyBatchOrders(category, originalOrderIdList, requestPayloadList): Promise<ModifyBatchOrdersResult>` — `originalOrderIdList` нужен для трасировки `orderId` в результате на случай, если биржа не вернёт его в ответе (per-order error path)
- `BybitTradeStream.cancelBatchOrders(category, originalOrderIdList, requestPayloadList): Promise<CancelBatchOrdersResult>` — аналогично, `originalOrderIdList` для трасировки

**Хранение pending запросов:** `pendingBatchContextByReqId: Map<string, BybitPendingBatchContext>` (discriminated union по `kind: 'create' | 'modify' | 'cancel'`) — хранит метаданные запроса (`originalArgsList` или `originalOrderIdList`, размер чанка) между отправкой и получением ответа. Очищается при resolve/reject и orphan-сценариях. Защита от kind mismatch: если `kind` входящего сообщения не совпадает с зарегистрированным pending — reject с ошибкой.

## parseWebSocketMessage<T> (src/ws/parseWebSocketMessage.ts)

Generic JSON parser, используется всеми WebSocket стримами:
```typescript
function parseWebSocketMessage<T>(rawData: RawData): T
```
Заменяет 7 ранее идентичных parse-функций. Каждый стрим вызывает через inline arrow: `(rawData) => parseWebSocketMessage<SpecificType>(rawData)`.

## Bybit Private Stream

- **URL**: `wss://stream.bybit.com/v5/private`
- Аутентификация на каждый `onOpen` через `authenticateBybitWebSocket()`
- После успешной аутентификации автоматически подписывается на топики из `topicList` (если не пустой): `{ op: 'subscribe', args: topicList }`
- `topicList?: string[]` — опциональный список топиков для подписки, передаётся через `BybitPrivateStreamArgs`
- Фильтрует `message.op === 'auth'` — не передаёт в хендлер
- **Heartbeat**: `{ op: 'ping' }`, интервал 20s
- `getConnectionInfo()` → `WebSocketConnectionInfo | null` — возвращает null если не подключён

## Error Protection

Все message handlers во всех WebSocket стримах обёрнуты в try-catch. При ошибке в handler логируется сообщение через `logger.error()` и стрим продолжает работать.

## Паттерн конвертации интервалов (Bybit)

Binance использует строки `'1m'`, `'1h'`, `'1d'` напрямую.
Bybit конвертирует через маппинг `BYBIT_KLINE_INTERVAL`:
```
'1m' → '1', '5m' → '5', '1h' → '60', '4h' → '240', '1d' → 'D', '1w' → 'W'
```

## FuturesConnection структура

Каждое соединение в `BinanceFuturesPublicStream` отслеживает:
- `webSocket: ReliableWebSocket<BinanceCombinedMessage>`
- `label: string` — включает `groupKey` (например `Binance Futures Public WebSocket interval-1m`)
- `streamList: string[]` — стримы, подписанные на этом соединении
- `url: string` — базовый market WS URL
- `messageCount: number`, `lastMessageTimestamp: number`
- `groupKey: string` — ключ группы (`tickers-markprices` или `interval-{interval}`)
- `recreateCount`, `lastRecreateTimestamp` — учёт пересозданий
- `readyPromise: Promise<void>`, `resolveReady?` — готовность после SUBSCRIBE-батчей

## BybitConnection структура

Каждое соединение в `BybitPublicStream` отслеживает:
- `webSocket: ReliableWebSocket<BybitWebSocketMessage>` — само WebSocket соединение
- `label: string` — человекочитаемый лейбл (e.g. `[Bybit Linear] Public` или `[Bybit Linear] Public #2`)
- `topicList: string[]` — все topics в соединении (изначальные + добавленные)
- `dynamicTopicList: string[]` — только topics, добавленные динамически через `addTopicToConnection()` (не были при создании)
- `url: string` — URL соединения
- `lastRecreateTimestamp: number` — время последнего programmatic recreate (дедуп 2000ms)

При reconnect (`onReconnectSuccess`) переподписываются все topics из `topicList` данного соединения.

## Type Extraction

Типы вынесены в co-located `.types.ts` файлы:
- `BaseTradeStream.types.ts` — BaseTradeStreamArgs, PendingRequest (kind-tagged), PendingRequestKind (enum: `SingleOrder` | `CreateBatch` | `ModifyBatch` | `CancelBatch`)
- `BinanceFuturesPublicStream.types.ts` — BinanceFuturesPublicStreamArgs, BinanceCombinedMessage, FuturesConnection
- `BinanceSpotPublicStream.types.ts` — BinanceSpotPublicStreamArgs, BinanceSpotWebSocketEnvelope
- `BinanceUserDataStream.types.ts` — BinanceUserDataStreamArgs
- `BinanceTradeStream.types.ts` — BinanceTradeWebSocketResponse, BinanceWebSocketError, BinanceWebSocketRateLimitEntry (`{ rateLimitType, interval, intervalNum, limit, count }`)
- `BybitPublicStream.types.ts` — BybitPublicStreamArgs, BybitWebSocketMessage, BybitConnection
- `TradeToKlineAggregator.types.ts` — AggregatedKline
- `BybitPrivateStream.types.ts` — BybitPrivateMessage, BybitPrivateStreamArgs
- `BybitTradeStream.types.ts` — BybitTradeMessage, BybitTradeResponseHeader (`{ 'X-Bapi-Limit'?, 'X-Bapi-Limit-Status'?, 'X-Bapi-Limit-Reset-Timestamp'? }`), BybitPendingBatchContext (discriminated union по `kind: 'create' | 'modify' | 'cancel'`, хранит `originalArgsList` / `originalOrderIdList` для трасировки в ответе)
- `bybitWebSocketUtils.types.ts` — BybitBaseWebSocketMessage, AuthenticateBybitWebSocketArgs
