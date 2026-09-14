# Exchange Layer — Binance

Часть `exchange-layer.md` (см. индекс там). Конкретные реализации `BinanceBaseClient`, `BinanceFutures`, `BinanceSpot`.

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
3. Для limit-like ордеров маппит `timeInForce`: **futures** через `BINANCE_FUTURES_TIME_IN_FORCE_REVERSE` (`PostOnly → GTX`, дефолт `GTC`); **spot** post-only Limit → тип `LIMIT_MAKER` (без `timeInForce`), иначе значение enum как есть (`GTC`/`IOC`/`FOK`)
4. Если `tradeStream.isConnected()` → отправляет через WebSocket
5. Иначе fallback: `httpClient.createOrder()` → `normalizeBinanceOrder()`

Реализует методы работы с ордерами (7 методов):
- `fetchOrderHistory(symbol, options?)` → `httpClient.getAllOrders()` → `map(normalizeBinanceOrder)`
- `cancelOrder(symbol, orderId)` → `httpClient.cancelOrder()` → `normalizeBinanceOrder()`. У `BinanceFutures` переопределён: сначала реестр происхождения, потом обычная книга, при её ответе «заявки нет» — условная служба; отказ ОБЕИХ разбирается общим `resolveTwoServiceOrderFailure` (см. ниже)
- `getOrder(symbol, orderId)` → `httpClient.getOrder()` → `normalizeBinanceOrder()`
- `fetchOpenOrders(symbol?)` → `httpClient.getOpenOrders()` → `map(normalizeBinanceOrder)`
- `fetchOpenConditionalOrders(_settleCoin)` → `httpClient.getOpenOrders(undefined)` (все открытые ордера, без символа) → `map(normalizeBinanceOrder)` → `.filter(order => order.stopPrice > 0)` (Binance не отдаёт отдельный список условных ордеров — фильтруется по наличию `stopPrice`; `settleCoin` не используется, параметр есть для паритета с Bybit)
- `fetchOrderBook(symbol, limit?)` → `httpClient.fetchOrderBook()` → `normalizeBinanceOrderBook()`
- `fetchTrades(symbol, limit?)` → `httpClient.fetchTrades()` → `normalizeBinancePublicTrades()`

Реализует `isTradeWebSocketConnected()` и `connectTradeWebSocket()` через `BinanceTradeStream`.

Реализует `connectUserDataStream(handler)` — создаёт listenKey через REST, запускает `BinanceUserDataStream`, устанавливает keepalive-таймер (`setInterval` каждые 30 мин → `keepAliveListenKey`). Защита от гонки: флаг `userDataStreamConnecting` + `try/finally` не дают создать второй стрим/таймер при параллельном вызове. **`BinanceSpot` переопределяет `connectUserDataStream` и бросает ошибку** (listenKey REST `/api/v3/userDataStream` удалён биржей 2026-02-20; нужна миграция на WS API). Обрабатывает события:
- `ORDER_TRADE_UPDATE` → `handler.onOrderUpdate` (статус через канон `BINANCE_ORDER_STATUS` из mappings — НЕ локальная карта; `REJECTED → 'rejected'`, `EXPIRED → 'canceled'`)
- `ACCOUNT_UPDATE` → `handler.onPositionUpdate` (из `event.a.P[]`)

Реализует `disconnectUserDataStream()` — очищает keepalive-таймер, закрывает стрим, удаляет listenKey через `deleteListenKey`.

Реализует `isUserDataStreamConnected()` — `userDataStream !== null && userDataStream.isConnected()`.

Реализует `getWebSocketConnectionInfoList()` — агрегирует `publicStream.getConnectionInfoList()` + `tradeStream.getConnectionInfo()` + optional `userDataStream.getConnectionInfo()`.

Переопределяет `getRateLimitState()` — тонкая обёртка над `httpClient.getRateLimitState()` (память лимитов живёт в HTTP-слое, общая на адрес — см. `http-layer-binance.md`, раздел «Rate-limit awareness»).

## Конкретные классы — Binance

### BinanceFutures
- `marketLabel = 'futures'`, `klineLimit = 499`
- Реализует все фьючерсные методы (position, leverage, funding, marginMode)
- `conditionalOrderRegistry` — экземпляр `BinanceConditionalOrderRegistry`, с 0.25.0 это тонкий наследник общего `ConditionalOrderRegistry` (`src/exchanges/ConditionalOrderRegistry.ts`, тот же, которым пользуется OKX): собственной копии разбора у Binance больше нет, наследник лишь подставляет `BINANCE_CONDITIONAL_ORDER_REGISTRY_MAX_SIZE` и `BINANCE_CONDITIONAL_ORDER_REGISTRY_TTL_MS`. Набор методов прежний: `record()`, `lookup()`, `ageMs()`, `size()`
- `createOrderWebSocket(args)` override: после постановки обычной (не условной) заявки запоминает её происхождение в `conditionalOrderRegistry` как `'plain'` — тем же реестром, которым размечает условные заявки `tryCreateConditionalOrder`. Без этого первое чтение/отмена по номеру только что созданной обычной заявки опрашивала бы обе службы (условную и обычную), и вторая отвечала бы `-2013` на каждую заявку. То же самое делает пакетная постановка (`createBatchOrders`, per-order) и одиночная REST-ветка `tryCreateConditionalOrder` при отказе условной. Для номеров, пришедших извне (после перезапуска процесса — реестр в памяти), двойной опрос остаётся, но логируется уровнем info, не error
- `setLeverage(leverage, symbol)` → `httpClient.setLeverage()` → `SetLeverageResult`. Подтверждённое значение берётся ТОЛЬКО из числового поля `leverage` ответа `/fapi/v1/leverage`; отсутствие пригодного числа (включая `< 1`) даёт `confirmedLeverage: null` — вызывающий обязан считать плечо неподтверждённым, а не полагаться на эхо своего запроса
- Переопределяет `fetchAndNormalizeBalances()` (базовый — для Spot — через `httpClient.fetchAccount()` → `normalizeBinanceBalances()`): `httpClient.fetchFuturesAccount()` → `normalizeBinanceFuturesBalances()` — фьючерсный ответ несёт другой набор сводных полей (`totalInitialMargin`, `totalMarginBalance`, ...), см. `normalizers-and-types-binance-bybit.md`
- Реализует дополнительные методы (10):
  - `modifyOrder(args)` → `httpClient.modifyOrder()` → `normalizeBinanceOrder()`
  - `cancelAllOrders(symbol)` → `httpClient.cancelAllOrders()`
  - `createBatchOrders(orderList)` → chunking по `BINANCE_FUTURES_CREATE_BATCH_CHUNK_SIZE` (5) через `chunkList` → последовательные вызовы `httpClient.createBatchOrders()` → `normalizeBinanceOrder()` per item. Per-order ошибки в ответе (элементы с `code < 0`) пропускаются с `logger.warn()` — успешные ордера возвращаются.
  - `cancelBatchOrders(symbol, orderIdList)` → chunking по `BINANCE_FUTURES_CANCEL_BATCH_CHUNK_SIZE` (10) через `chunkList` → последовательные вызовы `httpClient.cancelBatchOrders()`; per-order success/error агрегируется в `CancelBatchOrdersResult`. Нечисловые идентификаторы (`isBinanceNumericOrderId`) на биржу НЕ отправляются, но занимают своё место в результате как неуспешные (`errorText: 'Binance requires a numeric orderId'`) — ответ биржи маппится по позиции в чанке, поэтому выпадение элемента сдвинуло бы все последующие. Если чанк целиком нечисловой, HTTP-запрос не выполняется
  - `modifyBatchOrders(orderList)` → chunking по `BINANCE_FUTURES_MODIFY_BATCH_CHUNK_SIZE` (5) → последовательные вызовы `httpClient.modifyBatchOrders()` → per-order маппинг success/error в `ModifyBatchOrdersResult`. Каждый ордер требует `side` (обязательно для Binance PUT `/fapi/v1/batchOrders`); `clientOrderId` (если задан) маппится в `origClientOrderId`.
  - `fetchMarkPrice(symbol?)` → `httpClient.fetchMarkPrice()` → `normalizeBinanceMarkPriceList()`
  - `fetchOpenInterest(symbol)` → `httpClient.fetchOpenInterest()` → `normalizeBinanceOpenInterest()`
  - `fetchFeeRate(symbol?)` → `httpClient.fetchCommissionRate()` → `normalizeBinanceCommissionRate()`
  - `fetchIncome(options?)` → `httpClient.fetchIncome()` → `normalizeBinanceIncomeList()`. Каждая строка несёт `kind: IncomeKind`, резолвится из сырого `incomeType` обратным переводом `resolveBinanceIncomeKind` (`constants/mappings.ts`) — без фильтра биржа и так отдаёт все виды разом, разбирать их дома дополнительно не нужно
  - `fetchClosedPnl(symbol?, options?)` → у Binance нет готовой ручки закрытых позиций — итоги собираются из собственных сделок счёта (`httpClient.fetchUserTrades()`) через `buildBinanceClosedPnlList()`. `options.limit` значит РОВНО то же, что у Bybit — сколько строк ИТОГА вернуть, не сколько исполнений прочитать; отбор самых свежих строк идёт уже после сборки. Без `options.startTime` — одна страница максимального размера (`USER_TRADE_PAGE_SIZE` = 1000). С `startTime` — постраничный сбор через приватный `fetchUserTradeHistory()`: следующая страница адресуется номером сделки `fromId` (документация запрещает сочетать его с окном времени), с дедупом по `id` на стыке страниц, досечением по `endTime` у себя и предохранителем `USER_TRADE_MAX_PAGE_COUNT` = 30 страниц (при достижении — `logger.warn`, отдаётся собранное неполным)
- `setPositionMode(mode)` → `httpClient.setPositionMode()`, код Binance `-4059` (`No need to change position side.`) обрабатывается как no-op без throw (логируется на HTTP-слое)
- `setMarginMode(mode, symbol)` для Binance futures: код Binance `-4046` (`No need to change margin type.`) обрабатывается как no-op без throw (логируется на HTTP-слое)
- HTTP: `BinanceFuturesHttpClient`, WS: `BinanceFuturesPublicStream`

### Отказ обеих служб: «спросить не удалось» ≠ «заявки нет» (0.25.0)

Чтение (`readOrderFromOwningService`) и отмена (`cancelOrder`) заявки неизвестного происхождения
опрашивают ОБЕ службы. Когда отказали обе, исход выбирает общий помощник
`resolveTwoServiceOrderFailure` (`src/exchanges/twoServiceOrderLookup.ts`, тип
`TwoServiceOrderFailure` в `.types.ts`), одинаковый по смыслу с `OkxBaseClient.resolveOkxTwoServiceFailure`:

1. КАЖДАЯ причина пишется в журнал (с символом и номером заявки) — раньше причина со стороны
   условной службы отбрасывалась молча. **Уровень различает два случая:** ожидаемое «такой заявки
   нет» (тот же `isBinanceMissingOrderError`) пишется уровнем СВЕДЕНИЙ, предупреждение остаётся
   за настоящим отказом службы. Иначе самый частый путь — спросили заявку, которой уже нет, обе
   службы ответили отсутствием — давал по два предупреждения на вызов, тогда как слой запросов
   тот же ответ давно понижает до сведений;
2. наружу уходит ПЕРВАЯ причина, которая не является ответом «такой заявки нет»
   (предикат — `isBinanceMissingOrderError`, коды `-2011`/`-2013` и их текстовые следы);
3. если такой нет (обе службы ответили «нет») — наружу уходит `missingOrderError`, то есть ИСХОДНАЯ
   ошибка обычной книги: по ней вызывающий отличает успешную отмену от настоящей ошибки. Прежнее
   поведение в этом случае не изменилось.

Зачем: «заявки нет» торговый слой читает как команду — считает защитную заявку снятой и ставит
вторую или закрывает позицию. Отдать так обрыв связи, 5xx или упор в предел частоты значит соврать
о судьбе живого стопа.

Подключено в ТРЁХ местах: `readOrderFromOwningService` (`action: 'reading'`), ветвь «обычная книга
сказала нет, условная отказала» в `cancelOrder` (`action: 'cancelling'`) и
`getOrderByClientOrderId` (`action: 'reading'`). У последнего прежде стоял `throw plainOutcome.reason` —
причина ОБЫЧНОЙ книги, то есть «Order does not exist» даже тогда, когда условную службу просто не
удалось спросить. Успешный, но не той формы ответ условной службы там разбирается так же, как в
`readOrderFromOwningService`: считается отказом «в условной службе не найдено».

### BinanceSpot
- `marketLabel = 'spot'`, `klineLimit = 1000`
- Фьючерсные методы → `throw new Error('Not supported for spot market')`
- HTTP: `BinanceSpotHttpClient`, WS: `BinanceSpotPublicStream`
