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
├── OkxBaseClient (abstract)
│   ├── OkxSwap
│   └── OkxSpot
```

## Контракт и типы аргументов

Полный список методов `ExchangeClient` и типы аргументов (`CreateOrderWebSocketArgs`,
`ModifyOrderArgs`, `ModifyBatchOrderArgs`, `FetchIncomeArgs`, `SubscribeOrderbookArgs`,
`SubscribePublicTradesArgs`) вынесены в [exchange-layer-contract.md](exchange-layer-contract.md).

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
- `resubscribeKlineList(argsList)` — ПАКЕТНАЯ переподписка: если стрим умеет `resubscribeStreamList` — отдаёт список ему целиком (одна пара «снять/подписать» на соединение, работает порог лавины); иначе перебирает список одиночной `resubscribeStream`. Умеют все три биржи: `BinanceFuturesPublicStream`, `BybitPublicStream` (0.25.0), `OkxPublicStream`
- `resubscribeOrderbook(args)` / `resubscribePublicTrades(args)` / `resubscribeMarkPrices()` — принудительная light-переподписка (unsubscribe+subscribe на живом сокете, без реконнекта; recreate-fallback при disconnect) соответствующих топиков; делегируют в `publicStream.resubscribe*` если реализованы (Bybit; для mark-price — батчево по всем `tickers.{symbol}`, connection-granular). Используются `StreamSubscriptionWatchdog` (trade-engine) для recovery при тихом устаревании потока без разрыва сокета
- `subscribeMarkPrices()` / `unsubscribeMarkPrices()` — делегирует в `getPublicStream()`, прокидывая `Array.from(this.tradeSymbols.keys())` как `symbolList` (Binance Futures — агрегатный `!markPrice@arr@1s`, symbolList игнорируется; Bybit — per-symbol `tickers.{symbol}` по каждому символу из symbolList, агрегатного топика нет; Binance Spot — предупреждение в стриме, без подписки)
- `subscribeAllTickers()` / `unsubscribeAllTickers()` — прямая передача (`symbolList` приходит от вызывающего, в отличие от `subscribeMarkPrices` — сам `tradeSymbols` не читает); `unsubscribeAllTickers` — опциональный вызов (`?.()`)
- `subscribeOrderbook()` / `subscribePublicTrades()` — делегирует в `getPublicStream()`, если метод реализован. `subscribeOrderbook` — только Bybit (linear и spot); если `PublicStreamLike.subscribeOrderbook === undefined` — throw `Orderbook subscription not supported for ${marketLabel} market`, `unsubscribeOrderbook` — no-op. `subscribePublicTrades` — Bybit и Binance Futures (не Binance Spot); если `PublicStreamLike.subscribePublicTrades === undefined` — throw `Public trade subscription not supported for ${marketLabel} market`, `unsubscribePublicTrades` — no-op
- `setOrderbookLiveSymbol()` / `subscribeRawOrderbook()` / `unsubscribeRawOrderbook()` — опциональная передача (`?.()`) в `getPublicStream()`; реализованы только у Bybit (см. «Lazy orderbook parse» ниже)
- `awaitWebSocketConnectionsReady()` — `publicStream.awaitConnectionsReady?.() ?? Promise.resolve()` (Binance Futures public ждёт SUBSCRIBE-батчи; остальные стримы без метода — немедленный resolve)
- `amountToPrecision()` / `priceToPrecision()` — lookup в tradeSymbols + precision utils, возвращает `number`, fallback на исходное значение
- `getMinOrderQty()` / `getMinNotional()` — lookup в tradeSymbols, fallback 0
- `getMaxOrderQty()` — lookup `filter.maxQty`, fallback 0
- `getMarketMaxOrderQty()` — lookup `filter.marketMaxQty` (валидное конечное число `> 0`), fallback на `filter.maxQty` (нет отдельного market-cap у символа), затем fallback 0

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
- `cancelOrder()`, `getOrder()`, `fetchOpenOrders()`, `fetchOpenConditionalOrders()`, `fetchOrderBook()`, `fetchTrades()`
- `modifyOrder()`, `cancelAllOrders()`, `createBatchOrders()`, `cancelBatchOrders()`, `modifyBatchOrders()`, `getOrderRateLimit()`
- `fetchMarkPrice()`, `fetchOpenInterest()`, `fetchFeeRate()`, `fetchIncome()`, `fetchClosedPnl()`
- `setPositionMode()`, `connectUserDataStream()`, `disconnectUserDataStream()`

### Default return (переопределяются в подклассах):
- `isUserDataStreamConnected()` — возвращает `false`
- `getRateLimitState()` — возвращает пустое состояние (`{ usedWeight: null, weightLimit: null, observedAtMs: null, bannedUntilMs: null }`); `BinanceBaseClient` переопределяет

## Детальная документация по биржам

Контракт и конкретные реализации вынесены в отдельные файлы (30k-лимит):

| Файл | Содержание |
|------|-----------|
| [exchange-layer-contract.md](exchange-layer-contract.md) | Полный контракт `ExchangeClient`: все методы и типы аргументов (`CreateOrderWebSocketArgs`, `ModifyOrderArgs`, `ModifyBatchOrderArgs`, `FetchIncomeArgs`, `SubscribeOrderbookArgs`, `SubscribePublicTradesArgs`) |
| [exchange-layer-binance.md](exchange-layer-binance.md) | BinanceBaseClient, BinanceFutures, BinanceSpot |
| [exchange-layer-bybit.md](exchange-layer-bybit.md) | BybitBaseClient, BybitLinear, BybitSpot |
| [exchange-layer-okx.md](exchange-layer-okx.md) | OkxBaseClient: имена инструментов, единицы объёма, рыночные данные, история и журнал начислений (index) |
| [exchange-layer-okx-orders.md](exchange-layer-okx-orders.md) | Заявки, реестр происхождения заявок, чтение и отмена, списки, пакетные операции |
| [exchange-layer-okx-classes.md](exchange-layer-okx-classes.md) | Поток событий счёта на двух соединениях, соединения и завершение, OkxSwap, OkxSpot |

## getOrderRateLimit (per-UID write rate-limit)

Возвращает документированный или измеренный лимит RPS для order endpoints (create/cancel/modify, в т.ч. batch).

```typescript
interface OrderRateLimit {
  writeRequestsPerSecond: number;
  source: OrderRateLimitSource;  // 'binance-exchange-info' | 'bybit-exchange-header' | 'bybit-documented' | 'okx-documented' | 'fallback'
}
```

- **Binance Futures/Spot** (`BinanceBaseClient.getOrderRateLimit`): делает `httpClient.fetchExchangeInfo()` → `parseBinanceOrderRateLimit(raw)` (`src/normalizers/binanceNormalizer.ts:349`). Функция фильтрует `raw.rateLimits[]` по `rateLimitType === 'ORDERS'`, конвертирует все интервалы в RPS (`limit / (intervalNum * secondsInInterval)`), возвращает наиболее строгий лимит через `Math.min(...)` с `source: 'binance-exchange-info'`. Если `rateLimits` отсутствует/пуст — `{ writeRequestsPerSecond: BINANCE_ORDER_RATE_LIMIT_FALLBACK_RPS, source: 'fallback' }` (константа = 15 RPS, `src/normalizers/binanceNormalizer.ts:331`). Поддерживаемые интервалы: `SECOND` / `MINUTE` / `HOUR` / `DAY`.
- **Bybit Linear/Spot** (`BybitBaseClient.getOrderRateLimit`): СНАЧАЛА берёт предел, названный самой биржей — `tradeStream?.getLastReportedOrderRateLimit()`; если он есть и положителен, возвращает `{ writeRequestsPerSecond: reported.limit, source: 'bybit-exchange-header' }`. Торговый канал запоминает его из заголовка ответа на ЛЮБУЮ операцию с заявкой — и одиночную, и пачку (до 0.25.0 одиночный путь заголовок разбирал, но не запоминал, поэтому счёт на одиночных заявках вечно жил на константе). Запасной вариант — документированная константа: `{ writeRequestsPerSecond, source: 'bybit-documented' }`, где `writeRequestsPerSecond` зависит от категории — **spot = 20, linear = 10**. Bybit не отдаёт rate-limits через GET endpoint (только через headers на actual order calls), поэтому значение — документированная константа. Источник: https://bybit-exchange.github.io/docs/v5/rate-limit. Точные per-UID лимиты (standard account): для spot `/v5/order/create`, `/cancel`, `/cancel-all`, `/create-batch`, `/amend-batch`, `/cancel-batch` = 20/s (а `/amend` = 10/s); для linear все order-эндпоинты = 10/s (inverse/option ещё строже). Берётся create-лимит категории.
- **OKX Swap/Spot** (`OkxBaseClient.getOrderRateLimit`): возвращает `{ writeRequestsPerSecond: OKX_ORDER_RATE_LIMIT_RPS (30), source: 'okx-documented' }`. Число — документированный предел НА ИНСТРУМЕНТ (60 запросов за 2 секунды). Общий предел суб-счёта (1000 заявок за 2 секунды, отказ кодом 50061) к одному инструменту не относится и здесь не выражается.
- **Default**: в `BaseExchangeClient.getOrderRateLimit` — throw `Not supported for ${marketLabel} market`, но переопределяется во всех шести реальных классах.

Raw-тип: `BinanceRateLimitRaw { rateLimitType, interval, intervalNum, limit }` в `binanceNormalizer.ts`. `BinanceExchangeInfoRaw` имеет опциональное `rateLimits?: BinanceRateLimitRaw[]`.

Реализует `getWebSocketConnectionInfoList()` — агрегирует `publicStream.getConnectionInfoList()` + optional `tradeStream.getConnectionInfo()` + optional `privateStream.getConnectionInfo()`.

В demo mode `tradeStream = null` — все ордера через REST.

## Demo mode

Проверяется **только в конструкторе** — не runtime toggle:
- Binance Futures: другой baseUrl + другой WS URL
- Binance Spot: другой baseUrl, WS URL тот же
- Bybit Linear: другой baseUrl + другой WS URL, `tradeStream = null` (REST fallback)
- Bybit Spot: другой baseUrl + другой WS URL
- OKX Swap/Spot: тот же baseUrl + заголовок `x-simulated-trading: 1` на каждом запросе, другие WS URL (`wspap.okx.com`). Торговый и приватные каналы в демо доступны — `tradeStream` создаётся всегда

## tradeSymbols

- `new Map()` при создании (пустой)
- `loadTradeSymbols()` — всегда загружает свежие данные, очищает Map перед заполнением
- Используется в `amountToPrecision()`, `priceToPrecision()`, `getMinOrderQty()`, `getMinNotional()`

## Structured Logging

ExchangeLogger поддерживает overloaded signatures:
- `logger.info(message: string)` — простое сообщение
- `logger.info(context: Record<string, unknown>, message: string)` — сообщение с контекстным объектом

## Lazy orderbook parse (opt-in, `ExchangeConfig.lazyOrderbookParse`)

Default `false` (или поле отсутствует) → поведение без изменений: каждый WS-кадр полностью парсится (`parseWebSocketMessage` → `JSON.parse`) до маршрутизации. Включается только когда public-WS становится слишком тяжёлым для парсинга на одном Node-потоке (у coin-listing orderbook ~4650 кадров/с × ~322µs = ~1.5 ядра только на парсинг → отставание стакана). **Действует ТОЛЬКО на orderbook-топики**; tickers/klines/publicTrade не затрагиваются.

При `true` (только `BybitPublicStream`):
- `resolveBybitMessage` (новый `parseMessage`-колбэк) дёшево достаёт символ из первых ~200 байт сырого кадра через `ORDERBOOK_TOPIC_HEAD_REGEX` — **без** `JSON.parse` тела. Для orderbook-кадра символа **не из** `liveOrderbookSymbolSet` возвращает лёгкий sentinel `{ topic, __rawOrderbook: { symbol, raw, receivedTimestamp } }`. Если topic не в голове кадра — fallback на полный парс (корректность сохранена, экономии для этого кадра нет). Не-orderbook топики всегда парсятся полностью.
- `handleMessage` при `__rawOrderbook` раздаёт сырьё зарегистрированным `rawOrderbookHandlerSet` и `return` (никакой нормализации). Для live-символа ДОПОЛНИТЕЛЬНО делает полный парс → `handleOrderBookMessage` (consumer строит абсолютную книгу в реальном времени).
- Публичное API (проброшено через `BaseExchangeClient` / `ExchangeClient`): `setOrderbookLiveSymbol(args: { symbol, isLive })` (управление live-set), `subscribeRawOrderbook(handler: RawOrderbookHandler)` / `unsubscribeRawOrderbook(handler)`. `resubscribeOrderbook(symbol, depth)` (уже был) — даёт свежий snapshot для live-символа (unsub+sub на живом сокете).
- `parseBybitOrderbookRawFrame({ raw, symbol, receivedTimestamp }): OrderBookUpdate | undefined` (экспортируется из index) — on-demand парсинг сырого кадра в `OrderBookUpdate` (потребитель сам решает, что и когда парсить, напр. capture-окно). Типы `RawOrderbookFrame` / `RawOrderbookHandler` в `types/common.ts`.

Радиус поражения изолирован флагом (как `publicStreamConnectionPacking`): ma-chaser и прочие потребители без флага не затронуты. **coin-listing эту возможность НЕ использует** (по умолчанию off) — она оставлена в либе на будущее; приложение хранит стакан отсортированным массивом и парсит каждый кадр (узкое место было не в парсинге, а в O(N)-переборе best — устранено на стороне coin-listing).

## Ticker: bid1/ask1 + subscribeAllTickers

`BybitTickerRaw` и нормализованный `Ticker` (`types/common.ts`) несут **`bid1Price/bid1Size/ask1Price/ask1Size`** (best bid/ask level 1, linear). Bybit шлёт их в `tickers.{symbol}` (snapshot всегда, delta — при изменении); `normalizeBybitTickers` заполняет их когда присутствуют. Публичный `ExchangeClient.subscribeAllTickers(handler, symbolList)` / `unsubscribeAllTickers(handler)` (passthrough в `BaseExchangeClient`) даёт per-update поток `TickerBySymbol` — потребитель может считать premium (mid − mark) из тикера, не трогая стакан. Защита от молчаливой потери полей — `test/normalizers/bybitTickerCompleteness.test.ts` (реальная фикстура снапшота; падает, если биржа прислала ключ, который ни смоделирован, ни явно проигнорирован).
