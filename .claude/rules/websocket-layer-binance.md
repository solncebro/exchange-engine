# WebSocket Layer — Binance

Часть `websocket-layer.md` (см. индекс там). Binance-специфичные публичные/trade/user-data стримы.

## Binance Futures Public Stream

- **URL**: `wss://fstream.binance.com/market/ws` (demo: `wss://fstream.binancefuture.com/market/ws`) — один endpoint без списка стримов в query; подписка только через JSON после `onOpen`
- **Группировка соединений**: одно соединение на не-kline стримы (`!miniTicker@arr`, при необходимости `!markPrice@arr@1s`); одно соединение на все `@aggTrade` стримы (`groupKey = 'aggTrades'`); kline-интервалы — отдельная группа на interval, шардируемая на несколько соединений при превышении `maxStreamsPerConnection` (см. «Шардинг соединений» ниже). TRADIFI perpetual (по `TradeSymbol.isTradifi`) использует `{symbol}@kline_{interval}` вместо `continuousKline`
- **Kline стрим**: `{symbol}_perpetual@continuousKline_{interval}` или spot-формат для TRADIFI
- **Тикер стрим**: `!miniTicker@arr`
- **Mark/index стрим** (если есть подписчики `subscribeMarkPrices`): `!markPrice@arr@1s` — в `subscriptionList` как `MarkPrices`; payload → `MarkPriceUpdate[]`
- **PublicTrade стрим** (`subscribePublicTrades`/`unsubscribePublicTrades`/`resubscribePublicTrades`, 0.16.0): `{symbol}@aggTrade` на отдельном соединении (`groupKey = 'aggTrades'`); нормализация через `normalizeBinanceAggTradeFromStream` (`BinanceAggTradeWebSocketRaw` — `e, E, s, a, p, q, f, l, T, m`); в `subscriptionList` как `Trades {symbol}`. В отличие от kline-групп, `addAggTradeStream` не проверяет `maxStreamsPerConnection` — все `@aggTrade` стримы всегда идут на одно (первое найденное) `aggTrades`-соединение
- **Подписка**: в `onOpen` батчами `{"method":"SUBSCRIBE","params":[...streams],"id"}` (`subscribeBatchSize`, пауза `pauseBetweenSubscribeBatchesMs` между батчами). У каждого соединения свой `readyPromise`, резолвится после отправки всех батчей. `sendSubscribeBatches` читает длину `streamList` **вживую** на каждой итерации (не фиксирует `batchCount` заранее) — стримы, добавленные динамически, пока соединение ещё открывается, попадают в ещё не отправленный батч
- **Deferred connect**: `scheduleConnect()` через `queueMicrotask`; между созданием соединений — `pauseBetweenConnectionsMs` (rate limit)
- **Шардинг соединений** (`maxStreamsPerConnection`, дефолт 900 — под лимит Binance 1024 стрима/соединение): при создании — `createConnections` бьёт `streamListByInterval` через `chunkList(streamList, maxStreamsPerConnection)`, каждый чанк — отдельное соединение с тем же `groupKey`; не-kline (`tickers-markprices`) и `aggTrades` группы chunkList не проходят — всегда одно соединение независимо от числа стримов. При динамическом добавлении — `addStreamToIntervalGroup` ищет среди соединений своего `groupKey` то, где `streamList.length < maxStreamsPerConnection`; если все полны — создаёт новый шард с тем же `groupKey`
- **Фикс залпа `SUBSCRIBE`**: `sendDynamicSubscribe` больше не шлёт по кадру на стрим сразу — если соединение ещё не открыто (`connection.resolveReady !== undefined`), функция ничего не отправляет и просто выходит: стрим уже добавлен в `streamList` до вызова, и его заберёт пакетный `onOpen`-батч (см. выше «читает длину streamList вживую»). Раньше при массовой синхронной подписке на ещё не открытое соединение уходил залп индивидуальных `SUBSCRIBE`-кадров — выше лимита Binance 10 входящих сообщений/сек/соединение → разрыв
- **Stale watcher**: периодически проверяет возраст `lastMessageTimestamp`; при превышении `staleThresholdMs` — `recreateConnection` (с дедупом и grace после recreate)
- **Диагностика**: `messageCount`, `lastMessageTimestamp` на `FuturesConnection` и в `WebSocketConnectionInfo`
- **Heartbeat**: application-level, не дефолтный ping `ReliableWebSocket` — `{ method: 'LIST_SUBSCRIPTIONS', id: 1_000_000 }` каждые 30s (`configuration.pingInterval`); ответ детектируется по `id === 1_000_000 && Array.isArray(result)`
- **Методы**: `awaitConnectionsReady()` — `Promise.all` по `readyPromise` активных соединений; `resubscribeStream(symbol, interval)` / `resubscribePublicTrades(symbol)` — оба делегируют в приватный `resubscribeStreamByName(stream)`, который делает `recreateConnection` для соединения, где есть стрим
- **Orderbook стрим** (`subscribeOrderbook`/`unsubscribeOrderbook`/`resubscribeOrderbook`): `{symbol}@depth{depth}@100ms` на отдельной группе (`groupKey = 'orderbooks'`). Соединение этой группы открывается на **отдельном endpoint** — `orderbookWebSocketUrl` (аргумент конструктора, по умолчанию равен `webSocketUrl`), а не на рыночном `/market/ws`: рыночный endpoint подтверждает `SUBSCRIBE` на глубину, но кадров не шлёт (проверено живой пробой 06.09.2026); комбинированный `wss://fstream.binance.com/stream` отдаёт стакан в обёртке `{ stream, data }`. `BinanceFutures` передаёт `BINANCE_FUTURES_WEBSOCKET_COMBINED_URL` (demo — `BINANCE_DEMO_FUTURES_WEBSOCKET_COMBINED_URL`); все остальные группы (`tickers-markprices`, `aggTrades`, `interval-{interval}`) остаются на `webSocketUrl`
- **Аргументы** (`BinanceFuturesPublicStreamArgs`): опционально `orderbookWebSocketUrl` (endpoint группы `orderbooks`, по умолчанию `webSocketUrl`), `pauseBetweenConnectionsMs`, `staleThresholdMs`, `staleCheckIntervalMs`, `subscribeBatchSize`, `pauseBetweenSubscribeBatchesMs`, `maxStreamsPerConnection`

## Binance Spot Public Stream

- **URL**: `wss://stream.binance.com:9443/ws`
- **Одно соединение**, lazy-initialized через `ensureConnected()`
- **Kline стрим**: `{symbol.toLowerCase()}@kline_{interval}`
- **Тикер стрим**: `!miniTicker@arr`
- **Mark price**: не поддерживается — `subscribeMarkPrices` логирует предупреждение и не подписывается; `unsubscribeMarkPrices` — no-op
- **Подписка**: динамическая через JSON: `{ method: 'SUBSCRIBE', params: [...], id }`
- **Reconnect**: переподписка через `onOpen → handleOpen → resubscribeAll()` (срабатывает на каждый connect, включая reconnect); `onReconnectSuccess` НЕ используется — иначе была бы двойная переподписка
- **Heartbeat**: `{ method: 'PING' }` → ответ с `id` и `result: null`, интервал 30s
- **Методы**: `resubscribeStream(symbol, interval)` — принудительная переподписка на конкретный стрим через SUBSCRIBE

## Binance User Data Stream — два разных механизма (Futures vs Spot)

**Futures — `BinanceUserDataStream` (listenKey):**
- **URL**: `${baseWebSocketUrl}/{listenKey}` — `wss://fstream.binance.com/private/ws` (prod) / `wss://fstream.binancefuture.com/ws` (demo). listenKey получается через REST, передаётся в конструкторе; refresh — ответственность вызывающего (каждые 30 мин)
- Все сообщения передаются в `onMessage` без фильтрации; события `ORDER_TRADE_UPDATE` / `ACCOUNT_UPDATE` маппит `BinanceBaseClient.handleUserDataMessage`

**Spot — `BinanceSpotUserDataStream` (WebSocket API):** listenKey REST `/api/v3/userDataStream` удалён биржей 2026-02-20, поэтому спот переведён на WS API.
- **URL**: `ws-api/v3` (та же константа, что и спотовый trade-stream: `wss://ws-api.binance.com:443/ws-api/v3` prod / demo testnet)
- На `onOpen` (и на `onReconnectSuccess`) шлёт подписанный `{ id, method: 'userDataStream.subscribe', params }`, где `params = buildBinanceWebSocketSignedParams({ apiKey })` — **HMAC-SHA256, без Ed25519/session.logon**. Хранит `subscriptionId` из ответа `{ status: 200, result: { subscriptionId } }`
- `handleMessage`: ответ subscribe/unsubscribe (по `id`) не форвардит; event-фрейм (`message.event ?? message`) → `onMessage`
- `close()` → `userDataStream.unsubscribe` с `subscriptionId`, затем закрытие сокета. listenKey-keepalive таймер не нужен
- Маппинг событий (`BinanceSpot.handleSpotUserDataMessage`): `executionReport → onOrderUpdate` (avgPrice = `Z`/`z`), `outboundAccountPosition → onBalanceUpdate` (`B[]` → `BalanceUpdateEvent.balanceList`). `onPositionUpdate` к споту не применяется
- ⚠️ Требует live-проверки на testnet: формат event-фрейма (голый vs `{event:...}`), поведение подписки при долгой сессии

**Общее:** `isConnected()` / `getConnectionInfo().isConnected` — через `webSocket.getStatus() === WebSocketStatus.CONNECTED`; `getConnectionInfo()` → null если сокет не создан. `BinanceSpot` переопределяет `connectUserDataStream` / `disconnectUserDataStream` / `isUserDataStreamConnected` / `getWebSocketConnectionInfoList` и хранит spot-UDS в отдельном поле `spotUserDataStream` (защита от двойного connect — `spotUserDataStreamConnecting`)

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
