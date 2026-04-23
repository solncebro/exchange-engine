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
```

## ExchangeClient интерфейс (src/types/exchange.ts)

Полный контракт — все методы, которые потребитель может вызвать:

```
Свойства:
  apiKey: string (readonly)
  tradeSymbols: TradeSymbolBySymbol (readonly, Map)

Рыночные данные:
  loadTradeSymbols(): Promise<TradeSymbolBySymbol>
  fetchTickers(): Promise<TickerBySymbol>
  fetchKlines(symbol, interval, options?): Promise<Kline[]>
  fetchAllKlines(symbolList, interval, options?): Promise<Map<string, Kline[]>>

Аккаунт:
  fetchBalances(): Promise<AccountBalances>
  fetchPosition(symbol): Promise<Position>
  fetchPositionMode(): Promise<PositionModeEnum>
  fetchFundingRateHistory(symbol, options?): Promise<FundingRateHistory[]>
  fetchFundingInfo(symbol?): Promise<FundingInfo[]>

Ордера:
  createOrderWebSocket(args): Promise<Order>
  fetchOrderHistory(symbol, options?): Promise<Order[]>
  cancelOrder(symbol, orderId): Promise<Order>
  getOrder(symbol, orderId): Promise<Order>
  fetchOpenOrders(symbol?): Promise<Order[]>
  modifyOrder(args: ModifyOrderArgs): Promise<Order>
  cancelAllOrders(symbol): Promise<void>
  createBatchOrders(orderList): Promise<Order[]>
  cancelBatchOrders(symbol, orderIdList): Promise<void>

Рыночные данные (расширенные):
  fetchOrderBook(symbol, limit?): Promise<OrderBook>
  fetchTrades(symbol, limit?): Promise<PublicTrade[]>
  fetchMarkPrice(symbol?): Promise<MarkPrice[]>
  fetchOpenInterest(symbol): Promise<OpenInterest>
  fetchFeeRate(symbol?): Promise<FeeRate[]>
  fetchIncome(options?): Promise<Income[]>
  fetchClosedPnl(symbol?, options?): Promise<ClosedPnl[]>

Trade WebSocket:
  isTradeWebSocketConnected(): boolean
  connectTradeWebSocket(): Promise<void>

User Data Stream:
  connectUserDataStream(handler: UserDataStreamHandlerArgs): Promise<void>
  disconnectUserDataStream(): void
  isUserDataStreamConnected(): boolean

Настройки:
  setLeverage(leverage, symbol): Promise<void>
  setMarginMode(mode, symbol): Promise<void>
  setPositionMode(mode): Promise<void>

Precision:
  amountToPrecision(symbol, amount): number
  priceToPrecision(symbol, price): number
  getMinOrderQty(symbol): number
  getMinNotional(symbol): number

Стриминг:
  watchTickers(): AsyncGenerator<TickerBySymbol>
  subscribeKlines(args): void
  unsubscribeKlines(args): void
  resubscribeKlines(args): void
  subscribeMarkPrices(handler: MarkPriceHandler): void
  unsubscribeMarkPrices(handler: MarkPriceHandler): void

WebSocket Registry:
  getWebSocketConnectionInfoList(): WebSocketConnectionInfo[]

Жизненный цикл:
  close(): Promise<void>
```

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
- `subscribeMarkPrices()` / `unsubscribeMarkPrices()` — делегирует в `getPublicStream()` (Binance Futures — отдельный mark-price стрим; Bybit — данные из `tickers.*`; Binance Spot — предупреждение в стриме, без подписки)
- `amountToPrecision()` / `priceToPrecision()` — lookup в tradeSymbols + precision utils, возвращает `number`, fallback на исходное значение
- `getMinOrderQty()` / `getMinNotional()` — lookup в tradeSymbols, fallback 0

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
- `cancelOrder()`, `getOrder()`, `fetchOpenOrders()`, `fetchOrderBook()`, `fetchTrades()`
- `modifyOrder()`, `cancelAllOrders()`, `createBatchOrders()`, `cancelBatchOrders()`
- `fetchMarkPrice()`, `fetchOpenInterest()`, `fetchFeeRate()`, `fetchIncome()`, `fetchClosedPnl()`
- `setPositionMode()`, `connectUserDataStream()`, `disconnectUserDataStream()`

### Default return (переопределяются в подклассах):
- `isUserDataStreamConnected()` — возвращает `false`

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
3. Для limit ордеров добавляет `timeInForce = GTC` если не указан
4. Если `tradeStream.isConnected()` → отправляет через WebSocket
5. Иначе fallback: `httpClient.createOrder()` → `normalizeBinanceOrder()`

Реализует методы работы с ордерами (6 методов):
- `fetchOrderHistory(symbol, options?)` → `httpClient.getAllOrders()` → `map(normalizeBinanceOrder)`
- `cancelOrder(symbol, orderId)` → `httpClient.cancelOrder()` → `normalizeBinanceOrder()`
- `getOrder(symbol, orderId)` → `httpClient.getOrder()` → `normalizeBinanceOrder()`
- `fetchOpenOrders(symbol?)` → `httpClient.getOpenOrders()` → `map(normalizeBinanceOrder)`
- `fetchOrderBook(symbol, limit?)` → `httpClient.fetchOrderBook()` → `normalizeBinanceOrderBook()`
- `fetchTrades(symbol, limit?)` → `httpClient.fetchTrades()` → `normalizeBinancePublicTrades()`

Реализует `isTradeWebSocketConnected()` и `connectTradeWebSocket()` через `BinanceTradeStream`.

Реализует `connectUserDataStream(handler)` — создаёт listenKey через REST, запускает `BinanceUserDataStream`, устанавливает keepalive-таймер (`setInterval` каждые 30 мин → `keepAliveListenKey`). Обрабатывает события:
- `ORDER_TRADE_UPDATE` → `handler.onOrderUpdate` (нормализация через `BINANCE_ORDER_STATUS_MAP`)
- `ACCOUNT_UPDATE` → `handler.onPositionUpdate` (из `event.a.P[]`)

Реализует `disconnectUserDataStream()` — очищает keepalive-таймер, закрывает стрим, удаляет listenKey через `deleteListenKey`.

Реализует `isUserDataStreamConnected()` — `userDataStream !== null && userDataStream.isConnected()`.

Реализует `getWebSocketConnectionInfoList()` — агрегирует `publicStream.getConnectionInfoList()` + `tradeStream.getConnectionInfo()` + optional `userDataStream.getConnectionInfo()`.

## Конкретные классы — отличия

### BinanceFutures
- `marketLabel = 'futures'`, `klineLimit = 499`
- Реализует все фьючерсные методы (position, leverage, funding, marginMode)
- Реализует дополнительные методы (8):
  - `modifyOrder(args)` → `httpClient.modifyOrder()` → `normalizeBinanceOrder()`
  - `cancelAllOrders(symbol)` → `httpClient.cancelAllOrders()`
  - `createBatchOrders(orderList)` → `httpClient.createBatchOrders()` → `map(normalizeBinanceOrder)`
  - `cancelBatchOrders(symbol, orderIdList)` → `httpClient.cancelBatchOrders()`
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

## BybitBaseClient — общая Bybit логика

Промежуточный абстрактный класс для `BybitLinear` и `BybitSpot`. Наследует `BaseExchangeClient`.

`category` — `protected readonly` поле (доступно подклассам для передачи в HTTP-вызовы).

Реализует все `protected fetchAndNormalize*()` методы через `BybitHttpClient` + `bybitNormalizer`.

Реализует `createOrderWebSocket()` через `BybitTradeStream` с fallback на REST:
1. Формирует params через `buildBybitOrderParams()`: `{ category, symbol, orderType, side, qty, ... }`
2. `submitOrder(orderParams, args: CreateOrderWebSocketArgs)` — принимает аргументы как второй параметр
3. Если `tradeStream !== null && tradeStream.isConnected()` → отправляет через WebSocket
4. Иначе fallback: `httpClient.createOrder()` → `buildBybitOrderFromCreateResponse()`

Реализует `isTradeWebSocketConnected()` и `connectTradeWebSocket()` через `BybitTradeStream`.

Реализует `connectUserDataStream(handler)` — создаёт `BybitPrivateStream` с `topicList: ['order', 'position']`. Обрабатывает события:
- `topic === 'order'` → `handler.onOrderUpdate` (нормализация через `BYBIT_ORDER_STATUS_MAP`)
- `topic === 'position'` → `handler.onPositionUpdate`

Реализует `disconnectUserDataStream()` — закрывает `privateStream`.

Реализует `isUserDataStreamConnected()` — `privateStream !== null && privateStream.isConnected()`.

Реализует методы работы с ордерами и рыночными данными (13 методов):
- `cancelOrder(symbol, orderId)` → `httpClient.cancelOrder()` → возвращает минимальный Order со status='canceled'
- `getOrder(symbol, orderId)` → сначала `httpClient.getOpenOrders()` (realtime), fallback на `httpClient.getOrderHistory()` → `normalizeBybitOrder()`
- `fetchOpenOrders(symbol?)` → `httpClient.getOpenOrders()` → `map(normalizeBybitOrder)`
- `fetchOrderHistory(symbol, options?)` → `httpClient.getOrderHistory()` → `map(normalizeBybitOrder)`
- `fetchOrderBook(symbol, limit?)` → `httpClient.fetchOrderBook()` → `normalizeBybitOrderBook()`
- `fetchTrades(symbol, limit?)` → `httpClient.fetchRecentTrades()` → `normalizeBybitPublicTradeList()`
- `fetchFeeRate(symbol?)` → `httpClient.fetchFeeRate()` → `normalizeBybitFeeRateList()`
- `modifyOrder(args)` → `httpClient.amendOrder()` → `getOrder()` для получения обновлённого ордера
- `cancelAllOrders(symbol)` → `httpClient.cancelAllOrders(category, symbol)`
- `createBatchOrders(orderList)` → `httpClient.createBatchOrders()` → `map(buildBybitOrderFromCreateResponse)`
- `cancelBatchOrders(symbol, orderIdList)` → `httpClient.cancelBatchOrders()`
- `fetchIncome(options?)` → `httpClient.fetchTransactionLog()` → `normalizeBybitIncomeList()`
- `fetchClosedPnl(symbol?, options?)` → `httpClient.getClosedPnl()` → `normalizeBybitClosedPnlList()`

Реализует `getWebSocketConnectionInfoList()` — агрегирует `publicStream.getConnectionInfoList()` + optional `tradeStream.getConnectionInfo()` + optional `privateStream.getConnectionInfo()`.

В demo mode `tradeStream = null` — все ордера через REST.

### BybitLinear
- `marketLabel = 'linear'`
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
  - `fetchPositionMode()` → `throw new Error('Not implemented for Bybit')`
- `setPositionMode(mode)` → `httpClient.setPositionMode()`, код Bybit `110025` обрабатывается как no-op без throw

### BybitSpot
- `marketLabel = 'spot'`
- Наследует `BybitBaseClient`
- Для market ордеров устанавливает `marketUnit = 'baseCoin'`
- Фьючерсные методы наследуют default throw из `BaseExchangeClient`

## Demo mode

Проверяется **только в конструкторе** — не runtime toggle:
- Binance Futures: другой baseUrl + другой WS URL
- Binance Spot: другой baseUrl, WS URL тот же
- Bybit Linear: другой baseUrl + другой WS URL, `tradeStream = null` (REST fallback)
- Bybit Spot: другой baseUrl + другой WS URL

## tradeSymbols

- `new Map()` при создании (пустой)
- `loadTradeSymbols()` — всегда загружает свежие данные, очищает Map перед заполнением
- Используется в `amountToPrecision()`, `priceToPrecision()`, `getMinOrderQty()`, `getMinNotional()`

## Structured Logging

ExchangeLogger поддерживает overloaded signatures:
- `logger.info(message: string)` — простое сообщение
- `logger.info(context: Record<string, unknown>, message: string)` — сообщение с контекстным объектом

## CreateOrderWebSocketArgs

- `triggerDirection?: 1 | 2` — направление триггера для условных ордеров (1 = rise, 2 = fall)

## ModifyOrderArgs

- `symbol: string` — символ торговой пары
- `orderId: string` — ID ордера для модификации
- `price?: number` — новая цена
- `amount?: number` — новый объём
- `triggerPrice?: number` — новая триггер-цена
