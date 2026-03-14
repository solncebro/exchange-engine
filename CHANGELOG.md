# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.3] - 2026-03-14

### Added
- `ExchangeError` custom error class (`src/errors/ExchangeError.ts`) with `code` and `exchange` fields for structured error handling
- `ExchangeError` exported from `src/index.ts`

### Changed
- `BinanceTradeStream`, `BybitTradeStream`, and `BybitHttpClient` now throw `ExchangeError` instead of plain `Error`

## [0.3.2] - 2026-03-13

### Added
- `isTradeWebSocketConnected()` and `connectTradeWebSocket()` methods on `ExchangeClient` interface
- `BinanceTradeStream` — WebSocket-based order execution for Binance (parity with Bybit)

### Internal
- Extracted `BybitBaseClient` — common base for `BybitLinear` and `BybitSpot`
- Extracted `BaseTradeStream<T>` — common base for `BinanceTradeStream` and `BybitTradeStream`
- Extracted `parseWebSocketMessage<T>()` — generic WebSocket parser replacing 7 duplicate functions
- Extracted `buildCategoryParams()` in `BybitHttpClient` — deduplicated 7 methods
- Extracted `buildOptionalSymbolParams()` in `BinanceBaseHttpClient` — deduplicated 4 methods
- `BaseExchangeClient`: futures-specific methods now have default `throw` implementations instead of `abstract`
- `BaseHttpClient`: extracted `executeRequest()` pattern for non-GET HTTP methods
- `BinanceBaseHttpClient`: extracted `signRequest()` method
- Shared test fixtures: `mockAxios.ts`, `mockTradeSymbol.ts`

## [0.3.1] - 2026-03-12

### Added
- HTTP keep-alive via `agentkeepalive` — TCP-соединения переиспользуются по умолчанию
- `httpsAgent` option in `ExchangeConfig` — custom HTTPS agent для всех HTTP-клиентов
- `FetchAllKlinesOptions` — настройки для `fetchAllKlines()`: `chunkSize`, `pauseBetweenChunksMs`, `trimLastKline`, `onChunkLoaded` callback
- `fetchKlines()` uses `klineLimit` as default `limit` when not specified

### Fixed
- ESLint check added to `yarn build` pipeline

## [0.3.0] - 2026-03-11

### Breaking Changes
- All enums renamed with `Enum` suffix: `ExchangeName` → `ExchangeNameEnum`, `OrderSide` → `OrderSideEnum`, `OrderType` → `OrderTypeEnum`, `MarginMode` → `MarginModeEnum`, `PositionSide` → `PositionSideEnum`, `TradeSymbolType` → `TradeSymbolTypeEnum`, `TimeInForce` → `TimeInForceEnum`, `PositionMode` → `PositionModeEnum`
- Expanded `Ticker` interface: added `lastPrice`, `openPrice`, `highPrice`, `lowPrice`, `priceChangePercent`, `volume`, `quoteVolume`; removed `close`, `percentage`
- Expanded `Order` interface: added `clientOrderId`, `timeInForce`, `avgPrice`, `stopPrice`, `filledAmount`, `filledQuoteAmount`, `reduceOnly`, `updatedTimestamp`
- Expanded `CreateOrderWebSocketArgs`: added `stopPrice`, `closePosition`, `workingType`, `positionSide`, `reduceOnly`, `timeInForce`, `clientOrderId`

### Added
- `WorkingTypeEnum` — `MarkPrice`, `ContractPrice`
- `OrderTypeEnum` expanded: `StopMarket`, `TakeProfitMarket`, `Stop`, `TakeProfit`, `TrailingStop`
- `fetchOrderHistory(symbol, options?)` method on `ExchangeClient` (Binance Futures implementation, stubs for others)
- Reverse mapping constants: `BINANCE_ORDER_TYPE_REVERSE`, `BINANCE_TIME_IN_FORCE`, `BINANCE_WORKING_TYPE`, `BYBIT_TIME_IN_FORCE`

## [0.2.0] - 2026-03-06

### Breaking Changes
- Renamed `Market` → `TradeSymbol`, `MarketBySymbol` → `TradeSymbolBySymbol`, `MarketFilter` → `TradeSymbolFilter`, `MarketType` → `TradeSymbolType`
- Renamed `loadMarkets()` → `loadTradeSymbols()`, property `markets` → `tradeSymbols`
- Renamed `FetchKlinesArgs` → `FetchPageWithLimitArgs`
- Renamed Kline fields: `open` → `openPrice`, `high` → `highPrice`, `low` → `lowPrice`, `close` → `closePrice`, `quoteVolume` → `quoteAssetVolume`, `trades` → `numberOfTrades`
- Added Kline fields: `takerBuyBaseAssetVolume`, `takerBuyQuoteAssetVolume`

### Added
- `FundingRateHistory` type and `fetchFundingRateHistory()` method (Binance Futures)
- `BinanceFundingRateHistoryRaw` type and `normalizeBinanceFundingRateHistory()` normalizer
- ESLint integration with TypeScript support (`eslint.config.mjs`)
- `yarn lint` script — runs ESLint on `src/` and `test/`
- ESLint check added to `prepublishOnly` pipeline

### Fixed
- Unused imports in WebSocket streams (`Kline`, `isBybitPongResponse`)
- `test/tsconfig.json`: added `"node"` to `types` for `console` support in smoke tests

### Internal
- Code style alignment across all source and test files
- All abbreviations expanded (`opts` → `options`, etc.)

## [0.1.2] - 2026-03-03

### Added
- Test suite: 204 tests (Jest + ts-jest) covering auth, HTTP clients, normalizers, WebSocket utils, exchange clients, precision formatting, and public exports
- HTTP retry for GET requests with exponential backoff
- `package.json` exports map and `sideEffects: false` for tree-shaking support
- Test gate in `prepublishOnly` script

### Fixed
- README: corrected Kline field names (`openTimestamp`/`closeTimestamp`), Map API for markets, `FetchKlinesArgs` parameter type

### Internal
- Utility modules: `crypto.ts`, `httpParams.ts`, `klineLoader.ts`
- WebSocket helpers: `binanceWsUtils.ts`, `bybitWsUtils.ts`
- Base classes: `BaseExchangeClient`, `BinanceBaseClient`, `BinanceBaseHttpClient`

## [0.1.0] - 2026-02-25

### Added
- Initial release of @solncebro/exchange-engine
- Unified API for Binance and Bybit
- Support for Binance Spot and Futures markets
- Support for Bybit Spot and Linear Perpetual markets
- REST API endpoints:
  - `loadMarkets()` — fetch and cache market information
  - `fetchTickers()` — get current prices for all symbols
  - `fetchKlines()` — historical candlestick data
  - `fetchBalance()` — account balance
  - `fetchPosition()` — futures position info (futures only)
  - `createOrderWs()` — place orders via WebSocket
  - `setLeverage()` — adjust position leverage (futures only)
  - `setMarginMode()` — isolated or cross margin (futures only)
- WebSocket subscriptions:
  - Real-time kline updates (`subscribeKlines()`)
  - Ticker price updates (Binance Futures)
- Type-safe unified types:
  - `Kline` — candlestick data
  - `Ticker` — current price and 24h change
  - `Position` — futures position details
  - `Order` — placed order info
  - `Market` — market metadata
  - `Balance` — account balance
- Automatic WebSocket reconnection with exponential backoff
- Structured logging via custom logger interface
- Price and amount precision formatting
- Error normalization across exchanges

### Internal
- Separate HTTP clients for each exchange
- Exchange-specific normalizers (Binance and Bybit)
- Public and private WebSocket streams
- Auth utilities (HMAC signing, headers)
- Four exchange implementations: BinanceFutures, BinanceSpot, BybitLinear, BybitSpot
- Factory pattern via unified `Exchange` entry point

### Notes
- Binance spot and futures use separate rate limits
- Bybit combines spot and linear in single unified API
- Public endpoints (markets, klines) do not require API keys
- Private endpoints (balance, position, orders) require valid credentials
- WebSocket subscriptions are stateless and can be re-established on reconnect

[0.3.3]: https://github.com/solncebro/exchange-engine/releases/tag/v0.3.3
[0.3.2]: https://github.com/solncebro/exchange-engine/releases/tag/v0.3.2
[0.3.1]: https://github.com/solncebro/exchange-engine/releases/tag/v0.3.1
[0.3.0]: https://github.com/solncebro/exchange-engine/releases/tag/v0.3.0
[0.2.0]: https://github.com/solncebro/exchange-engine/releases/tag/v0.2.0
[0.1.2]: https://github.com/solncebro/exchange-engine/releases/tag/v0.1.2
[0.1.0]: https://github.com/solncebro/exchange-engine/releases/tag/v0.1.0
