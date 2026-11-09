# WebSocket Layer — Bybit

Часть `websocket-layer.md` (см. индекс там). Bybit-специфичные публичные/trade/private стримы.

## Bybit Public Stream

- **URL**: `wss://stream.bybit.com/v5/public/linear` или `.../spot`. **Публичные стримы всегда на mainnet-хосте**, даже в demo-режиме (Bybit demo-хост `stream-demo.bybit.com` НЕ отдаёт публичные данные — только private)
- **Multi-connection**: `connectionList: BybitConnection[]`, чанкинг при превышении лимита
- **Лимит**: 200 topics на соединение (`MAX_TOPICS_PER_CONNECTION`), 10 topics на SUBSCRIBE сообщение (`MAX_TOPICS_PER_SUBSCRIBE`)
- **Kline topic**: `kline.{bybitInterval}.{symbol}` (интервал конвертируется через `BYBIT_KLINE_INTERVAL`)
- **1s kline**: через `TradeToKlineAggregator` — подписка на `publicTrade.{symbol}`, агрегация трейдов в 1-секундные свечи
- **Тикер topic**: per-symbol `tickers.{symbol}` — у Bybit V5 нет агрегатного ticker-топика (`tickers.linear`/`tickers.spot` отвечают `handler not found`). `subscribeAllTickers(handler, symbolList)` и `subscribeMarkPrices(handler, symbolList)` принимают `symbolList` и подписывают `tickers.{symbol}` для каждого символа через `subscribeTickerSymbols`. Один `tickers.{symbol}` обслуживает обоих consumer'ов (ticker + mark price): ref-count в `releaseTickerSymbolsIfUnused` снимает топики только когда пусты ОБА — `markPriceHandlerSet` И `tickerHandlerSet`. Подписанные символы хранятся в `tickerSubscribedSymbolSet`
- **Приращение тикера сливается со снимком** (`lastTickerBySymbol: Map<string, BybitTickerRaw>`): по теме тикера биржа шлёт сначала полный снимок (`type: 'snapshot'`), дальше — приращения (`type: 'delta'`) ТОЛЬКО с изменившимися полями. На живом BTCUSDT это 175 приращений из 176 кадров за 25 секунд, и в 149 из них нет цены последней сделки. Разбор читает поля как обязательные, поэтому одиночное приращение давало наружу `lastPrice`/`priceChangePercent` «не числами», а суточные объём и границы — нулями. `mergeTickerFrameList` накладывает приращение поверх запомненного снимка и само слитое запоминает как новый снимок; наружу через `subscribeAllTickers` уходит только полный тикер. Приращение по символу, снимка которого ещё не было, НЕ отдаётся вовсе. Неполным считается только кадр, помеченный биржей как `delta`; кадр без пометки принимается за полный, как и прежде. Память чистится в `releaseTickerSymbolsIfUnused` и в `close()`. Цене маркировки отдаётся СЫРОЙ кадр, не слитый: у неё своя память индекса, а слитый кадр повторял бы прежнюю `markPrice` в каждом приращении по верху стакана и порождал события с устаревшей ценой
- **Mark/index**: не отдельный topic — переиспользует `tickers.{symbol}`; в `handleMessage` ветка `tickers.` идёт ДО guard'а `!Array.isArray(message.data)` и coerce'ит объект в одноэлементный список (per-symbol Bybit шлёт `data` объектом, не массивом); из элементов с валидным `markPrice` → `MarkPriceUpdate[]`. **Индекс переживает дельты без markPrice** (`lastIndexPriceBySymbol: Map<string, number>` в `extractMarkPriceUpdates`) — тикер-дельта несёт только ИЗМЕНИВШИЕСЯ поля, поэтому кадр с `markPrice`, но без `indexPrice`, раньше затирал `indexPrice` в `0` (потребитель — price-limit формула, у которой отключался компонент `Max(Index, …)`); теперь используется последний известный индекс per symbol, `0` отдаётся только пока индекс ни разу не приходил (OPGUSDT 2026-07-07)
- **Orderbook topic**: `orderbook.{depth}.{symbol}` (`subscribeOrderbook(symbol, depth, handler)`); `handleMessage` обрабатывает orderbook ДО проверки `Array.isArray(message.data)` — Bybit отдаёт `data` как объект, не массив. `type` из сырого сообщения нормализуется в `'snapshot' | 'delta'`. Symbol берётся из `data.s`, fallback — последний сегмент topic. Уровни `bidList`/`askList` сохраняются как пары decimal-строк (`OrderBookRawLevel = [string, string]`) — без `parseFloat`, чтобы не терять точность
- **PublicTrade topic**: `publicTrade.{symbol}`. Два независимых consumer'а на один topic:
  1. `TradeToKlineAggregator` (1s klines) — подписка через `subscribeKlines(symbol, '1s', handler)`
  2. Custom subscribers через `subscribePublicTrades(symbol, handler)` — получают `PublicTrade[]` нормализованный через `normalizeBybitPublicTradeFromStream`
  Topic снимается только когда отписались оба consumer'а; защита: `unsubscribeKlines('1s')` и `unsubscribePublicTrades` проверяют наличие другого consumer'а перед `removeTopicFromConnection`
- **Подписка**: батчами по 10 topics через `sendSubscribeInBatches()`: `{ op: 'subscribe', args: [batch] }`
- **Deferred connection**: `queueMicrotask()` для батчинга подписок (через `scheduleConnect()`)
- **onOpen**: при открытии соединения подписывает все topics этого соединения через `sendSubscribeInBatches()` с `context.send()`
- **Reconnect**: `onReconnectSuccess → resubscribeConnection(index)` — переподписка topics конкретного соединения, `tradeAggregator.clearSymbol()` для trade-подписок
- **Dynamic topics**: новые подписки добавляются в соединение с наименьшим количеством topics (через `addTopicToConnection`); если все полны — создаётся новое. `addTopicToConnection` дедуплицирует: если топик уже есть в каком-либо соединении — no-op (общие топики `publicTrade.{symbol}` / kline не дублируются в `topicList`, иначе была бы утечка при cleanup и спам «already subscribed» на reconnect)
- **Heartbeat**: `{ op: 'ping' }` → `{ op: 'pong' }`, интервал 20s
- **subscriptionList отображение**: `Tickers`, `MarkPrices`, `Klines {symbol} {interval}`, `Orderbook {symbol} depth={depth}`, `Trades {symbol}` (для `publicTrade.*`)
- **Методы**: `resubscribeStreamList(subscriptionList)` (0.25.0) — приводит пары «символ + интервал» к темам `kline.{bybitInterval}.{symbol}` (общий сборщик `buildKlineTopic`) и отдаёт их `resubscribeTopicList` ОДНИМ списком: одна пара «снять/подписать» на соединение, и порог лавины (`BYBIT_WS_CASCADE_RECREATE_TOPIC_COUNT`, 50) наконец срабатывает. Пустой список — no-op. До 0.25.0 метода не было, и `BaseExchangeClient.resubscribeKlineList` разворачивался в россыпь одиночных переподписок, где порог не срабатывал никогда. `resubscribeStream(symbol, interval)` — находит соединение с соответствующим kline topic. Если WS соединения CONNECTED — light-resubscribe: отправляет `{ op: 'unsubscribe', args: [topic] }` + `{ op: 'subscribe', args: [topic] }` на уже открытый сокет (без пересоздания). Если сокет не CONNECTED или `sendToConnectedSocket` бросает — fallback на `recreateConnection` (полное пересоздание `ReliableWebSocket` с тем же `topicList`); дедуп recreate в окне 2000ms по `lastRecreateTimestamp` на `BybitConnection`; для топиков `publicTrade.*` перед recreate — `tradeAggregator.clearSymbol`
- **Внутреннее**: `buildWebSocket(connectionIndex, label)`, `recreateConnection(connectionIndex, reason)`, `handleOrderBookMessage(topic, message)`, `extractSymbolFromOrderbookTopic(topic)`, `hasPublicTradeConsumer(symbol)`, `resolveBybitMessage(rawData)` — `parseMessage`-колбэк `ReliableWebSocket`, реализует опциональный ленивый парсинг orderbook-кадров при `lazyOrderbookParse: true` (полное описание — `exchange-layer.md`, раздел «Lazy orderbook parse»)

## TradeToKlineAggregator (src/ws/TradeToKlineAggregator.ts)

Агрегирует Bybit public trade данные в 1-секундные klines:
- `setHandler(handler)` — устанавливает callback для эмита klines
- `processTrade(tradeData)` — обрабатывает один трейд: первый трейд для символа пропускается (неполная секунда), далее агрегация OHLCV
- `forceEmitPendingKlineList()` — принудительно эмитит накопленные klines (вызывается при `close()`)
- `clearSymbol(symbol)` — сбрасывает состояние символа (вызывается при reconnect)
- Эмитит kline с `isClosed: true` при переходе на следующую секунду
- Не эмитит kline с `volume <= 0` — гард в `emitKline` (защищает и rollover, и `forceEmitPendingKlineList`: вырожденный placeholder с нулевым OHLC после first-trade-skip на close НЕ эмитится)

## Bybit Trade Stream

Наследует `BaseTradeStream<BybitTradeMessage>`.

- **URL**: `wss://stream.bybit.com/v5/trade`
- **Только production** — в demo mode `tradeStream = null`, fallback на REST
- Аутентификация при каждом open через `authenticateBybitWebSocket()` (`expires = Date.now() + 10000`)
- Single create: request format `{ op: 'order.create', args: [...], reqId, header: { X-BAPI-* } }`
- Response matching по `reqId` = `requestId`
- Возвращает минимальный Order (только id + clientOrderId), не полную нормализацию
- **Per-response rate-limit snapshot**: `handleSingleOrderResponse` парсит `message.header` через `parseBybitHeaderRateLimit` — читает `X-Bapi-Limit` (общий лимит per-UID на эту группу ордеров), `X-Bapi-Limit-Status` (remaining), `X-Bapi-Limit-Reset-Timestamp` (resetMs unix ms). Результат `OrderRateLimitSnapshot` присваивается `Order.rateLimit?` И запоминается через `rememberOrderRateLimit` — оттуда его берёт `BybitBaseClient.getOrderRateLimit` (0.25.0; до этого запоминали только обработчики пачек, и счёт на одиночных заявках живого числа не получал никогда). Если хоть одно поле отсутствует или не parseable как число → snapshot не присваивается (поле остаётся undefined) и ничего не запоминается.
- **Heartbeat**: `{ op: 'ping' }`, интервал 20s
- Ошибки выбрасываются как `ExchangeError` с полями `code` и `exchange`
- **handleMessage**: маршрутизирует по `op` сообщения:
  - `order.create` → `handleSingleOrderResponse` (`PendingRequestKind.SingleOrder`)
  - `order.create-batch` / `order.amend-batch` / `order.cancel-batch` → ОДИН `handleBatchResponse`, которому передаётся запись из таблицы `BYBIT_BATCH_OP_BY_NAME` (`BybitBatchOp`: `label`, `logMessage`, `pendingKind`, `contextKind`, `failureText`) — всё, чем три вида пачки отличаются. Раскладку исходов делает `buildBatchResultList` по виду сохранённого контекста: `create` → `buildBybitCreateOutcome` из исходных аргументов, `modify`/`cancel` → `buildBatchItemResult` по списку номеров заявок. До 0.25.0 обработчиков было три, слово в слово (150 строк вместо ~60), и именно поэтому запоминание предела частоты потерялось на четвёртом, одиночном пути
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

## Bybit Private Stream

- **URL**: передаётся через `BybitPrivateStreamArgs.url` (обязательное поле) — `wss://stream.bybit.com/v5/private` (prod) или `wss://stream-demo.bybit.com/v5/private` (demo). `BybitBaseClient` выбирает по `isDemoMode` и прокидывает в стрим
- Аутентификация на каждый `onOpen` через `authenticateBybitWebSocket()`
- После успешной аутентификации автоматически подписывается на топики из `topicList` (если не пустой): `{ op: 'subscribe', args: topicList }`
- `topicList?: string[]` — опциональный список топиков для подписки, передаётся через `BybitPrivateStreamArgs`
- Фильтрует `message.op === 'auth'` — не передаёт в хендлер
- **Heartbeat**: `{ op: 'ping' }`, интервал 20s
- `isConnected()` / `getConnectionInfo().isConnected` — через `webSocket.getStatus() === WebSocketStatus.CONNECTED` (не «объект существует»); `getConnectionInfo()` возвращает null если сокет не создан

## BybitConnection структура

Каждое соединение в `BybitPublicStream` отслеживает:
- `webSocket: ReliableWebSocket<BybitWebSocketMessage>` — само WebSocket соединение
- `label: string` — человекочитаемый лейбл (e.g. `[Bybit Linear] Public` или `[Bybit Linear] Public #2`)
- `topicList: string[]` — все topics в соединении (изначальные + добавленные)
- `dynamicTopicList: string[]` — только topics, добавленные динамически через `addTopicToConnection()` (не были при создании)
- `url: string` — URL соединения
- `lastRecreateTimestamp: number` — время последнего programmatic recreate (дедуп 2000ms)

При reconnect (`onReconnectSuccess`) переподписываются все topics из `topicList` данного соединения.
