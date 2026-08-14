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
- `BinancePositionRiskRaw` — `{ symbol, positionSide, positionAmt, entryPrice, markPrice, unRealizedProfit, leverage?, marginType, liquidationPrice, notional, isolatedMargin, [key: string]: unknown }`
- `BinanceOrderResponseRaw` — `{ orderId, clientOrderId, symbol, side, type, timeInForce, origQty, executedQty, price, avgPrice, stopPrice, cumQuote, status, reduceOnly, time, updateTime }`
- `BinanceAccountRaw` — `{ balances: BinanceBalanceRaw[] }` (BinanceBalanceRaw — internal: `{ asset, free, locked }`)
- `BinanceFuturesAccountRaw` — `{ assets: BinanceFuturesAssetRaw[] }` (BinanceFuturesAssetRaw — internal: `{ asset, walletBalance, availableBalance }`)
- `BinanceFundingRateHistoryRaw` — `{ symbol, fundingRate, fundingTime, markPrice }`
- `BinanceFundingInfoRaw` — `{ symbol, adjustedFundingRateCap, adjustedFundingRateFloor, fundingIntervalHours }`
- `BinanceOrderBookRaw` — `{ lastUpdateId, E, T, bids: string[][], asks: string[][] }`
- `BinancePublicTradeRaw` — `{ id, price, qty, quoteQty, time, isBuyerMaker }`
- `BinanceMarkPriceRaw` — `{ symbol, markPrice, indexPrice, lastFundingRate, nextFundingTime, time }`
- `BinanceMarkPriceWebSocketRaw` — событие `markPriceUpdate` c полями `e, E, s, p, ap, i, P, r, T` (символ, цены, время события)
- `BinanceAggTradeWebSocketRaw` — событие `aggTrade` c полями `e, E, s, a, p, q, f, l, T, m` (агрегированная публичная сделка Binance Futures)
- `BinanceOpenInterestRaw` — `{ symbol, openInterest, time }`
- `BinanceCommissionRateRaw` — `{ symbol, makerCommissionRate, takerCommissionRate }`
- `BinanceIncomeRaw` — `{ symbol, incomeType, income, asset, time, info, tranId, tradeId }`

### Функции нормализации:
- `normalizeBinanceTradeSymbols(raw)` → `TradeSymbolBySymbol` (Map)
  - Извлекает фильтры: PRICE_FILTER (tickSize, minPrice, maxPrice), LOT_SIZE (stepSize, minQty, maxQty), MARKET_LOT_SIZE (marketMinQty, marketMaxQty, marketStepSize), MIN_NOTIONAL (notional → minNotional), NOTIONAL (minNotional, maxNotional)
  - Строит `priceLimitRisk` из PERCENT_PRICE (`source: 'binancePercentPrice'`) или PERCENT_PRICE_BY_SIDE (`source: 'binancePercentPriceBySide'`)
  - Пробрасывает `pricePrecision`, `quantityPrecision`, `onboardDate → launchTimestamp`, `triggerProtect`, `liquidationFee`, `orderTypes → orderTypeList`, `timeInForce → timeInForceList`
  - Сохраняет сырой payload в `info`
  - Определяет тип: PERPETUAL/TRADIFI_PERPETUAL → Swap, пустой/отсутствует contractType → Spot, остальное → Future
  - `isTradifi`: `contractType === 'TRADIFI_PERPETUAL'` (токенизированные акции/металлы Binance)
  - `extractFilter<T>()` — generic helper с дискриминированным union по `filterType`, возвращает точный тип фильтра
- `normalizeBinanceTickers(rawList)` → `TickerBySymbol` (Map)
- `normalizeBinanceKlines(rawList)` → `Kline[]` — массив массивов → массив объектов, parseFloat для строк
- `normalizeBinanceKlineWebSocketMessage(raw)` → `Kline` — маппинг коротких ключей, `raw.x → isClosed`
- `normalizeBinancePosition(raw)` → `Position`
  - Маппинг через `BINANCE_POSITION_SIDE` (LONG→long, SHORT→short, BOTH→both)
  - `marginType === 'ISOLATED' ? MarginModeEnum.Isolated : MarginModeEnum.Cross`
  - NaN liquidationPrice → 0
  - Отсутствующий/невалидный leverage → 0
  - Сохраняет raw в `info`
- `normalizeBinanceOrder(raw)` → `Order`
  - Маппинг через `BINANCE_ORDER_SIDE`, `BINANCE_ORDER_TYPE` и `BINANCE_ORDER_STATUS` (константы из `src/constants/mappings.ts`); `side` с fallback `?? OrderSideEnum.Buy` (не утекает `undefined` в non-optional поле)
  - `orderId` number → string
- `normalizeBinanceBalances(raw)` → `BalanceByAsset` (Map)
  - Пропускает нулевые балансы (`free + locked === 0`) и невалидные (`NaN` в `free`/`locked` → `continue`)
- `normalizeBinanceFuturesBalances(raw)` → `BalanceByAsset` (Map)
  - Отдельная функция для фьючерсного баланса — использует `walletBalance`/`availableBalance` вместо `free`/`locked`
  - Пропускает записи с `walletBalance === 0`
  - `free = availableBalance`, `locked = walletBalance - availableBalance`, `total = walletBalance`
- `normalizeBinanceFundingRateHistory(rawList)` → `FundingRateHistory[]`
  - Пустой markPrice → `null`
- `normalizeBinanceFundingInfo(rawList)` → `FundingInfo[]`
  - parseFloat для строковых чисел, fundingIntervalHours уже number
- `normalizeBinanceOrderBook(raw, symbol)` → `OrderBook`
  - symbol передаётся отдельно (отсутствует в raw), timestamp fallback `T → E → Date.now()`
  - `updateId = raw.lastUpdateId`, `eventTimestamp = raw.E`
- `normalizeBinancePublicTrades(rawList, symbol)` → `PublicTrade[]`
  - symbol передаётся отдельно, `id` number → string, `qty → quantity`, `quoteQty → quoteQuantity`
- `normalizeBinanceAggTradeFromStream(raw)` → `PublicTrade`
  - WS-вариант одиночной сделки (`@aggTrade`, Binance Futures Public Stream): `a` (agg trade id) → `id` (string), `p`/`q` → parseFloat, `quoteQuantity = price * quantity`, `T → timestamp`
  - `isBuyerMaker = raw.m`, `side = raw.m ? Sell : Buy` (Binance `m: true` — покупатель был мейкером, значит инициатор сделки продавец)
- `normalizeBinanceMarkPriceList(rawList)` → `MarkPrice[]`
  - parseFloat для строковых полей, `time → timestamp`
- `normalizeBinanceMarkPriceWebSocketList(rawList)` → `MarkPriceUpdate[]`
  - `s → symbol`, `p → markPrice`, `i → indexPrice` (пустая строка → `0`), `E → timestamp`
- `normalizeBinanceOpenInterest(raw)` → `OpenInterest`
  - parseFloat для openInterest, `time → timestamp`
- `normalizeBinanceCommissionRate(raw)` → `FeeRate[]`
  - Возвращает массив из одного элемента, `makerCommissionRate → makerRate`, `takerCommissionRate → takerRate`
- `normalizeBinanceIncomeList(rawList)` → `Income[]`
  - `info` собирается из `{ tranId, tradeId, info }`

## bybitNormalizer.ts — все raw-типы и функции

Тот же паттерн, но с Bybit-специфичными полями и маппингами.

### Bybit Raw-типы (export):

REST:
- `BybitInstrumentInfoRaw` — `{ symbol, status, baseCoin, quoteCoin, settleCoin?, contractType?, contractSize?, lotSizeFilter?, priceFilter? }`
- `BybitTickerRaw` — `{ symbol, lastPrice, prevPrice24h, highPrice24h, lowPrice24h, price24hPcnt, volume24h, turnover24h, markPrice?, indexPrice?, bid1Price?, bid1Size?, ask1Price?, ask1Size?, fundingRate?, nextFundingTime?, time? }`
- `BybitPositionRaw` — `{ symbol, side, size, avgPrice, markPrice, unrealisedPnl, leverage, tradeMode, liqPrice, positionIdx, [key: string]: unknown }`
- `BybitOrderResponseRaw` — `{ orderId, orderLinkId, symbol, side, orderType, timeInForce, qty, price, avgPrice, triggerPrice, cumExecQty, cumExecValue, orderStatus, reduceOnly, createdTime, updatedTime }`
- `BybitWalletBalanceRaw` — `{ list: BybitAccountRaw[] }` (BybitAccountRaw — internal: `{ accountType, coin: BybitCoinRaw[] }`)
- `BybitOrderBookRaw` — `{ a: string[][], b: string[][], ts, u, s?, seq? }` (a = asks, b = bids; `s` — symbol из WS payload, `seq` — cross-sequence)
- `BybitPublicTradeRaw` — `{ execId, symbol, price, size, side, time, isBlockTrade }`
- `BybitOpenInterestRaw` — `{ openInterest, timestamp }` (оба string)
- `BybitFeeRateRaw` — `{ symbol, makerFeeRate, takerFeeRate }`
- `BybitFundingRateHistoryRaw` — `{ symbol, fundingRate, fundingRateTimestamp }`
- `BybitClosedPnlRaw` — `{ symbol, orderId, side, qty, avgEntryPrice, avgExitPrice, closedPnl, createdTime }`
- `BybitTransactionLogRaw` — `{ symbol, type, qty, cashFlow, currency, transactionTime, tradeId, orderId }`

WebSocket:
- `BybitWebSocketKlineRaw` — `{ start, end?, interval?, open, high, low, close, volume, turnover, confirm: boolean, timestamp }`
- `BybitPublicTradeDataRaw` — `{ T: number, s: string, p: string, v: string, S?: string, i?: string, BT?: boolean, L?: string }` (`S` — side, `i` — trade id, `BT` — block trade flag, `L` — price direction tick)
- `BybitWebSocketMessageRaw<T>` — `{ topic, type, ts, data: T[] }`
- `BybitKlineMessageRaw` = `BybitWebSocketMessageRaw<BybitWebSocketKlineRaw>`
- `BybitTradeMessageRaw` = `BybitWebSocketMessageRaw<BybitPublicTradeDataRaw>`

### Функции нормализации:
- `normalizeBybitTradeSymbols(rawList)` → `TradeSymbolBySymbol` (Map)
  - `isActive`: `status === 'Trading'` или `status === 'PreLaunch'`
  - LinearPerpetual/LinearFutures → Swap, пустой contractType → Spot, остальное → Future
  - `isTradifi`: `symbolType` ∈ {`stock`, `commodity`} — Bybit листит токенизированные акции/ETF и сырьё (нефть, золото, серебро) с обычным `contractType: 'LinearPerpetual'`, единственный маркер — `symbolType`; `innovation` — обычная крипта, не TradFi
  - `stepSize` берётся из `qtyStep` (linear) или `basePrecision` (spot)
  - `minNotional` берётся из `minNotionalValue` или `minOrderAmt`
  - `filter`: пробрасывает `priceFilter.minPrice/maxPrice`, `lotSizeFilter.maxMktOrderQty → marketMaxQty`, `lotSizeFilter.postOnlyMaxOrderQty → postOnlyMaxQty`
  - `leverageFilter` строится из `raw.leverageFilter` (если есть хоть одно поле)
  - `priceLimitRisk` строится из `raw.riskParameters` (`source: 'bybitRiskParameters'`, `priceLimitRatioX`, `priceLimitRatioY`)
  - `funding` строится из `fundingInterval`, `upperFundingRate`, `lowerFundingRate`
  - `launchTimestamp` — parseFloat от `launchTime` (если непустая строка)
  - Сохраняет сырой payload в `info`
- `normalizeBybitTickers(rawList)` → `TickerBySymbol` (Map)
  - `priceChangePercent` умножается на 100 (Bybit отдаёт долю, не проценты)
  - `timestamp` fallback на `Date.now()` если отсутствует
  - Пробрасывает `markPrice`, `indexPrice`, `fundingRate`, `nextFundingTime`, `bid1Price`, `bid1Size`, `ask1Price`, `ask1Size` через parseFloat (опционально, только когда Bybit прислал поле)
- `normalizeBybitKlines(rawList)` → `Kline[]` — массив строковых массивов → массив объектов, `closeTimestamp = 0`, `numberOfTrades = 0`, `.reverse()` для хронологического порядка (Bybit возвращает newest-first)
- `normalizeBybitKlineWebSocketMessage(raw)` → `Kline` — маппинг полей, `raw.confirm → isClosed`
- `normalizeBybitPosition(raw)` → `Position`
  - Маппинг через `BYBIT_POSITION_SIDE` (Buy→Long, Sell→Short), fallback → Both
  - `tradeMode === 0 ? Cross : Isolated`
  - NaN liquidationPrice → 0
  - Сохраняет raw в `info`
- `normalizeBybitOrder(raw)` → `Order`
  - Маппинг через `BYBIT_ORDER_SIDE`, `BYBIT_ORDER_TYPE`, `BYBIT_ORDER_STATUS`, `BYBIT_TIME_IN_FORCE`; `side` с fallback `?? OrderSideEnum.Buy`
  - `triggerPrice → stopPrice`, `cumExecValue → filledQuoteAmount`
  - timestamp через `parseFloat(raw.createdTime)`
- `buildBybitOrderFromCreateResponse(args, orderId)` → `Order`
  - Строит Order из `CreateOrderWebSocketArgs` + orderId, все filled-поля = 0, status = 'open'
- `normalizeBybitBalances(raw)` → `AccountBalances`
  - Итерирует по `raw.list[].coin[]`, агрегирует балансы если один coin встречается в нескольких accounts
  - `free = walletBalance - totalPositionIM - totalOrderIM`
  - `locked` = frozenAmount или locked, fallback `walletBalance - free`
  - Пропускает нулевые балансы (`free + locked === 0`)
  - На каждый asset заполняет `walletBalance`, `totalOrderInitialMargin`, `totalPositionInitialMargin`; `availableToWithdraw` — если не пусто
  - На уровне `AccountBalances` возвращает `accountType` (primary account), `totalMarginBalance`, `totalInitialMargin`
- `normalizeBybitOrderBook(raw, symbol)` → `OrderBook`
  - symbol передаётся отдельно, `a → askList`, `b → bidList`, `ts → timestamp`, `u → updateId`
- `normalizeBybitOrderBookUpdate(raw, symbol, updateType, receivedTimestamp, envelopeTimestamp?)` → `OrderBookUpdate`
  - WS-вариант orderbook (Bybit V5 public stream); сохраняет уровни как сырые пары decimal-строк (`OrderBookRawLevel = [string, string]`) — без `parseFloat`, чтобы избежать потери точности
  - `bidList`/`askList` строятся через приватный `toOrderBookRawLevelList(rawList)` (`[level[0], level[1]]`)
  - `updateType` — переданный извне (`'snapshot' | 'delta'`), `receivedTimestamp` — время, когда сообщение получено клиентом
  - `eventTimestamp = envelopeTimestamp ?? raw.ts` — Bybit V5 кладёт время события в ENVELOPE-поле `ts` сообщения, а не в `data`, поэтому `raw.ts` обычно `undefined`; envelope-значение в приоритете, `raw.ts` — fallback
- `parseBybitOrderbookRawFrame({ raw, symbol, receivedTimestamp }: ParseBybitOrderbookRawFrameArgs)` → `OrderBookUpdate | undefined`
  - On-demand парсер сырого WS-кадра (для отложенного парсинга при `lazyOrderbookParse`, см. `exchange-layer.md`): `JSON.parse(raw)` → достаёт envelope (`type`, `ts`, `data`); при невалидном JSON, отсутствующем `data` или `data` как массиве (не поддерживается) — возвращает `undefined`
  - `updateType` = `'snapshot'` только если `envelope.type === 'snapshot'`, иначе `'delta'`
  - Делегирует в `normalizeBybitOrderBookUpdate`, передавая `envelope.ts` как `envelopeTimestamp`
  - Экспортируется из `src/index.ts` (публичный API)
- `normalizeBybitPublicTradeList(rawList)` → `PublicTrade[]`
  - `execId → id`, `size → quantity`, `quoteQuantity` вычисляется как `price * size`
  - `isBuyerMaker = raw.side === 'Sell'`
  - Пробрасывает `isBlockTrade`; `side` маппится через `BYBIT_ORDER_SIDE` (если side валидный)
- `normalizeBybitPublicTradeFromStream(rawList)` → `PublicTrade[]`
  - WS-вариант (`BybitPublicTradeDataRaw[]` с короткими ключами): `i → id` (fallback пустая строка), `s → symbol`, `p → price` (parseFloat), `v → quantity` (parseFloat), `quoteQuantity = price * quantity`, `T → timestamp`, `isBuyerMaker = S === 'Sell'`, `BT → isBlockTrade` (fallback false)
  - `side` маппится через `BYBIT_ORDER_SIDE[S]`, если значение валидно
- `normalizeBybitMarkPriceList(rawList)` → `MarkPrice[]`
  - Использует `BybitTickerRaw` (те же данные что tickers), `fundingRate → lastFundingRate`, timestamp fallback `Date.now()`
- `normalizeBybitOpenInterest(raw)` → `OpenInterest`
  - `symbol` возвращается пустым (устанавливается вызывающим), parseFloat для строковых полей
- `normalizeBybitFeeRateList(rawList)` → `FeeRate[]`
  - `makerFeeRate → makerRate`, `takerFeeRate → takerRate`
- `normalizeBybitFundingRateHistoryList(rawList)` → `FundingRateHistory[]`
  - `fundingRateTimestamp → fundingTime`, `markPrice` всегда `null` (Bybit не возвращает)
- `normalizeBybitClosedPnlList(rawList)` → `ClosedPnl[]`
  - `avgEntryPrice → entryPrice`, `avgExitPrice → exitPrice`, side через `BYBIT_ORDER_SIDE` маппинг
- `normalizeBybitIncomeList(rawList)` → `Income[]`
  - Использует `BybitTransactionLogRaw`, `cashFlow → income`, `currency → asset`, `type → incomeType`
  - `info` собирается из `{ tradeId, orderId }`
  - `quantity = parseFloat(raw.qty)`

## Унифицированные типы (src/types/common.ts)

### Enums:
- `ExchangeNameEnum` — Binance, Bybit
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

### Конфигурация:
- `ExchangeConfig` — `{ apiKey, secret, recvWindow?, isDemoMode?, httpsAgent?, publicStreamConnectionPacking?, lazyOrderbookParse? }`

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
- `Order` — `{ id, clientOrderId, symbol, side, type, amount, price, avgPrice, stopPrice, filledAmount, filledQuoteAmount, status, timeInForce, reduceOnly, timestamp, updatedTimestamp, rateLimit?: OrderRateLimitSnapshot }`. Поле `rateLimit?` опциональное — заполняется только для одиночных order-операций через WebSocket Trade Stream.
- `OrderRateLimitSnapshot` — `{ limit: number; remaining: number; resetMs: number }`. Per-response runtime snapshot per-UID rate-limit, извлечённый из заголовков ответа на одиночный `createOrder` через WS. Bybit: парсится из `header['X-Bapi-Limit' / 'X-Bapi-Limit-Status' / 'X-Bapi-Limit-Reset-Timestamp']` через `parseBybitHeaderRateLimit`. Binance: из массива `message.rateLimits[]` (поиск entry с `rateLimitType === 'ORDERS' && interval === 'SECOND'`) через `parseBinanceRateLimitArray`, `remaining = limit - count`, `resetMs = Date.now() + intervalNum * 1000`. Отличается от `OrderRateLimit` (см. `getOrderRateLimit()`): тот возвращает статический per-UID лимит из exchange-info, этот — runtime snapshot после конкретной операции.
- `Balance` — `{ asset, free, locked, total, walletBalance?, availableToWithdraw?, totalOrderInitialMargin?, totalPositionInitialMargin? }` (опциональные поля — Bybit Unified Account)
- `AccountBalances` — `{ totalWalletBalance, totalAvailableBalance, balanceByAsset, accountType?, totalMarginBalance?, totalInitialMargin? }`
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
- `MarkPrice` — `{ symbol, markPrice, indexPrice, lastFundingRate, nextFundingTime, timestamp }`
- `MarkPriceUpdate` — `{ symbol, markPrice, indexPrice, timestamp }` (потоковые обновления mark/index, без funding-полей)
- `MarkPriceHandler` — `(markPriceList: MarkPriceUpdate[]) => void`
- `OpenInterest` — `{ symbol, openInterest, timestamp }`
- `FeeRate` — `{ symbol, makerRate, takerRate }`
- `Income` — `{ symbol, incomeType, income, asset, timestamp, info: Record<string, unknown>, quantity? }`
- `ClosedPnl` — `{ symbol, orderId, side: OrderSideEnum, quantity, entryPrice, exitPrice, closedPnl, timestamp }`
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
```
