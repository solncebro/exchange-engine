# Архитектура проекта

## Назначение

exchange-engine — унифицированная абстракция над REST API и WebSocket биржами Binance, Bybit и OKX. Потребители работают с единым интерфейсом `ExchangeClient` независимо от биржи.

## Слои

```
Exchange (фабрика)
│
├── ExchangeClient (интерфейс) ← единая точка входа для потребителей
│
├── BaseExchangeClient (абстрактный)
│   ├── BinanceBaseClient<T> (абстрактный, шаблонный метод)
│   │   ├── BinanceFutures
│   │   └── BinanceSpot
│   ├── BybitBaseClient (абстрактный, общая Bybit логика)
│   │   ├── BybitLinear
│   │   └── BybitSpot
│   ├── OkxBaseClient (абстрактный, общая OKX логика)
│   │   ├── OkxSwap
│   │   └── OkxSpot
│   ├── ConditionalOrderRegistry — общая память «номер заявки → её служба» (Binance и OKX);
│   │     BinanceConditionalOrderRegistry — тонкий наследник со своими размером и сроком
│   └── twoServiceOrderLookup — resolveTwoServiceOrderFailure: разбор отказа ОБЕИХ служб
│         (обычной книги и условной) — общий для Binance и OKX
│
├── HTTP-клиенты (src/http/)
│   ├── BaseHttpClient (retry, rate limits, axios, executeRequest, beforeRequest/onResponse хуки)
│   ├── BinanceBaseHttpClient (signing, signRequest, buildOptionalSymbolParams, проактивный троттлинг через binanceRateLimit.ts)
│   │   ├── BinanceFuturesHttpClient (фьючерсные эндпоинты)
│   │   └── BinanceSpotHttpClient (спотовые эндпоинты)
│   ├── BybitHttpClient (единый для spot/linear, buildCategoryParams)
│   ├── OkxHttpClient (единый для SWAP/SPOT, подпись в заголовках, демо-заголовок, пересдача 50102, повтор 50011)
│   └── binanceRateLimit.ts — чистые функции: расчёт cooldown по REQUEST_WEIGHT / HTTP 418 (без класса, только для Binance)
│
├── Нормализаторы (src/normalizers/)
│   ├── binanceNormalizer.ts — raw Binance → унифицированные типы
│   ├── bybitNormalizer.ts — raw Bybit → унифицированные типы
│   └── okxNormalizer.ts — raw OKX → унифицированные типы (контракты → монеты)
│
├── WebSocket (src/ws/)
│   ├── BinanceFuturesPublicStream — klines + тикеры (market/ws + SUBSCRIBE) + публичные сделки (@aggTrade), auto-шардинг соединений
│   ├── BinanceSpotPublicStream — klines + тикеры (динамические подписки)
│   ├── BinanceUserDataStream — listenKey user data
│   ├── BybitPublicStream — klines + тикеры (topic-based), 1s klines через TradeToKlineAggregator, опциональный ленивый парсинг orderbook (lazyOrderbookParse)
│   ├── TradeToKlineAggregator — агрегация трейдов в 1-секундные klines
│   ├── BybitPrivateStream — приватные события
│   ├── bybitWebSocketAuth.ts — authenticateBybitWebSocket (общая для BybitPrivateStream/BybitTradeStream)
│   ├── OkxPublicStream — klines на business-входе, тикеры/mark-price/trades/orderbook на public-входе, два пула соединений, опциональный ленивый парсинг orderbook
│   ├── OkxPrivateStream — приватные события (личный вход: orders/positions/account; деловой вход: orders-algo)
│   ├── OkxSilenceWatchdog — сторож тишины по рыночным данным, только у публичного потока (текстовый ping/pong OKX и разрыв немого сокета — дело движка соединений через `OKX_HEARTBEAT_CONFIG`/`OKX_WEBSOCKET_CONFIGURATION`)
│   ├── okxWebSocketAuth.ts — authenticateOkxWebSocket (op: login)
│   ├── BaseTradeStream<T> — абстрактная база для trade WS
│   │   ├── BinanceTradeStream — ордера через WS (Binance spot + futures)
│   │   ├── BybitTradeStream — ордера через WS (только production)
│   │   └── OkxTradeStream — ордера через WS (одиночные и пакетные; условные заявки НЕ принимает)
│   ├── parseWebSocketMessage<T> — generic JSON parser для всех стримов
│   ├── tradeStreamOrder — buildMinimalTradeStreamOrder: заготовка Order по одному лишь номеру
│   │     (торговый канал возвращает расписку, а не снимок заявки)
│   ├── publicConnectionDiagnostics — buildPublicConnectionInfo / buildPublicConnectionCloseLine:
│   │     чистые сборщики записи реестра соединений и строки-снимка на закрытие (Bybit + OKX)
│   └── streamCommandRateLimit — общие настроечные числа потоков (темп команд, окно подавления
│         повторного пересоздания, длина головы кадра)
│
├── Авторизация (src/auth/)
│   ├── binanceAuth.ts — HMAC-SHA256 query string signing
│   ├── bybitAuth.ts — HMAC-SHA256 header signing
│   └── okxAuth.ts — HMAC-SHA256 base64 header signing + подпись входа в WebSocket
│
├── Типы (src/types/)
│   ├── common.ts — все enum, interface, type (Ticker, Kline, Position, Order, WebSocketConnectionInfo...)
│   ├── exchange.ts — ExchangeClient интерфейс + args types
│   └── stream.ts — PublicStreamLike интерфейс
│
├── Ошибки (src/errors/)
│   └── ExchangeError.ts — кастомный Error с полями `code` и `exchange`
│
├── Утилиты (src/utils/, src/precision/, src/constants/)
│   ├── precision.ts — roundToStep для amount/price
│   ├── decimalString.ts — точный перевод монет в контракты и обратно (OKX)
│   ├── klineLoader.ts — параллельная загрузка klines чанками
│   ├── httpParams.ts — applyTimeRangeOptions, buildOptionalParams
│   ├── crypto.ts — hmacSha256
│   ├── sleep.ts — пауза, не удерживающая процесс живым (unref)
│   ├── wireErrorCode.ts — код ошибки с провода к числу, если он число
│   ├── okxErrorCode.ts — разбор кода отказа OKX
│   └── constants/ — URL, таймауты, маппинги
│
└── src/index.ts — публичный API (экспорты)
```

## Поток данных

```
Потребитель → ExchangeClient.fetchTickers()
  → BaseExchangeClient.fetchTickers()
    → fetchAndNormalizeTickers() [абстрактный]
      → BinanceBaseClient.fetchAndNormalizeTickers()
        → httpClient.fetchTickers() [HTTP GET]
          → BaseHttpClient.get() [с retry]
            → axios.get() → raw JSON
        → normalizeBinanceTickers(raw) → TickerBySymbol (Map)
```

## Фабрика Exchange

`Exchange` — точка входа. Создаёт пару futures + spot:

```typescript
const exchange = new Exchange(ExchangeNameEnum.Binance, { config, logger });
exchange.futures  // → BinanceFutures (ExchangeClient)
exchange.spot     // → BinanceSpot (ExchangeClient)
exchange.getWebSocketConnectionInfoList()  // → все WS-соединения (futures + spot)
exchange.close()  // → закрывает оба
```

При `ExchangeNameEnum.Bybit` создаёт `BybitLinear` + `BybitSpot`.
При `ExchangeNameEnum.Okx` создаёт `OkxSwap` + `OkxSpot`; кодовая фраза (`ExchangeConfig.passphrase`) обязательна — без неё конструктор сразу бросает `ExchangeError('OKX_PASSPHRASE_REQUIRED')`.

## Subpath-экспорт `./public` (src/public.ts, 0.16.0)

Облегчённая точка входа `@solncebro/exchange-engine/public` (`package.json` → `exports["./public"]`) — только публичные стримы (`BybitPublicStream`, `BinanceFuturesPublicStream`, `OkxPublicStream`), нормализаторы klines/tradeSymbols всех трёх бирж и нужные константы/типы. Не тянет `Exchange`/`ExchangeClient`, HTTP-клиенты, trade/user-data стримы — для потребителей, которым нужны только публичные market-data потоки без веса всего клиента (signing, order-методы и т.п.).

## Ключевые принципы

- **Raw-данные не покидают нормализаторы** — потребители видят только унифицированные типы
- **Коллекции — Map с именованием "By"**: `TickerBySymbol`, `BalanceByAsset`, `TradeSymbolBySymbol`
- **Spot-классы выбрасывают ошибку** для фьючерсных методов: `"Not supported for spot market"`
- **Demo mode** — переключается в конструкторе через `isDemoMode`, влияет на URL (у OKX — на WS-адреса и заголовок `x-simulated-trading`), не runtime toggle
- **tradeSymbols** — `Map` на инстансе, `loadTradeSymbols()` всегда загружает свежие данные (очищает Map перед заполнением)
- **Уведомления** — `BaseExchangeClient.createNotifyHandler()` оборачивает `onNotify` БЕЗ дополнительной логики: сообщение (включая CRITICAL от WebSocket) просто проксируется в пользовательский callback. Библиотека процесс НЕ завершает — решение о том, что делать с критическим сообщением, принимает потребитель (`src/exchanges/BaseExchangeClient.ts:70-76`; `process.exit` в `src/` отсутствует, сторож — `test/exchanges/BaseExchangeClient.test.ts:35`)
