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

## binanceNormalizer.ts — все raw-типы и функции

### Raw-интерфейсы (export):
- `BinanceExchangeInfoRaw` — `{ symbols: BinanceSymbolRaw[] }`
- `BinanceTicker24hrRaw` — `{ symbol, lastPrice, openPrice, highPrice, lowPrice, priceChangePercent, volume, quoteVolume, time }`
- `BinanceWebSocketKlineRaw` — `{ t, o, h, l, c, v, T, q, n, V, Q, i?, f?, L?, x, B? }` (короткие ключи, `x: boolean` — isClosed)
- `BinanceContinuousKlineMessageRaw` — `{ e, E, ps, ct, k: BinanceWebSocketKlineRaw }`
- `BinancePositionRiskRaw` — `{ symbol, positionSide, positionAmt, entryPrice, markPrice, unRealizedProfit, leverage, marginType, liquidationPrice, notional, isolatedMargin, [key: string]: unknown }`
- `BinanceOrderResponseRaw` — `{ orderId, clientOrderId, symbol, side, type, timeInForce, origQty, executedQty, price, avgPrice, stopPrice, cumQuote, status, reduceOnly, time, updateTime }`
- `BinanceAccountRaw` — `{ balances: BinanceBalanceRaw[] }` (BinanceBalanceRaw — internal: `{ asset, free, locked }`)
- `BinanceFuturesAccountRaw` — `{ assets: BinanceFuturesAssetRaw[] }` (BinanceFuturesAssetRaw — internal: `{ asset, walletBalance, availableBalance }`)
- `BinanceFundingRateHistoryRaw` — `{ symbol, fundingRate, fundingTime, markPrice }`
- `BinanceFundingInfoRaw` — `{ symbol, adjustedFundingRateCap, adjustedFundingRateFloor, fundingIntervalHours }`

### Функции нормализации:
- `normalizeBinanceTradeSymbols(raw)` → `TradeSymbolBySymbol` (Map)
  - Извлекает фильтры: PRICE_FILTER (tickSize), LOT_SIZE (stepSize, minQty, maxQty), MIN_NOTIONAL/NOTIONAL
  - Определяет тип: PERPETUAL → Swap, пустой/отсутствует contractType → Spot, остальное → Future
- `normalizeBinanceTickers(rawList)` → `TickerBySymbol` (Map)
- `normalizeBinanceKlines(rawList)` → `Kline[]` — массив массивов → массив объектов, parseFloat для строк
- `normalizeBinanceKlineWebSocketMessage(raw)` → `Kline` — маппинг коротких ключей, `raw.x → isClosed`
- `normalizeBinancePosition(raw)` → `Position`
  - Маппинг через `BINANCE_POSITION_SIDE` (LONG→long, SHORT→short, BOTH→both)
  - `marginType === 'ISOLATED' ? MarginModeEnum.Isolated : MarginModeEnum.Cross`
  - NaN liquidationPrice → 0
  - Сохраняет raw в `info`
- `normalizeBinanceOrder(raw)` → `Order`
  - Маппинг через `BINANCE_ORDER_SIDE`, `BINANCE_ORDER_TYPE` и `BINANCE_ORDER_STATUS` (константы из `src/constants/mappings.ts`)
  - `orderId` number → string
- `normalizeBinanceBalance(raw)` → `BalanceByAsset` (Map)
  - Пропускает нулевые балансы (`free + locked === 0`)
- `normalizeBinanceFuturesBalance(raw)` → `BalanceByAsset` (Map)
  - Отдельная функция для фьючерсного баланса — использует `walletBalance`/`availableBalance` вместо `free`/`locked`
  - Пропускает записи с `walletBalance === 0`
  - `free = availableBalance`, `locked = walletBalance - availableBalance`, `total = walletBalance`
- `normalizeBinanceFundingRateHistory(rawList)` → `FundingRateHistory[]`
  - Пустой markPrice → `null`
- `normalizeBinanceFundingInfo(rawList)` → `FundingInfo[]`
  - parseFloat для строковых чисел, fundingIntervalHours уже number

## bybitNormalizer.ts — все raw-типы и функции

Тот же паттерн, но с Bybit-специфичными полями и маппингами.

### Bybit Raw-типы (export):

REST:
- `BybitInstrumentInfoRaw` — `{ symbol, status, baseCoin, quoteCoin, settleCoin?, contractType?, contractSize?, lotSizeFilter?, priceFilter? }`
- `BybitTickerRaw` — `{ symbol, lastPrice, prevPrice24h, highPrice24h, lowPrice24h, price24hPcnt, volume24h, turnover24h, time? }`
- `BybitPositionRaw` — `{ symbol, side, size, avgPrice, markPrice, unrealisedPnl, leverage, tradeMode, liqPrice, positionIdx, [key: string]: unknown }`
- `BybitOrderResponseRaw` — `{ orderId, orderLinkId, symbol, side, orderType, timeInForce, qty, price, avgPrice, triggerPrice, cumExecQty, cumExecValue, orderStatus, reduceOnly, createdTime, updatedTime }`
- `BybitWalletBalanceRaw` — `{ list: BybitAccountRaw[] }` (BybitAccountRaw — internal: `{ accountType, coin: BybitCoinRaw[] }`)

WebSocket:
- `BybitWebSocketKlineRaw` — `{ start, end?, interval?, open, high, low, close, volume, turnover, confirm: boolean, timestamp }`
- `BybitPublicTradeDataRaw` — `{ T: number, s: string, p: string, v: string }`
- `BybitWebSocketMessageRaw<T>` — `{ topic, type, ts, data: T[] }`
- `BybitKlineMessageRaw` = `BybitWebSocketMessageRaw<BybitWebSocketKlineRaw>`
- `BybitTradeMessageRaw` = `BybitWebSocketMessageRaw<BybitPublicTradeDataRaw>`

### Функции нормализации:
- `normalizeBybitTradeSymbols(rawList)` → `TradeSymbolBySymbol` (Map)
  - LinearPerpetual/LinearFutures → Swap, пустой contractType → Spot, остальное → Future
  - `stepSize` берётся из `qtyStep` (linear) или `basePrecision` (spot)
  - `minNotional` берётся из `minNotionalValue` или `minOrderAmt`
- `normalizeBybitTickers(rawList)` → `TickerBySymbol` (Map)
  - `priceChangePercent` умножается на 100 (Bybit отдаёт долю, не проценты)
  - `timestamp` fallback на `Date.now()` если отсутствует
- `normalizeBybitKlines(rawList)` → `Kline[]` — массив строковых массивов → массив объектов, `closeTimestamp = 0`, `numberOfTrades = 0`
- `normalizeBybitKlineWebSocketMessage(raw)` → `Kline` — маппинг полей, `raw.confirm → isClosed`
- `normalizeBybitPosition(raw)` → `Position`
  - Маппинг через `BYBIT_POSITION_SIDE` (Buy→Long, Sell→Short), fallback → Both
  - `tradeMode === 0 ? Cross : Isolated`
  - NaN liquidationPrice → 0
  - Сохраняет raw в `info`
- `normalizeBybitOrder(raw)` → `Order`
  - Маппинг через `BYBIT_ORDER_SIDE`, `BYBIT_ORDER_TYPE`, `BYBIT_ORDER_STATUS`, `BYBIT_TIME_IN_FORCE`
  - `triggerPrice → stopPrice`, `cumExecValue → filledQuoteAmount`
  - timestamp через `parseFloat(raw.createdTime)`
- `buildBybitOrderFromCreateResponse(args, orderId)` → `Order`
  - Строит Order из `CreateOrderWebSocketArgs` + orderId, все filled-поля = 0, status = 'open'
- `normalizeBybitBalance(raw)` → `BalanceByAsset` (Map)
  - Итерирует по `raw.list[].coin[]`, агрегирует балансы если один coin встречается в нескольких accounts
  - `free = walletBalance - totalPositionIM - totalOrderIM`
  - `locked` = frozenAmount или locked, fallback `walletBalance - free`
  - Пропускает нулевые балансы (`free + locked === 0`)

## Унифицированные типы (src/types/common.ts)

### Enums:
- `ExchangeNameEnum` — Binance, Bybit
- `OrderSideEnum` — Buy, Sell
- `OrderTypeEnum` — Market, Limit, StopMarket, TakeProfitMarket, Stop, TakeProfit, TrailingStop
- `MarginModeEnum` — Isolated, Cross
- `PositionSideEnum` — Long, Short, Both
- `PositionModeEnum` — Hedge, OneWay
- `TradeSymbolTypeEnum` — Spot, Swap, Future
- `TimeInForceEnum` — Gtc, Ioc, Fok, PostOnly
- `WorkingTypeEnum` — MarkPrice, ContractPrice
- `MarketTypeEnum` — Futures, Spot
- `MARKET_TYPE_LIST: MarketTypeEnum[]` — `Object.values(MarketTypeEnum)`
- `WebSocketConnectionTypeEnum` — Public, Trade, UserData

### Конфигурация:
- `ExchangeConfig` — `{ apiKey, secret, recvWindow?, isDemoMode?, httpsAgent? }`

### Интерфейсы:
- `Ticker` — `{ symbol, lastPrice, openPrice, highPrice, lowPrice, priceChangePercent, volume, quoteVolume, timestamp }`
- `Kline` — `{ openTimestamp, openPrice, highPrice, lowPrice, closePrice, volume, closeTimestamp, quoteAssetVolume, numberOfTrades, takerBuyBaseAssetVolume, takerBuyQuoteAssetVolume, isClosed?: boolean }`
- `TradeSymbol` — `{ symbol, baseAsset, quoteAsset, settle, isActive, type, isLinear, contractSize, filter }`
- `TradeSymbolFilter` — `{ tickSize, stepSize, minQty, maxQty, minNotional }` (все string)
- `Position` — `{ symbol, side, contracts, entryPrice, markPrice, unrealizedPnl, leverage, marginMode, liquidationPrice, info }`
- `Order` — `{ id, clientOrderId, symbol, side, type, amount, price, avgPrice, stopPrice, filledAmount, filledQuoteAmount, status, timeInForce, reduceOnly, timestamp, updatedTimestamp }`
- `Balance` — `{ asset, free, locked, total }`
- `FundingRateHistory` — `{ symbol, fundingRate, fundingTime, markPrice: number | null }`
- `FundingInfo` — `{ symbol, fundingIntervalHours, adjustedFundingRateCap, adjustedFundingRateFloor }`
- `WebSocketConnectionInfo` — `{ label, url, isConnected, type: WebSocketConnectionTypeEnum, subscriptionList: string[] }`

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
BINANCE_ORDER_TYPE: { MARKET → Market, LIMIT → Limit, STOP_MARKET → StopMarket, TAKE_PROFIT_MARKET → TakeProfitMarket, STOP → Stop, TAKE_PROFIT → TakeProfit, TRAILING_STOP_MARKET → TrailingStop }
BINANCE_ORDER_TYPE_REVERSE: { market → 'MARKET', limit → 'LIMIT', stopMarket → 'STOP_MARKET', ... } (обратный маппинг)
BINANCE_ORDER_STATUS: { NEW → 'open', PARTIALLY_FILLED → 'open', FILLED → 'closed', CANCELED → 'canceled', REJECTED → 'rejected', EXPIRED → 'canceled', EXPIRED_IN_MATCH → 'canceled' }
BINANCE_TIME_IN_FORCE: { GTC → Gtc, IOC → Ioc, FOK → Fok, GTX → PostOnly }
BINANCE_WORKING_TYPE: { markPrice → 'MARK_PRICE', contractPrice → 'CONTRACT_PRICE' }
BYBIT_POSITION_SIDE: { Buy → Long, Sell → Short }
BYBIT_ORDER_SIDE: { Buy → Buy, Sell → Sell }
BYBIT_ORDER_TYPE: { Market → Market, Limit → Limit }
BYBIT_ORDER_STATUS: { New → 'open', PartiallyFilled → 'open', Untriggered → 'open', Filled → 'closed', Cancelled → 'canceled', PartiallyFilledCanceled → 'canceled', Rejected → 'rejected', Deactivated → 'canceled' }
BYBIT_TIME_IN_FORCE: { GTC → Gtc, IOC → Ioc, FOK → Fok, PostOnly → PostOnly }
```
