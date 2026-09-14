# Нормализаторы — Binance и Bybit

Часть `normalizers-and-types.md` (см. индекс там). Raw-типы и функции нормализации Binance и Bybit; унифицированные типы и маппинги — в основном файле.

## binanceNormalizer.ts — все raw-типы и функции

### Raw-интерфейсы (export):
- `BinanceExchangeInfoRaw` — `{ symbols: BinanceSymbolRaw[] }`
- `BinanceTicker24hrRaw` — `{ symbol, priceChange, priceChangePercent, weightedAvgPrice, lastPrice, lastQty, openPrice, highPrice, lowPrice, volume, quoteVolume, openTime, closeTime, firstId, lastId, count }` плюс спотовые `prevClosePrice?`, `bidPrice?`, `bidQty?`, `askPrice?`, `askQty?`. **Поля `time` в ответе нет** ни у `/fapi/v1/ticker/24hr`, ни у `/api/v3/ticker/24hr` — окно суток задано парой `openTime`/`closeTime` (сверено живым ответом обеих ручек, боевой и демо, 10.09.2026)
- `BinanceMiniTickerWebSocketRaw` — кадр потока `!miniTicker@arr` (оба рынка): `{ e: '24hrMiniTicker', E, s, c, o, h, l, v, q, ps?, st? }`. Имена КОРОТКИЕ и с суточной сводкой не совпадают ни одним; процента изменения в кадре нет; `ps`/`st` приходят только на контрактах. Кадр приходит ГОЛЫМ МАССИВОМ и на `market/ws` контрактов, и на `/ws` спота
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
  - `settle` — из `marginAsset` ответа биржи, НЕ из догадки «бессрочный значит USDT»: на USDⓈ-M торгуются контракты с расчётом в USDC, BTC, USD1 и U, а у срочных валюта расчёта названа так же. У спота поля нет — остаётся пустым
  - `isTradifi`: `contractType === 'TRADIFI_PERPETUAL'` (токенизированные акции/металлы Binance)
  - `extractFilter<T>()` — generic helper с дискриминированным union по `filterType`, возвращает точный тип фильтра
- `normalizeBinanceTickers(rawList)` → `TickerBySymbol` (Map) — `timestamp` берётся из `closeTime`, правого края суточного окна: другой отметки ответ не несёт
- `normalizeBinanceMiniTickerList(rawList)` → `TickerBySymbol` (Map) — разбор кадра потока: `s → symbol`, `c → lastPrice`, `o → openPrice`, `h`/`l`, `v → volume`, `q → quoteVolume`, `E → timestamp`. `priceChangePercent` СЧИТАЕТСЯ здесь (биржа его в кадре не отдаёт) как рост от цены суточной давности к последней; нулевая цена открытия даёт ноль, а не бесконечность. Используется обоими публичными потоками Binance
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
- `normalizeBinanceFuturesBalances(raw)` → `AccountBalances`
  - Отдельная функция для фьючерсного баланса — использует `walletBalance`/`availableBalance` вместо `free`/`locked`
  - Пропускает записи с `walletBalance === 0`
  - `free = availableBalance`, `locked = walletBalance - availableBalance`, `total = walletBalance`
  - `totalAvailableBalance`/`availableBalanceSource`: `raw.availableBalance` в приоритете (`'exchange'`); если его нет — `totalWalletBalance − raw.totalInitialMargin` (`'derived'`); иначе `0` и `'unknown'` — занятая маржа НЕ выводится вычитанием кошелька со свободными (свободные уже уменьшены биржей на нереализованный итог)
  - `totalInitialMargin` — читается из `raw.totalInitialMargin`, если есть; `totalMarginBalance` — из `raw.totalMarginBalance`
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
  - `kind` резолвится из сырого `incomeType` обратным переводом `resolveBinanceIncomeKind` (`constants/mappings.ts`), незнакомое значение → `'other'`
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
- `BybitClosedPnlRaw` — `{ symbol, orderId, side, qty, avgEntryPrice, avgExitPrice, cumEntryValue, cumExitValue, openFee, closeFee, closedPnl, createdTime }` (`closedPnl` — биржевой итог, наружу не отдаётся — см. `normalizeBybitClosedPnlList`)
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
  - На каждый asset заполняет `walletBalance`, `totalOrderInitialMargin`, `totalPositionInitialMargin`, `usdValue` (если прислан); `availableToWithdraw` — если не пусто
  - Свод счёта строится ТОЛЬКО из `usdValue` монет (`sumBalanceUsdValue`/`sumMarginUsdValue`, private) — остатки в собственных единицах монет складывать нельзя (биткойн иначе весит как доллар). `null` от этих хелперов (хоть у одной ненулевой монеты нет `usdValue`) — сигнал считать неполную сумму нельзя
  - `totalWalletBalance`/`totalAvailableBalance`/`availableBalanceSource`: биржевое поле в приоритете (`'exchange'`); иначе `marginBalance − initialMargin` или `totalWalletBalance − initialMargin` (`'derived'`); иначе — если есть долларовая оценка занятой маржи по монетам — `totalWalletBalance − marginUsd` (`'derived'`); иначе `0` и `'unknown'`
  - На уровне `AccountBalances` возвращает `accountType` (primary account), `totalMarginBalance`, `totalInitialMargin` (биржевое поле или `marginUsd`, если биржа не дала), `availableBalanceSource`
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
- `normalizeBybitFundingInfoList(rawList)` → `FundingInfo[]` — из списка инструментов (`BybitInstrumentInfoRaw`), отдельной ручки сведений о фандинге у Bybit нет
  - `fundingInterval` биржа даёт в МИНУТАХ, единый контракт меряет часами — минуты делятся на 60 и округляются до сотых (480 → 8, 240 → 4)
  - `upperFundingRate → adjustedFundingRateCap`, `lowerFundingRate → adjustedFundingRateFloor` (доли, как отдаёт биржа); поля нет или оно пустое — ноль
  - Запись без пригодного интервала (нет поля, ноль, не число) ПРОПУСКАЕТСЯ: ноль в часах читался бы как «начислений нет», а это не то же самое, что «биржа интервала не назвала»
- `normalizeBybitClosedPnlList(rawList)` → `ClosedPnl[]`
  - `avgEntryPrice → entryPrice`, `avgExitPrice → exitPrice`, side через `BYBIT_ORDER_SIDE` маппинг
  - `closedPnl` НЕ читается из биржевого поля — оно уже вычитает фандинг за жизнь позиции. Пересчитывается как `bybitGrossPnl(raw, side) − openFee − closeFee`, где `bybitGrossPnl` — `cumEntryValue − cumExitValue` (закрытие шорта покупкой) или наоборот для лонга. Тот же смысл, что у Binance: чистый после торговых комиссий, без фандинга
- `normalizeBybitIncomeList(rawList)` → `Income[]`
  - Использует `BybitTransactionLogRaw`, `currency → asset`, `type → incomeType`
  - `income` — через приватный `bybitIncomeAmount`: для типов из `BYBIT_FUNDING_INCOME_TYPE_SET` (`FUNDING`/`SETTLEMENT`, `src/constants/bybit.ts`) берётся поле `funding` (у этих строк `cashFlow` всегда 0), иначе — `cashFlow`
  - `info` собирается из `{ tradeId, orderId }`
  - `quantity = parseFloat(raw.qty)`
