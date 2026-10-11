# AGENTS.md

Этот файл содержит инструкции для Codex (Codex.ai/code) при работе с кодом в этом репозитории.

## Команды

```bash
yarn build              # Проверка стиля и тесты, затем компиляция TypeScript → dist/
yarn lint               # ESLint src/ test/ scripts/
yarn test               # Запустить все Jest-тесты
yarn test -- --testPathPatterns=normalizers  # Запустить тесты по образцу пути (Jest 30: ключ во множественном числе)
yarn test:coverage      # Тесты с отчётом по покрытию
yarn test:smoke         # Smoke-тесты (верификация контракта ExchangeClient)
yarn type-check         # Проверка типов (без emit)
```

yarn lint               # ESLint src/ test/ scripts/

## Архитектура

Унифицированная абстракция над Binance, Bybit и OKX (futures + spot). Потребители работают с единым интерфейсом `ExchangeClient` независимо от биржи.

```
Exchange (фабрика) → ExchangeClient (интерфейс)
  ├── BaseExchangeClient (абстрактный, общая логика)
  │   ├── BinanceBaseClient → BinanceFutures / BinanceSpot
  │   ├── BybitBaseClient → BybitLinear / BybitSpot
  │   └── OkxBaseClient → OkxSwap / OkxSpot
  │
  ├── HTTP-клиенты (src/http/)
  │   ├── BaseHttpClient (retry, rate limits, axios, executeRequest)
  │   ├── BinanceBaseHttpClient (signing, signRequest, buildOptionalSymbolParams, троттлинг через binanceRateLimit.ts)
  │   │   ├── BinanceFuturesHttpClient
  │   │   └── BinanceSpotHttpClient
  │   ├── BybitHttpClient (buildCategoryParams)
  │   └── OkxHttpClient (подпись в заголовках, демо-заголовок, пересдача 50102, повтор 50011)
  │
  ├── Нормализаторы (src/normalizers/)
  │   Raw-типы биржи → унифицированные типы (Ticker, Kline, Position, ...)
  │
  ├── Ошибки (src/errors/)
  │   └── ExchangeError — кастомный Error с полями `code` и `exchange`
  │
  ├── WebSocket-стримы (src/ws/)
  │   ├── Публичные стримы (тикеры, klines, mark/index price, публичные сделки)
  │   ├── BaseTradeStream → BinanceTradeStream / BybitTradeStream / OkxTradeStream
  │   ├── User data стримы (BinanceUserDataStream, BybitPrivateStream, OkxPrivateStream ×2)
  │   ├── bybitWebSocketAuth — authenticateBybitWebSocket
  │   ├── okxWebSocketAuth — authenticateOkxWebSocket; OkxSilenceWatchdog — сторож тишины по рыночным данным у публичного потока OKX (текстовый ping/pong и разрыв немого сокета — дело движка соединений)
  │   └── parseWebSocketMessage — общий разбор сообщений с сохранением больших целых номеров
  │
  ├── src/utils/parseJsonPreservingLargeIntegers.ts — общий разбор HTTP/WS: большие целые числа сохраняются точными строками
  │
  └── src/public.ts — subpath-точка входа `./public`: только публичные стримы, без HTTP/trade/user-data
```

### Ключевые паттерны

**Нормализатор**: каждый файл определяет raw-интерфейсы (`BinanceTicker24hrRaw`) и чистые функции (`normalizeBinanceTickers`), конвертирующие raw-данные в унифицированные типы. Raw-типы не покидают нормализаторы.

**Коллекции через Map с "By" именованием**: `TickerBySymbol = Map<string, Ticker>`, `BalanceByAsset = Map<string, Balance>`.

**Паритет spot/futures**: spot-классы выбрасывают `"Not supported for spot market"` для фьючерсных методов.

**Единицы OKX**: бессрочный контракт OKX меряется штуками, поэтому объёмы переводятся в монеты и обратно внутри клиента (`src/utils/decimalString.ts`) — наружу все величины в монетах, как у соседей.

**Реквизиты OKX**: для публичного чтения ключ, секрет и кодовую фразу можно оставить пустыми. Ключ или секрет без кодовой фразы отклоняются при создании клиента; закрытые HTTP-запросы требуют всех трёх реквизитов. Доказательство: `src/http/OkxHttpClient.ts:103` и `src/http/OkxHttpClient.ts:124`.

### Тесты

Структура тестов зеркалит `src/`. Фикстуры в `test/fixtures/` (raw-данные бирж). Все HTTP- и exchange-клиенты тестируются с мокированным axios. `test/exports.test.ts` проверяет публичный API. `test/smoke.test.ts` проверяет реализацию `ExchangeClient` всеми шестью клиентами (по собранному `dist/`).

## Стиль кода

Во время разработки **обязательно** опирайся на скилл `code-style` — он содержит все правила форматирования, именования, типизации и структуры кода. Применяй его при написании, редактировании и ревью любого кода.

После завершения любой задачи (фича, багфикс, рефакторинг):
1. **Обязательно** запусти агент `code-style-enforcer` для проверки всех изменённых файлов на соответствие стилю кода.
2. **Обязательно** примени скилл `sync-docs` — синхронизируй `.claude/rules/` и `AGENTS.md` с фактическим состоянием кода. Документация всегда должна отражать текущую архитектуру.

## Детальная документация

Подробные описания архитектуры, паттернов и гайды находятся в `.claude/rules/`:

| Файл | Содержание |
|------|-----------|
| [architecture.md](.claude/rules/architecture.md) | Общая архитектура, слои, поток данных, фабрика Exchange |
| [exchange-layer.md](.claude/rules/exchange-layer.md) | Иерархия классов, BaseExchangeClient, demo mode, кеширование, getOrderRateLimit, ленивый разбор стакана, bid1/ask1 тикера (index; контракт и конкретные биржи — в сателлитах ниже) |
| [exchange-layer-contract.md](.claude/rules/exchange-layer-contract.md) | Полный контракт `ExchangeClient`: все методы и args-типы (`CreateOrderWebSocketArgs`, `ModifyOrderArgs`, `ModifyBatchOrderArgs`, `FetchIncomeArgs`, `SubscribeOrderbookArgs`, `SubscribePublicTradesArgs`) |
| [exchange-layer-binance.md](.claude/rules/exchange-layer-binance.md) | BinanceBaseClient, BinanceFutures, BinanceSpot |
| [exchange-layer-bybit.md](.claude/rules/exchange-layer-bybit.md) | BybitBaseClient, BybitLinear, BybitSpot |
| [exchange-layer-okx.md](.claude/rules/exchange-layer-okx.md) | OkxBaseClient: имена инструментов, единицы объёма, режим маржи как память клиента, рыночные данные, журнал начислений (index) |
| [exchange-layer-okx-orders.md](.claude/rules/exchange-layer-okx-orders.md) | OKX: заявки, условная служба, реестр происхождения заявок, чтение и отмена, пакетные операции |
| [exchange-layer-okx-classes.md](.claude/rules/exchange-layer-okx-classes.md) | OKX: поток счёта на двух соединениях, соединения и завершение, OkxSwap, OkxSpot |
| [http-layer.md](.claude/rules/http-layer.md) | `BaseHttpClient` (retry, rate-limit extension points), `BybitHttpClient`, `OkxHttpClient`, все эндпоинты Bybit и OKX, общие паттерны (index; Binance — в сателлите ниже) |
| [http-layer-binance.md](.claude/rules/http-layer-binance.md) | `BinanceBaseHttpClient`/`BinanceFuturesHttpClient`/`BinanceSpotHttpClient`: signing, пересдача при протухшей отметке, rate-limit awareness (REQUEST_WEIGHT/HTTP 418/429), все эндпоинты Binance |
| [websocket-layer.md](.claude/rules/websocket-layer.md) | Общие паттерны стримов, PublicStreamLike, BaseTradeStream (index; конкретные биржи — в сателлитах ниже) |
| [websocket-layer-binance.md](.claude/rules/websocket-layer-binance.md) | Binance Futures/Spot Public Stream, User Data Stream, Trade Stream |
| [websocket-layer-bybit.md](.claude/rules/websocket-layer-bybit.md) | Bybit Public Stream, TradeToKlineAggregator, Trade Stream (+ Batch), Private Stream |
| [websocket-layer-okx.md](.claude/rules/websocket-layer-okx.md) | OKX: текстовое сердцебиение, вход, OkxConnection (index) |
| [websocket-layer-okx-public.md](.claude/rules/websocket-layer-okx-public.md) | OKX Public Stream: три набора соединений, бюджет операций подписки, подписка и отписка, темы |
| [websocket-layer-okx-orderbook.md](.claude/rules/websocket-layer-okx-orderbook.md) | OKX: стакан, разрывы номеров, ленивый разбор, разбор входящих кадров |
| [websocket-layer-okx-trade.md](.claude/rules/websocket-layer-okx-trade.md) | OKX Trade Stream (+ Batch, признак непригодности канала), Private Stream ×2 |
| [normalizers-and-types.md](.claude/rules/normalizers-and-types.md) | Унифицированные типы, маппинги, сборщики исхода записи пачки (index) |
| [normalizers-and-types-binance-bybit.md](.claude/rules/normalizers-and-types-binance-bybit.md) | Raw-интерфейсы и функции нормализации Binance и Bybit |
| [normalizers-and-types-okx.md](.claude/rules/normalizers-and-types-okx.md) | Raw-интерфейсы и функции нормализации OKX, единицы контрактов |
| [constants-and-urls.md](.claude/rules/constants-and-urls.md) | URL, таймауты, retry-константы, precision, kline loader |
| [testing-patterns.md](.claude/rules/testing-patterns.md) | Мокирование axios/WS, createClient, фикстуры, верификация HTTP-вызовов |
| [testing-patterns-catalog.md](.claude/rules/testing-patterns-catalog.md) | Каталог тест-файлов по слоям и живые проверки против настоящих бирж (`exchange:live-check`, `okx:probe`) |
| [adding-endpoint.md](.claude/rules/adding-endpoint.md) | Пошаговый гайд + чеклист по добавлению нового эндпоинта |
| [api-reference.md](docs/api-reference.md) | Полная API-документация ExchangeClient: методы, типы, enum-ы, матрица поддержки |
