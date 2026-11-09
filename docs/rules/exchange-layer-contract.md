# Exchange Layer — контракт ExchangeClient

Часть `exchange-layer.md` (см. индекс там). Полный список методов единого интерфейса и типы
аргументов, которые потребитель передаёт в них. Иерархия классов, `BaseExchangeClient`,
режим демо, `getOrderRateLimit`, ленивый разбор стакана и верх стакана в тикере — в основном файле.

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
  fetchPositionLeverage(symbol): Promise<number | null>
  fetchPositionMode(): Promise<PositionModeEnum | undefined>
  fetchFundingRateHistory(symbol, options?: FetchFundingRateHistoryArgs): Promise<FundingRateHistory[]>
  fetchFundingInfo(symbol?): Promise<FundingInfo[]>

Ордера:
  createOrderWebSocket(args): Promise<Order>
  fetchOrderHistory(symbol, options?): Promise<Order[]>
  cancelOrder(symbol, orderId): Promise<Order>
  getOrder(symbol, orderId): Promise<Order>
  fetchOpenOrders(symbol?): Promise<Order[]>
  fetchOpenConditionalOrders(settleCoin): Promise<Order[]>
  modifyOrder(args: ModifyOrderArgs): Promise<Order>
  cancelAllOrders(symbol): Promise<void>
  createBatchOrders(orderList): Promise<Order[]>
  cancelBatchOrders(symbol, orderIdList): Promise<CancelBatchOrdersResult>
  modifyBatchOrders(orderList: ModifyBatchOrderArgs[]): Promise<ModifyBatchOrdersResult>
  getOrderRateLimit(): Promise<OrderRateLimit>
  getRateLimitState(): ExchangeRateLimitState
    // Расход веса запросов на АДРЕС и срок запрета (07.09.2026) — по последнему полученному ответу,
    // без сети. `BaseExchangeClient` отдаёт дефолт «не знаем» ({ usedWeight: null, weightLimit: null,
    // observedAtMs: null, bannedUntilMs: null }); `BinanceBaseClient` переопределяет и читает из
    // `binanceRequestGate` (см. `http-layer-binance.md`) — у Bybit своего счётчика веса нет, дефолт остаётся.

Рыночные данные (расширенные):
  fetchOrderBook(symbol, limit?): Promise<OrderBook>
  fetchTrades(symbol, limit?): Promise<PublicTrade[]>
  fetchMarkPrice(symbol?): Promise<MarkPrice[]>
  fetchOpenInterest(symbol): Promise<OpenInterest>
  fetchFeeRate(symbol?): Promise<FeeRate[]>
  fetchIncome(options?: FetchIncomeArgs): Promise<Income[]>
  fetchAccountTrades(symbol, options: FetchPageWithLimitArgs): Promise<AccountTrade[]>
  fetchOrderExecutionSummary(args: FetchOrderExecutionSummaryArgs): Promise<OrderExecutionSummary>
  fetchClosedPnl(symbol?, options?): Promise<ClosedPnl[]>
    // limit = сколько строк ИТОГА вернуть (одинаково на обеих биржах). У Bybit это готовая ручка
    // биржи, у Binance итоги собираются из сырых исполнений счёта — с startTime они забираются
    // постранично (1000 на страницу, дальше по fromId: окно времени биржа с ним не принимает).
    // Просить окном по времени, а не числом строк: закрытие неликвида — это сотни исполнений.

Trade WebSocket:
  isTradeWebSocketConnected(): boolean
  connectTradeWebSocket(): Promise<void>

User Data Stream:
  connectUserDataStream(handler: UserDataStreamHandlerArgs): Promise<void>
  disconnectUserDataStream(): void
  isUserDataStreamConnected(): boolean

Настройки:
  setLeverage(leverage, symbol): Promise<SetLeverageResult>  // { confirmedLeverage: number | null } — то, что биржа реально подтвердила
  fetchLeverageTierList(symbol): Promise<LeverageTier[]>
  fetchAllLeverageTierList(): Promise<LeverageTierListBySymbol>
  setMarginMode(mode, symbol): Promise<void>
  setPositionMode(mode): Promise<void>

Precision:
  amountToPrecision(symbol, amount, rounding?: StepRounding): number   // 'nearest' (по умолчанию) | 'up' | 'down'
  priceToPrecision(symbol, price, rounding?: StepRounding): number
  getMinOrderQty(symbol): number
  getMinNotional(symbol): number
  getMaxOrderQty(symbol): number
  getMarketMaxOrderQty(symbol): number

Стриминг:
  watchTickers(): AsyncGenerator<TickerBySymbol>
  subscribeKlines(args): void
  unsubscribeKlines(args): void
  resubscribeKlines(args): void
  resubscribeKlineList(argsList: ResubscribeKlinesArgs[]): void
  resubscribeOrderbook(args: ResubscribeOrderbookArgs): void
  resubscribePublicTrades(args: ResubscribePublicTradesArgs): void
  resubscribeMarkPrices(): void
  subscribeMarkPrices(handler: MarkPriceHandler): void
  unsubscribeMarkPrices(handler: MarkPriceHandler): void
  subscribeAllTickers(handler: (tickers: TickerBySymbol) => void, symbolList: string[]): void
  unsubscribeAllTickers(handler: (tickers: TickerBySymbol) => void): void
  subscribeOrderbook(args: SubscribeOrderbookArgs): void
  unsubscribeOrderbook(args: SubscribeOrderbookArgs): void
  setOrderbookLiveSymbol(args: SetOrderbookLiveSymbolArgs): void
  subscribeRawOrderbook(handler: RawOrderbookHandler): void
  unsubscribeRawOrderbook(handler: RawOrderbookHandler): void
  subscribePublicTrades(args: SubscribePublicTradesArgs): void
  unsubscribePublicTrades(args: SubscribePublicTradesArgs): void

WebSocket Registry:
  getWebSocketConnectionInfoList(): WebSocketConnectionInfo[]
  awaitWebSocketConnectionsReady(): Promise<void>

Жизненный цикл:
  close(): Promise<void>
```

## CreateOrderWebSocketArgs

- `symbol: string` — торговая пара
- `type: OrderTypeEnum` — `Market`, `Limit`, `StopMarket`, `StopLimit`, `TakeProfitMarket`, `TakeProfitLimit`, `Stop`, `TakeProfit`, `TrailingStop`
- `side: OrderSideEnum` — `Buy` / `Sell`
- `amount: number` — объём в base
- `price?: number` — цена для Limit-like
- `stopPrice?: number` — триггерная цена для conditional/stop ордеров
- `triggerDirection?: 1 | 2` — направление триггера (1 = rise, 2 = fall) — Bybit Linear, не применяется на spot
- `triggerBy?: TriggerByEnum` — `MarkPrice` / `LastPrice` / `IndexPrice` (Bybit Linear, 0.13.0)
- `closePosition?: boolean` — Binance Futures STOP_MARKET/TAKE_PROFIT_MARKET закрытие всей позиции (на spot не применяется)
- `workingType?: WorkingTypeEnum` — Binance Futures: `MarkPrice`/`ContractPrice` для conditional (на spot не применяется)
- `positionSide?: PositionSideEnum` — `Long`/`Short` для Hedge mode futures. Маппится в Bybit `positionIdx` (1/2). На spot игнорируется.
- `reduceOnly?: boolean` — Bybit Linear: разрешён в обоих режимах. Binance Futures: разрешён только в OneWay (в Hedge `reduceOnly` выкидывается из wire). На spot не применяется.
- `closeOnTrigger?: boolean` — Bybit Linear conditional close (0.13.0, на spot не применяется)
- `timeInForce?: TimeInForceEnum` — `GTC`/`IOC`/`FOK`/`PostOnly`
- `clientOrderId?: string` — клиентский id (Bybit `orderLinkId`, Binance `newClientOrderId`, OKX `clOrdId`/`algoClOrdId`). **Общее правило для приложений под все три биржи: только латинские буквы и цифры, 1–32 знака** — самое строгое из трёх требований (OKX, `OKX_CLIENT_ORDER_ID_PATTERN`, отказ клиента до отправки `OKX_CLIENT_ORDER_ID_INVALID`); Binance и Bybit допускают до 36 знаков с дефисом и подчёркиванием, но такой номер на OKX не пройдёт
- `orderFilter?: OrderFilterEnum` — Bybit Spot conditional filter: `Order` / `tpslOrder` / `StopOrder` (0.13.0, только spot)
- `marketUnit?: MarketUnitEnum` — Bybit Spot Market unit: `baseCoin` / `quoteCoin` (0.13.0, только spot)
- `trailingDelta?: number` — Binance Spot STOP_LOSS/TAKE_PROFIT trailing (0.13.0)
- `quoteOrderQty?: number` — Binance/Bybit Spot Market Buy: USDT-сумма вместо qty (0.13.0)

## ModifyOrderArgs

- `symbol: string` — символ торговой пары
- `orderId: string` — ID ордера для модификации
- `price?: number` — новая цена
- `amount?: number` — новый объём
- `triggerPrice?: number` — новая триггер-цена

## ModifyBatchOrderArgs

- `symbol: string` — символ
- `orderId: string` — ID ордера для модификации
- `side: OrderSideEnum` — обязательно (`Buy` / `Sell`); требуется для Binance Futures PUT `/fapi/v1/batchOrders` (биржа не выводит side по `origOrderId`)
- `clientOrderId?: string` — для Bybit маппится в `orderLinkId`, для Binance — в `origClientOrderId`
- `price?: number` — новая цена
- `amount?: number` — новый объём
- `triggerPrice?: number` — новая триггер-цена

## FetchIncomeArgs (extends FetchPageWithLimitArgs)

- `startTime?: number` / `endTime?: number` / `limit?: number` — унаследованы из `FetchPageWithLimitArgs`
- `incomeType?: IncomeTypeFilter` — `'funding' | 'realizedPnl' | 'commission'` (= `IncomeKind` без `'other'`, `types/common.ts`)
- **Без поля (07.09.2026) — ВСЕ ТРИ вида одним запросом, помеченные полем `kind: IncomeKind`** (`'realizedPnl' | 'commission' | 'funding' | 'other'`, `Income`). Раньше три отдельных запроса читали на Bybit одну и ту же страницу журнала операций трижды — самый дорогой обычный запрос счёта, отправленный залпом, и есть то, что 06.09.2026 довело адрес боевого сервера до восьмиминутного запрета биржи (потребитель — `rubber`, `accountPeriodTotals.ts`)
- Binance: `incomeType: 'funding'`/`'realizedPnl'`/`'commission'` пробрасывается на биржу как `incomeType=FUNDING_FEE`/`REALIZED_PNL`/`COMMISSION` в `/fapi/v1/income`; без фильтра `kind` резолвится обратным переводом сырого `incomeType` (`resolveBinanceIncomeKind`, `constants/mappings.ts`), незнакомое значение → `'other'`
- Bybit: фильтр по типу применяется локально (не на биржу) — подробности в `exchange-layer-bybit.md`, раздел про `fetchIncome`

## SubscribeOrderbookArgs

- `symbol: string` — торговый символ (`BTCUSDT`)
- `depth: number` — глубина orderbook (Bybit: `1` / `50` / `200` / `500` / `1000` для linear, `1` / `50` / `200` для spot)
- `handler: OrderBookHandler` — `(symbol, update: OrderBookUpdate) => void`

Поддерживается только Bybit (linear и spot). Для Binance вызов `subscribeOrderbook` бросает `Not supported for ${marketLabel} market`.

## SubscribePublicTradesArgs

- `symbol: string` — торговый символ
- `handler: PublicTradeHandler` — `(symbol, tradeList: PublicTrade[]) => void`

Поддерживается Bybit (linear и spot) и Binance Futures (через `@aggTrade`, см. `websocket-layer.md`); Binance Spot — нет. На Bybit сосуществует с `subscribeKlines(symbol, '1s', ...)` (`TradeToKlineAggregator`) на одном topic `publicTrade.{symbol}` — оба consumer'а получают сообщения независимо.

## SubAccountClient (src/types/exchange.ts, 0.26.0)

Не часть `ExchangeClient`: живёт в `Exchange.subAccount`. Методы: `fetchSubAccountList()`,
`transferSubAccountAsset(SubAccountTransferArgs)`, `fetchSubAccountTransfer(FetchSubAccountTransferArgs)`
(null — перевода не нашлось), `fetchSubAccountBalances(FetchSubAccountBalancesArgs)`.

- `SubAccountTransferArgs`: `subAccountId`, `direction: SubAccountTransferDirectionEnum`, `asset`,
  `amount: number`, `fromWalletType`/`toWalletType: WalletTypeEnum`, `transferId` (номер вызывающего).
- `FetchSubAccountTransferArgs`: `subAccountId`, `direction`, `transferId`, необязательные `amount`, `asset`, `sinceMs`. Binance при заданных сумме и времени ищет отсутствующий в универсальной истории перевод в истории фьючерсных переводов; несколько совпадений — `TRANSFER_MATCH_AMBIGUOUS`. Доказательство: `src/exchanges/BinanceSubAccount.ts:111`.
- `FetchSubAccountBalancesArgs`: `subAccountId`, `walletType`, необязательный `assetList`. Bybit читает не больше десяти монет, у единого счёта по умолчанию USDT; Binance список не использует. Доказательство: `src/exchanges/BybitSubAccount.ts:100`, `src/exchanges/BinanceSubAccount.ts:152`.
- Проверки до сети (`src/exchanges/subAccountTransferValidation.ts`): сумма конечная и больше нуля
  (`INVALID_TRANSFER_AMOUNT`), непустые номер перевода и подсчёта (`INVALID_TRANSFER_ID`,
  `INVALID_SUB_ACCOUNT_ID`); у Bybit ещё UUID и числовой номер пользователя.

`fetchAccountTrades` поддержан только Binance Futures; остальные клиенты дают явную ошибку неподдерживаемого метода. Требуются символ и конечное окно до семи дней, результат содержит все исполнения окна без обрезки по `limit`. Доказательство: `src/exchanges/BaseExchangeClient.ts:524`, `src/exchanges/BinanceFutures.ts:1105`.

`fetchPositionLeverage(symbol)` отдельно читает настроенное плечо Binance Futures; положительное конечное число либо `null`, если точное значение недоступно. Ошибки запроса проходят наружу. У остальных клиентов — `null` без запроса. Обычные чтения позиций этот метод не вызывают, но сами делают дополнительный запрос на каждый вызов. Binance Futures (`fetchPosition`, `fetchPositionSnapshot`, `fetchPositionList`, `fetchAllPositions`) каждый раз параллельно со `/fapi/v3/positionRisk` читает `/fapi/v1/symbolConfig` — из него плечо и режим маржи позиции. Bybit Linear плечо берёт из записи `/v5/position/list`, а для режима маржи каждый раз параллельно со списком позиций читает `/v5/account/info`; если он отказал, берёт последние успешно прочитанные сведения о счёте, а если их ещё нет — отдаёт позиции с режимом `null`. Доказательство: `src/exchanges/BinanceFutures.ts:590`, `src/exchanges/BaseExchangeClient.ts:389`, `src/exchanges/BinanceFutures.ts:615`, `src/exchanges/BybitLinear.ts:446`, `src/exchanges/BybitLinear.ts:476`.


Опциональный третий параметр метода установки плеча: `SetLeverageOptions` с полем `direction?: 'long' | 'short'`. Bybit сохраняет встречную сторону при изолированной двусторонней марже, при общей марже меняет обе. Binance и OKX сохраняют прежнее общее поведение. Неизвестный режим счёта или недоступное плечо встречной стороны у Bybit приводят к отказу до записи.



`fetchOrderExecutionSummary` поддержан Binance Futures и Bybit Linear; остальные клиенты явно отказывают. Аргументы: символ, номер заявки, обязательные целые начало и конец окна. Окно разбивается на участки до семи суток; каждый дочитывается до конца. Результат — сумма исполненного количества и время первого и последнего исполнения, без подмены временем изменения заявки. Проверяются принадлежность символу и заявке, положительное количество, время внутри окна, отсутствие противоречащих повторов и завершение пагинации. Пустая история возвращает ноль и неизвестное время, а не подтверждение отсутствия исполнения.


`addIsolatedPositionMargin(args: AddIsolatedPositionMarginArgs): Promise<void>` увеличивает изолированную маржу у Binance Futures (`/fapi/v1/positionMargin`) и Bybit Linear (`/v5/position/add-margin`). Поля: `symbol`, `positionSide: PositionSideEnum`, конечная положительная `amount` в валюте маржи (проверяется до запроса). Сумма усекается до числа знаков биржи — Bybit 4, Binance 8 — по кратчайшей десятичной записи числа и уходит десятичной строкой без показательной записи (`BaseExchangeClient.formatIsolatedPositionMarginAmount`); ставшая нулём после усечения и число от `1e21` — отказ до запроса. Остальные рынки явно отказывают. Запрос не повторяется при сетевой ошибке или неизвестном исходе; подтверждённый отказ из-за устаревшей временной отметки обрабатывается общим механизмом подписи. После неизвестного исхода вызывающий обязан заблокировать повтор и сверить состояние вручную; собственного ключа однократности у запроса нет.

`fetchOrderExecutionSummary` для Binance USD-M и Bybit linear возвращает все страницы исполнений окна: `executionList` с устойчивым `executionId`, количеством, ценой, фактическим оборотом, временем и комиссией. Возвращённый результат всегда полный: ошибка страницы, упор в потолок страниц, конфликт повторов или неверные данные прерывают чтение исключением. Пустой полный ответ отличается от ошибки (`executionList: []`). `quoteAmount`, `averagePrice`, `feeAmountByAsset` считаются только из исполнений; неизвестная комиссия или её валюта остаётся `null`. Поля расширения необязательны в общем типе для совместимости остальных клиентов.
