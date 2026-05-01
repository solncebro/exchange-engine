# Архитектура проекта

## Назначение

exchange-engine — унифицированная абстракция над REST API и WebSocket биржами Binance и Bybit. Потребители работают с единым интерфейсом `ExchangeClient` независимо от биржи.

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
│
├── HTTP-клиенты (src/http/)
│   ├── BaseHttpClient (retry, rate limits, axios, executeRequest)
│   ├── BinanceBaseHttpClient (signing, signRequest, buildOptionalSymbolParams)
│   │   ├── BinanceFuturesHttpClient (фьючерсные эндпоинты)
│   │   └── BinanceSpotHttpClient (спотовые эндпоинты)
│   └── BybitHttpClient (единый для spot/linear, buildCategoryParams)
│
├── Нормализаторы (src/normalizers/)
│   ├── binanceNormalizer.ts — raw Binance → унифицированные типы
│   └── bybitNormalizer.ts — raw Bybit → унифицированные типы
│
├── WebSocket (src/ws/)
│   ├── BinanceFuturesPublicStream — klines + тикеры (market/ws + SUBSCRIBE)
│   ├── BinanceSpotPublicStream — klines + тикеры (динамические подписки)
│   ├── BinanceUserDataStream — listenKey user data
│   ├── BybitPublicStream — klines + тикеры (topic-based), 1s klines через TradeToKlineAggregator
│   ├── TradeToKlineAggregator — агрегация трейдов в 1-секундные klines
│   ├── BybitPrivateStream — приватные события
│   ├── BaseTradeStream<T> — абстрактная база для trade WS
│   │   ├── BinanceTradeStream — ордера через WS (Binance spot + futures)
│   │   └── BybitTradeStream — ордера через WS (только production)
│   └── parseWebSocketMessage<T> — generic JSON parser для всех стримов
│
├── Авторизация (src/auth/)
│   ├── binanceAuth.ts — HMAC-SHA256 query string signing
│   └── bybitAuth.ts — HMAC-SHA256 header signing
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
│   ├── klineLoader.ts — параллельная загрузка klines чанками
│   ├── httpParams.ts — applyTimeRangeOptions
│   ├── crypto.ts — hmacSha256
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

## Ключевые принципы

- **Raw-данные не покидают нормализаторы** — потребители видят только унифицированные типы
- **Коллекции — Map с именованием "By"**: `TickerBySymbol`, `BalanceByAsset`, `TradeSymbolBySymbol`
- **Spot-классы выбрасывают ошибку** для фьючерсных методов: `"Not supported for spot market"`
- **Demo mode** — переключается в конструкторе через `isDemoMode`, влияет на URL (не runtime toggle)
- **tradeSymbols** — `Map` на инстансе, `loadTradeSymbols()` всегда загружает свежие данные (очищает Map перед заполнением)
- **CRITICAL handler** — `BaseExchangeClient.createNotifyHandler()` оборачивает `onNotify`: при CRITICAL-сообщении от WebSocket (FAILED status) вызывает `process.exit(1)` после уведомления
