# Exchange Layer — OKX

Часть `exchange-layer.md` (см. индекс там). Конкретные реализации `OkxBaseClient`, `OkxSwap`, `OkxSpot`.

## OkxBaseClient — общая OKX логика

Промежуточный абстрактный класс для `OkxSwap` и `OkxSpot`. Наследует `BaseExchangeClient`.

Аргументы (`OkxBaseClientArgs`, `OkxBaseClient.types.ts`): `exchangeArgs`, `instType` (`'SWAP' | 'SPOT'`) и четыре лейбла соединений — `publicStreamLabel`, `tradeStreamLabel`, `privateStreamLabel`, `algoPrivateStreamLabel`.

Поля: `instType`, `isSwap`, `symbolMap: OkxSymbolMap`, `contractValueBySymbol`, `lotSizeBySymbol`, `groupIdBySymbol`, `conditionalOrderRegistry`, `publicStream`, `tradeStream`, `privateStream`/`algoPrivateStream` (оба `null` до `connectUserDataStream`), `accountConfig` (ленивый кеш `/api/v5/account/config`).

Конструктор: кодовая фраза берётся из `config.passphrase ?? ''` и передаётся в `OkxHttpClient`, который при пустом значении бросает `ExchangeError('OKX API requires a passphrase (ExchangeConfig.passphrase)', 'OKX_PASSPHRASE_REQUIRED', 'OKX')`. **Отказ происходит в конструкторе клиента**, то есть и в `new Exchange(ExchangeNameEnum.Okx, ...)` — потребитель узнаёт сразу, а не при первом запросе. Сторож — `test/exchanges/Exchange.test.ts`, случай «rejects okx without a passphrase right at construction».

Demo mode (`config.isDemoMode`) выбирает адреса потоков (`OKX_DEMO_*`) и включает в HTTP-клиенте заголовок `x-simulated-trading: 1`. В отличие от Bybit, у OKX торговый и приватный каналы доступны и в демо — REST-фолбэка «в демо только через REST» здесь нет.

### Имена инструментов (`src/exchanges/okxSymbol.ts`)

`OkxSymbolMap` держит две карты — `instId` по общему имени и обратно; заполняется в `loadTradeSymbols()`.

- `parseOkxInstId(instId)` → `OkxInstrumentIdentity | null`: `BTC-USDT-SWAP` → `{ symbol: 'BTCUSDT', baseAsset: 'BTC', quoteAsset: 'USDT', isSwap: true }`, `BTC-USDT` → то же с `isSwap: false`. Всё остальное — `null`.
- `resolveInstId(symbol)`: карта → запасной разбор `buildOkxInstIdFallback` по списку котируемых валют `OKX_QUOTE_CURRENCY_LIST` (USDT, USDC; при совпадении нескольких берётся самая длинная) → `ExchangeError('OKX_SYMBOL_UNRESOLVED')`.
- `resolveSymbol(instId)`: карта → разбор, **но только если рынок совпадает** (`parsedIdentity.isSwap === this.isSwap`); спотовое обозначение у клиента контрактов и наоборот отвергаются тем же `OKX_SYMBOL_UNRESOLVED`.
- `register(identity)` возвращает `false`, если это общее имя уже занято ДРУГИМ обозначением биржи. Два инструмента с одним именем затирали друг друга молча, и заявки по «затёртому» уходили бы на другой инструмент; карта журнала не имеет, поэтому признак столкновения уходит наружу, а предупреждает клиент в `fetchAndNormalizeTradeSymbols`.

**Числовой код инструмента (`instIdCode`) кешируется в карте имён — без него не работает торговый канал.** Код приходит в ответе списка инструментов (`OkxInstrumentRaw.instIdCode`) и кладётся в карту при `loadTradeSymbols()` (`register(identity, instIdCode)`); `resolveInstIdCode(symbol)` отдаёт его торговому каналу, где инструмент адресуется ТОЛЬКО числом: заявка с именем отвергается кодом `50014` («Parameter instIdCode can not be empty», живая проба 09.09.2026). Запасного правила нет: код из имени не выводится, поэтому незагруженная карта даёт `OKX_INSTRUMENTS_NOT_LOADED`, а неизвестный инструмент — `OKX_SYMBOL_UNRESOLVED`, и заявка уходит обычным запросом (он понимает имя).

Код перезаписывается ровно тем, что пришло с текущей загрузкой, а без кода — стирается: «instIdCode will change if a trading symbol is relisted, but remains unchanged when instId is renamed». **Отсюда обязанность потребителя: после перелистинга инструмента нужен повторный `loadTradeSymbols()`** — оставшийся от прошлой загрузки код адресует уже другой инструмент. Пока карта не обновлена, биржа отвечает отказом по этому полю, канал объявляется непригодным, и заявки продолжают идти обычными запросами — молча не туда они не уходят.

### Единицы: контракты и монеты

`resolveContractValue(symbol)` — множитель `ctVal` из карты, заполняемой `loadTradeSymbols()`. Для контракта отсутствие записи — `ExchangeError('OKX_INSTRUMENTS_NOT_LOADED')`; для спота возвращается пустая строка (пересчёт не нужен).

`resolveLotSize(symbol)` — шаг объёма `lotSz`; отсутствие или пустая строка — тот же `OKX_INSTRUMENTS_NOT_LOADED`.

`resolveOkxOrderSize(symbol, amount)` — единственная точка перевода объёма на провод:
- спот → `String(this.amountToPrecision(symbol, amount))` (монеты как есть);
- контракт → `convertCoinsToContracts({ amount, contractValue, lotSize })` (`src/utils/decimalString.ts`, целочисленная арифметика без потери разряда); результат `'0'` → `ExchangeError('OKX: amount … is below one lot for …', 'AMOUNT_BELOW_LOT')` — нулевую заявку биржа приняла бы как «ничего», и вызывающий считал бы, что защита стоит.

Тем же методом считается `newSz` при правке (одиночной, условной и пакетной): OKX понимает новый объём как ПОЛНЫЙ размер заявки, а не как остаток.

`amountToPrecision(symbol, amount)` — override базового класса: у контракта он обязан отвечать РОВНО тем числом монет, которое несёт отправленный размер, иначе вызывающий проверяет одну заявку, а ставит другую. Считается тем же переводом (`convertCoinsToContracts` → `convertContractsToCoins`), то есть отбрасыванием остатка сверх целого числа контрактов; размер меньше одного контракта даёт `0` (а `getMinOrderQty` даёт минимум — вызывающий сразу видит несоответствие). Спот и символ вне карты уходят в `super.amountToPrecision`.

`resolveOkxCreatedAmount(args)` — сколько монет несёт только что отправленная заявка; попадает в `Order.amount` при постановке (одиночной, условной и пакетной) вместо запрошенного объёма. Совпадает с `amountToPrecision` по построению. Заявка, размеренная в котируемой валюте (`isOkxQuoteSizedOrder`), монет на проводе не несёт — там остаётся запрошенное значение.

### Реализованные `fetchAndNormalize*`

- `fetchAndNormalizeTradeSymbols()` → `httpClient.fetchInstruments(instType)`. Перед заполнением карты чистит `symbolMap`, `contractValueBySymbol`, `lotSizeBySymbol`, `groupIdBySymbol`; запись принимается только если `parseOkxInstId` разобрал `instId` И `isOkxInstrumentSupported` пропустил её (контракт: `instType SWAP`, `ctType linear`, `settleCcy ∈ OKX_LINEAR_SETTLE_CURRENCY_LIST`, положительные `ctVal`/`lotSz`/`minSz`/`tickSz`; спот: `instType SPOT` и положительные `lotSz`/`minSz`/`tickSz`). Итог — `normalizeOkxTradeSymbols(rawList, fundingRawList)`: вторым списком идёт ответ ставки фандинга (`funding-rate?instId=ANY`, ОДИН запрос на всю загрузку, параллельно со списком инструментов, только для контракта), из которого заполняется `TradeSymbol.funding`; отказ этой ручки загрузку не срывает — предупреждение и инструменты без сведений о фандинге.
- `fetchAndNormalizeTickers()` → `httpClient.fetchTickers(instType)` → `normalizeOkxTickers(rawList, isSwap, contractValueBySymbol)` (карта нужна, чтобы перевести верх стакана из контрактов в монеты).
- `fetchAndNormalizeKlines(symbol, interval, options?)` — интервал переводится через `OKX_KLINE_INTERVAL` (нет соответствия → ошибка `Kline interval '…' is not supported by OKX`), лимит клампится к `OKX_KLINE_LIMIT` (300). Ручка выбирается по нужде в истории: `startTime`/`endTime` заданы или интервал `1s` → `fetchHistoryCandles`, иначе `fetchCandles`. Верхняя граница `after` считается как `endTime + 1`, а при одном `startTime` — как `startTime + limit × длительность интервала` (для `1M` — приближённый месяц). После нормализации при заданном `startTime` список досекается по `openTimestamp >= startTime`. Интервалы от шести часов и крупнее запрашиваются в `utc`-написании (`6Hutc`, `12Hutc`, `1Dutc`, `3Dutc`, `1Wutc`, `1Mutc`), поэтому границы свечей совпадают с Binance и Bybit; подробности и цитата документации — в `constants-and-urls.md`.
- `fetchAndNormalizeBalances()` → `httpClient.fetchBalance()`; пустой ответ → `ExchangeError('OKX_BALANCE_EMPTY')`; иначе `normalizeOkxBalances(rawList[0], accountLevel)`, где `accountLevel` — `acctLv` из ленивого кеша `ensureAccountConfig()` (`resolveAccountLevel`, один запрос за жизнь клиента), дающий `AccountBalances.accountType = 'acctLv:2'`; отказ чтения режима не срывает баланс — предупреждение в журнал, `accountType` остаётся пустым.

### Рыночные данные

- `fetchOrderBook(symbol, limit?)` → `/api/v5/market/books`, глубина клампится к `OKX_ORDER_BOOK_MAX_DEPTH` (400); пустой ответ → `OKX_ORDER_BOOK_EMPTY`. Количество на уровне переводится в монеты множителем инструмента (`resolveContractValue`, для контракта без загруженных инструментов — отказ): документация книги заявок говорит дословно «number of contracts for derivatives».
- `fetchTrades(symbol, limit?)` → `/api/v5/market/trades`, лимит по умолчанию 100, потолок `OKX_TRADES_MAX_LIMIT` (500); объём переводится в монеты множителем инструмента.
- `fetchMarkPrice(symbol?)` (OkxSwap) — ТРИ параллельных запроса: цена маркировки, ставка фандинга и ИНДЕКС (`/api/v5/market/index-tickers`). Обозначение индекса — контракт без хвоста `-SWAP` (`toOkxIndexInstId`); без символа индексы спрашиваются по каждой валюте расчёта из `OKX_LINEAR_SETTLE_CURRENCY_LIST`. Отказ ручки индекса цену маркировки НЕ срывает: предупреждение и `indexPrice` пустым (никогда не нулём).
- `fetchFeeRate(symbol?)` — **символ обязателен**: вызов без него → `ExchangeError('OKX fee rate requires a symbol', 'FEE_RATE_SYMBOL_REQUIRED')`. Для контракта запрос идёт по семейству инструментов (`instFamily` = `instId` без суффикса `-SWAP`), для спота — по `instId`. Пустой ответ → `OKX_FEE_RATE_EMPTY`. В нормализатор передаются `groupId` инструмента, валюта расчёта и признак рынка; если он ответил, что ставка взята из верхнеуровневых (устаревших) полей, а не из группы инструмента (`isFromOutdatedField`), клиент пишет предупреждение — расчёт издержек по общей ставке может разойтись с тем, что спишет биржа.
- `getOrderRateLimit()` → `{ writeRequestsPerSecond: OKX_ORDER_RATE_LIMIT_RPS (30), source: 'okx-documented' }`. Число — документированный предел НА ИНСТРУМЕНТ (60 запросов за 2 секунды). Общий предел суб-счёта (1000 заявок за 2 секунды, отказ 50061) к одному инструменту не относится и здесь не выражается.

### История и журнал начислений

`isArchiveWindow(options)` — смотрит на ту границу окна, которая задана: начало, если оно есть, иначе конец. Граница старше `OKX_RECENT_HISTORY_RETENTION_MS` (7 суток) переключает запрос на архивную ручку (`orders-history-archive`, `bills-archive`). Раньше смотрело только на начало, и окно, заданное ТОЛЬКО концом, уходило в свежую ручку и возвращало пустой список, неотличимый от «записей не было».

- `fetchOrderHistory(symbol, options?)` — читает ОБЕ службы и сводит их в один список: обычную книгу (`/api/v5/trade/orders-history[-archive]` через `fetchAllOrderHistory`) и службу условных заявок (`/api/v5/trade/orders-algo-history` через `fetchAllAlgoOrderHistory`). Без второй сработавший или снятый стоп в историю не попадал НИКОГДА — у OKX условные заявки живут отдельно. Обе читаются постранично (полная страница на сотне записей раньше молча обрезала ответ). Условная служба окна по времени не принимает вовсе — только состояние и страницы по номеру, — поэтому спрашиваются все терминальные состояния (`OKX_ALGO_HISTORY_STATE_LIST` = `effective`/`canceled`/`order_failed`) по каждому виду (`OKX_ALGO_HISTORY_ORD_TYPE_LIST` = `conditional,oco` и `move_order_stop`), то есть шесть запросов, а отбор по времени идёт локально. Итог сортируется по времени создания, новые первыми, и режется до `options.limit`. **`options.limit` — сколько строк ИТОГА вернуть** (как у Binance и Bybit), а не размер страницы; умолчание — `OKX_ORDER_PAGE_LIMIT` (100). К готовой странице применяется `hydrateTriggeredOrderList`: у СРАБОТАВШИХ условных заявок дочитывается порождённая обычная (тот же `hydrateTriggeredOrder`, что и в одиночном чтении). У OKX `effective` — состояние ТЕРМИНАЛЬНОЕ (вход истории принимает только `effective|canceled|order_failed`), а не мимолётное, как `TRIGGERED` у соседей, поэтому без дочитывания сработавший стоп навсегда оставался в истории «открытым» с нулевым исполнением. Дочитываются только записи, которые числятся открытыми и породили заявку, и не больше `OKX_HISTORY_TRIGGERED_ORDER_READ_LIMIT` (20) за вызов — при упоре в предел пишется предупреждение с числом заявок.
- `fetchIncome(options?: FetchIncomeArgs)` → `/api/v5/account/bills[-archive]`, лимит клампится к `OKX_BILLS_PAGE_LIMIT` (100). `options.incomeType` переводится в тип записи через `OKX_INCOME_BILL_TYPE` (`funding → '8'`, `realizedPnl → '2'`, `commission → '2'`). **Постраничного дочитывания нет**, поэтому полная страница (`rawList.length >= limit`) — отказ с текстом «the answer would be incomplete»: молча урезанный журнал дал бы неверную сумму фандинга за период. Дальше ветвление вывода: `realizedPnl` → `buildOkxRealizedPnlIncomeList`, `commission` → `buildOkxCommissionIncomeList`, иначе `normalizeOkxIncomeList` (запись сделки раскладывается на строку валового итога и строку комиссии — см. `normalizers-and-types.md`).

## Детальная документация

Заявки и конкретные классы вынесены в отдельные файлы (30k-лимит):

| Файл | Содержание |
|------|-----------|
| [exchange-layer-okx-orders.md](exchange-layer-okx-orders.md) | Заявки, реестр происхождения, чтение и отмена, списки заявок, пакетные операции |
| [exchange-layer-okx-classes.md](exchange-layer-okx-classes.md) | Поток событий счёта на двух соединениях, соединения и завершение, OkxSwap, OkxSpot |
