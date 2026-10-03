# Exchange Layer — Bybit

Часть `exchange-layer.md` (см. индекс там). Конкретные реализации `BybitBaseClient`, `BybitLinear`, `BybitSpot`. `getOrderRateLimit` (обе биржи) — в основном файле `exchange-layer.md`.

## BybitBaseClient — общая Bybit логика

Промежуточный абстрактный класс для `BybitLinear` и `BybitSpot`. Наследует `BaseExchangeClient`.

`category` — `protected readonly` поле (доступно подклассам для передачи в HTTP-вызовы).

`batchChunkSize` — `protected abstract readonly` поле: максимальный размер чанка для batch-операций. `BybitLinear` = `BYBIT_LINEAR_BATCH_CHUNK_SIZE` (20), `BybitSpot` = `BYBIT_SPOT_BATCH_CHUNK_SIZE` (10). Используется во всех трёх batch-методах (`createBatchOrders`, `modifyBatchOrders`, `cancelBatchOrders`) через `chunkList()`.

Реализует все `protected fetchAndNormalize*()` методы через `BybitHttpClient` + `bybitNormalizer`.

Реализует `createOrderWebSocket()` через `BybitTradeStream` с fallback на REST:
1. Формирует params через `buildBybitOrderParams()`: `{ category, symbol, orderType, side, qty, ... }`. `price` прикладывается **только** к limit-like типам (`isLimitLike = Limit | StopLimit | TakeProfitLimit`) — Market-ордер price на wire не несёт, даже если `args.price` задан (вызывающий код может переиспользовать limit-параметры для market-piece; стрей price на market-запросе — мусор на проводе, не команда биржи).
2. `submitOrder(orderParams, args: CreateOrderWebSocketArgs)` — принимает аргументы как второй параметр
3. Если `tradeStream !== null && tradeStream.isConnected()` → отправляет через WebSocket; на WS-пути `Order.rateLimit` snapshot из ответа переносится на пересобранный Order (не теряется)
4. Иначе fallback: `httpClient.createOrder()` → `buildBybitOrderFromCreateResponse()`

`fetchKlines` для Bybit интервала без маппинга в `BYBIT_KLINE_INTERVAL` (например `1s`) бросает ошибку — Bybit REST не отдаёт 1s-свечи (только WS-агрегатор).

Реализует `isTradeWebSocketConnected()` и `connectTradeWebSocket()` через `BybitTradeStream`.

Реализует `connectUserDataStream(handler)` — создаёт `BybitPrivateStream` с `topicList: ['order', 'position']` и demo-aware `url` (`privateWebSocketUrl`, выбран по `isDemoMode`). Обрабатывает события:
- `topic === 'order'` → `handler.onOrderUpdate` (статус через канон `BYBIT_ORDER_STATUS` из mappings — НЕ локальная карта; `Rejected → 'rejected'`, `Deactivated`/`PartiallyFilledCanceled → 'canceled'`, `Triggered → 'open'`)
- `topic === 'position'` → `handler.onPositionUpdate`

Реализует `disconnectUserDataStream()` — закрывает `privateStream`.

Реализует `isUserDataStreamConnected()` — `privateStream !== null && privateStream.isConnected()`.

Реализует методы работы с ордерами и рыночными данными (15 методов):
- `cancelOrder(symbol, orderId)` → `httpClient.cancelOrder()` → затем `getOrder(symbol, orderId)` возвращает реальный нормализованный Order (а не фабрикованный stub с `side: Buy`)
- `getOrder(symbol, orderId)` → сначала `httpClient.getOpenOrders()` (realtime), fallback на `httpClient.getOrderHistory()` → `normalizeBybitOrder()`
- `fetchOpenOrders(symbol?)` → `httpClient.getOpenOrders()` → `map(normalizeBybitOrder)`
- `fetchOpenConditionalOrders(settleCoin)` → `httpClient.getOpenOrders(category, { settleCoin, orderFilter: OrderFilterEnum.StopOrder })` → `map(normalizeBybitOrder)` (условные/стоп ордера — Bybit REST `/v5/order/realtime` с `orderFilter=StopOrder`). На споте `settleCoin` НЕ передаётся (0.26.0): вход его у спота не принимает (документация open-order)
- `fetchOrderHistory(symbol, options?)` → `httpClient.getOrderHistory()` → `map(normalizeBybitOrder)`
- `fetchOrderBook(symbol, limit?)` → `httpClient.fetchOrderBook()` → `normalizeBybitOrderBook()`
- `fetchTrades(symbol, limit?)` → `httpClient.fetchRecentTrades()` → `normalizeBybitPublicTradeList()`
- `fetchFeeRate(symbol?)` → `httpClient.fetchFeeRate()` → `normalizeBybitFeeRateList()`
- `modifyOrder(args)` → `httpClient.amendOrder()` → `getOrder()` для получения обновлённого ордера
- `cancelAllOrders(symbol)` → `httpClient.cancelAllOrders(category, symbol)`
- `createBatchOrders(orderList)` → chunking по `batchChunkSize` через `chunkList`. WS-routing: если `tradeStream !== null && tradeStream.isConnected()` → `tradeStream.createBatchOrders(category, originalArgsChunk, requestPayloadChunk)`; иначе `httpClient.createBatchOrders(category, request)` → `map(buildBybitOrderFromCreateResponse)`.
- `cancelBatchOrders(symbol, orderIdList)` → chunking по `batchChunkSize`. WS-routing: если активен tradeStream → `tradeStream.cancelBatchOrders(category, originalOrderIdChunk, requestPayloadChunk)`; иначе `httpClient.cancelBatchOrders()` → per-order маппинг через `retExtInfo.list`. Результат — `CancelBatchOrdersResult`.
- `modifyBatchOrders(orderList)` → chunking по `batchChunkSize`. WS-routing: если активен tradeStream → `tradeStream.modifyBatchOrders(category, originalOrderIdChunk, requestPayloadChunk)`; иначе `httpClient.amendBatchOrders(category, request)` → per-order маппинг через `retExtInfo.list` в `ModifyBatchOrdersResult`. `clientOrderId` маппится в `orderLinkId`.
- `fetchIncome(options?: FetchIncomeArgs)` → ОДИН обход `httpClient.fetchAllTransactionLog({ category, limit, startTime, endTime })` при любом `options.incomeType` — журнал операций Bybit один на все виды дохода И на весь счёт (символ этот вход не принимает, отбор по символу — локальный). **Страницы дочитываются по курсору до конца окна (10.09.2026)**: `limit` — размер страницы, клампится к `BYBIT_TRANSACTION_LOG_MAX_LIMIT` (50), а не потолок ответа. До этого дня чтение было одной страницей, и полная страница давала отказ — на живом счёте это каждая сделка длиннее нескольких часов (REZUSDT 10.09.2026: десять часов удержания, журнал за окно занял 8 страниц, фандинг лежал за первой; на Bybit-инстансе rubber четыре закрытия за сутки ушли в журнал с фандингом «неизвестен»). Окно `startTime`/`endTime` дублирующе перепроверяется локально (доп. защита поверх серверного окна; биржа сама ограничивает его семью сутками). Честный отказ остался ровно для курсора без конца: потолок `BYBIT_TRANSACTION_LOG_MAX_PAGE_COUNT` (200) — ошибка «page count limit», а не усечённый список.
  - `options.incomeType === 'funding'` → `normalizeBybitIncomeList` по строкам вида `BYBIT_FUNDING_INCOME_TYPE_SET` (`FUNDING`/`SETTLEMENT`, `src/constants/bybit.ts`), `kind: 'funding'`
  - `options.incomeType === 'realizedPnl'` → строки `BYBIT_TRADE_INCOME_TYPE_SET` с ненулевым `cashFlow`, `kind: 'realizedPnl'`
  - `options.incomeType === 'commission'` → `buildBybitCommissionIncomeList`, `kind: 'commission'`
  - **Без `incomeType` (07.09.2026) — все три списка выше разом, СЛИТЫЕ и отсортированные по времени по возрастанию.** Одна строка журнала `SETTLEMENT` законно попадает в результат ДВАЖДЫ — начисление фандинга и денежный поток сделки лежат в разных полях одной записи. Раньше без фильтра метод отдавал `normalizeBybitIncomeList(symbolFilteredList)` НАПРЯМУЮ, до применения окна `startTime`/`endTime`, — окно у пути «без фильтра» не проверялось вовсе; теперь оно проверяется, как и у остальных трёх путей
  - Сумма записи фандинга (`normalizeBybitIncomeList`) берётся из поля `funding`, а не `cashFlow` — у начисления фандинга денежный поток нулевой; какое поле читать, решает переданный `kind`, а не повторный разбор типа записи (`bybitIncomeAmount(raw, kind)`)
- `fetchClosedPnl(symbol?, options?)` → `httpClient.getClosedPnl()` → `normalizeBybitClosedPnlList()`. Итог пересчитывается из полей записи (`cumEntryValue`, `cumExitValue`, `openFee`, `closeFee`) — биржевое поле `closedPnl` не используется, оно уже вычитает фандинг за жизнь позиции; контракт держит паритет с Binance: чистый после торговых комиссий, без фандинга

**WS-routing для batch-операций**: при наличии активного `tradeStream` (`tradeStream !== null && tradeStream.isConnected()`) все три batch-метода (`createBatchOrders`, `modifyBatchOrders`, `cancelBatchOrders`) отправляются через WebSocket Trade Stream (`order.create-batch`, `order.amend-batch`, `order.cancel-batch`); иначе fallback на REST. В demo mode (`tradeStream === null`) — всегда REST. Chunking применяется на уровне `BybitBaseClient` снаружи WS/REST-вызова — каждый чанк отправляется отдельным запросом, результаты конкатенируются.

Реализует `getWebSocketConnectionInfoList()` — агрегирует `publicStream.getConnectionInfoList()` + optional `tradeStream.getConnectionInfo()` + optional `privateStream.getConnectionInfo()`.

В demo mode `tradeStream = null` — все ордера через REST.

## Конкретные классы — Bybit

### BybitLinear
- `marketLabel = 'linear'`
- `batchChunkSize = BYBIT_LINEAR_BATCH_CHUNK_SIZE` (20) — лимит Bybit V5 на linear/inverse/option batch
- Наследует `BybitBaseClient`
- Реализует фьючерсные методы (position, leverage)
- `setMarginMode()` — no-op (Bybit Unified Account управляет margin mode на уровне аккаунта, не символа)
- `setLeverage()` — обрабатывает код Bybit `110043` (leverage not modified) как no-op без throw. Возвращает `SetLeverageResult`: Bybit не отдаёт установленное значение в ответе, поэтому и no-op, и успешная установка возвращают эхо запроса (`confirmedLeverage: leverage`) — по документации оба исхода означают «на бирже стоит ровно запрошенное»
- Реализует `createOrderWebSocket()` через `buildBybitOrderParams()` + `submitOrder()`
- Реализует дополнительные методы:
  - `fetchMarkPrice(symbol?)` → `httpClient.fetchTickers()` → `normalizeBybitMarkPriceList()`
  - `fetchOpenInterest(symbol)` → `httpClient.fetchOpenInterest()` → `normalizeBybitOpenInterest()`, symbol устанавливается
  - `fetchFundingRateHistory(symbol, options?)` → `httpClient.fetchFundingHistory()` → `normalizeBybitFundingRateHistoryList()`
  - `fetchFundingInfo(symbol?)` — отдельной ручки сведений о фандинге у Bybit нет: интервал начислений и границы ставки лежат в списке инструментов. С символом — `httpClient.fetchInstrumentsInfo('linear', { symbol })`, без символа — `httpClient.fetchAllInstrumentsInfo('linear')` (постранично, вместе с инструментами до запуска торгов). Дальше `normalizeBybitFundingInfoList()`. Кеша нет намеренно: границы ставки биржа меняет, устаревшее значение опаснее лишнего запроса
  - `fetchPositionMode()` → `httpClient.fetchPositionList({ category: 'linear', settleCoin: 'USDT' })` → инференс по `positionIdx`: Hedge если ∃ позиция с `positionIdx ∈ {1, 2}`, OneWay если все `positionIdx === 0`, `undefined` если позиций нет (Bybit V5 не даёт API для чтения mode без позиций). Сигнатура — `Promise<PositionModeEnum | undefined>` (3.4.0/0.13.0 BREAKING).
- `setPositionMode(mode)` → `httpClient.setPositionMode(category, mode, coin)` с монетой расчётов `coin: 'USDT'` (0.26.0): Bybit требует `symbol` или `coin` в запросе `/v5/position/switch-mode`, с монетой переключаются все USDT-контракты без позиции и без открытых заявок; код Bybit `110025` обрабатывается как no-op без throw

### BybitSpot
- `marketLabel = 'spot'`
- `batchChunkSize = BYBIT_SPOT_BATCH_CHUNK_SIZE` (10) — лимит Bybit V5 на spot batch
- Наследует `BybitBaseClient`
- Для market ордеров устанавливает `marketUnit = 'baseCoin'` по умолчанию (только если не задан явно через `args.marketUnit` И не используется `quoteOrderQty`)
- Фьючерсные методы наследуют default throw из `BaseExchangeClient`

## BybitSubAccount (0.26.0, `SubAccountClient`, поле `Exchange.subAccount`)

- Не наследник `BaseExchangeClient`: уровень счёта. HTTP — `BybitSubAccountHttpClient` на `BYBIT_BASE_URL`.
- Номер главного счёта для перевода узнаётся один раз из `/v5/user/query-api` (`userID`) и запоминается; неудача не запоминается. Ключ подсчёта (`isMaster: false`) → `ExchangeError('NOT_MASTER_ACCOUNT_KEY')`.
- Кошельки: `Spot` и `UsdtFutures` → `UNIFIED` (единый торговый счёт — один кошелёк), `Funding` → `FUND`. «Классический» счёт не поддерживается.
- `transferId` — только UUID (`INVALID_TRANSFER_ID` до сети), `subAccountId` — числовой UID (`INVALID_SUB_ACCOUNT_ID`).
- Состояние перевода ищется по `transferId`; совпадение точное или по вхождению — пример документации отдаёт номер в оправе `universalTransfer_<uuid>_<uid>`.
