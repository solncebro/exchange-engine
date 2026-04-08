# WebSocket Layer

## Зависимость

Все стримы используют `ReliableWebSocket<TMessage>` из `@solncebro/websocket-engine` — автоматический reconnect, heartbeat, backoff.

## PublicStreamLike интерфейс (src/types/stream.ts)

```
subscribeAllTickers(handler: (tickers: TickerBySymbol) => void): void
subscribeKlines(symbol, interval, handler): void
unsubscribeKlines(symbol, interval, handler): void
resubscribeStream?(symbol, interval): void  // опциональный, для принудительной переподписки
getConnectionInfoList(): WebSocketConnectionInfo[]
close(): void
```

## Хранение хендлеров

- **Тикеры**: `Set<Handler>` — все хендлеры получают одни и те же данные
- **Klines**: `Map<"SYMBOL_INTERVAL", Set<Handler>>` — группировка по стриму

## WebSocket Connection Registry

Все стримы реализуют `getConnectionInfoList()` или `getConnectionInfo()`, возвращающие `WebSocketConnectionInfo`:
- `label` — человекочитаемый лейбл: `[Binance Futures] Public`, `[Bybit Linear] Public`, `[Binance Spot] Orders` и т.д.
- `url` — URL WebSocket-соединения
- `isConnected` — текущее состояние (через `WebSocketStatus.CONNECTED`)
- `type` — `WebSocketConnectionTypeEnum` (Public / Trade / UserData)
- `subscriptionList` — список подписок: `'Tickers'`, `'Klines BTCUSDT 30m'`, `'Trades ETHUSDT'`, или `[]` для trade/userData стримов

Лейблы передаются в стримы через конструктор (Args-паттерн), формируются в exchange-классах.

BinanceFuturesPublicStream при нескольких connections нумерует: `#1`, `#2`, `#3`.

Exchange-классы агрегируют через `getWebSocketConnectionInfoList()`: public + trade + optional userData.

## Binance Futures Public Stream

- **URL**: `wss://fstream.binance.com/stream?streams={stream1}/{stream2}/...`
- **Лимит**: 200 стримов на соединение (чанкинг при превышении)
- **Kline стрим**: `{symbol.toLowerCase()}_perpetual@continuousKline_{interval}`
- **Тикер стрим**: `!miniTicker@arr`
- **Подписка**: URL-based (стримы в query string при создании соединения) или динамическая через `sendToConnectedSocket()` (добавленные стримы отслеживаются в `dynamicStreamList`)
- **Deferred connection**: `queueMicrotask()` для батчинга подписок
- **Reconnect**: `onReconnectSuccess` callback переподписывает все динамически добавленные стримы (из `dynamicStreamList`) при reconnect
- **Heartbeat**: дефолтный ReliableWebSocket (30s ping)
- **Методы**: `resubscribeStream(symbol, interval)` — принудительная переподписка на конкретный стрим (найдёт соединение и отправит SUBSCRIBE)

## Binance Spot Public Stream

- **URL**: `wss://stream.binance.com:9443/ws`
- **Одно соединение**, lazy-initialized через `ensureConnected()`
- **Kline стрим**: `{symbol.toLowerCase()}@kline_{interval}`
- **Тикер стрим**: `!miniTicker@arr`
- **Подписка**: динамическая через JSON: `{ method: 'SUBSCRIBE', params: [...], id }`
- **Reconnect**: `onReconnectSuccess → resubscribeAll()` — переподписка всех стримов
- **Heartbeat**: `{ method: 'PING' }` → ответ с `id` и `result: null`, интервал 30s
- **Методы**: `resubscribeStream(symbol, interval)` — принудительная переподписка на конкретный стрим через SUBSCRIBE

## Bybit Public Stream

- **URL**: `wss://stream.bybit.com/v5/public/linear` или `.../spot`
- **Одно соединение**, lazy-initialized через `ensureConnected()`
- **Kline topic**: `kline.{bybitInterval}.{symbol}` (интервал конвертируется через `BYBIT_KLINE_INTERVAL`)
- **1s kline**: через `TradeToKlineAggregator` — подписка на `publicTrade.{symbol}`, агрегация трейдов в 1-секундные свечи
- **Тикер topic**: `tickers.linear` или `tickers.spot` (определяется по URL)
- **Подписка**: `{ op: 'subscribe', args: [topicList] }`
- **Reconnect**: `onReconnectSuccess → resubscribeAll()` из `activeSubscriptionSet`, `tradeAggregator.clearSymbol()` для всех подписанных символов
- **Heartbeat**: `{ op: 'ping' }` → `{ op: 'pong' }`, интервал 20s

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
- `createOrder(orderParams)` → `Promise<Order>` — async request-response
- `getConnectionInfo()` → `WebSocketConnectionInfo | null` — info о текущем соединении
- `ensureConnected()` — lazy connection с dedup промисов
- `sendOrderRequest(request, requestId)` — timeout 30s, pending requests в `Map<reqId, PendingRequest>`
- `takePendingRequest(requestId)` — protected метод, возвращает и удаляет pending request из Map

`label` передаётся через `BaseTradeStreamArgs` (не абстрактное свойство).

Абстрактные методы (реализуются подклассами):
- `initConnection()` — создание WebSocket и подключение
- `buildOrderRequest(orderParams, requestId)` — формирование запроса

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

## Bybit Trade Stream

Наследует `BaseTradeStream<BybitTradeMessage>`.

- **URL**: `wss://stream.bybit.com/v5/trade`
- **Только production** — в demo mode `tradeStream = null`, fallback на REST
- Аутентификация при каждом open через `authenticateBybitWebSocket()` (`expires = Date.now() + 10000`)
- Request format: `{ op: 'order.create', args: [...], reqId, header: { X-BAPI-* } }`
- Response matching по `reqId` = `requestId`
- Возвращает минимальный Order (только id + clientOrderId), не полную нормализацию
- **Heartbeat**: `{ op: 'ping' }`, интервал 20s
- Ошибки выбрасываются как `ExchangeError` с полями `code` и `exchange`

## parseWebSocketMessage<T> (src/ws/parseWebSocketMessage.ts)

Generic JSON parser, используется всеми WebSocket стримами:
```typescript
function parseWebSocketMessage<T>(rawData: RawData): T
```
Заменяет 7 ранее идентичных parse-функций. Каждый стрим вызывает через inline arrow: `(rawData) => parseWebSocketMessage<SpecificType>(rawData)`.

## Bybit Private Stream

- **URL**: `wss://stream.bybit.com/v5/private`
- Аутентификация на каждый `onOpen` через `authenticateBybitWebSocket()`
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
- `webSocket: ReliableWebSocket<BinanceCombinedMessage>` — само WebSocket соединение
- `label: string` — человекочитаемый лейбл (e.g. `[Binance Futures] Public` или `[Binance Futures] Public #2`)
- `streamList: string[]` — все стримы в соединении (изначальные + добавленные)
- `dynamicStreamList: string[]` — только стримы, добавленные динамически через `sendToConnectedSocket()` (не были в URL при создании)
- `url: string` — URL соединения с параметрами query

При reconnect (`onReconnectSuccess`) переподписываются только стримы из `dynamicStreamList`.

## Type Extraction

Типы вынесены в co-located `.types.ts` файлы:
- `BaseTradeStream.types.ts` — BaseTradeStreamArgs, PendingRequest
- `BinanceFuturesPublicStream.types.ts` — BinanceFuturesPublicStreamArgs, BinanceCombinedMessage, FuturesConnection
- `BinanceSpotPublicStream.types.ts` — BinanceSpotPublicStreamArgs, BinanceSpotWebSocketEnvelope
- `BinanceUserDataStream.types.ts` — BinanceUserDataStreamArgs
- `BinanceTradeStream.types.ts` — BinanceTradeWebSocketResponse, BinanceWebSocketError
- `BybitPublicStream.types.ts` — BybitPublicStreamArgs, BybitWebSocketMessage
- `TradeToKlineAggregator.types.ts` — AggregatedKline
- `BybitPrivateStream.types.ts` — BybitPrivateMessage, BybitPrivateStreamArgs
- `BybitTradeStream.types.ts` — BybitTradeMessage
- `bybitWebSocketUtils.types.ts` — BybitBaseWebSocketMessage, AuthenticateBybitWebSocketArgs
