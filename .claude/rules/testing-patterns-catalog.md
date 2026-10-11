# Паттерны тестирования — каталог тест-файлов и живые проверки

Часть `testing-patterns.md` (см. индекс там). Что покрывает каждый тест-файл Exchange/HTTP/WebSocket/OKX и где лежат живые проверки против настоящих бирж.

## Тест-файлы Exchange

| Файл | Покрытие |
|------|----------|
| BaseExchangeClient.test.ts | createNotifyHandler: проксирование обычных и CRITICAL сообщений, отсутствие `process.exit` в обоих случаях, async onNotify, error safety |
| BinanceFutures.test.ts | точные большие номера исполнений при переходе между страницами и удалении повторов; сохранение номера закрывающей заявки |
| BinanceFuturesTwoServiceFailure.test.ts | отказ ОБЕИХ служб заявок: сбой связи условной службы выходит наружу своей причиной и попадает в журнал; обе «заявки нет» — прежний ответ обычной книги (0.25.0) |
| BybitOrderRateLimit.test.ts | `getOrderRateLimit` после ОДИНОЧНОЙ постановки отдаёт предел из заголовка биржи (`bybit-exchange-header`); без заголовка — документированная константа; спот и linear имеют свои (0.25.0) |

- `BinanceSubAccount.test.ts`, `BybitSubAccount.test.ts` — подсчёты: сборка запросов, подпись, нормализация по образцам из документации (`test/fixtures/binanceSubAccountRaw.ts`, `bybitSubAccountRaw.ts`), проверки до сети, передача кодов отказа биржи.

## Тест-файлы HTTP (дополнительно)

| Файл | Покрытие |
|------|----------|
| BybitInstrumentsPaging.test.ts | потолок страниц обхода списка инструментов: бесконечный курсор останавливается на `BYBIT_INSTRUMENTS_MAX_PAGE_COUNT`, честное предупреждение о неполноте, обычный обход в две страницы проходит целиком и молча (0.25.0) |
| BaseHttpClient.test.ts | разбор больших целых номеров без округления, разные номера открытых заявок, прежний разбор пустых ответов и ошибок |

## Тест-файлы WebSocket

| Файл | Покрытие |
|------|----------|
| BaseTradeStream.test.ts | connect, disconnect, isConnected, createOrder, takePendingRequest |
| BinanceFuturesPublicStream.test.ts | tickers, klines, dynamic subscribe, connection sharding (`maxStreamsPerConnection`), SUBSCRIBE-burst regression, close |
| BinanceSpotPublicStream.test.ts | tickers, klines, resubscribeAll, handleMessage, close |
| BybitPublicStream.test.ts | tickers (linear/spot, bid1/ask1), klines, resubscribeAll, lazyOrderbookParse (live/non-live orderbook), close |
| BinanceUserDataStream.test.ts | connect, onMessage, close, isConnected |
| BybitPrivateStream.test.ts | connect, auth, handleMessage filtering, close |
| BinanceTradeStream.handleMessage.test.ts | request-response matching, ExchangeError |
| BinanceTradeStream.initConnection.test.ts | connection creation, buildOrderRequest signing |
| BybitTradeStream.handleMessage.test.ts | dual format responses, auth filtering |
| BybitTradeStream.initConnection.test.ts | connection with auth, buildOrderRequest format |
| BybitTradeStream.batch.test.ts | три WS batch-метода (`createBatchOrders`/`modifyBatchOrders`/`cancelBatchOrders`), top-level errors, timeout, orphan context cleanup, kind mismatch protection |
| TradeToKlineAggregator.test.ts | processTrade aggregation, forceEmit, clearSymbol, first-trade skip |
| parseWebSocketMessage.test.ts | разбор сообщений, ошибки синтаксиса, точные большие номера обычных и условных заявок Binance |
| bybitWebSocketUtils.test.ts | pong detection (heartbeat only — HMAC-аутентификация вынесена в bybitWebSocketAuth.test.ts) |
| bybitWebSocketAuth.test.ts | authenticateBybitWebSocket: HMAC-подпись, ожидание `auth`-ответа, ошибки |
| OkxPublicStream.test.ts | три набора соединений (глубокий стакан отдельно, потолок 29), темы и их досыпка пачками, ленивый разбор, переподписка и пересоздание, `close`; стакан: кадр с разрывом не отдаётся, приращения молчат до снимка, все три ступени лечения; соединение без тем закрывается и исчезает из реестра; уведомление о плановом разрыве переоткрывает соединение; бюджет 480 операций в час; сторож: `pong` — ответ, но не данные, немое соединение с темами переподписывается без разрыва; отказ снимающей отправки не выходит из микрозадачи; отвергнутая подписка снова отправляется; потерянная тема возвращается в работу |
| OkxConnectionOperationBudget.test.ts | счёт операций подписки за скользящий час: предел и отказ, единственное предупреждение при подходе к пределу, возврат права на операции по выходу из окна |
| OkxPrivateStream.test.ts | вход, подписка на темы, фильтрация служебных кадров, сторож живости (рвётся только при отсутствии ответа; один `pong` соединение сохраняет), отказ входа не проглатывается, уведомление о плановом разрыве переоткрывает соединение, `getConnectionInfo` |
| OkxTradeStream.handleMessage.test.ts | сопоставление по `id`, сверка вида ответа с видом запроса, ответы без `op`, признак непригодности канала, ответ без поля `sMsg`/`code` даёт ошибку биржи, а не сбой чтения свойства |
| OkxTradeStream.initConnection.test.ts | создание соединения, вход, форма запроса, сторож живости (рвётся только при отсутствии ответа; один `pong` соединение сохраняет), провал повторного входа отклоняет открытие и не запускает сердцебиение, уведомление о плановом разрыве (переподключение только при пустой очереди заявок) |
| OkxTradeStream.batch.test.ts | три пакетные операции по каналу, поэлементные исходы, сироты и очистка памяти пачки |
| OkxSilenceWatchdog.test.ts | повторное срабатывание `onSilent` при затянувшемся молчании данных, тишина не засчитывается пока идёт контент, срабатывание ровно на границе порога, остановка таймера (`stop`), идемпотентный `start`, повторный `start` сбрасывает отсчёт молчания |
| okxWebSocketUtils.test.ts | разбор кадра, `pong` строкой, ключ темы |
| okxWebSocketAuth.test.ts | подпись входа, ожидание ответа `login`, отказы |

## Тест-файлы OKX (не-WebSocket)

| Файл | Покрытие |
|------|----------|
| test/exchanges/OkxSwap.test.ts | инструменты и единицы, рыночные данные, баланс, позиции, плечо, режимы, фандинг, открытый интерес, итоги закрытия, журнал начислений |
| test/exchanges/OkxSwap.orders.test.ts | сборка обычной и условной заявки, единицы объёма контракта (`perpetual sizing never borrows the spot units`), постановка/чтение/отмена/правка, пачки и их пределы, маршрутизация по реестру, поток счёта |
| test/exchanges/OkxSpot.test.ts | спотовые особенности: `tdMode: 'cash'`, единица объёма, отказы фьючерсных методов |
| test/exchanges/OkxSpot.orders.test.ts | сумма в котируемой валюте (обычная и условная ветки), единица объёма, отказ на лимитной заявке |
| test/exchanges/okxConditionalParity.test.ts | сквозные обещания условных заявок OKX наравне с соседями |
| test/exchanges/okxSymbol.test.ts | разбор `instId`, запасной разбор имени, отказ на чужом рынке |
| test/exchanges/ConditionalOrderRegistry.test.ts | запись, чтение, вытеснение по размеру, устаревание по времени |
| test/http/OkxHttpClient.test.ts | подпись и демо-заголовок, проверка ответов (в т.ч. поэлементных и пакетных), повтор при 50011, пересдача при 50102, постраничное дочитывание; публичное чтение без реквизитов и отказ закрытого HTTP-запроса при неполном наборе до отправки |
| test/http/okxTimestampError.test.ts | распознавание кода 50102 в разных формах ошибки |
| test/normalizers/okxNormalizer.test.ts | все функции нормализации |
| test/utils/decimalString.test.ts | перевод монет в контракты и обратно, точная арифметика, показательная запись |
| test/auth/okxAuth.test.ts | заголовки подписи, отметка времени, подпись входа в WebSocket |
| test/constants/okx.test.ts | карты интервалов и их обратимость |

Мокирование `authenticateBybitWebSocket` в тестах `BybitPrivateStream`/`BybitTradeStream` теперь идёт по новому пути: `jest.mock('../../src/ws/bybitWebSocketAuth', () => ({ authenticateBybitWebSocket: jest.fn().mockResolvedValue(undefined) }))` (раньше — `jest.mock('../../src/ws/bybitWebSocketUtils', ...)` с `requireActual` + override).

## Общий разбор больших целых чисел

`test/utils/parseJsonPreservingLargeIntegers.test.ts` проверяет точные строки больших положительных и отрицательных целых чисел, сохранение обычных чисел, дробной и показательной записи, строк и экранированного содержимого, а также ошибки синтаксиса. Реализация — `src/utils/parseJsonPreservingLargeIntegers.ts:5`.

## Живые проверки: что где лежит

Всё выше — тесты на мокированном ответе. Живые прогоны против настоящей биржи лежат отдельно, в
`scripts/`, и в `yarn test` НЕ входят: они требуют ключей демо-счетов и сети.

Ключи всех трёх бирж лежат в файле `.env` ЭТОЙ библиотеки по образцу `.env.example` (имена
`BINANCE_*`, `BYBIT_*`, `OKX_*` — по одному на величину, запасных имён соседних проектов нет), и
скрипты читают его сами собственным разборщиком `scripts/live-support/liveEnvFile.ts`: запуск —
одна команда `yarn exchange:live-check` (или `yarn okx:probe`), без `source`.

| Что | Где | Вопрос, на который отвечает |
|---|---|---|
| `yarn exchange:live-check` | `scripts/exchange-live-check.ts` + `scripts/exchange-live-check/` | Держит ли биржа ДОГОВОР библиотеки — одни и те же обещания на Binance, Bybit и OKX: единицы объёма (монеты, а не контракты), знак комиссии, отметка времени в миллисекундах, порядок свечей и уровней стакана, инварианты баланса, приход кадров в публичные потоки, оборот одной заявки через публичный `ExchangeClient`. Итог — таблица «обещание × биржа», в которой расхождение между биржами видно строкой |
| `yarn okx:probe` | `scripts/okx-live-probe.ts` + `scripts/okx-live-probe/` | Верны ли десять конкретных утверждений про OKX, которые доказываются только ответом биржи |
| Общее для обоих | `scripts/live-support/` | Замена ключей в печати и вывод, разбор отказа биржи, журнал библиотеки, чтение ключей запуска и переменных окружения, ожидание условия. Копий этого в двух скриптах нет |

**Граница с `trade-engine` — одно обещание не проверяется дважды.** Логику ОБЁРТКИ проверяет
`../trade-engine/tests/integration/{binance,bybit,okx}.test.ts`: разрешение имён с приставками
(`FLOKIUSDT` → `1000FLOKIUSDT`), запасной путь через спот, `ExchangeConnector`, `PositionManager`
(состояние позиции, открытие и закрытие рынком, установка плеча), расчёт закрывающих заявок.
Здесь этого нет; там нет договора с биржей на уровне библиотеки. Добавляя живую проверку, сначала
решите, чьё это обещание, и положите ровно в одно место.

Проверка отделяет **расхождение библиотеки** от **данных биржи**: нули в сетке цен и объёмов у
инструмента, которым биржа торговать пока не даёт, отсутствующий наименьший объём при заданном шаге
и замороженные сутки в тикере снятого с торгов инструмента печатаются строкой «данные биржи» и
статус не портят. Обещание про потоки смотрит НЕ на счётчик кадров, а на величины внутри кадра
(цена инструмента, цена закрытия свечи) — иначе поток, отдающий пустые записи, сходил бы за
работающий.

Подробности запуска, ключей окружения, статусов, уборки по метке клиентского номера, сроков (общий
срок прогона печатает таблицу и завершает процесс кодом 1) и известных особенностей демо-счетов
(ключ Bybit привязан к адресам — приватные вызовы отвечают `10010`; демо-вход спота Binance очень
медленный на тяжёлых ответах) — в `scripts/README.md`.
