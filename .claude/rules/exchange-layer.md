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
  loadTradeSymbols(shouldReload?): Promise<TradeSymbolBySymbol>
  fetchTickers(): Promise<TickerBySymbol>
  fetchKlines(symbol, interval, options?): Promise<Kline[]>
  fetchAllKlines(symbolList, interval): Promise<Map<string, Kline[]>>

Аккаунт:
  fetchBalance(): Promise<BalanceByAsset>
  fetchPosition(symbol): Promise<Position>
  fetchPositionMode(): Promise<PositionModeEnum>
  fetchFundingRateHistory(symbol, options?): Promise<FundingRateHistory[]>
  fetchFundingInfo(symbol?): Promise<FundingInfo[]>

Ордера:
  createOrderWebSocket(args): Promise<Order>
  fetchOrderHistory(symbol, options?): Promise<Order[]>

Trade WebSocket:
  isTradeWebSocketConnected(): boolean
  connectTradeWebSocket(): Promise<void>

Настройки:
  setLeverage(leverage, symbol): Promise<void>
  setMarginMode(mode, symbol): Promise<void>

Precision:
  amountToPrecision(symbol, amount): string
  priceToPrecision(symbol, price): string
  getMinOrderQty(symbol): number
  getMinNotional(symbol): number

Стриминг:
  watchTickers(): AsyncGenerator<TickerBySymbol>
  subscribeKlines(args): void
  unsubscribeKlines(args): void

Жизненный цикл:
  close(): Promise<void>
```

## BaseExchangeClient — что реализовано vs что абстрактно

### Реализовано (наследуется всеми):
- `loadTradeSymbols()` — ленивая загрузка + кеш в `this.tradeSymbols` Map
- `fetchTickers()` — делегирует в абстрактный `fetchAndNormalizeTickers()`
- `fetchKlines()` — делегирует в абстрактный `fetchAndNormalizeKlines()`
- `fetchAllKlines()` — батч-загрузка через `loadKlinesInChunks` утилиту (чанки по 200)
- `fetchBalance()` — делегирует в абстрактный `fetchAndNormalizeBalance()`
- `watchTickers()` — подписка через `getPublicStream().subscribeAllTickers()` + yield `fetchTickers()`
- `subscribeKlines()` / `unsubscribeKlines()` — делегирует в publicStream
- `amountToPrecision()` / `priceToPrecision()` — lookup в tradeSymbols + precision utils, fallback на `String(value)`
- `getMinOrderQty()` / `getMinNotional()` — lookup в tradeSymbols, fallback 0

### Абстрактно (нужно реализовать):
- `protected getPublicStream(): PublicStreamLike`
- `protected fetchAndNormalizeTradeSymbols(): Promise<TradeSymbolBySymbol>`
- `protected fetchAndNormalizeTickers(): Promise<TickerBySymbol>`
- `protected fetchAndNormalizeKlines(symbol, interval, options?): Promise<Kline[]>`
- `protected fetchAndNormalizeBalance(): Promise<BalanceByAsset>`
- `isTradeWebSocketConnected(): boolean`
- `connectTradeWebSocket(): Promise<void>`
- `createOrderWebSocket()`
- `close()`

### Default throw (переопределяются только в futures-классах):
- `fetchOrderHistory()`, `fetchFundingRateHistory()`, `fetchFundingInfo()`, `fetchPositionMode()`
- `fetchPosition()`, `setLeverage()`, `setMarginMode()`

## BinanceBaseClient — шаблонный метод

Обобщённый класс `<T extends BinanceBaseHttpClient>` — общий для Spot и Futures.

Реализует все `protected fetchAndNormalize*()` методы:
- `fetchAndNormalizeTradeSymbols()` → `httpClient.fetchExchangeInfo()` → `normalizeBinanceTradeSymbols()`
- `fetchAndNormalizeTickers()` → `httpClient.fetchTickers()` → `normalizeBinanceTickers()`
- `fetchAndNormalizeKlines()` → `httpClient.fetchKlines()` → `normalizeBinanceKlines()`
- `fetchAndNormalizeBalance()` → `httpClient.fetchAccount()` → `normalizeBinanceBalance()`

Реализует `createOrderWebSocket()` через `BinanceTradeStream` с fallback на REST:
1. Формирует params через `buildBinanceOrderParams()`: `{ symbol, side, type, quantity, price, timeInForce, ... }`
2. Форматирует через `amountToPrecision()` + `priceToPrecision()`
3. Для limit ордеров добавляет `timeInForce = GTC` если не указан
4. Если `tradeStream.isConnected()` → отправляет через WebSocket
5. Иначе fallback: `httpClient.createOrder()` → `normalizeBinanceOrder()`

Реализует `isTradeWebSocketConnected()` и `connectTradeWebSocket()` через `BinanceTradeStream`.

## Конкретные классы — отличия

### BinanceFutures
- `marketLabel = 'futures'`, `klineLimit = 499`
- Реализует все фьючерсные методы (position, leverage, funding, marginMode)
- HTTP: `BinanceFuturesHttpClient`, WS: `BinanceFuturesPublicStream`

### BinanceSpot
- `marketLabel = 'spot'`, `klineLimit = 1000`
- Фьючерсные методы → `throw new Error('Not supported for spot market')`
- HTTP: `BinanceSpotHttpClient`, WS: `BinanceSpotPublicStream`

## BybitBaseClient — общая Bybit логика

Промежуточный абстрактный класс для `BybitLinear` и `BybitSpot`. Наследует `BaseExchangeClient`.

Реализует все `protected fetchAndNormalize*()` методы через `BybitHttpClient` + `bybitNormalizer`.

Реализует `createOrderWebSocket()` через `BybitTradeStream` с fallback на REST:
1. Формирует params через `buildBybitOrderParams()`: `{ category, symbol, orderType, side, qty, ... }`
2. Если `tradeStream !== null` → отправляет через WebSocket
3. Иначе fallback: `httpClient.createOrder()` → `buildBybitOrderFromCreateResponse()`

Реализует `isTradeWebSocketConnected()` и `connectTradeWebSocket()` через `BybitTradeStream`.

В demo mode `tradeStream = null` — все ордера через REST.

### BybitLinear
- `marketLabel = 'linear'`
- Наследует `BybitBaseClient`
- Реализует фьючерсные методы (position, leverage, marginMode)

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

## Кеширование tradeSymbols

- `new Map()` при создании (пустой)
- Заполняется при первом вызове `loadTradeSymbols()`
- Повторные вызовы возвращают кеш
- `loadTradeSymbols(true)` — принудительная перезагрузка
- Используется в `amountToPrecision()`, `priceToPrecision()`, `getMinOrderQty()`, `getMinNotional()`
- Автоматического TTL нет — потребитель управляет сам
