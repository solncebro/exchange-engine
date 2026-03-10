# WebSocket Layer

## Зависимость

Все стримы используют `ReliableWebSocket<TMessage>` из `@solncebro/websocket-engine` — автоматический reconnect, heartbeat, backoff.

## PublicStreamLike интерфейс (src/types/stream.ts)

```
subscribeAllTickers(handler: (tickers: TickerBySymbol) => void): void
subscribeKlines(symbol, interval, handler): void
unsubscribeKlines(symbol, interval, handler): void
close(): void
```

## Хранение хендлеров

- **Тикеры**: `Set<Handler>` — все хендлеры получают одни и те же данные
- **Klines**: `Map<"SYMBOL_INTERVAL", Set<Handler>>` — группировка по стриму

## Binance Futures Public Stream

- **URL**: `wss://fstream.binance.com/stream?streams={stream1}/{stream2}/...`
- **Лимит**: 200 стримов на соединение (чанкинг при превышении)
- **Kline стрим**: `{symbol.toLowerCase()}_perpetual@continuousKline_{interval}`
- **Тикер стрим**: `!miniTicker@arr`
- **Подписка**: URL-based (стримы в query string при создании соединения)
- **Deferred connection**: `queueMicrotask()` для батчинга подписок
- **Heartbeat**: дефолтный ReliableWebSocket (30s ping)

## Binance Spot Public Stream

- **URL**: `wss://stream.binance.com:9443/ws`
- **Одно соединение**, lazy-initialized через `ensureConnected()`
- **Kline стрим**: `{symbol.toLowerCase()}@kline_{interval}`
- **Тикер стрим**: `!miniTicker@arr`
- **Подписка**: динамическая через JSON: `{ method: 'SUBSCRIBE', params: [...], id }`
- **Reconnect**: `onReconnectSuccess → resubscribeAll()` — переподписка всех стримов
- **Heartbeat**: `{ method: 'PING' }` → ответ с `id` и `result: null`, интервал 30s

## Bybit Public Stream

- **URL**: `wss://stream.bybit.com/v5/public/linear` или `.../spot`
- **Одно соединение**, lazy-initialized через `ensureConnected()`
- **Kline topic**: `kline.{bybitInterval}.{symbol}` (интервал конвертируется через `BYBIT_KLINE_INTERVAL`)
- **Тикер topic**: `tickers.linear` или `tickers.spot` (определяется по URL)
- **Подписка**: `{ op: 'subscribe', args: [topicList] }`
- **Reconnect**: `onReconnectSuccess → resubscribeAll()` из `activeSubscriptionSet`
- **Heartbeat**: `{ op: 'ping' }` → `{ op: 'pong' }`, интервал 20s

## Binance User Data Stream

- **URL**: `wss://stream.binance.com:9443/ws/{listenKey}`
- listenKey получается внешне (REST API), передаётся в конструкторе
- Все сообщения передаются в `onMessage` хендлер без фильтрации
- **listenKey refresh** НЕ управляется этим классом — ответственность вызывающего (каждые 30 мин)

## Bybit Trade Stream

- **URL**: `wss://stream.bybit.com/v5/trade`
- **Только production** — в demo mode `tradeStream = null`, fallback на REST
- Аутентификация при каждом open через `authenticateBybitWebSocket()`
- **Async request-response** паттерн для ордеров:
  1. Генерирует уникальный `reqId` (timestamp + random)
  2. Отправляет `{ op: 'order.create', args: [...], reqId, header: {...} }`
  3. Ожидает ответ с matching `reqId` (timeout 30s)
  4. Pending requests хранятся в `Map<reqId, PendingRequest>`
- **Heartbeat**: `{ op: 'ping' }`, интервал 20s

## Bybit Private Stream

- **URL**: `wss://stream.bybit.com/v5/private`
- Аутентификация на каждый `onOpen` через `authenticateBybitWebSocket()`
- Фильтрует `message.op === 'auth'` — не передаёт в хендлер
- **Heartbeat**: `{ op: 'ping' }`, интервал 20s

## Паттерн конвертации интервалов (Bybit)

Binance использует строки `'1m'`, `'1h'`, `'1d'` напрямую.
Bybit конвертирует через маппинг `BYBIT_KLINE_INTERVAL`:
```
'1m' → '1', '5m' → '5', '1h' → '60', '4h' → '240', '1d' → 'D', '1w' → 'W'
```
