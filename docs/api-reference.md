# Exchange Engine — API Reference

Унифицированная абстракция над REST API и WebSocket биржами Binance и Bybit.
Все методы доступны через единый интерфейс `ExchangeClient`.

## Быстрый старт

```typescript
import { Exchange, ExchangeNameEnum } from '@solncebro/exchange-engine';

const exchange = new Exchange(ExchangeNameEnum.Binance, {
  config: { apiKey: 'YOUR_KEY', secret: 'YOUR_SECRET', isDemoMode: false },
  logger, // ExchangeLogger
});

const futures = exchange.futures; // ExchangeClient
const spot = exchange.spot;       // ExchangeClient

// Загрузить символы, получить тикеры, закрыть
await futures.loadTradeSymbols();
const tickers = await futures.fetchTickers();
await exchange.close();
```

## Фабрика Exchange

```typescript
class Exchange {
  readonly name: ExchangeNameEnum;
  readonly futures: ExchangeClient;
  readonly spot: ExchangeClient;

  constructor(name: ExchangeNameEnum, args: ExchangeArgs);
  getWebSocketConnectionInfoList(): WebSocketConnectionInfo[];
  close(): Promise<void>;
}
```

При `ExchangeNameEnum.Binance` создает `BinanceFutures` + `BinanceSpot`.
При `ExchangeNameEnum.Bybit` создает `BybitLinear` + `BybitSpot`.

---

## Матрица поддержки методов

| Метод | Binance Futures | Binance Spot | Bybit Linear | Bybit Spot |
|---|:---:|:---:|:---:|:---:|
| `loadTradeSymbols` | ✅ | ✅ | ✅ | ✅ |
| `amountToPrecision` | ✅ | ✅ | ✅ | ✅ |
| `priceToPrecision` | ✅ | ✅ | ✅ | ✅ |
| `getMinOrderQty` | ✅ | ✅ | ✅ | ✅ |
| `getMinNotional` | ✅ | ✅ | ✅ | ✅ |
| `fetchTickers` | ✅ | ✅ | ✅ | ✅ |
| `fetchKlines` | ✅ | ✅ | ✅ | ✅ |
| `fetchAllKlines` | ✅ | ✅ | ✅ | ✅ |
| `fetchOrderBook` | ✅ | ✅ | ✅ | ✅ |
| `fetchTrades` | ✅ | ✅ | ✅ | ✅ |
| `fetchMarkPrice` | ✅ | ❌ | ✅ | ❌ |
| `fetchOpenInterest` | ✅ | ❌ | ✅ | ❌ |
| `fetchBalances` | ✅ | ✅ | ✅ | ✅ |
| `fetchFeeRate` | ✅ | ❌ | ✅ | ✅ |
| `fetchIncome` | ✅ | ❌ | ✅ | ✅ |
| `fetchClosedPnl` | ❌ | ❌ | ✅ | ✅ |
| `fetchPosition` | ✅ | ❌ | ✅ | ❌ |
| `fetchPositionMode` | ✅ | ❌ | ✅ | ❌ |
| `setPositionMode` | ✅ | ❌ | ✅ | ❌ |
| `setLeverage` | ✅ | ❌ | ✅ | ❌ |
| `setMarginMode` | ✅ | ❌ | ✅ | ❌ |
| `fetchFundingRateHistory` | ✅ | ❌ | ✅ | ❌ |
| `fetchFundingInfo` | ✅ | ❌ | ❌ | ❌ |
| `createOrderWebSocket` | ✅ | ✅ | ✅ | ✅ |
| `cancelOrder` | ✅ | ✅ | ✅ | ✅ |
| `getOrder` | ✅ | ✅ | ✅ | ✅ |
| `fetchOpenOrders` | ✅ | ✅ | ✅ | ✅ |
| `fetchOrderHistory` | ✅ | ✅ | ✅ | ✅ |
| `modifyOrder` | ✅ | ❌ | ✅ | ✅ |
| `cancelAllOrders` | ✅ | ❌ | ✅ | ✅ |
| `createBatchOrders` | ✅ | ❌ | ✅ | ✅ |
| `cancelBatchOrders` | ✅ | ❌ | ✅ | ✅ |
| `watchTickers` | ✅ | ✅ | ✅ | ✅ |
| `subscribeMarkPrices` / `unsubscribeMarkPrices` | ✅ | ⚠️ | ✅ | ✅ |
| `subscribeKlines` | ✅ | ✅ | ✅ | ✅ |
| `unsubscribeKlines` | ✅ | ✅ | ✅ | ✅ |
| `connectTradeWebSocket` | ✅ | ✅ | ✅ | ✅ |
| `isTradeWebSocketConnected` | ✅ | ✅ | ✅ | ✅ |
| `connectUserDataStream` | ✅ | ✅ | ✅ | ✅ |
| `disconnectUserDataStream` | ✅ | ✅ | ✅ | ✅ |
| `isUserDataStreamConnected` | ✅ | ✅ | ✅ | ✅ |
| `getWebSocketConnectionInfoList` | ✅ | ✅ | ✅ | ✅ |
| `awaitWebSocketConnectionsReady` | ✅ | ✅ | ✅ | ✅ |
| `close` | ✅ | ✅ | ✅ | ✅ |

> ❌ — метод выбрасывает `Error("Not supported for ... market")` или `Error("Not implemented for ...")`.
>
> ⚠️ — метод вызывается без ошибки, но для этого рынка не создаётся поток mark/index (см. описание ниже).

---

## Свойства ExchangeClient

### `apiKey`

```typescript
readonly apiKey: string
```

API-ключ, переданный при создании клиента.

### `tradeSymbols`

```typescript
readonly tradeSymbols: TradeSymbolBySymbol // Map<string, TradeSymbol>
```

Кэш торговых инструментов. Пустой `Map` до вызова `loadTradeSymbols()`.

---

## 1. Инструменты и конфигурация

### `loadTradeSymbols()`

```typescript
loadTradeSymbols(): Promise<TradeSymbolBySymbol>
```

Загружает список торговых инструментов с биржи, заполняет `tradeSymbols`. При повторном вызове очищает и перезагружает данные.

**Возврат:** `TradeSymbolBySymbol` (`Map<string, TradeSymbol>`) — все доступные инструменты.

```typescript
const symbols = await futures.loadTradeSymbols();
const btc = symbols.get('BTCUSDT');
console.log(btc?.filter.stepSize); // '0.001'
```

---

### `amountToPrecision()`

```typescript
amountToPrecision(symbol: string, amount: number): number
```

Округляет количество до шага `stepSize` инструмента. Требует предварительного вызова `loadTradeSymbols()`.

| Параметр | Тип | Обязательный | Описание |
|---|---|:---:|---|
| `symbol` | `string` | да | Торговый символ, напр. `'BTCUSDT'` |
| `amount` | `number` | да | Количество для округления |

**Возврат:** `number` — округленное значение. Если символ не найден, возвращает исходное значение.

```typescript
const qty = futures.amountToPrecision('BTCUSDT', 0.00156);
// 0.001 (при stepSize = '0.001')
```

---

### `priceToPrecision()`

```typescript
priceToPrecision(symbol: string, price: number): number
```

Округляет цену до шага `tickSize` инструмента. Требует предварительного вызова `loadTradeSymbols()`.

| Параметр | Тип | Обязательный | Описание |
|---|---|:---:|---|
| `symbol` | `string` | да | Торговый символ |
| `price` | `number` | да | Цена для округления |

**Возврат:** `number` — округленная цена. Если символ не найден, возвращает исходное значение.

```typescript
const price = futures.priceToPrecision('BTCUSDT', 50123.456789);
// 50123.50 (при tickSize = '0.10')
```

---

### `getMinOrderQty()`

```typescript
getMinOrderQty(symbol: string): number
```

Возвращает минимальный объем ордера (`minQty`) для инструмента.

| Параметр | Тип | Обязательный | Описание |
|---|---|:---:|---|
| `symbol` | `string` | да | Торговый символ |

**Возврат:** `number` — минимальный объем. `0` если символ не найден.

---

### `getMinNotional()`

```typescript
getMinNotional(symbol: string): number
```

Возвращает минимальную стоимость ордера (`minNotional`) для инструмента.

| Параметр | Тип | Обязательный | Описание |
|---|---|:---:|---|
| `symbol` | `string` | да | Торговый символ |

**Возврат:** `number` — минимальная стоимость. `0` если символ не найден.

---

## 2. Рыночные данные

### `fetchTickers()`

```typescript
fetchTickers(): Promise<TickerBySymbol>
```

Получает тикеры 24h для всех инструментов.

**Возврат:** `TickerBySymbol` (`Map<string, Ticker>`) — все тикеры, ключ — символ.

```typescript
const tickers = await futures.fetchTickers();
const btc = tickers.get('BTCUSDT');
console.log(btc?.lastPrice, btc?.priceChangePercent);
```

---

### `fetchKlines()`

```typescript
fetchKlines(
  symbol: string,
  interval: KlineInterval,
  options?: FetchPageWithLimitArgs,
): Promise<Kline[]>
```

Загружает исторические свечи (OHLCV).

| Параметр | Тип | Обязательный | Описание |
|---|---|:---:|---|
| `symbol` | `string` | да | Торговый символ |
| `interval` | `KlineInterval` | да | Интервал свечи: `'1m'`, `'5m'`, `'1h'`, `'1d'` и т.д. |
| `options` | `FetchPageWithLimitArgs` | нет | `startTime`, `endTime`, `limit` |

**Возврат:** `Kline[]` — массив свечей. Лимит по умолчанию: 499 (Binance Futures), 1000 (Binance Spot), 200 (Bybit).

```typescript
const klines = await futures.fetchKlines('BTCUSDT', '1h', { limit: 100 });
```

---

### `fetchAllKlines()`

```typescript
fetchAllKlines(
  symbolList: string[],
  interval: KlineInterval,
  options?: FetchAllKlinesOptions,
): Promise<Map<string, Kline[]>>
```

Параллельная загрузка свечей для списка символов с разбивкой на чанки.

| Параметр | Тип | Обязательный | Описание |
|---|---|:---:|---|
| `symbolList` | `string[]` | да | Список символов |
| `interval` | `KlineInterval` | да | Интервал свечи |
| `options` | `FetchAllKlinesOptions` | нет | `chunkSize` (по умолчанию 200), `pauseBetweenChunksMs`, `trimLastKline`, `onChunkLoaded` |

**Возврат:** `Map<string, Kline[]>` — свечи для каждого символа.

```typescript
const allKlines = await futures.fetchAllKlines(['BTCUSDT', 'ETHUSDT'], '1h');
const btcKlines = allKlines.get('BTCUSDT');
```

---

### `fetchOrderBook()`

```typescript
fetchOrderBook(symbol: string, limit?: number): Promise<OrderBook>
```

Получает стакан заявок (bids/asks) для инструмента.

| Параметр | Тип | Обязательный | Описание |
|---|---|:---:|---|
| `symbol` | `string` | да | Торговый символ |
| `limit` | `number` | нет | Глубина стакана |

**Возврат:** `OrderBook` — стакан с полями `symbol`, `askList`, `bidList`, `timestamp`.

```typescript
const book = await futures.fetchOrderBook('BTCUSDT', 20);
console.log(book.askList[0].price, book.bidList[0].price);
```

---

### `fetchTrades()`

```typescript
fetchTrades(symbol: string, limit?: number): Promise<PublicTrade[]>
```

Получает последние публичные сделки.

| Параметр | Тип | Обязательный | Описание |
|---|---|:---:|---|
| `symbol` | `string` | да | Торговый символ |
| `limit` | `number` | нет | Количество сделок |

**Возврат:** `PublicTrade[]` — массив публичных сделок.

---

### `fetchMarkPrice()`

```typescript
fetchMarkPrice(symbol?: string): Promise<MarkPrice[]>
```

Получает mark price, index price и текущую ставку фандинга.

| Параметр | Тип | Обязательный | Описание |
|---|---|:---:|---|
| `symbol` | `string` | нет | Символ (если не указан — все инструменты) |

**Возврат:** `MarkPrice[]` — массив с полями `markPrice`, `indexPrice`, `lastFundingRate`, `nextFundingTime`.

| Биржа | Futures | Spot |
|---|:---:|:---:|
| Binance | ✅ | ❌ |
| Bybit | ❌ | ❌ |

---

### `fetchOpenInterest()`

```typescript
fetchOpenInterest(symbol: string): Promise<OpenInterest>
```

Получает открытый интерес для инструмента.

| Параметр | Тип | Обязательный | Описание |
|---|---|:---:|---|
| `symbol` | `string` | да | Торговый символ |

**Возврат:** `OpenInterest` — `{ symbol, openInterest, timestamp }`.

| Биржа | Futures | Spot |
|---|:---:|:---:|
| Binance | ✅ | ❌ |
| Bybit | ✅ | ❌ |

---

## 3. Аккаунт

### `fetchBalances()`

```typescript
fetchBalances(): Promise<AccountBalances>
```

Получает балансы аккаунта. Нулевые балансы пропускаются.

**Возврат:** `AccountBalances` — объект с агрегированными полями аккаунта и `balanceByAsset` (`Map<string, Balance>`).

```typescript
const balances = await futures.fetchBalances();
const usdt = balances.balanceByAsset.get('USDT');
console.log(balances.totalWalletBalance, usdt?.free, usdt?.locked);
```

---

### `fetchFeeRate()`

```typescript
fetchFeeRate(symbol?: string): Promise<FeeRate[]>
```

Получает комиссии (maker/taker rate).

| Параметр | Тип | Обязательный | Описание |
|---|---|:---:|---|
| `symbol` | `string` | нет | Символ (если не указан — все) |

**Возврат:** `FeeRate[]` — массив `{ symbol, makerRate, takerRate }`.

| Биржа | Futures | Spot |
|---|:---:|:---:|
| Binance | ✅ | ❌ |
| Bybit | ✅ | ✅ |

---

### `fetchIncome()`

```typescript
fetchIncome(options?: FetchPageWithLimitArgs): Promise<Income[]>
```

Получает историю доходов/расходов (комиссии, фандинг, PnL).

| Параметр | Тип | Обязательный | Описание |
|---|---|:---:|---|
| `options` | `FetchPageWithLimitArgs` | нет | `startTime`, `endTime`, `limit` |

**Возврат:** `Income[]` — массив записей.

| Биржа | Futures | Spot |
|---|:---:|:---:|
| Binance | ✅ | ❌ |
| Bybit | ✅ | ✅ |

---

### `fetchClosedPnl()`

```typescript
fetchClosedPnl(symbol?: string, options?: FetchPageWithLimitArgs): Promise<ClosedPnl[]>
```

Получает историю закрытых PnL.

| Параметр | Тип | Обязательный | Описание |
|---|---|:---:|---|
| `symbol` | `string` | нет | Символ для фильтрации |
| `options` | `FetchPageWithLimitArgs` | нет | `startTime`, `endTime`, `limit` |

**Возврат:** `ClosedPnl[]` — массив закрытых PnL.

| Биржа | Futures | Spot |
|---|:---:|:---:|
| Binance | ❌ | ❌ |
| Bybit | ✅ | ✅ |

---

## 4. Позиции

### `fetchPosition()`

```typescript
fetchPosition(symbol: string): Promise<Position>
```

Получает текущую позицию по инструменту. Выбрасывает ошибку если позиция не найдена.

| Параметр | Тип | Обязательный | Описание |
|---|---|:---:|---|
| `symbol` | `string` | да | Торговый символ |

**Возврат:** `Position` — текущая позиция.

| Биржа | Futures | Spot |
|---|:---:|:---:|
| Binance | ✅ | ❌ |
| Bybit | ✅ | ❌ |

```typescript
const position = await futures.fetchPosition('BTCUSDT');
console.log(position.side, position.contracts, position.unrealizedPnl);
```

---

### `fetchPositionMode()`

```typescript
fetchPositionMode(): Promise<PositionModeEnum | undefined>
```

Получает текущий режим позиций (Hedge или OneWay), если его можно определить по API.

**Возврат:** `PositionModeEnum` (`Hedge` или `OneWay`) или `undefined`, когда режим недоступен без открытых позиций (Bybit Linear V5).

| Биржа | Futures | Spot |
|---|:---:|:---:|
| Binance | ✅ | ❌ |
| Bybit | ✅ | ❌ |

---

### `setPositionMode()`

```typescript
setPositionMode(mode: PositionModeEnum): Promise<void>
```

Устанавливает режим позиций.

| Параметр | Тип | Обязательный | Описание |
|---|---|:---:|---|
| `mode` | `PositionModeEnum` | да | `Hedge` или `OneWay` |

| Биржа | Futures | Spot |
|---|:---:|:---:|
| Binance | ✅ | ❌ |
| Bybit | ❌ | ❌ |

---

### `setLeverage()`

```typescript
setLeverage(leverage: number, symbol: string): Promise<void>
```

Устанавливает кредитное плечо.

| Параметр | Тип | Обязательный | Описание |
|---|---|:---:|---|
| `leverage` | `number` | да | Множитель плеча (напр. 10) |
| `symbol` | `string` | да | Торговый символ |

| Биржа | Futures | Spot |
|---|:---:|:---:|
| Binance | ✅ | ❌ |
| Bybit | ✅ | ❌ |

---

### `setMarginMode()`

```typescript
setMarginMode(marginMode: MarginModeEnum, symbol: string): Promise<void>
```

Устанавливает режим маржи (Isolated / Cross).

| Параметр | Тип | Обязательный | Описание |
|---|---|:---:|---|
| `marginMode` | `MarginModeEnum` | да | `Isolated` или `Cross` |
| `symbol` | `string` | да | Торговый символ |

| Биржа | Futures | Spot |
|---|:---:|:---:|
| Binance | ✅ | ❌ |
| Bybit | ✅ | ❌ |

---

### `fetchFundingRateHistory()`

```typescript
fetchFundingRateHistory(
  symbol: string,
  options?: FetchPageWithLimitArgs,
): Promise<FundingRateHistory[]>
```

Получает историю ставок фандинга.

| Параметр | Тип | Обязательный | Описание |
|---|---|:---:|---|
| `symbol` | `string` | да | Торговый символ |
| `options` | `FetchPageWithLimitArgs` | нет | `startTime`, `endTime`, `limit` |

**Возврат:** `FundingRateHistory[]` — массив `{ symbol, fundingRate, fundingTime, markPrice }`.

| Биржа | Futures | Spot |
|---|:---:|:---:|
| Binance | ✅ | ❌ |
| Bybit | ✅ | ❌ |

---

### `fetchFundingInfo()`

```typescript
fetchFundingInfo(symbol?: string): Promise<FundingInfo[]>
```

Получает информацию о фандинге (интервал, cap/floor).

| Параметр | Тип | Обязательный | Описание |
|---|---|:---:|---|
| `symbol` | `string` | нет | Символ для фильтрации |

**Возврат:** `FundingInfo[]` — массив `{ symbol, fundingIntervalHours, adjustedFundingRateCap, adjustedFundingRateFloor }`.

| Биржа | Futures | Spot |
|---|:---:|:---:|
| Binance | ✅ | ❌ |
| Bybit | ❌ | ❌ |

---

## 5. Ордера

### `createOrderWebSocket()`

```typescript
createOrderWebSocket(args: CreateOrderWebSocketArgs): Promise<Order>
```

Создает ордер через WebSocket (если подключен) или через REST (fallback).

| Параметр | Тип | Обязательный | Описание |
|---|---|:---:|---|
| `args.symbol` | `string` | да | Торговый символ |
| `args.type` | `OrderTypeEnum` | да | Тип ордера |
| `args.side` | `OrderSideEnum` | да | Сторона: `Buy` / `Sell` |
| `args.amount` | `number` | да | Количество |
| `args.price` | `number` | нет | Цена (для Limit) |
| `args.stopPrice` | `number` | нет | Стоп-цена (для StopMarket, TakeProfitMarket) |
| `args.triggerDirection` | `1 \| 2` | нет | Направление триггера: 1 = рост, 2 = падение |
| `args.triggerBy` | `TriggerByEnum` | нет | Триггер conditional (Bybit Linear): mark / last / index |
| `args.closePosition` | `boolean` | нет | Закрыть позицию целиком |
| `args.workingType` | `WorkingTypeEnum` | нет | Mark price или Contract price |
| `args.positionSide` | `PositionSideEnum` | нет | Сторона позиции (для Hedge mode) |
| `args.reduceOnly` | `boolean` | нет | Только уменьшение позиции |
| `args.closeOnTrigger` | `boolean` | нет | Bybit Linear: закрытие по триггеру |
| `args.timeInForce` | `TimeInForceEnum` | нет | GTC, IOC, FOK, PostOnly. Для Limit по умолчанию GTC |
| `args.clientOrderId` | `string` | нет | Пользовательский ID ордера |
| `args.orderFilter` | `OrderFilterEnum` | нет | Bybit Spot: фильтр conditional / TPSL |
| `args.marketUnit` | `MarketUnitEnum` | нет | Bybit Spot: единица количества Market-ордера |
| `args.trailingDelta` | `number` | нет | Binance Spot: trailing для STOP/TAKE_PROFIT |
| `args.quoteOrderQty` | `number` | нет | Binance / Bybit Spot: сумма в котируемой валюте для Market Buy |

**Возврат:** `Order` — созданный ордер.

```typescript
import { OrderTypeEnum, OrderSideEnum } from '@solncebro/exchange-engine';

const order = await futures.createOrderWebSocket({
  symbol: 'BTCUSDT',
  type: OrderTypeEnum.Limit,
  side: OrderSideEnum.Buy,
  amount: 0.001,
  price: 50000,
});
```

---

### `cancelOrder()`

```typescript
cancelOrder(symbol: string, orderId: string): Promise<Order>
```

Отменяет ордер по ID.

| Параметр | Тип | Обязательный | Описание |
|---|---|:---:|---|
| `symbol` | `string` | да | Торговый символ |
| `orderId` | `string` | да | ID ордера |

**Возврат:** `Order` — отмененный ордер.

| Биржа | Futures | Spot |
|---|:---:|:---:|
| Binance | ✅ | ✅ |
| Bybit | ✅ | ✅ |

---

### `getOrder()`

```typescript
getOrder(symbol: string, orderId: string): Promise<Order>
```

Получает информацию об ордере по ID.

| Параметр | Тип | Обязательный | Описание |
|---|---|:---:|---|
| `symbol` | `string` | да | Торговый символ |
| `orderId` | `string` | да | ID ордера |

**Возврат:** `Order` — данные ордера.

| Биржа | Futures | Spot |
|---|:---:|:---:|
| Binance | ✅ | ✅ |
| Bybit | ✅ | ✅ |

---

### `fetchOpenOrders()`

```typescript
fetchOpenOrders(symbol?: string): Promise<Order[]>
```

Получает список открытых ордеров.

| Параметр | Тип | Обязательный | Описание |
|---|---|:---:|---|
| `symbol` | `string` | нет | Символ для фильтрации |

**Возврат:** `Order[]` — массив открытых ордеров.

| Биржа | Futures | Spot |
|---|:---:|:---:|
| Binance | ✅ | ✅ |
| Bybit | ✅ | ✅ |

---

### `fetchOrderHistory()`

```typescript
fetchOrderHistory(symbol: string, options?: FetchPageWithLimitArgs): Promise<Order[]>
```

Получает историю ордеров.

| Параметр | Тип | Обязательный | Описание |
|---|---|:---:|---|
| `symbol` | `string` | да | Торговый символ |
| `options` | `FetchPageWithLimitArgs` | нет | `startTime`, `endTime`, `limit` |

**Возврат:** `Order[]` — массив ордеров.

| Биржа | Futures | Spot |
|---|:---:|:---:|
| Binance | ✅ | ❌ |
| Bybit | ✅ | ✅ |

---

### `modifyOrder()`

```typescript
modifyOrder(args: ModifyOrderArgs): Promise<Order>
```

Модифицирует существующий ордер (цену, количество, триггер-цену).

| Параметр | Тип | Обязательный | Описание |
|---|---|:---:|---|
| `args.symbol` | `string` | да | Торговый символ |
| `args.orderId` | `string` | да | ID ордера |
| `args.price` | `number` | нет | Новая цена |
| `args.amount` | `number` | нет | Новое количество |
| `args.triggerPrice` | `number` | нет | Новая триггер-цена |

**Возврат:** `Order` — модифицированный ордер.

| Биржа | Futures | Spot |
|---|:---:|:---:|
| Binance | ✅ | ❌ |
| Bybit | ✅ | ✅ |

---

### `cancelAllOrders()`

```typescript
cancelAllOrders(symbol: string): Promise<void>
```

Отменяет все открытые ордера по символу.

| Параметр | Тип | Обязательный | Описание |
|---|---|:---:|---|
| `symbol` | `string` | да | Торговый символ |

| Биржа | Futures | Spot |
|---|:---:|:---:|
| Binance | ✅ | ❌ |
| Bybit | ✅ | ✅ |

---

### `createBatchOrders()`

```typescript
createBatchOrders(orderList: CreateOrderWebSocketArgs[]): Promise<Order[]>
```

Создает несколько ордеров одним запросом.

| Параметр | Тип | Обязательный | Описание |
|---|---|:---:|---|
| `orderList` | `CreateOrderWebSocketArgs[]` | да | Массив ордеров |

**Возврат:** `Order[]` — массив созданных ордеров.

| Биржа | Futures | Spot |
|---|:---:|:---:|
| Binance | ✅ | ❌ |
| Bybit | ✅ | ✅ |

---

### `cancelBatchOrders()`

```typescript
cancelBatchOrders(symbol: string, orderIdList: string[]): Promise<void>
```

Отменяет несколько ордеров одним запросом.

| Параметр | Тип | Обязательный | Описание |
|---|---|:---:|---|
| `symbol` | `string` | да | Торговый символ |
| `orderIdList` | `string[]` | да | Массив ID ордеров |

| Биржа | Futures | Spot |
|---|:---:|:---:|
| Binance | ✅ | ❌ |
| Bybit | ✅ | ✅ |

---

## 6. WebSocket стриминг

### `watchTickers()`

```typescript
watchTickers(): AsyncGenerator<TickerBySymbol>
```

Подписывается на обновления тикеров через WebSocket. Первый yield — текущие тикеры через REST.

**Возврат:** `AsyncGenerator<TickerBySymbol>` — асинхронный генератор обновлений.

```typescript
for await (const tickers of futures.watchTickers()) {
  const btc = tickers.get('BTCUSDT');
  console.log(btc?.lastPrice);
}
```

---

### `subscribeMarkPrices()`

```typescript
subscribeMarkPrices(handler: MarkPriceHandler): void
```

Подписывает обработчик на потоковые обновления mark price и index price. Хендлер вызывается с батчем `MarkPriceUpdate[]` (символ, числовые цены, время события).

| Рынок | Поведение |
|------|-----------|
| Binance Futures | Подписка на WebSocket-стрим `!markPrice@arr@1s` |
| Binance Spot | Подписка не создаётся; в лог пишется предупреждение, хендлер не вызывается |
| Bybit Linear / Spot | Используется тот же топик `tickers.linear` / `tickers.spot`, что и у all-tickers; в хендлер попадают только элементы с валидным `markPrice` в сообщении биржи |

Требуется тот же экземпляр функции для отписки, что и для `unsubscribeMarkPrices`.

---

### `unsubscribeMarkPrices()`

```typescript
unsubscribeMarkPrices(handler: MarkPriceHandler): void
```

Снимает ранее зарегистрированный обработчик mark/index price. На Binance Spot вызов без эффекта.

---

### `subscribeKlines()`

```typescript
subscribeKlines(args: SubscribeKlinesArgs): void
```

Подписывается на обновления свечей через WebSocket.

| Параметр | Тип | Обязательный | Описание |
|---|---|:---:|---|
| `args.symbol` | `string` | да | Торговый символ |
| `args.interval` | `KlineInterval` | да | Интервал свечи |
| `args.handler` | `KlineHandler` | да | `(symbol: string, kline: Kline) => void` |

```typescript
futures.subscribeKlines({
  symbol: 'BTCUSDT',
  interval: '1m',
  handler: (symbol, kline) => {
    if (kline.isClosed) {
      console.log(`${symbol}: closed at ${kline.closePrice}`);
    }
  },
});
```

---

### `unsubscribeKlines()`

```typescript
unsubscribeKlines(args: SubscribeKlinesArgs): void
```

Отписывается от обновлений свечей. Передать тот же `handler`, что был передан в `subscribeKlines`.

| Параметр | Тип | Обязательный | Описание |
|---|---|:---:|---|
| `args.symbol` | `string` | да | Торговый символ |
| `args.interval` | `KlineInterval` | да | Интервал свечи |
| `args.handler` | `KlineHandler` | да | Тот же handler, что был передан в `subscribeKlines` |

---

### `connectTradeWebSocket()`

```typescript
connectTradeWebSocket(): Promise<void>
```

Устанавливает WebSocket-соединение для торговых операций. После подключения `createOrderWebSocket` будет отправлять ордера через WebSocket вместо REST.

---

### `isTradeWebSocketConnected()`

```typescript
isTradeWebSocketConnected(): boolean
```

Проверяет, подключен ли торговый WebSocket.

**Возврат:** `boolean` — `true` если соединение установлено.

---

### `connectUserDataStream()`

```typescript
connectUserDataStream(handler: UserDataStreamHandlerArgs): Promise<void>
```

Устанавливает WebSocket-соединение для приёма приватных событий — обновлений ордеров и позиций в реальном времени.

Повторный вызов при уже активном соединении — no-op.

| Параметр | Тип | Обязательный | Описание |
|---|---|:---:|---|
| `handler.onOrderUpdate` | `OrderUpdateHandler` | да | Вызывается при изменении статуса ордера |
| `handler.onPositionUpdate` | `PositionUpdateHandler` | да | Вызывается при изменении позиции |

```typescript
await futures.connectUserDataStream({
  onOrderUpdate: (event) => {
    console.log(`Order ${event.orderId}: ${event.status}, filled ${event.filledAmount}/${event.amount}`);
  },
  onPositionUpdate: (event) => {
    console.log(`Position ${event.symbol}: size ${event.size}, pnl ${event.unrealisedPnl}`);
  },
});
```

---

### `disconnectUserDataStream()`

```typescript
disconnectUserDataStream(): void
```

Закрывает user data WebSocket-соединение и освобождает связанные ресурсы (listenKey у Binance, приватный стрим у Bybit). Вызывается автоматически при `close()`.

---

### `isUserDataStreamConnected()`

```typescript
isUserDataStreamConnected(): boolean
```

Проверяет, подключён ли user data WebSocket.

**Возврат:** `boolean` — `true` если соединение установлено.

---

### `awaitWebSocketConnectionsReady()`

```typescript
awaitWebSocketConnectionsReady(): Promise<void>
```

Ожидает готовности публичных WebSocket-подключений после подписок (например, после завершения батчей `SUBSCRIBE` у Binance Futures). У стримов без реализации `awaitConnectionsReady` разрешается сразу.

---

### `getWebSocketConnectionInfoList()`

```typescript
getWebSocketConnectionInfoList(): WebSocketConnectionInfo[]
```

Возвращает информацию обо всех активных WebSocket-соединениях (public + trade + userData).

**Возврат:** `WebSocketConnectionInfo[]` — массив с `label`, `url`, `isConnected`, `type`, `subscriptionList`; опционально `messageCount` и `lastMessageTimestamp` (диагностика, в т.ч. Binance Futures public).

---

## 7. Жизненный цикл

### `close()`

```typescript
close(): Promise<void>
```

Закрывает все WebSocket-соединения (public stream, trade stream, user data stream).

```typescript
await exchange.close(); // закрывает и futures, и spot
```

---

## Типы

### Enums

#### `ExchangeNameEnum`

```typescript
enum ExchangeNameEnum {
  Binance = 'binance',
  Bybit = 'bybit',
}
```

#### `OrderSideEnum`

```typescript
enum OrderSideEnum {
  Buy = 'buy',
  Sell = 'sell',
}
```

#### `OrderTypeEnum`

```typescript
enum OrderTypeEnum {
  Market = 'market',
  Limit = 'limit',
  StopMarket = 'stopMarket',
  StopLimit = 'stopLimit',
  TakeProfitMarket = 'takeProfitMarket',
  TakeProfitLimit = 'takeProfitLimit',
  Stop = 'stop',
  TakeProfit = 'takeProfit',
  TrailingStop = 'trailingStop',
}
```

#### `TriggerByEnum`

```typescript
enum TriggerByEnum {
  MarkPrice = 'markPrice',
  LastPrice = 'lastPrice',
  IndexPrice = 'indexPrice',
}
```

#### `OrderFilterEnum`

```typescript
enum OrderFilterEnum {
  Order = 'Order',
  TpslOrder = 'tpslOrder',
  StopOrder = 'StopOrder',
}
```

#### `MarketUnitEnum`

```typescript
enum MarketUnitEnum {
  BaseCoin = 'baseCoin',
  QuoteCoin = 'quoteCoin',
}
```

#### `MarginModeEnum`

```typescript
enum MarginModeEnum {
  Isolated = 'isolated',
  Cross = 'cross',
}
```

#### `PositionSideEnum`

```typescript
enum PositionSideEnum {
  Long = 'long',
  Short = 'short',
  Both = 'both',
}
```

#### `PositionModeEnum`

```typescript
enum PositionModeEnum {
  Hedge = 'hedge',
  OneWay = 'oneWay',
}
```

#### `TradeSymbolTypeEnum`

```typescript
enum TradeSymbolTypeEnum {
  Spot = 'spot',
  Swap = 'swap',
  Future = 'future',
}
```

#### `TimeInForceEnum`

```typescript
enum TimeInForceEnum {
  Gtc = 'GTC',
  Ioc = 'IOC',
  Fok = 'FOK',
  PostOnly = 'PostOnly',
}
```

#### `WorkingTypeEnum`

```typescript
enum WorkingTypeEnum {
  MarkPrice = 'markPrice',
  ContractPrice = 'contractPrice',
}
```

#### `MarketTypeEnum`

```typescript
enum MarketTypeEnum {
  Futures = 'futures',
  Spot = 'spot',
}
```

#### `WebSocketConnectionTypeEnum`

```typescript
enum WebSocketConnectionTypeEnum {
  Public = 'public',
  Trade = 'trade',
  UserData = 'userData',
}
```

---

### Data Interfaces

#### `Ticker`

```typescript
interface Ticker {
  symbol: string;
  lastPrice: number;
  openPrice: number;
  highPrice: number;
  lowPrice: number;
  priceChangePercent: number;
  volume: number;
  quoteVolume: number;
  timestamp: number;
  markPrice?: number;
  indexPrice?: number;
  fundingRate?: number;
  nextFundingTime?: number;
}
```

Опциональные поля `markPrice`, `indexPrice`, `fundingRate`, `nextFundingTime` заполняются Bybit tickers для linear-контрактов — Binance их не возвращает в tickers-эндпоинте (используйте `fetchMarkPrice` отдельно).

#### `Kline`

```typescript
interface Kline {
  openTimestamp: number;
  openPrice: number;
  highPrice: number;
  lowPrice: number;
  closePrice: number;
  volume: number;
  closeTimestamp: number;
  quoteAssetVolume: number;
  numberOfTrades: number;
  takerBuyBaseAssetVolume: number;
  takerBuyQuoteAssetVolume: number;
  isClosed?: boolean;
}
```

#### `TradeSymbol`

```typescript
interface TradeSymbol {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  settle: string;
  isActive: boolean;
  type: TradeSymbolTypeEnum;
  isLinear: boolean;
  contractSize: number;
  contractType: string;
  filter: TradeSymbolFilter;
  leverageFilter?: LeverageFilter;
  priceLimitRisk?: PriceLimitRisk;
  pricePrecision?: number;
  quantityPrecision?: number;
  funding?: TradingFunding;
  launchTimestamp?: number;
  triggerProtect?: string;
  liquidationFee?: string;
  orderTypeList?: string[];
  timeInForceList?: string[];
  info?: Record<string, unknown>;
}
```

Опциональные поля заполняются по доступности данных у биржи:
- `leverageFilter`, `funding`, `priceLimitRisk` — preferably Bybit linear, частично Binance futures (`priceLimitRisk` → `PERCENT_PRICE` / `PERCENT_PRICE_BY_SIDE`)
- `pricePrecision`, `quantityPrecision`, `triggerProtect`, `liquidationFee`, `orderTypeList`, `timeInForceList` — Binance futures
- `launchTimestamp` — Bybit `launchTime`, Binance `onboardDate`
- `info` — сырой payload биржи (для доступа к специфичным полям без кастомных нормализаторов)

#### `TradeSymbolFilter`

```typescript
interface TradeSymbolFilter {
  tickSize: string;
  stepSize: string;
  minQty: string;
  maxQty: string;
  minNotional: string;
  minPrice?: string;
  maxPrice?: string;
  maxNotional?: string;
  marketMinQty?: string;
  marketMaxQty?: string;
  marketStepSize?: string;
  postOnlyMaxQty?: string;
}
```

#### `LeverageFilter`

```typescript
interface LeverageFilter {
  minLeverage: string;
  maxLeverage: string;
  leverageStep: string;
}
```

#### `PriceLimitRisk`

```typescript
type PriceLimitRisk =
  | {
      source: 'binancePercentPrice';
      multiplierUp: string;
      multiplierDown: string;
      multiplierDecimal: string;
    }
  | {
      source: 'binancePercentPriceBySide';
      bidMultiplierUp: string;
      bidMultiplierDown: string;
      askMultiplierUp: string;
      askMultiplierDown: string;
      avgPriceMins: number;
    }
  | {
      source: 'bybitRiskParameters';
      priceLimitRatioX: string;
      priceLimitRatioY: string;
    };
```

Дискриминированное объединение по полю `source` — форма payload отличается между биржами.

#### `TradingFunding`

```typescript
interface TradingFunding {
  fundingIntervalMinutes?: number;
  upperFundingRate?: string;
  lowerFundingRate?: string;
}
```

#### `Position`

```typescript
interface Position {
  symbol: string;
  side: PositionSideEnum;
  contracts: number;
  entryPrice: number;
  markPrice: number;
  unrealizedPnl: number;
  leverage: number;
  marginMode: MarginModeEnum;
  liquidationPrice: number;
  info: Record<string, unknown>; // raw-данные биржи
}
```

#### `Order`

```typescript
interface Order {
  id: string;
  clientOrderId: string;
  symbol: string;
  side: OrderSideEnum;
  type: OrderTypeEnum;
  timeInForce: TimeInForceEnum;
  price: number;
  avgPrice: number;
  stopPrice: number;
  amount: number;
  filledAmount: number;
  filledQuoteAmount: number;
  status: string; // 'open' | 'closed' | 'canceled' | 'rejected'
  reduceOnly: boolean;
  timestamp: number;
  updatedTimestamp: number;
}
```

#### `Balance`

```typescript
interface Balance {
  asset: string;
  free: number;
  locked: number;
  total: number;
  walletBalance?: number;
  availableToWithdraw?: number;
  totalOrderInitialMargin?: number;
  totalPositionInitialMargin?: number;
}
```

Опциональные поля заполняются Bybit Unified Account (`normalizeBybitBalances`).

#### `AccountBalances`

```typescript
interface AccountBalances {
  totalWalletBalance: number;
  totalAvailableBalance: number;
  balanceByAsset: BalanceByAsset;
  accountType?: string;
  totalMarginBalance?: number;
  totalInitialMargin?: number;
}
```

#### `FundingRateHistory`

```typescript
interface FundingRateHistory {
  symbol: string;
  fundingRate: number;
  fundingTime: number;
  markPrice: number | null;
}
```

#### `FundingInfo`

```typescript
interface FundingInfo {
  symbol: string;
  fundingIntervalHours: number;
  adjustedFundingRateCap: number;
  adjustedFundingRateFloor: number;
}
```

#### `OrderBook`

```typescript
interface OrderBook {
  symbol: string;
  askList: OrderBookLevel[];
  bidList: OrderBookLevel[];
  timestamp: number;
  updateId?: number;
  eventTimestamp?: number;
}
```

- `updateId` — Binance `lastUpdateId`, Bybit `u`
- `eventTimestamp` — Binance `E` (event time), Bybit не возвращает

#### `OrderBookLevel`

```typescript
interface OrderBookLevel {
  price: number;
  quantity: number;
}
```

#### `PublicTrade`

```typescript
interface PublicTrade {
  id: string;
  symbol: string;
  price: number;
  quantity: number;
  quoteQuantity: number;
  timestamp: number;
  isBuyerMaker: boolean;
  isBlockTrade?: boolean;
  side?: OrderSideEnum;
}
```

`isBlockTrade` и `side` заполняются Bybit (`execId`-based трейды).

#### `MarkPrice`

```typescript
interface MarkPrice {
  symbol: string;
  markPrice: number;
  indexPrice: number;
  lastFundingRate: number;
  nextFundingTime: number;
  timestamp: number;
}
```

REST `fetchMarkPrice` и связанные нормализаторы. Для WebSocket используйте `MarkPriceUpdate`.

#### `MarkPriceUpdate`

```typescript
interface MarkPriceUpdate {
  symbol: string;
  markPrice: number;
  indexPrice: number;
  timestamp: number;
}
```

Потоковые обновления из `subscribeMarkPrices` (без полей funding).

#### `MarkPriceHandler`

```typescript
type MarkPriceHandler = (markPriceList: MarkPriceUpdate[]) => void;
```

#### `OpenInterest`

```typescript
interface OpenInterest {
  symbol: string;
  openInterest: number;
  timestamp: number;
}
```

#### `FeeRate`

```typescript
interface FeeRate {
  symbol: string;
  makerRate: number;
  takerRate: number;
}
```

#### `Income`

```typescript
interface Income {
  symbol: string;
  incomeType: string;
  income: number;
  asset: string;
  timestamp: number;
  info: Record<string, unknown>;
  quantity?: number;
}
```

`quantity` заполняется Bybit transaction log (`qty`). Binance futures income не содержит этого поля.

#### `ClosedPnl`

```typescript
interface ClosedPnl {
  symbol: string;
  orderId: string;
  side: OrderSideEnum;
  quantity: number;
  entryPrice: number;
  exitPrice: number;
  closedPnl: number;
  timestamp: number;
}
```

#### `WebSocketConnectionInfo`

```typescript
interface WebSocketConnectionInfo {
  label: string;
  url: string;
  isConnected: boolean;
  type: WebSocketConnectionTypeEnum;
  subscriptionList: string[];
  messageCount?: number;
  lastMessageTimestamp?: number;
}
```

#### `OrderUpdateEvent`

```typescript
interface OrderUpdateEvent {
  symbol: string;
  orderId: string;
  clientOrderId: string;
  side: OrderSideEnum;
  status: string;
  price: number;
  avgPrice: number;
  amount: number;
  filledAmount: number;
  timestamp: number;
}
```

#### `PositionUpdateEvent`

```typescript
interface PositionUpdateEvent {
  symbol: string;
  side: string;
  size: number;
  entryPrice: number;
  markPrice: number;
  unrealisedPnl: number;
  leverage: number;
  liquidationPrice: number;
  positionSide: string;
  timestamp: number;
}
```

#### `UserDataStreamHandlerArgs`

```typescript
interface UserDataStreamHandlerArgs {
  onOrderUpdate: OrderUpdateHandler;
  onPositionUpdate: PositionUpdateHandler;
}

type OrderUpdateHandler = (event: OrderUpdateEvent) => void;
type PositionUpdateHandler = (event: PositionUpdateEvent) => void;
```

---

### Collection Types

```typescript
type TickerBySymbol = Map<string, Ticker>;
type TradeSymbolBySymbol = Map<string, TradeSymbol>;
type BalanceByAsset = Map<string, Balance>;
```

---

### Configuration Types

#### `ExchangeConfig`

```typescript
interface ExchangeConfig {
  apiKey: string;
  secret: string;
  recvWindow?: number;
  isDemoMode?: boolean;
  httpsAgent?: unknown;
}
```

#### `ExchangeLogger`

```typescript
interface ExchangeLogger {
  debug(message: string, ...args: unknown[]): void;
  debug(obj: Record<string, unknown>, message: string): void;
  info(message: string, ...args: unknown[]): void;
  info(obj: Record<string, unknown>, message: string): void;
  warn(message: string, ...args: unknown[]): void;
  warn(obj: Record<string, unknown>, message: string): void;
  error(message: string, ...args: unknown[]): void;
  error(obj: Record<string, unknown>, message: string): void;
  fatal(message: string, ...args: unknown[]): void;
  fatal(obj: Record<string, unknown>, message: string): void;
}
```

#### `ExchangeArgs`

```typescript
interface ExchangeArgs {
  config: ExchangeConfig;
  logger: ExchangeLogger;
  onNotify?: (message: string) => void | Promise<void>;
}
```

---

### Args Types

#### `CreateOrderWebSocketArgs`

```typescript
interface CreateOrderWebSocketArgs {
  symbol: string;
  type: OrderTypeEnum;
  side: OrderSideEnum;
  amount: number;
  price?: number;
  stopPrice?: number;
  triggerDirection?: 1 | 2;
  triggerBy?: TriggerByEnum;
  closePosition?: boolean;
  workingType?: WorkingTypeEnum;
  positionSide?: PositionSideEnum;
  reduceOnly?: boolean;
  closeOnTrigger?: boolean;
  timeInForce?: TimeInForceEnum;
  clientOrderId?: string;
  orderFilter?: OrderFilterEnum;
  marketUnit?: MarketUnitEnum;
  trailingDelta?: number;
  quoteOrderQty?: number;
}
```

#### `FetchPageWithLimitArgs`

```typescript
interface FetchPageWithLimitArgs {
  startTime?: number;
  endTime?: number;
  limit?: number;
}
```

#### `FetchAllKlinesOptions`

```typescript
interface FetchAllKlinesOptions {
  chunkSize?: number;
  pauseBetweenChunksMs?: number;
  trimLastKline?: boolean;
  onChunkLoaded?: (chunkResult: Map<string, Kline[]>) => void;
}
```

#### `ModifyOrderArgs`

```typescript
interface ModifyOrderArgs {
  symbol: string;
  orderId: string;
  price?: number;
  amount?: number;
  triggerPrice?: number;
}
```

#### `SubscribeKlinesArgs`

```typescript
interface SubscribeKlinesArgs {
  symbol: string;
  interval: KlineInterval;
  handler: KlineHandler;
}
```

#### `KlineHandler`

```typescript
type KlineHandler = (symbol: string, kline: Kline) => void;
```

---

### Literal Types

#### `KlineInterval`

```typescript
type KlineInterval =
  | '1s' | '1m' | '3m' | '5m' | '15m' | '30m'
  | '1h' | '2h' | '4h' | '6h' | '12h'
  | '1d' | '3d' | '1w' | '1M';
```

---

### Runtime Constants

```typescript
const MARKET_TYPE_LIST: MarketTypeEnum[] = [MarketTypeEnum.Futures, MarketTypeEnum.Spot];
```

---

### Error Class

#### `ExchangeError`

```typescript
class ExchangeError extends Error {
  readonly code: number | string;
  readonly exchange: string;

  constructor(message: string, code: number | string, exchange: string);
}
```

Выбрасывается при ошибках API биржи. Поле `code` содержит код ошибки биржи, `exchange` — имя биржи.

```typescript
import { ExchangeError } from '@solncebro/exchange-engine';

try {
  await futures.createOrderWebSocket(args);
} catch (error) {
  if (error instanceof ExchangeError) {
    console.log(error.code, error.exchange, error.message);
  }
}
```
