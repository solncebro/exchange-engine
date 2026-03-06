# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.2.0]: https://github.com/solncebro/exchange-engine/releases/tag/v0.2.0
[0.1.2]: https://github.com/solncebro/exchange-engine/releases/tag/v0.1.2
[0.1.0]: https://github.com/solncebro/exchange-engine/releases/tag/v0.1.0
