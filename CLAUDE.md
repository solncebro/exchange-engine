# CLAUDE.md

Этот файл содержит инструкции для Claude Code (claude.ai/code) при работе с кодом в этом репозитории.

## Команды

```bash
yarn build              # Компиляция TypeScript → dist/
yarn lint               # ESLint src/ test/
yarn test               # Запустить все Jest-тесты
yarn test -- --testPathPattern=normalizers  # Запустить тесты по паттерну
yarn test:coverage      # Тесты с отчётом по покрытию
yarn test:smoke         # Smoke-тесты (верификация контракта ExchangeClient)
yarn type-check         # Проверка типов (без emit)
```

Последовательность верификации: `yarn lint && yarn test --coverage && yarn test:smoke && yarn build`

## Архитектура

Унифицированная абстракция над Binance и Bybit (futures + spot). Потребители работают с единым интерфейсом `ExchangeClient` независимо от биржи.

```
Exchange (фабрика) → ExchangeClient (интерфейс)
  ├── BaseExchangeClient (абстрактный, общая логика)
  │   ├── BinanceBaseClient → BinanceFutures / BinanceSpot
  │   └── BybitBaseClient → BybitLinear / BybitSpot
  │
  ├── HTTP-клиенты (src/http/)
  │   ├── BaseHttpClient (retry, rate limits, axios, executeRequest)
  │   ├── BinanceBaseHttpClient (signing, signRequest, buildOptionalSymbolParams)
  │   │   ├── BinanceFuturesHttpClient
  │   │   └── BinanceSpotHttpClient
  │   └── BybitHttpClient (buildCategoryParams)
  │
  ├── Нормализаторы (src/normalizers/)
  │   Raw-типы биржи → унифицированные типы (Ticker, Kline, Position, ...)
  │
  ├── Ошибки (src/errors/)
  │   └── ExchangeError — кастомный Error с полями `code` и `exchange`
  │
  └── WebSocket-стримы (src/ws/)
      ├── Публичные стримы (тикеры, klines)
      ├── BaseTradeStream → BinanceTradeStream / BybitTradeStream
      ├── User data стримы (BinanceUserDataStream, BybitPrivateStream)
      └── parseWebSocketMessage — generic WS parser
```

### Ключевые паттерны

**Нормализатор**: каждый файл определяет raw-интерфейсы (`BinanceTicker24hrRaw`) и чистые функции (`normalizeBinanceTickers`), конвертирующие raw-данные в унифицированные типы. Raw-типы не покидают нормализаторы.

**Коллекции через Map с "By" именованием**: `TickerBySymbol = Map<string, Ticker>`, `BalanceByAsset = Map<string, Balance>`.

**Паритет spot/futures**: spot-классы выбрасывают `"Not supported for spot market"` для фьючерсных методов.

### Тесты

Структура тестов зеркалит `src/`. Фикстуры в `test/fixtures/` (raw-данные бирж). Все HTTP- и exchange-клиенты тестируются с мокированным axios. `test/exports.test.ts` проверяет публичный API. `test/smoke.test.ts` проверяет реализацию `ExchangeClient` всеми клиентами.

## Стиль кода

Во время разработки **обязательно** опирайся на скилл `code-style` — он содержит все правила форматирования, именования, типизации и структуры кода. Применяй его при написании, редактировании и ревью любого кода.

После завершения любой задачи (фича, багфикс, рефакторинг):
1. **Обязательно** запусти агент `code-style-enforcer` для проверки всех изменённых файлов на соответствие стилю кода.
2. **Обязательно** примени скилл `sync-docs` — синхронизируй `.claude/rules/` и `CLAUDE.md` с фактическим состоянием кода. Документация всегда должна отражать текущую архитектуру.

## Детальная документация

Подробные описания архитектуры, паттернов и гайды находятся в `.claude/rules/`:

| Файл | Содержание |
|------|-----------|
| [architecture.md](.claude/rules/architecture.md) | Общая архитектура, слои, поток данных, фабрика Exchange |
| [exchange-layer.md](.claude/rules/exchange-layer.md) | ExchangeClient интерфейс, BaseExchangeClient, все конкретные классы, demo mode, кеширование |
| [http-layer.md](.claude/rules/http-layer.md) | HTTP-клиенты, retry-логика, signing Binance/Bybit, все эндпоинты |
| [websocket-layer.md](.claude/rules/websocket-layer.md) | WebSocket-стримы, подписки, heartbeat, reconnect, user data |
| [normalizers-and-types.md](.claude/rules/normalizers-and-types.md) | Все raw-интерфейсы, функции нормализации, унифицированные типы, маппинги |
| [constants-and-urls.md](.claude/rules/constants-and-urls.md) | URL, таймауты, retry-константы, precision, kline loader |
| [testing-patterns.md](.claude/rules/testing-patterns.md) | Мокирование axios/WS, createClient, фикстуры, верификация HTTP-вызовов |
| [adding-endpoint.md](.claude/rules/adding-endpoint.md) | Пошаговый гайд + чеклист по добавлению нового эндпоинта |
