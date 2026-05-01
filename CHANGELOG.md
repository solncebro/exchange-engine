# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.13.0] - 2026-04-30

Сводный релиз, объединяющий все локальные эксперименты после 0.12.1: WebSocket-отчёт, Bybit Linear position-mode detection, и spot/futures order-params матрицу для нового `PositionManager` API в trade-engine.

### Added

- `OrderTypeEnum` расширен: `StopLimit`, `TakeProfitLimit` — для атомарных STOP_LOSS_LIMIT / TAKE_PROFIT_LIMIT на Binance Spot и Bybit Spot.
- `TriggerByEnum` (`MarkPrice` | `LastPrice` | `IndexPrice`) — для conditional/stop ордеров на Bybit Linear.
- `OrderFilterEnum` (`Order` | `tpslOrder` | `StopOrder`) — спецификация Bybit Spot conditional/TPSL ордеров.
- `MarketUnitEnum` (`baseCoin` | `quoteCoin`) — выбор единицы количества для Market ордеров на Bybit Spot.
- `CreateOrderWebSocketArgs` дополнен полями: `triggerBy`, `closeOnTrigger`, `orderFilter`, `marketUnit`, `trailingDelta`, `quoteOrderQty`. Все опциональные, обратно-совместимы.
- `BINANCE_FUTURES_ORDER_TYPE_REVERSE` и `BINANCE_SPOT_ORDER_TYPE_REVERSE` — раздельные mapping таблицы. На spot `OrderTypeEnum.StopMarket → 'STOP_LOSS'`, `StopLimit → 'STOP_LOSS_LIMIT'`, `TakeProfitMarket → 'TAKE_PROFIT'`, `TakeProfitLimit → 'TAKE_PROFIT_LIMIT'`. На futures сохранён прежний `STOP_MARKET`/`TAKE_PROFIT_MARKET` контракт.
- `BINANCE_ORDER_TYPE` mapping расширен значениями `STOP_LOSS`, `STOP_LOSS_LIMIT`, `TAKE_PROFIT_LIMIT` для парсинга входящих spot-ордеров.
- `BybitLinear.fetchPositionMode()` — реализация через `GET /v5/position/list?category=linear&settleCoin=USDT`. Логика: Hedge если есть позиция с `positionIdx ∈ {1, 2}`; OneWay если все `positionIdx === 0`; `undefined` если позиций нет (Bybit V5 не даёт API для чтения mode без позиций).
- `SymbolLimitFilterArgs`: опциональные `settleCoin?: string`, `baseCoin?: string` для Bybit V5 position-list endpoint.
- `BybitHttpClient.buildCategoryParams()` поддерживает `settleCoin`/`baseCoin` в query-параметрах.
- `formatWebSocketConnectionsReport` — публичная утилита для plain-text отчёта о WebSocket-соединениях (`exchangeClient.getWebSocketConnectionInfoList()` → human-readable summary).
- `ExchangeClient.awaitWebSocketConnectionsReady()` — ожидание готовности публичных WS после подписок (Binance Futures: после SUBSCRIBE-батчей; у стримов без `awaitConnectionsReady` — немедленный resolve).
- `PublicStreamLike.awaitConnectionsReady?()` — опциональный хук на уровне публичного стрима.
- `WebSocketConnectionInfo.messageCount?` / `lastMessageTimestamp?` — per-connection диагностика (заполняет Binance Futures public).

### Changed (BREAKING)

- `ExchangeClient.fetchPositionMode()` теперь возвращает `Promise<PositionModeEnum | undefined>`. Раньше — `Promise<PositionModeEnum>`. Реализации без надёжного API-способа определить режим без открытых позиций (Bybit Linear) возвращают `undefined`.

### Changed

- `BinanceFuturesPublicStream`: endpoint `wss://fstream.binance.com/market/ws` (и demo-аналог); подписка через JSON `SUBSCRIBE` батчами после `onOpen`; группировка соединений — отдельное на `!miniTicker@arr` / `!markPrice@arr@1s` и по одному на каждый kline interval; stale-watcher с пересозданием «зависших» соединений; настраиваемые `pauseBetweenConnectionsMs`, `staleThresholdMs`, `staleCheckIntervalMs`, `subscribeBatchSize`, `pauseBetweenSubscribeBatchesMs`.
- `normalizeBybitTradeSymbols`: инструменты со `status === 'PreLaunch'` получают `isActive: true` (наряду с `Trading`).
- `BinanceBaseClient.buildBinanceOrderParams()` различает spot и futures по `marketLabel`. На spot НЕ выставляются `closePosition`, `workingType`, `positionSide`, `reduceOnly`. Поддерживаются `quoteOrderQty` (USDT-сумма для Market Buy на spot) и `trailingDelta` (STOP_LOSS/TAKE_PROFIT trailing). `timeInForce` ставится для всех Limit-like типов (`Limit`, `StopLimit`, `TakeProfitLimit`).
- `BybitBaseClient.buildBybitOrderParams()` различает spot и linear. На spot НЕ выставляются `triggerDirection`, `triggerBy`, `reduceOnly`, `closeOnTrigger` (валидны только linear/inverse). Добавлены ветки `orderFilter` и `marketUnit` (только spot). Поддерживается `quoteOrderQty` для Market Buy на spot.
- `BybitSpot.createOrderWebSocket()` форсирует `marketUnit='baseCoin'` только если поле НЕ задано явно через `args.marketUnit` И не используется `quoteOrderQty`. Default остаётся `baseCoin` для backward-compat.

### Notes

- `BINANCE_ORDER_TYPE_REVERSE` оставлен как алиас `BINANCE_FUTURES_ORDER_TYPE_REVERSE` для обратной совместимости с внешними импортами.

## [0.13.0-prev] - 2026-04-27 (history note)

Раньше существовали отдельные локальные релизы 0.13.0 (2026-04-27, formatWebSocketConnectionsReport), 0.14.0 (2026-04-29, BybitLinear.fetchPositionMode + BREAKING) и uncommitted 0.15.0. Они объединены в выпускной 0.13.0 от 2026-04-30 выше. Историческая запись (полные технические подробности WebSocket-отчёта) сохранена ниже для справки.

### Added

#### `formatWebSocketConnectionsReport` — заготовка отчёта о WebSocket-соединениях

Новая публичная утилита (`src/utils/formatWebSocketConnectionsReport.ts`), доступная через `import { formatWebSocketConnectionsReport } from '@solncebro/exchange-engine'`. Принимает `WebSocketConnectionInfo[]` (полученный через `exchangeClient.getWebSocketConnectionInfoList()`), возвращает многострочную plain-text строку с компактным форматом:

```
🌐 WebSocket Connections
now: 2026-04-27 14:02:30
total: 54 | source: Binance Futures Public WebSocket

✅ symbols-001 | 40 streams | 2481 msgs | 0s ago
   1000BONKUSDT, 1000FLOKIUSDT, 1000LUNCUSDT, ...
```

Опции:
- `formatTimestamp?: (epochMs: number) => string` — кастомный форматтер времени (default: ISO-подобный)
- `nowTimestamp?: number` — переопределение текущего времени для тестов (default: `Date.now()`)
- `headerLine?: string` — кастомная шапка (default: `🌐 WebSocket Connections`)

Без зависимостей от Telegram/dayjs — приложение само эскейпит markdown и форматирует timestamp в нужном для своей домены формате.

#### Публичный API ExchangeClient

- `ExchangeClient.awaitWebSocketConnectionsReady(): Promise<void>` — позволяет дождаться полной готовности всех WS-соединений (handshake + SUBSCRIBE батчи) после вызовов `subscribeKlines`/`subscribeAllTickers`/`subscribeMarkPrices`. Используется для sequential init: подписался → дождался → REST-загрузка.
- `WebSocketConnectionInfo.messageCount?: number` и `lastMessageTimestamp?: number` — per-connection диагностика (только Binance Futures сейчас).
- `PublicStreamLike.awaitConnectionsReady?(): Promise<void>` — опциональный метод в интерфейсе stream (Bybit/Spot не реализуют — возвращается `Promise.resolve()` сразу).

### Changed

#### `BinanceFuturesPublicStream` — детали реализации в релизной ветке

Актуальное поведение (группировка по типу стримов и kline interval, endpoint `/market/ws`, SUBSCRIBE-батчи, stale-recreate, `readyPromise`) описано в выпускной секции **[0.13.0] → Changed** выше и в `.claude/rules/websocket-layer.md`. Ранний черновик этой записи описывал другую схему (`symbolsPerConnection`); он не соответствует финальному коду и оставлен только как напоминание о эволюции задачи.

### Added (BinanceFuturesPublicStreamArgs)

- `staleThresholdMs?`, `staleCheckIntervalMs?`, `subscribeBatchSize?`, `pauseBetweenSubscribeBatchesMs?`, `pauseBetweenConnectionsMs?` — см. фактические default-значения в `BinanceFuturesPublicStream.ts`

### Notes

- **Bybit** и **Binance Spot** streams не затронуты этой работой — у них своя архитектура (Bybit использует `MAX_TOPICS_PER_CONNECTION = 200` + heartbeat, Spot single connection).
- Backward-compatibility: новые методы добавлены к интерфейсам как обязательные (`awaitWebSocketConnectionsReady`) или опциональные (`awaitConnectionsReady?`). Поля `messageCount?`/`lastMessageTimestamp?` опциональны, поэтому non-Futures клиенты возвращают `undefined`.

## [0.12.1] - 2026-04-24

### Fixed
- `BinanceBaseClient.createOrderWebSocket()`: `reduceOnly` больше не отправляется в hedge mode, если задан `positionSide`; параметр остаётся доступен для one-way mode.
- `BybitBaseClient.createOrderWebSocket()`: для linear-рынка добавлено корректное сопоставление `positionSide` → `positionIdx` (`Long` → `1`, `Short` → `2`), что делает хедж-ордера валидными для Bybit API.

### Tests
- `BinanceFutures.test.ts`: добавлена проверка, что `reduceOnly` отбрасывается при наличии `positionSide`.
- `BybitLinear.test.ts`: добавлены сценарии для `positionIdx` в hedge/one-way режимах и совместимости с `reduceOnly`.
- `BybitSpot.test.ts`: добавлена проверка, что `positionIdx` не добавляется для spot-ордеров.

## [0.12.0] - 2026-04-19

### Added

**Новые унифицированные типы** (`src/types/common.ts`):
- `LeverageFilter` — `{ minLeverage, maxLeverage, leverageStep }` (все string)
- `PriceLimitRisk` — дискриминированное объединение с тегом `source`:
  - `'binancePercentPrice'` — `multiplierUp`, `multiplierDown`, `multiplierDecimal`
  - `'binancePercentPriceBySide'` — `bidMultiplierUp/Down`, `askMultiplierUp/Down`, `avgPriceMins`
  - `'bybitRiskParameters'` — `priceLimitRatioX`, `priceLimitRatioY`
- `TradingFunding` — `{ fundingIntervalMinutes?, upperFundingRate?, lowerFundingRate? }`

**Расширение существующих типов** (все поля опциональные, обратно-совместимо):
- `Ticker`: `markPrice?`, `indexPrice?`, `fundingRate?`, `nextFundingTime?` — Bybit tickers теперь отдают данные mark price и funding в одном запросе
- `TradeSymbolFilter`: `minPrice?`, `maxPrice?`, `maxNotional?`, `marketMinQty?`, `marketMaxQty?`, `marketStepSize?`, `postOnlyMaxQty?`
- `TradeSymbol`: `leverageFilter?`, `priceLimitRisk?`, `pricePrecision?`, `quantityPrecision?`, `funding?`, `launchTimestamp?`, `triggerProtect?`, `liquidationFee?`, `orderTypeList?`, `timeInForceList?`, `info?`
- `Balance`: `walletBalance?`, `availableToWithdraw?`, `totalOrderInitialMargin?`, `totalPositionInitialMargin?`
- `AccountBalances`: `accountType?`, `totalMarginBalance?`, `totalInitialMargin?`
- `OrderBook`: `updateId?`, `eventTimestamp?` (Binance: `lastUpdateId` и `E`)
- `PublicTrade`: `isBlockTrade?`, `side?: OrderSideEnum`
- `Income`: `quantity?` — проставляется при наличии поля в ответе биржи (Bybit transaction log)

**Публичные экспорты** (`src/index.ts`):
- `PriceLimitRisk`, `LeverageFilter`, `TradingFunding`
- `MarkPriceUpdate`, `MarkPriceHandler`

**WebSocket mark/index price** (`ExchangeClient`, публичные стримы):
- `subscribeMarkPrices(handler)` / `unsubscribeMarkPrices(handler)` — поток обновлений mark/index; хендлер получает `MarkPriceUpdate[]` (`symbol`, `markPrice`, `indexPrice`, `timestamp`)
- **Binance Futures**: подписка на combined-stream `!markPrice@arr@1s`, разбор через `normalizeBinanceMarkPriceWebSocketList()` (`BinanceMarkPriceWebSocketRaw`)
- **Bybit** (linear и spot): те же сообщения `tickers.*`, что и у all-tickers; при наличии подписчиков mark price из сырого тикера собирается в `MarkPriceUpdate` (записи без валидного `markPrice` отбрасываются)
- **Binance Spot**: вызов `subscribeMarkPrices` не открывает стрим — в лог пишется предупреждение, хендлер не вызывается (`unsubscribeMarkPrices` — no-op)

**Контракт стрима** (`src/types/stream.ts`):
- Обязательные `subscribeMarkPrices` / `unsubscribeMarkPrices` на `PublicStreamLike`
- Опциональный `unsubscribeAllTickers` — реализован у Binance/Bybit публичных стримов для снятия хендлера all-tickers

### Changed

**Нормализаторы**:
- `normalizeBinanceMarkPriceWebSocketList()` — raw события mark price c фьючерсного WebSocket → `MarkPriceUpdate[]`
- `normalizeBinanceTradeSymbols()` — извлекает `PERCENT_PRICE` / `PERCENT_PRICE_BY_SIDE` в `priceLimitRisk`, `MARKET_LOT_SIZE` в `filter.marketMinQty/marketMaxQty/marketStepSize`, `PRICE_FILTER.minPrice/maxPrice` в `filter`, а также `pricePrecision`, `quantityPrecision`, `onboardDate → launchTimestamp`, `triggerProtect`, `liquidationFee`, `orderTypes → orderTypeList`, `timeInForce → timeInForceList`; сохраняет сырой payload в `info`
- `normalizeBybitTradeSymbols()` — строит `leverageFilter`, `priceLimitRisk` (из `riskParameters`), `funding` (из `fundingInterval`/`upperFundingRate`/`lowerFundingRate`), `launchTimestamp` (из `launchTime`); извлекает `priceFilter.minPrice/maxPrice`, `lotSizeFilter.maxMktOrderQty → marketMaxQty`, `lotSizeFilter.postOnlyMaxOrderQty → postOnlyMaxQty`; сохраняет сырой payload в `info`
- `normalizeBybitTickers()` — пробрасывает `markPrice`, `indexPrice`, `fundingRate`, `nextFundingTime`, если присутствуют в raw-ответе
- `normalizeBybitBalances()` — заполняет `walletBalance`, `availableToWithdraw`, `totalOrderInitialMargin`, `totalPositionInitialMargin` на каждый asset; возвращает `accountType`, `totalMarginBalance`, `totalInitialMargin` на уровне `AccountBalances`
- `normalizeBinanceOrderBook()` — пробрасывает `updateId` (из `lastUpdateId`) и `eventTimestamp` (из `E`)
- `normalizeBybitOrderBook()` — пробрасывает `updateId` (из `u`)
- `normalizeBybitPublicTradeList()` — пробрасывает `isBlockTrade` и маппит `side` через `BYBIT_ORDER_SIDE`
- `normalizeBybitIncomeList()` — пробрасывает `qty → quantity`

**Типизация фильтров Binance** (внутренняя):
- `BinanceFilterRaw` разбит на дискриминированное объединение `BinanceKnownFilterRaw` по `filterType` (`PRICE_FILTER`, `LOT_SIZE`, `MARKET_LOT_SIZE`, `MIN_NOTIONAL`, `NOTIONAL`, `PERCENT_PRICE`, `PERCENT_PRICE_BY_SIDE`, `MAX_NUM_ORDERS`, `POSITION_RISK_CONTROL`, `ICEBERG_PARTS`, `TRAILING_DELTA`, `MAX_NUM_ORDER_LISTS`, `MAX_NUM_ALGO_ORDERS`, `MAX_NUM_ORDER_AMENDS`) + fallback `BinanceUnknownFilterRaw`
- `extractFilter<T>()` теперь возвращает точный тип фильтра по `filterType`

### Internal
- `normalizeBinanceTradeSymbols()`: извлечение `minNotional` из `MIN_NOTIONAL` и `NOTIONAL` разнесено на отдельные переменные — поведение не меняется (фильтры не сосуществуют в одном символе), упрощает дальнейшее чтение `NOTIONAL.maxNotional` для `filter.maxNotional`

## [0.11.0] - 2026-04-17

### Added
- `connectUserDataStream(handler: UserDataStreamHandlerArgs): Promise<void>` — устанавливает WebSocket-соединение для приёма приватных событий (ордера, позиции)
- `disconnectUserDataStream(): void` — закрывает соединение и освобождает ресурсы
- `isUserDataStreamConnected(): boolean` — проверяет наличие активного соединения
- Новые типы в публичном API: `OrderUpdateEvent`, `PositionUpdateEvent`, `OrderUpdateHandler`, `PositionUpdateHandler`, `UserDataStreamHandlerArgs`

**Binance-реализация** (`BinanceFutures`, `BinanceSpot`):
- Создаёт listenKey через REST, каждые 30 минут продлевает (`keepAliveListenKey`), при отключении удаляет (`deleteListenKey`)
- Обрабатывает события `ORDER_TRADE_UPDATE` → `onOrderUpdate` и `ACCOUNT_UPDATE` → `onPositionUpdate`
- Нормализация статусов ордеров через `BINANCE_ORDER_STATUS_MAP` (NEW/PARTIALLY_FILLED → open, FILLED → closed, CANCELED → canceled, EXPIRED/EXPIRED_IN_MATCH → expired)

**Bybit-реализация** (`BybitLinear`, `BybitSpot`):
- Использует `BybitPrivateStream` с подпиской на топики `['order', 'position']`
- Обрабатывает события `order` → `onOrderUpdate` и `position` → `onPositionUpdate`
- Нормализация статусов через `BYBIT_ORDER_STATUS_MAP` (New/PartiallyFilled/Untriggered → open, Filled → closed, Cancelled/Rejected → canceled, Deactivated/Expired → expired)
- `getWebSocketConnectionInfoList()` теперь включает private stream info
- `close()` теперь вызывает `disconnectUserDataStream()`

### Changed
- `BybitPrivateStream`: добавлена поддержка `topicList?: string[]` в `BybitPrivateStreamArgs` — топики автоматически подписываются после успешной аутентификации

## [0.10.0] - 2026-04-14

### Breaking Changes
- `BybitLinear.setMarginMode()` is now a no-op — Bybit Unified Account manages margin mode at account level, not per-symbol. Method logs a message and returns without calling the API

### Added
- `BybitPublicStream`: multi-connection support with topic chunking (max 200 topics per connection) — automatically creates additional connections when topic count exceeds the limit
- `BybitPublicStream`: batched subscribe messages (max 10 topics per SUBSCRIBE request) to comply with Bybit WebSocket API limits
- `BybitPublicStream`: deferred connection via `queueMicrotask()` for batching initial subscriptions (matching Binance Futures pattern)
- `BybitPublicStream.resubscribeStream(symbol, interval)` — explicit topic resubscription on a specific connection
- `BybitConnection` type — internal connection state tracking (webSocket, label, topicList, dynamicTopicList, url)

### Fixed
- `BybitBaseClient.getOrder()`: now checks realtime (open orders) first, then falls back to order history — previously only queried history, missing recently placed orders
- `BybitBaseClient.submitOrder()`: checks `tradeStream.isConnected()` before sending via WebSocket — previously only checked `tradeStream !== null`, causing failures when stream existed but was not connected
- `BybitLinear.setLeverage()`: handles Bybit error code `110043` (leverage not modified) as no-op instead of throwing
- `normalizeBybitKlines()`: reverses API response from descending to ascending chronological order — Bybit returns klines newest-first, consumers expect oldest-first

### Internal
- `BybitPublicStream`: refactored from single `webSocket` to `connectionList: BybitConnection[]` architecture
- `BybitPublicStream`: subscription success messages no longer logged at debug level (reduced log noise)
- `BybitPublicStream.getConnectionInfoList()` now returns per-connection info with numbered labels when multiple connections exist
- `BybitPublicStream.buildSubscriptionList()` extracts human-readable subscription names from topic strings

## [0.9.1] - 2026-04-13

### Fixed
- `BaseHttpClient`: non-GET HTTP errors now throw readable `Error` messages instead of raw `AxiosError` — Binance API errors formatted as `[code] msg`, other HTTP errors as `HTTP {status}: {message}`

### Changed
- `BinanceFuturesPublicStream`: dynamic streams are now subscribed on initial WebSocket open via `onOpen` callback (previously only on reconnect via `onReconnectSuccess`)

## [0.9.0] - 2026-04-08

### Breaking Changes
- `TradeSymbol.contractType: string` — new field added to identify contract type (PERPETUAL, TRADIFI_PERPETUAL, etc.). While backward compatible for existing code, consumers should update type expectations
- `BaseExchangeClient.createNotifyHandler()` behavior simplified: CRITICAL message handling no longer automatically calls `process.exit(1)`. Consumers relying on automatic termination must implement their own shutdown logic

### Added
- Support for TRADIFI_PERPETUAL contracts in Binance Futures:
  - `TradeSymbol.contractType` field now included in normalized data (exported in public API)
  - `BinanceFuturesPublicStream` automatically selects correct kline stream format based on contract type
  - TRADIFI contracts use `{symbol}@kline_{interval}` format instead of perpetual `{symbol}_perpetual@continuousKline_{interval}`
- `setTradeSymbols()` method on `BinanceFuturesPublicStream` for dynamic stream name resolution

### Changed
- `BinanceFuturesPublicStream` now requires trade symbols context to properly differentiate between PERPETUAL and TRADIFI_PERPETUAL contracts
- `BaseExchangeClient.createNotifyHandler()` now delegates entirely to user's `onNotify` callback without automatic process termination

### Internal
- Both `binanceNormalizer` and `bybitNormalizer` extract and preserve raw `contractType` field from exchange API

## [0.8.0] - 2026-03-26

### Added
- WebSocket resubscription methods: `resubscribeStream(symbol, interval)` on `BinanceFuturesPublicStream` and `BinanceSpotPublicStream`
- `resubscribeKlines(symbol, interval)` on `ExchangeClient` for explicit stream reconnection
- Dynamic stream tracking in `BinanceFuturesPublicStream` to optimize reconnection behavior

## [0.6.2] - 2026-03-26

### Fixed
- Binance futures no-op responses (`-4046` margin type unchanged, `-4059` position side unchanged) are treated as successful no-ops:
  - `setMarginMode()` / `setPositionMode()` do not throw on these codes
  - `BaseHttpClient` logs `info` using the exchange `msg` text without additional prefixes

## [0.6.1] - 2026-03-23

### Changed
- Standardized WebSocket connection labels across all exchange clients:
  - `Binance Futures Public WebSocket`, `Binance Spot Public WebSocket`
  - `Binance Futures Order WebSocket`, `Binance Spot Order WebSocket`
  - `Bybit Linear Public WebSocket`, `Bybit Spot Public WebSocket`
  - `Bybit Linear Order WebSocket`, `Bybit Spot Order WebSocket`

### Fixed
- `authenticateBybitWebSocket()` now includes stream label context in error logs and thrown errors to simplify troubleshooting:
  - log format: `[<label>] Auth response: ...`
  - error format: `[<label>] Auth failed: ...`
- Removed redundant success log from Bybit WebSocket authentication to reduce log noise in normal flow

## [0.6.0] - 2026-03-22

### Breaking Changes
- Removed standalone exports: `normalizeBybitKlineWebSocketMessage`, `normalizeBinanceKlineWebSocketMessage` functions and raw WebSocket types (`BybitWebSocketKlineRaw`, `BybitPublicTradeDataRaw`, `BybitWebSocketMessageRaw`, `BybitKlineMessageRaw`, `BybitTradeMessageRaw`, `BinanceWebSocketKlineRaw`, `BinanceContinuousKlineMessageRaw`) — all functionality is now accessible only through `ExchangeClient` instances
- `ExchangeClient.fetchBalance()` renamed to `fetchBalances()` — consumers must update method calls
- `fetchBalances()` return type changed from `BalanceByAsset` to `AccountBalances` — use `result.balanceByAsset` for per-asset Map, `result.totalWalletBalance` and `result.totalAvailableBalance` for account-level totals

### Added
- 16 new methods on `ExchangeClient` interface:
  - Order management: `cancelOrder()`, `getOrder()`, `fetchOpenOrders()`, `modifyOrder()`, `cancelAllOrders()`, `createBatchOrders()`, `cancelBatchOrders()`
  - Market data: `fetchOrderBook()`, `fetchTrades()`, `fetchMarkPrice()`, `fetchOpenInterest()`
  - Account: `fetchFeeRate()`, `fetchIncome()`, `fetchClosedPnl()`
  - Settings: `setPositionMode()`
- `AccountBalances` type with `totalWalletBalance`, `totalAvailableBalance`, and `balanceByAsset` fields
- 8 unified types: `OrderBook`, `OrderBookLevel`, `PublicTrade`, `MarkPrice`, `OpenInterest`, `FeeRate`, `Income`, `ClosedPnl`
- `ModifyOrderArgs` interface for `modifyOrder()` parameters
- 13 raw interfaces and 13 normalizer functions (6 Binance, 7 Bybit) for new endpoints
- `fetchFundingRateHistory()` implementation for Bybit (previously threw "Not implemented")
- `docs/api-reference.md` — complete API reference for consumers and LLMs

### Changed
- `BybitBaseClient.category` visibility: `private` → `protected` for subclass access
- 7 methods moved from `BybitLinear` to `BybitBaseClient` for Bybit Spot support: `modifyOrder`, `cancelAllOrders`, `createBatchOrders`, `cancelBatchOrders`, `fetchIncome`, `fetchClosedPnl`, `fetchOrderHistory`
- 19 HTTP client methods typed with concrete raw interfaces (replaced `Record<string, unknown>`)
- `OrderBook` uses `askList`/`bidList` naming (array `List` suffix convention)
- `fetchBalance()` renamed to `fetchBalances()` (plural, consistent with `fetchTickers`)
- Normalizers renamed: `normalizeBinanceBalance` → `normalizeBinanceBalances`, `normalizeBinanceFuturesBalance` → `normalizeBinanceFuturesBalances`, `normalizeBybitBalance` → `normalizeBybitBalances`
- Binance Futures API endpoints updated: `/fapi/v2/account` → `/fapi/v3/account`, `/fapi/v2/positionRisk` → `/fapi/v3/positionRisk`

### Internal
- Extracted `parseOrderBookLevel()` into `src/normalizers/normalizerUtils.ts` — deduplicated 4 identical lambdas across Binance/Bybit normalizers
- Extracted `signedRequest()` in `BinanceBaseHttpClient` — deduplicated `signedGet`, `signedPost`, `signedDelete`
- Extracted inline types into named interfaces: `SignRequestResult`, `BybitCancelOrderResult`, `BybitTradeOrderData`, `TimestampedParamsResult`

## [0.5.0] - 2026-03-18

### Breaking Changes
- `BinanceWebSocketKlineRaw.x` — field is now required (`boolean` instead of `boolean | undefined`)
- `PublicStreamLike`: added required method `getConnectionInfoList()` — consumers with custom implementations must implement it
- `ExchangeClient`: added required method `getWebSocketConnectionInfoList()` — consumers with custom implementations must implement it
- Public stream constructors (`BinanceFuturesPublicStream`, `BinanceSpotPublicStream`, `BybitPublicStream`) now accept an Args object instead of positional arguments

### Added
- WebSocket Connection Registry — `getWebSocketConnectionInfoList()` on `ExchangeClient` and `Exchange` for querying active WebSocket connections, their status, and subscriptions
- `WebSocketConnectionTypeEnum` (Public, Trade, UserData) and `WebSocketConnectionInfo` types
- Human-readable labels for all WebSocket connections: `[Binance Futures] Public`, `[Bybit Linear] Public`, `[Binance Spot] Orders`, etc.
- `getConnectionInfoList()` on all public streams, `getConnectionInfo()` on trade/userData/private streams
- 1-second klines for Bybit via `TradeToKlineAggregator` — trade aggregation in `BybitPublicStream`
- `Kline.isClosed?: boolean` — kline close status from WebSocket
- `KlineInterval` — added `'1s'` literal
- `MarketTypeEnum` enum (Futures, Spot) and `MARKET_TYPE_LIST` constant
- Exported raw types: `BybitWebSocketKlineRaw`, `BybitPublicTradeDataRaw`, `BybitWebSocketMessageRaw`, `BybitKlineMessageRaw`, `BybitTradeMessageRaw`, `BinanceWebSocketKlineRaw`, `BinanceContinuousKlineMessageRaw`
- Exported normalizer functions: `normalizeBybitKlineWebSocketMessage`, `normalizeBinanceKlineWebSocketMessage`

### Fixed
- `normalizeBinanceKlineWebSocketMessage`: removed incorrect `?? true` fallback for `isClosed`

## [0.4.2] - 2026-03-15

### Breaking Changes
- `loadTradeSymbols()`: removed `shouldReload` parameter — method always fetches fresh data

### Changed
- `loadTradeSymbols()` now clears `tradeSymbols` Map before populating with fresh data
- `BinanceTradeStream` and `BybitTradeStream` log labels updated to `[Binance] Trade stream` / `[Bybit] Trade stream`

## [0.4.1] - 2026-03-14

### Added
- Structured logging: `ExchangeLogger` overloaded signatures `(contextObj, message)`
- API response validation: `BinanceBaseHttpClient` + `BybitHttpClient` throw `ExchangeError` on invalid responses
- `fetchAllInstrumentsInfo(category)` in `BybitHttpClient` with cursor pagination
- `triggerDirection` field in `CreateOrderWebSocketArgs`
- `BINANCE_ORDER_STATUS` mapping constant
- `exchangeLabel` abstract field + `getTradeSymbolOrWarn()` helper in `BaseExchangeClient`
- WebSocket error protection: try-catch in all WS message handlers
- Comprehensive WebSocket test suite (8 new test files, 76+ new tests)

### Changed
- Type extraction: 11 `.types.ts` files co-located with source modules
- `normalizeBinanceOrder()` uses `BINANCE_ORDER_STATUS` mapping
- `BybitTradeStream` returns minimal `Order` object (id + clientOrderId only)
- Bybit WebSocket auth uses `expires = Date.now() + 10000`
- `parseWebSocketMessage` throws descriptive error on invalid JSON

## [0.4.0] - 2026-03-14

### Breaking Changes
- `roundToStep()`, `amountToPrecision()`, `priceToPrecision()` now return `number` instead of `string`
- `ExchangeClient` interface: `amountToPrecision()` and `priceToPrecision()` return `number`
- `BaseExchangeClient`: fallback for unknown symbol returns raw `number` instead of `String(value)`

### Changed
- `BinanceBaseClient.buildBinanceOrderParams()`: wraps precision results in `String()` for API compatibility
- `BybitBaseClient.buildBybitOrderParams()`: wraps precision results in `String()` for API compatibility

## [0.3.3] - 2026-03-14

### Added
- `ExchangeError` custom error class (`src/errors/ExchangeError.ts`) with `code` and `exchange` fields for structured error handling
- `ExchangeError` exported from `src/index.ts`

### Changed
- `BinanceTradeStream`, `BybitTradeStream`, and `BybitHttpClient` now throw `ExchangeError` instead of plain `Error`

## [0.3.2] - 2026-03-13

### Added
- `isTradeWebSocketConnected()` and `connectTradeWebSocket()` methods on `ExchangeClient` interface
- `BinanceTradeStream` — WebSocket-based order execution for Binance (parity with Bybit)

### Internal
- Extracted `BybitBaseClient` — common base for `BybitLinear` and `BybitSpot`
- Extracted `BaseTradeStream<T>` — common base for `BinanceTradeStream` and `BybitTradeStream`
- Extracted `parseWebSocketMessage<T>()` — generic WebSocket parser replacing 7 duplicate functions
- Extracted `buildCategoryParams()` in `BybitHttpClient` — deduplicated 7 methods
- Extracted `buildOptionalSymbolParams()` in `BinanceBaseHttpClient` — deduplicated 4 methods
- `BaseExchangeClient`: futures-specific methods now have default `throw` implementations instead of `abstract`
- `BaseHttpClient`: extracted `executeRequest()` pattern for non-GET HTTP methods
- `BinanceBaseHttpClient`: extracted `signRequest()` method
- Shared test fixtures: `mockAxios.ts`, `mockTradeSymbol.ts`

## [0.3.1] - 2026-03-12

### Added
- HTTP keep-alive via `agentkeepalive` — TCP-соединения переиспользуются по умолчанию
- `httpsAgent` option in `ExchangeConfig` — custom HTTPS agent для всех HTTP-клиентов
- `FetchAllKlinesOptions` — настройки для `fetchAllKlines()`: `chunkSize`, `pauseBetweenChunksMs`, `trimLastKline`, `onChunkLoaded` callback
- `fetchKlines()` uses `klineLimit` as default `limit` when not specified

### Fixed
- ESLint check added to `yarn build` pipeline

## [0.3.0] - 2026-03-11

### Breaking Changes
- All enums renamed with `Enum` suffix: `ExchangeName` → `ExchangeNameEnum`, `OrderSide` → `OrderSideEnum`, `OrderType` → `OrderTypeEnum`, `MarginMode` → `MarginModeEnum`, `PositionSide` → `PositionSideEnum`, `TradeSymbolType` → `TradeSymbolTypeEnum`, `TimeInForce` → `TimeInForceEnum`, `PositionMode` → `PositionModeEnum`
- Expanded `Ticker` interface: added `lastPrice`, `openPrice`, `highPrice`, `lowPrice`, `priceChangePercent`, `volume`, `quoteVolume`; removed `close`, `percentage`
- Expanded `Order` interface: added `clientOrderId`, `timeInForce`, `avgPrice`, `stopPrice`, `filledAmount`, `filledQuoteAmount`, `reduceOnly`, `updatedTimestamp`
- Expanded `CreateOrderWebSocketArgs`: added `stopPrice`, `closePosition`, `workingType`, `positionSide`, `reduceOnly`, `timeInForce`, `clientOrderId`

### Added
- `WorkingTypeEnum` — `MarkPrice`, `ContractPrice`
- `OrderTypeEnum` expanded: `StopMarket`, `TakeProfitMarket`, `Stop`, `TakeProfit`, `TrailingStop`
- `fetchOrderHistory(symbol, options?)` method on `ExchangeClient` (Binance Futures implementation, stubs for others)
- Reverse mapping constants: `BINANCE_ORDER_TYPE_REVERSE`, `BINANCE_TIME_IN_FORCE`, `BINANCE_WORKING_TYPE`, `BYBIT_TIME_IN_FORCE`

## [0.2.0] - 2026-03-06

### Breaking Changes
- Renamed `Market` → `TradeSymbol`, `MarketBySymbol` → `TradeSymbolBySymbol`, `MarketFilter` → `TradeSymbolFilter`, `MarketType` → `TradeSymbolType`
- Renamed `loadMarkets()` → `loadTradeSymbols()`, property `markets` → `tradeSymbols`
- Renamed `FetchKlinesArgs` → `FetchPageWithLimitArgs`
- Renamed Kline fields: `open` → `openPrice`, `high` → `highPrice`, `low` → `lowPrice`, `close` → `closePrice`, `quoteVolume` → `quoteAssetVolume`, `trades` → `numberOfTrades`
- Added Kline fields: `takerBuyBaseAssetVolume`, `takerBuyQuoteAssetVolume`

### Added
- `FundingRateHistory` type and `fetchFundingRateHistory()` method (Binance Futures)
- `BinanceFundingRateHistoryRaw` type and `normalizeBinanceFundingRateHistory()` normalizer
- ESLint integration with TypeScript support (`eslint.config.mjs`)
- `yarn lint` script — runs ESLint on `src/` and `test/`
- ESLint check added to `prepublishOnly` pipeline

### Fixed
- Unused imports in WebSocket streams (`Kline`, `isBybitPongResponse`)
- `test/tsconfig.json`: added `"node"` to `types` for `console` support in smoke tests

### Internal
- Code style alignment across all source and test files
- All abbreviations expanded (`opts` → `options`, etc.)

## [0.1.2] - 2026-03-03

### Added
- Test suite: 204 tests (Jest + ts-jest) covering auth, HTTP clients, normalizers, WebSocket utils, exchange clients, precision formatting, and public exports
- HTTP retry for GET requests with exponential backoff
- `package.json` exports map and `sideEffects: false` for tree-shaking support
- Test gate in `prepublishOnly` script

### Fixed
- README: corrected Kline field names (`openTimestamp`/`closeTimestamp`), Map API for markets, `FetchKlinesArgs` parameter type

### Internal
- Utility modules: `crypto.ts`, `httpParams.ts`, `klineLoader.ts`
- WebSocket helpers: `binanceWsUtils.ts`, `bybitWsUtils.ts`
- Base classes: `BaseExchangeClient`, `BinanceBaseClient`, `BinanceBaseHttpClient`

## [0.1.0] - 2026-02-25

### Added
- Initial release of @solncebro/exchange-engine
- Unified API for Binance and Bybit
- Support for Binance Spot and Futures markets
- Support for Bybit Spot and Linear Perpetual markets
- REST API endpoints:
  - `loadMarkets()` — fetch and cache market information
  - `fetchTickers()` — get current prices for all symbols
  - `fetchKlines()` — historical candlestick data
  - `fetchBalance()` — account balance
  - `fetchPosition()` — futures position info (futures only)
  - `createOrderWs()` — place orders via WebSocket
  - `setLeverage()` — adjust position leverage (futures only)
  - `setMarginMode()` — isolated or cross margin (futures only)
- WebSocket subscriptions:
  - Real-time kline updates (`subscribeKlines()`)
  - Ticker price updates (Binance Futures)
- Type-safe unified types:
  - `Kline` — candlestick data
  - `Ticker` — current price and 24h change
  - `Position` — futures position details
  - `Order` — placed order info
  - `Market` — market metadata
  - `Balance` — account balance
- Automatic WebSocket reconnection with exponential backoff
- Structured logging via custom logger interface
- Price and amount precision formatting
- Error normalization across exchanges

### Internal
- Separate HTTP clients for each exchange
- Exchange-specific normalizers (Binance and Bybit)
- Public and private WebSocket streams
- Auth utilities (HMAC signing, headers)
- Four exchange implementations: BinanceFutures, BinanceSpot, BybitLinear, BybitSpot
- Factory pattern via unified `Exchange` entry point

### Notes
- Binance spot and futures use separate rate limits
- Bybit combines spot and linear in single unified API
- Public endpoints (markets, klines) do not require API keys
- Private endpoints (balance, position, orders) require valid credentials
- WebSocket subscriptions are stateless and can be re-established on reconnect

[0.13.0]: https://github.com/solncebro/exchange-engine/releases/tag/v0.13.0
[0.12.1]: https://github.com/solncebro/exchange-engine/releases/tag/v0.12.1
[0.12.0]: https://github.com/solncebro/exchange-engine/releases/tag/v0.12.0
[0.11.0]: https://github.com/solncebro/exchange-engine/releases/tag/v0.11.0
[0.10.0]: https://github.com/solncebro/exchange-engine/releases/tag/v0.10.0
[0.9.1]: https://github.com/solncebro/exchange-engine/releases/tag/v0.9.1
[0.9.0]: https://github.com/solncebro/exchange-engine/releases/tag/v0.9.0
[0.8.0]: https://github.com/solncebro/exchange-engine/releases/tag/v0.8.0
[0.6.2]: https://github.com/solncebro/exchange-engine/releases/tag/v0.6.2
[0.6.1]: https://github.com/solncebro/exchange-engine/releases/tag/v0.6.1
[0.6.0]: https://github.com/solncebro/exchange-engine/releases/tag/v0.6.0
[0.5.0]: https://github.com/solncebro/exchange-engine/releases/tag/v0.5.0
[0.4.2]: https://github.com/solncebro/exchange-engine/releases/tag/v0.4.2
[0.4.1]: https://github.com/solncebro/exchange-engine/releases/tag/v0.4.1
[0.4.0]: https://github.com/solncebro/exchange-engine/releases/tag/v0.4.0
[0.3.3]: https://github.com/solncebro/exchange-engine/releases/tag/v0.3.3
[0.3.2]: https://github.com/solncebro/exchange-engine/releases/tag/v0.3.2
[0.3.1]: https://github.com/solncebro/exchange-engine/releases/tag/v0.3.1
[0.3.0]: https://github.com/solncebro/exchange-engine/releases/tag/v0.3.0
[0.2.0]: https://github.com/solncebro/exchange-engine/releases/tag/v0.2.0
[0.1.2]: https://github.com/solncebro/exchange-engine/releases/tag/v0.1.2
[0.1.0]: https://github.com/solncebro/exchange-engine/releases/tag/v0.1.0
