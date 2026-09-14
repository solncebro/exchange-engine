# Нормализаторы и типы

## Принцип

Raw-данные биржи определяются и остаются **только** в нормализаторах. Потребители работают с унифицированными типами из `src/types/common.ts`.

## Структура нормализатора

Каждый нормализатор содержит:
1. **Raw-интерфейсы** с суффиксом `Raw` — точное отражение API-ответа биржи
2. **Функции нормализации** с префиксом `normalize{Exchange}` — чистые функции `raw → unified`

Пример:
```
BinanceTicker24hrRaw { symbol, lastPrice: string, priceChangePercent: string, time }
  → normalizeBinanceTickers(rawList) → TickerBySymbol (Map<string, Ticker>)
```

## Нормализаторы по биржам

Разборы конкретных бирж вынесены в отдельные файлы (30k-лимит):

| Файл | Содержание |
|------|-----------|
| [normalizers-and-types-binance-bybit.md](normalizers-and-types-binance-bybit.md) | binanceNormalizer.ts и bybitNormalizer.ts: все raw-интерфейсы и функции нормализации |
| [normalizers-and-types-okx.md](normalizers-and-types-okx.md) | okxNormalizer.ts: raw-интерфейсы, функции нормализации, единицы контрактов |

## batchOrderOutcome.ts — общие сборщики исхода одной записи пачки

Живёт отдельно от всех бирж: правило общее.

- `buildPlacedOrderOutcome(order)` / `buildRejectedOrderOutcome(errorCode, errorText)` → `CreateOrderItemResult` —
  заявка считается поставленной ТОЛЬКО когда биржа вернула её номер; пустой номер, слово `undefined`
  вместо номера, отсутствующая запись — всё это отказ, а не успех (`MISSING_ORDER_ID_ERROR_TEXT`).
- `buildBatchItemResult<TResult>(orderId, entryStatus, rateLimit?)` → `CancelOrderItemResult` /
  `ModifyOrderItemResult` (0.25.0) — исход одной записи пачки на ОТМЕНУ или ПРАВКУ по ответу
  `retExtInfo.list[]`. `code === 0` — успех; поля объявлены обязательными, но приезжают с провода,
  поэтому проверяются по факту (`typeof`): запись без числового кода — отказ, а не молчаливый успех;
  текст по умолчанию `'Unknown error'`. Снимок предела частоты прикладывается только если передан
  (путь через торговый канал; обычные запросы заголовка не несут). Тип входа —
  `BatchEntryStatusRaw` (`batchOrderOutcome.types.ts`). Один сборщик на три места, где он был
  выписан слово в слово: `BybitTradeStream` (пачки на отмену и на правку), `BybitBaseClient.cancelBatchOrders`,
  `BybitBaseClient.modifyBatchOrders`. У OKX своя копия — `buildOkxBatchItemResult` в `okxNormalizer.ts`.

## Унифицированные типы (src/types/common.ts)

### Enums:
- `ExchangeNameEnum` — Binance, Bybit, Okx (0.25.0: третье значение)
- `OrderSideEnum` — Buy, Sell
- `OrderTypeEnum` — Market, Limit, StopMarket, StopLimit, TakeProfitMarket, TakeProfitLimit, Stop, TakeProfit, TrailingStop (0.13.0: добавлены `StopLimit`/`TakeProfitLimit`)
- `MarginModeEnum` — Isolated, Cross
- `PositionSideEnum` — Long, Short, Both
- `PositionModeEnum` — Hedge, OneWay
- `TradeSymbolTypeEnum` — Spot, Swap, Future
- `TimeInForceEnum` — Gtc, Ioc, Fok, PostOnly
- `WorkingTypeEnum` — MarkPrice, ContractPrice
- `TriggerByEnum` — MarkPrice, LastPrice, IndexPrice (0.13.0; conditional/stop ордера на Bybit Linear)
- `OrderFilterEnum` — Order, tpslOrder, StopOrder (0.13.0; Bybit Spot conditional/TPSL filter)
- `MarketUnitEnum` — baseCoin, quoteCoin (0.13.0; Bybit Spot Market amount unit)
- `MarketTypeEnum` — Futures, Spot
- `MARKET_TYPE_LIST: MarketTypeEnum[]` — `Object.values(MarketTypeEnum)`
- `WebSocketConnectionTypeEnum` — Public, Trade, UserData
- `IncomeKind` — `'realizedPnl' | 'commission' | 'funding' | 'other'` (тип-литерал, не enum); `IncomeTypeFilter` (`types/exchange.ts`) — то же без `'other'`
- `OrderRateLimitSource` (`types/exchange.ts`) — `'binance-exchange-info' | 'bybit-exchange-header' | 'bybit-documented' | 'okx-documented' | 'fallback'`

### Конфигурация:
- `ExchangeConfig` — `{ apiKey, secret, passphrase?, recvWindow?, isDemoMode?, httpsAgent?, publicStreamConnectionPacking?, lazyOrderbookParse? }`. `passphrase` читает ТОЛЬКО OKX, и для него оно обязательно: пустое значение — `ExchangeError('OKX_PASSPHRASE_REQUIRED')` в конструкторе клиента

### Интерфейсы:
- `Ticker` — `{ symbol, lastPrice, openPrice, highPrice, lowPrice, priceChangePercent, volume, quoteVolume, timestamp, markPrice?, indexPrice?, bid1Price?, bid1Size?, ask1Price?, ask1Size?, fundingRate?, nextFundingTime? }` (последние 8 полей заполняются Bybit tickers, когда биржа их прислала)
- `Kline` — `{ openTimestamp, openPrice, highPrice, lowPrice, closePrice, volume, closeTimestamp, quoteAssetVolume, numberOfTrades, takerBuyBaseAssetVolume, takerBuyQuoteAssetVolume, isClosed?: boolean }`
- `TradeSymbol` — `{ symbol, baseAsset, quoteAsset, settle, isActive, type, isLinear, contractSize, contractType, isTradifi, filter, leverageFilter?, priceLimitRisk?, pricePrecision?, quantityPrecision?, funding?, launchTimestamp?, triggerProtect?, liquidationFee?, orderTypeList?, timeInForceList?, info? }`
- `TradeSymbolFilter` — `{ tickSize, stepSize, minQty, maxQty, minNotional, minPrice?, maxPrice?, maxNotional?, marketMinQty?, marketMaxQty?, marketStepSize?, postOnlyMaxQty? }` (все string)
- `LeverageFilter` — `{ minLeverage, maxLeverage, leverageStep }` (все string)
- `PriceLimitRisk` — дискриминированное объединение по `source`:
  - `'binancePercentPrice'` — `{ multiplierUp, multiplierDown, multiplierDecimal }`
  - `'binancePercentPriceBySide'` — `{ bidMultiplierUp, bidMultiplierDown, askMultiplierUp, askMultiplierDown, avgPriceMins }`
  - `'bybitRiskParameters'` — `{ priceLimitRatioX, priceLimitRatioY }`
- `TradingFunding` — `{ fundingIntervalMinutes?, upperFundingRate?, lowerFundingRate? }`
- `Position` — `{ symbol, side, direction: 'long' | 'short' | null, contracts, entryPrice, markPrice, unrealizedPnl, leverage, marginMode, liquidationPrice, positionIdx?, info }`
- `Order` — `{ id, clientOrderId, symbol, side, type, amount, price, avgPrice, stopPrice, filledAmount, filledQuoteAmount, status, timeInForce, reduceOnly, timestamp, updatedTimestamp, rateLimit?: OrderRateLimitSnapshot, isConditional?, triggeredOrderId? }`. Поле `rateLimit?` опциональное — заполняется только для одиночных order-операций через WebSocket Trade Stream. `isConditional?`/`triggeredOrderId?` заполняет OKX: условные заявки живут в отдельной службе биржи, и номер порождённой обычной заявки нужен, чтобы дочитать фактическое исполнение.
- `OrderRateLimitSnapshot` — `{ limit: number; remaining: number; resetMs: number }`. Per-response runtime snapshot per-UID rate-limit, извлечённый из заголовков ответа на одиночный `createOrder` через WS. Bybit: парсится из `header['X-Bapi-Limit' / 'X-Bapi-Limit-Status' / 'X-Bapi-Limit-Reset-Timestamp']` через `parseBybitHeaderRateLimit`. Binance: из массива `message.rateLimits[]` (поиск entry с `rateLimitType === 'ORDERS' && interval === 'SECOND'`) через `parseBinanceRateLimitArray`, `remaining = limit - count`, `resetMs = Date.now() + intervalNum * 1000`. Отличается от `OrderRateLimit` (см. `getOrderRateLimit()`): тот возвращает статический per-UID лимит из exchange-info, этот — runtime snapshot после конкретной операции.
- `Balance` — `{ asset, free, locked, total, walletBalance?, availableToWithdraw?, totalOrderInitialMargin?, totalPositionInitialMargin?, usdValue? }` (опциональные поля — Bybit Unified Account). `free`/`locked`/`total` — в единицах САМОЙ монеты, монеты между собой складывать нельзя (иначе биткойн весит как доллар — инцидент 29.08.2026); `usdValue?` — единственная величина, допустимая для свода по счёту
- `AccountBalances` — `{ totalWalletBalance, totalAvailableBalance, balanceByAsset, accountType?, totalMarginBalance?, totalInitialMargin?, availableBalanceSource? }`. `availableBalanceSource` — `'exchange'` (готовое поле биржи) / `'derived'` (выведено из остатка и занятой маржи) / `'unknown'` (посчитать нечем, число нулевое и фактом не является) — потребитель обязан различать факт и расчёт
- `FundingRateHistory` — `{ symbol, fundingRate, fundingTime, markPrice: number | null }`
- `FundingInfo` — `{ symbol, fundingIntervalHours, adjustedFundingRateCap, adjustedFundingRateFloor }`
- `WebSocketConnectionInfo` — `{ label, url, isConnected, type: WebSocketConnectionTypeEnum, subscriptionList: string[] }`
- `OrderBookLevel` — `{ price, quantity }` (оба number)
- `OrderBook` — `{ symbol, askList: OrderBookLevel[], bidList: OrderBookLevel[], timestamp, updateId?, eventTimestamp? }` (`updateId` — Binance `lastUpdateId` / Bybit `u`; `eventTimestamp` — Binance `E`)
- `OrderBookRawLevel` — `[string, string]` — пара `[price, quantity]` как сырые decimal-строки без потери точности (для WS-обновлений orderbook)
- `OrderBookUpdateType` — `'snapshot' | 'delta'`
- `OrderBookUpdate` — `{ symbol, updateType: OrderBookUpdateType, bidList: OrderBookRawLevel[], askList: OrderBookRawLevel[], updateId, eventTimestamp, receivedTimestamp }` (WS payload Bybit V5 — отличается от `OrderBook` тем, что уровни хранятся как строки)
- `OrderBookHandler` — `(symbol: string, update: OrderBookUpdate) => void`
- `RawOrderbookFrame` — `{ symbol, raw: string, receivedTimestamp }` — сырой (не распарсенный) orderbook-кадр Bybit; `raw` — исходный текст WS-сообщения целиком
- `RawOrderbookHandler` — `(frame: RawOrderbookFrame) => void`
- `PublicTrade` — `{ id, symbol, price, quantity, quoteQuantity, timestamp, isBuyerMaker, isBlockTrade?, side? }` (`isBlockTrade` и `side` — Bybit)
- `PublicTradeHandler` — `(symbol: string, tradeList: PublicTrade[]) => void`
- `MarkPrice` — `{ symbol, markPrice, indexPrice?, lastFundingRate, nextFundingTime, timestamp }` (`indexPrice` отсутствует, если биржа его не прислала — у OKX ручка цены маркировки индекс не отдаёт; ноль-заглушка недопустима)
- `MarkPriceUpdate` — `{ symbol, markPrice, indexPrice?, timestamp }` (потоковые обновления mark/index, без funding-полей; `indexPrice` отсутствует, пока индекс ни разу не приходил — у OKX канал цены маркировки индекса не несёт вовсе)
- `MarkPriceHandler` — `(markPriceList: MarkPriceUpdate[]) => void`
- `OpenInterest` — `{ symbol, openInterest, timestamp }`
- `FeeRate` — `{ symbol, makerRate, takerRate }`
- `Income` — `{ symbol, incomeType, kind: IncomeKind, income, asset, timestamp, info: Record<string, unknown>, quantity? }`. `incomeType` — строка биржи, приведённая к общему виду; `kind` — разряд записи для потребителя (`'realizedPnl' | 'commission' | 'funding' | 'other'`), по которому можно ветвиться, не разбирая строку
- `ClosedPnl` — `{ symbol, orderId, side: OrderSideEnum, quantity, entryPrice, exitPrice, closedPnl, timestamp }`. `closedPnl` — чистый итог после торговых комиссий (открытия и закрытия), БЕЗ фандинга на всех трёх биржах: тождество «валовой − closedPnl = комиссии» держится у Binance, Bybit и OKX; фандинг — отдельный поток (`fetchIncome`, `incomeType: 'funding'`)
- `ModifyBatchOrderArgs` — `{ symbol, orderId, side: OrderSideEnum, clientOrderId?, price?, amount?, triggerPrice? }`. `side` обязателен (требуется для Binance PUT batch); `clientOrderId` → Bybit `orderLinkId` / Binance `origClientOrderId`.
- `CancelOrderItemResult` — `{ orderId, isSuccess, errorCode: number | null, errorText: string | null }`
- `CancelBatchOrdersResult = CancelOrderItemResult[]`
- `ModifyOrderItemResult` — `{ orderId, isSuccess, errorCode: number | null, errorText: string | null }` (симметрично `CancelOrderItemResult`)
- `ModifyBatchOrdersResult = ModifyOrderItemResult[]`
- `SetLeverageResult` — `{ confirmedLeverage: number | null }`. То, что биржа ФАКТИЧЕСКИ подтвердила на установку плеча (не эхо запроса): Binance — из числового поля ответа `/fapi/v1/leverage`, Bybit — эхо запроса (значения не возвращает, но принятая установка и no-op `110043` обе означают «стоит запрошенное»). `null` — ответ пришёл без ошибки, но без пригодного числа

### Collection types (Map с "By" naming):
- `TickerBySymbol = Map<string, Ticker>`
- `TradeSymbolBySymbol = Map<string, TradeSymbol>`
- `BalanceByAsset = Map<string, Balance>`

### ExchangeLogger (overloaded signatures):
- `logger.info(message: string)` — простое сообщение
- `logger.info(context: Record<string, unknown>, message: string)` — сообщение с контекстным объектом
- Аналогично для `debug`, `warn`, `error`, `fatal`

### Тип-литерал:
- `KlineInterval` — union `'1s' | '1m' | '3m' | '5m' | '15m' | '30m' | '1h' | '2h' | '4h' | '6h' | '12h' | '1d' | '3d' | '1w' | '1M'`

## Маппинги (src/constants/mappings.ts)

```
BINANCE_POSITION_SIDE: { LONG → Long, SHORT → Short, BOTH → Both }
BINANCE_ORDER_SIDE: { BUY → Buy, SELL → Sell }
BINANCE_ORDER_SIDE_REVERSE: { Buy → 'BUY', Sell → 'SELL' } (обратный маппинг; используется в build-функциях batch-payload для Binance)
BINANCE_ORDER_TYPE: { MARKET → Market, LIMIT → Limit, STOP_MARKET → StopMarket, TAKE_PROFIT_MARKET → TakeProfitMarket, STOP → Stop, TAKE_PROFIT → TakeProfit, TRAILING_STOP_MARKET → TrailingStop }
BINANCE_ORDER_TYPE_REVERSE: { market → 'MARKET', limit → 'LIMIT', stopMarket → 'STOP_MARKET', ... } (обратный маппинг)
BINANCE_ORDER_STATUS: { NEW → 'open', PARTIALLY_FILLED → 'open', FILLED → 'closed', CANCELED → 'canceled', REJECTED → 'rejected', EXPIRED → 'canceled', EXPIRED_IN_MATCH → 'canceled' }
BINANCE_TIME_IN_FORCE: { GTC → Gtc, IOC → Ioc, FOK → Fok, GTX → PostOnly }
BINANCE_FUTURES_TIME_IN_FORCE_REVERSE: { Gtc → 'GTC', Ioc → 'IOC', Fok → 'FOK', PostOnly → 'GTX' } (build-маппинг для Binance futures; spot post-only выражается типом LIMIT_MAKER, не TIF)
BINANCE_WORKING_TYPE: { markPrice → 'MARK_PRICE', contractPrice → 'CONTRACT_PRICE' }
BYBIT_POSITION_SIDE: { Buy → Long, Sell → Short }
BYBIT_ORDER_SIDE: { Buy → Buy, Sell → Sell }
BYBIT_ORDER_TYPE: { Market → Market, Limit → Limit }
BYBIT_ORDER_STATUS: { New → 'open', PartiallyFilled → 'open', Untriggered → 'open', Triggered → 'open', Filled → 'closed', Cancelled → 'canceled', PartiallyFilledCanceled → 'canceled', Rejected → 'rejected', Deactivated → 'canceled' }
BYBIT_TIME_IN_FORCE: { GTC → Gtc, IOC → Ioc, FOK → Fok, PostOnly → PostOnly }
OKX_ORDER_SIDE: { buy → Buy, sell → Sell }
OKX_ORDER_SIDE_REVERSE: { Buy → 'buy', Sell → 'sell' }
OKX_POSITION_SIDE: { long → Long, short → Short, net → Both }
OKX_POSITION_IDX: { net → 0, long → 1, short → 2 }
OKX_ORDER_STATUS: { live → 'open', partially_filled → 'open', filled → 'closed', canceled → 'canceled', mmp_canceled → 'canceled' }
OKX_ALGO_STATUS: { live → 'open', pause → 'open', partially_effective → 'open', effective → 'open', canceled → 'canceled', order_failed → 'rejected', partially_failed → 'rejected' }
  (сработавшая условная заявка — ОТКРЫТА, как `TRIGGERED` у Binance и `Triggered` у Bybit: срабатывание ещё не исполнение)
OKX_ORDER_TYPE_BY_TIME_IN_FORCE: { Gtc → 'limit', PostOnly → 'post_only', Ioc → 'ioc', Fok → 'fok' }  // срок действия у OKX закодирован в типе заявки
OKX_ORD_TYPE_TO_ORDER_TYPE: { market → Market, limit/post_only/ioc/fok → Limit, optimal_limit_ioc → Market }
OKX_ORD_TYPE_TO_TIME_IN_FORCE: { limit → Gtc, post_only → PostOnly, ioc → Ioc, fok → Fok, market → Gtc, optimal_limit_ioc → Ioc }
OKX_TRIGGER_PX_TYPE: { markPrice → 'mark', lastPrice → 'last', indexPrice → 'index' }
OKX_WORKING_TYPE_TRIGGER_PX_TYPE: { markPrice → 'mark', contractPrice → 'last' }
OKX_INCOME_BILL_TYPE: { funding → '8', realizedPnl → '2', commission → '2' }
```
