# Константы, URL и маппинги

## Binance URL (src/constants/binance.ts)

| Константа | Значение |
|-----------|----------|
| BINANCE_SPOT_BASE_URL | https://api.binance.com |
| BINANCE_FUTURES_BASE_URL | https://fapi.binance.com |
| BINANCE_DEMO_SPOT_BASE_URL | https://demo-api.binance.com |
| BINANCE_DEMO_FUTURES_BASE_URL | https://demo-fapi.binance.com |
| BINANCE_FUTURES_WEBSOCKET_STREAM_URL | wss://fstream.binance.com/ws |
| BINANCE_FUTURES_WEBSOCKET_COMBINED_URL | wss://fstream.binance.com/stream |
| BINANCE_SPOT_WEBSOCKET_STREAM_URL | wss://stream.binance.com:9443/ws |
| BINANCE_DEMO_FUTURES_WEBSOCKET_COMBINED_URL | wss://fstream.binancefuture.com/stream |
| BINANCE_FUTURES_TRADE_WEBSOCKET_URL | wss://ws-fapi.binance.com/ws-fapi/v1 |
| BINANCE_DEMO_FUTURES_TRADE_WEBSOCKET_URL | wss://testnet.binancefuture.com/ws-fapi/v1 |
| BINANCE_SPOT_TRADE_WEBSOCKET_URL | wss://ws-api.binance.com:443/ws-api/v3 |
| BINANCE_DEMO_SPOT_TRADE_WEBSOCKET_URL | wss://testnet.binance.vision/ws-api/v3 |
| BINANCE_REQUEST_TIMEOUT | 30000 ms |
| BINANCE_KLINE_LIMIT_SPOT | 1000 |
| BINANCE_KLINE_LIMIT_FUTURES | 499 |

## Bybit URL (src/constants/bybit.ts)

| Константа | Значение |
|-----------|----------|
| BYBIT_BASE_URL | https://api.bybit.com |
| BYBIT_DEMO_BASE_URL | https://api-demo.bybit.com |
| BYBIT_PUBLIC_LINEAR_WEBSOCKET_URL | wss://stream.bybit.com/v5/public/linear |
| BYBIT_PUBLIC_SPOT_WEBSOCKET_URL | wss://stream.bybit.com/v5/public/spot |
| BYBIT_PRIVATE_WEBSOCKET_URL | wss://stream.bybit.com/v5/private |
| BYBIT_TRADE_WEBSOCKET_URL | wss://stream.bybit.com/v5/trade |
| BYBIT_DEMO_PUBLIC_LINEAR_WEBSOCKET_URL | wss://stream-demo.bybit.com/v5/public/linear |
| BYBIT_DEMO_PUBLIC_SPOT_WEBSOCKET_URL | wss://stream-demo.bybit.com/v5/public/spot |
| BYBIT_RECV_WINDOW | 7000 ms |
| BYBIT_REQUEST_TIMEOUT | 30000 ms |
| BYBIT_PING_INTERVAL | 20000 ms |

## Конвертация интервалов Bybit

```
BYBIT_KLINE_INTERVAL: Record<string, string>
'1m' → '1'    '3m' → '3'    '5m' → '5'    '15m' → '15'   '30m' → '30'
'1h' → '60'   '2h' → '120'  '4h' → '240'  '6h' → '360'   '12h' → '720'
'1d' → 'D'    '3d' → '3D'   '1w' → 'W'    '1M' → 'M'
```

## Retry

```
MAX_RETRIES = 3 (4 попытки: initial + 3)
RETRY_BASE_DELAY_MS = 1000
Backoff: 1s → 2s → 4s (exponential)
```

## Signing defaults

| Параметр | Binance | Bybit |
|----------|---------|-------|
| recvWindow | 5000 ms | 5000 ms (в коде), 7000 ms (в константе) |
| timestamp | `Date.now()` | `Date.now()` |
| Алгоритм | HMAC-SHA256 | HMAC-SHA256 |
| Расположение подписи | query string param `signature` | заголовок `X-BAPI-SIGN` |

## Маппинги (src/constants/mappings.ts)

### Position Side
- Binance: `LONG → Long`, `SHORT → Short`, `BOTH → Both`
- Bybit: `Buy → Long`, `Sell → Short`

### Order Side
- Binance: `BUY → Buy`, `SELL → Sell`
- Bybit: `Buy → Buy`, `Sell → Sell`

### Order Type
- Binance: `MARKET → Market`, `LIMIT → Limit`, `STOP_MARKET → StopMarket`, `TAKE_PROFIT_MARKET → TakeProfitMarket`, `STOP → Stop`, `TAKE_PROFIT → TakeProfit`, `TRAILING_STOP_MARKET → TrailingStop`
- Bybit: `Market → Market`, `Limit → Limit`

### Order Type Reverse (Binance only)
- `market → 'MARKET'`, `limit → 'LIMIT'`, `stopMarket → 'STOP_MARKET'`, `takeProfitMarket → 'TAKE_PROFIT_MARKET'`, `stop → 'STOP'`, `takeProfit → 'TAKE_PROFIT'`, `trailingStop → 'TRAILING_STOP_MARKET'`

### Order Status
- Binance: `NEW` / `PARTIALLY_FILLED` → `'open'`, `FILLED` → `'closed'`, `CANCELED` / `EXPIRED` / `EXPIRED_IN_MATCH` → `'canceled'`, `REJECTED` → `'rejected'`
- Bybit: `New` / `PartiallyFilled` / `Untriggered` → `'open'`, `Filled` → `'closed'`, `Cancelled` / `PartiallyFilledCanceled` / `Deactivated` → `'canceled'`, `Rejected` → `'rejected'`

### Time In Force
- Binance: `GTC → Gtc`, `IOC → Ioc`, `FOK → Fok`, `GTX → PostOnly`
- Bybit: `GTC → Gtc`, `IOC → Ioc`, `FOK → Fok`, `PostOnly → PostOnly`

### Working Type (Binance only)
- `markPrice → 'MARK_PRICE'`, `contractPrice → 'CONTRACT_PRICE'`

## Precision (src/precision/precision.ts)

```
countDecimalPlaces("0.001") → 3
countDecimalPlaces("0.10") → 1  (trailing zeros removed)
countDecimalPlaces("1") → 0

roundToStep(value, step): number
  1. stepValue = parseFloat(step)
  2. Если stepValue === 0 или NaN → возвращает value
  3. decimals = countDecimalPlaces(step)
  4. rounded = Math.round(value / stepValue) * stepValue
  5. return parseFloat(rounded.toFixed(decimals))

amountToPrecision(tradeSymbol, amount): number → roundToStep(amount, filter.stepSize)
priceToPrecision(tradeSymbol, price): number → roundToStep(price, filter.tickSize)
```

## Kline Loader (src/utils/klineLoader.ts)

```
KLINE_CHUNK_SIZE = 200

loadKlinesInChunks({ fetchKlines, symbolList, logger, chunkSize?, pauseBetweenChunksMs?, trimLastKline?, onChunkLoaded? }):
  1. Разбивает symbolList на чанки по chunkSize
  2. Каждый чанк — Promise.all() (параллельная загрузка)
  3. Чанки обрабатываются последовательно
  4. Если trimLastKline — удаляет последнюю (незакрытую) свечу
  5. Если onChunkLoaded — вызывает callback с Map результатами чанка
  6. Если pauseBetweenChunksMs > 0 — пауза между чанками
  7. Логирует прогресс: "Loaded klines for X/Y symbols"
  8. Возвращает Map<string, Kline[]>
```
