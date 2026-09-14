# WebSocket Layer

## Зависимость

Все стримы используют `ReliableWebSocket<TMessage>` из `@solncebro/websocket-engine` — автоматический reconnect, heartbeat, backoff.

## PublicStreamLike интерфейс (src/types/stream.ts)

```
subscribeAllTickers(handler: (tickers: TickerBySymbol) => void, symbolList: string[]): void
unsubscribeAllTickers?(handler): void  // снять хендлер all-tickers; у Bybit может отписать topic, если нет mark-price хендлеров
subscribeMarkPrices(handler: MarkPriceHandler, symbolList: string[]): void
unsubscribeMarkPrices(handler: MarkPriceHandler): void
subscribeKlines(symbol, interval, handler): void
unsubscribeKlines(symbol, interval, handler): void
subscribeOrderbook?(symbol, depth, handler: OrderBookHandler): void  // опциональный, реализован у Bybit и OKX
unsubscribeOrderbook?(symbol, depth, handler: OrderBookHandler): void
subscribePublicTrades?(symbol, handler: PublicTradeHandler): void  // опциональный, реализован у Bybit, OKX и Binance Futures (не Binance Spot)
unsubscribePublicTrades?(symbol, handler: PublicTradeHandler): void
resubscribeStream?(symbol, interval): void  // опциональный, для принудительной переподписки klines
resubscribeStreamList?(subscriptionList: ResubscribeKlinesArgs[]): void  // опциональный, пакетная переподписка klines; реализован у Binance Futures, Bybit и OKX
resubscribeOrderbook?(symbol, depth): void  // опциональный, реализован у Bybit и OKX
resubscribePublicTrades?(symbol): void  // опциональный, реализован у Bybit, OKX и Binance Futures
resubscribeMarkPrices?(): void  // опциональный, батчевая light-переподписка (Bybit — все tickers.{symbol}; OKX — все mark-price.{instId})
setOrderbookLiveSymbol?(symbol, isLive): void  // опциональный, Bybit и OKX — управление live-набором при lazyOrderbookParse
subscribeRawOrderbook?(handler: RawOrderbookHandler): void  // опциональный, Bybit и OKX
unsubscribeRawOrderbook?(handler: RawOrderbookHandler): void
getConnectionInfoList(): WebSocketConnectionInfo[]
awaitConnectionsReady?(): Promise<void>
close(): void
```

Optional методы `subscribeOrderbook`/`unsubscribeOrderbook` объявлены опциональными, поэтому Binance public streams (spot и futures) без реализации продолжают удовлетворять контракту; Bybit и OKX их реализуют. `subscribePublicTrades`/`unsubscribePublicTrades` реализованы у `BinanceFuturesPublicStream` (через `@aggTrade`), у Bybit и у OKX — только `BinanceSpotPublicStream` их не реализует. На уровне `BaseExchangeClient` отсутствие optional-метода → `subscribeOrderbook`/`subscribePublicTrades` бросает `Orderbook subscription not supported for ${marketLabel} market` / `Public trade subscription not supported for ${marketLabel} market`, соответствующий `unsubscribe*` — no-op.

## Хранение хендлеров

- **Тикеры**: `Set<Handler>` — все хендлеры получают одни и те же данные
- **Klines**: `Map<"SYMBOL_INTERVAL", Set<Handler>>` — группировка по стриму
- **Orderbook** (Bybit): `Map<"orderbook.{depth}.{symbol}", Set<OrderBookHandler>>` — ключ совпадает с topic
- **Orderbook** (OKX): `Map<"{channel}|{instId}", Set<OrderBookHandler>>` — тот же ключ темы, что и в списке тем соединения (`books` / `books5` / `bbo-tbt`)
- **PublicTrade** (OKX): `Map<symbol, Set<PublicTradeHandler>>`; тема `trades|{instId}` снимается, когда обработчиков не осталось
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

## Детальная документация по биржам

Публичные/trade/user-data стримы конкретных бирж вынесены в отдельные файлы (30k-лимит):

| Файл | Содержание |
|------|-----------|
| [websocket-layer-binance.md](websocket-layer-binance.md) | Binance Futures/Spot Public Stream, Binance User Data Stream, Binance Trade Stream, FuturesConnection |
| [websocket-layer-bybit.md](websocket-layer-bybit.md) | Bybit Public Stream, TradeToKlineAggregator, Bybit Trade Stream (+ Batch), Bybit Private Stream, BybitConnection |
| [websocket-layer-okx.md](websocket-layer-okx.md) | OkxSilenceWatchdog, вход, OkxConnection (index) |
| [websocket-layer-okx-public.md](websocket-layer-okx-public.md) | OKX Public Stream: три набора соединений, бюджет операций подписки, подписка и отписка, темы |
| [websocket-layer-okx-orderbook.md](websocket-layer-okx-orderbook.md) | Стакан: разрывы порядковых номеров, ленивый разбор, разбор входящих кадров |
| [websocket-layer-okx-trade.md](websocket-layer-okx-trade.md) | OKX Trade Stream (+ Batch, признак непригодности канала), OKX Private Stream (личный и деловой) |

## BaseTradeStream<T> (src/ws/BaseTradeStream.ts)

Абстрактный базовый класс для `BinanceTradeStream` и `BybitTradeStream`.

Общая инфраструктура:
- `connect()` / `disconnect()` / `isConnected()` — управление жизненным циклом
- `createOrder(orderParams)` → `Promise<Order>` — async request-response (single order)
- `getConnectionInfo()` → `WebSocketConnectionInfo | null` — info о текущем соединении
- `ensureConnected()` — lazy connection с dedup промисов. Порядок гардов: сначала `if (connectPromise !== null) return connectPromise`, затем `if (webSocket !== null) return` — параллельный вызов в окне CONNECTING ждёт in-flight `connectPromise`, а не возвращается рано (иначе `sendRequest` падал бы `WebSocket is not connected`)
- `sendRequest<TResult>(request, requestId, kind: PendingRequestKind): Promise<TResult>` — generic helper для всех request-response типов (single и batch). Timeout 30s, pending requests хранятся в `Map<reqId, PendingRequest>`.
- `sendOrderRequest(request, requestId): Promise<Order>` — private wrapper над `sendRequest<Order>(..., PendingRequestKind.SingleOrder)` (обратная совместимость для single create)
- `takePendingRequest(requestId)` — protected метод, возвращает и удаляет pending request из Map
- `ensureConnectedHook()` — protected helper для подклассов, отправляющих batch-запросы (форсирует lazy connect перед отправкой)
- `generateReqId()` — protected helper для генерации уникального `requestId` (используется в batch-методах `BybitTradeStream`)

`PendingRequest` теперь kind-tagged: discriminated union по полю `kind: PendingRequestKind`, где `PendingRequestKind` = enum `SingleOrder` | `CreateBatch` | `ModifyBatch` | `CancelBatch` | `ConditionalOrder` | `ConditionalCancel` | `SingleCancel` | `SingleAmend` (последние четыре добавлены для OKX: у него по торговому каналу идут ещё одиночная отмена и одиночная правка). Поле `resolve: (data: unknown) => void` (раньше `(order: Order) => void`) — подкласс приводит к нужному типу в handler.

`label` передаётся через `BaseTradeStreamArgs` (не абстрактное свойство).

Абстрактные методы (реализуются подклассами):
- `initConnection()` — создание WebSocket и подключение
- `buildOrderRequest(orderParams, requestId)` — формирование single-order запроса

## parseWebSocketMessage<T> (src/ws/parseWebSocketMessage.ts)

Generic JSON parser, используется всеми WebSocket стримами:
```typescript
function parseWebSocketMessage<T>(rawData: RawData): T
```
Заменяет 7 ранее идентичных parse-функций. Каждый стрим вызывает через inline arrow: `(rawData) => parseWebSocketMessage<SpecificType>(rawData)`.

## Error Protection

Все message handlers во всех WebSocket стримах обёрнуты в try-catch. При ошибке в handler логируется сообщение через `logger.error()` и стрим продолжает работать.

## Паттерн конвертации интервалов (Bybit)

Binance использует строки `'1m'`, `'1h'`, `'1d'` напрямую.
Bybit конвертирует через маппинг `BYBIT_KLINE_INTERVAL`:
```
'1m' → '1', '5m' → '5', '1h' → '60', '4h' → '240', '1d' → 'D', '1w' → 'W'
```

## Type Extraction

Типы вынесены в co-located `.types.ts` файлы:
- `BaseTradeStream.types.ts` — BaseTradeStreamArgs, PendingRequest (kind-tagged), PendingRequestKind (enum: `SingleOrder` | `CreateBatch` | `ModifyBatch` | `CancelBatch` | `ConditionalOrder` | `ConditionalCancel` | `SingleCancel` | `SingleAmend`)
- `BinanceFuturesPublicStream.types.ts` — BinanceFuturesPublicStreamArgs, BinanceCombinedMessage, FuturesConnection
- `BinanceSpotPublicStream.types.ts` — BinanceSpotPublicStreamArgs, BinanceSpotWebSocketEnvelope
- `BinanceUserDataStream.types.ts` — BinanceUserDataStreamArgs
- `BinanceSpotUserDataStream.types.ts` — BinanceSpotUserDataStreamArgs, BinanceSpotUserDataStreamMessage, BinanceSpotUserDataSubscribeResult
- `BinanceTradeStream.types.ts` — BinanceTradeWebSocketResponse, BinanceWebSocketError, BinanceWebSocketRateLimitEntry (`{ rateLimitType, interval, intervalNum, limit, count }`)
- `BybitPublicStream.types.ts` — BybitPublicStreamArgs, BybitWebSocketMessage, BybitConnection
- `TradeToKlineAggregator.types.ts` — AggregatedKline
- `BybitPrivateStream.types.ts` — BybitPrivateMessage, BybitPrivateStreamArgs
- `BybitTradeStream.types.ts` — BybitTradeMessage, BybitTradeResponseHeader (`{ 'X-Bapi-Limit'?, 'X-Bapi-Limit-Status'?, 'X-Bapi-Limit-Reset-Timestamp'? }`), BybitPendingBatchContext (discriminated union по `kind: 'create' | 'modify' | 'cancel'`, хранит `originalArgsList` / `originalOrderIdList` для трасировки в ответе)
- `bybitWebSocketUtils.types.ts` — BybitBaseWebSocketMessage, AuthenticateBybitWebSocketArgs (типы, реэкспортируются и из `bybitWebSocketUtils.ts`, и из `bybitWebSocketAuth.ts`)
- `OkxPublicStream.types.ts` — OkxPublicStreamArgs, OkxConnectionPoolType (`'public' | 'business'`), OkxTopicMutationKind (`'subscribe' | 'unsubscribe'`), OkxConnection
- `OkxTradeStream.types.ts` — OkxTradeStreamArgs, OkxTradeAnyMessage, OkxTradeResponseMessage, OkxCancelOrderParams, OkxPendingBatchContext (объединение по `kind: 'create' | 'modify' | 'cancel'`)
- `OkxPrivateStream.types.ts` — OkxPrivateStreamArgs
- `OkxSilenceWatchdog.types.ts` — OkxSilenceWatchdogArgs
- `okxWebSocketUtils.types.ts` — OkxWebSocketMessage, OkxSubscriptionArg
- `okxWebSocketAuth.types.ts` — AuthenticateOkxWebSocketArgs
- `bybitWebSocketAuth.ts` — `authenticateBybitWebSocket` (HMAC-подпись, ожидание ответа `auth`); вынесен из `bybitWebSocketUtils.ts`, который теперь содержит только heartbeat-хелперы (`BYBIT_HEARTBEAT_CONFIG`, `BYBIT_PING_INTERVAL`, `isBybitPongResponse`). `BybitPrivateStream` и `BybitTradeStream` импортируют функцию из нового файла
