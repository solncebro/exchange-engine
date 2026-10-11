# @solncebro/exchange-engine

Universal TypeScript client library for cryptocurrency trading on Binance, Bybit and OKX with unified API, WebSocket support, and native type safety.

## Latest Release

Текущая версия: `0.26.1`

- **Точные номера заявок и сделок:** большие целые номера в ответах HTTP и сообщениях WebSocket сохраняются строками без округления.
- **История исполнений Binance:** переход между страницами, удаление повторов и порядок сделок с одинаковым временем учитывают точные большие номера.
- **Публичное чтение OKX без ключей:** можно оставить ключ, секрет и кодовую фразу пустыми. Для закрытых HTTP-запросов нужен полный набор реквизитов; проверка выполняется до отправки.

Доказательство: `src/utils/parseJsonPreservingLargeIntegers.ts:5`, `src/exchanges/BinanceFutures.ts:1078`, `src/exchanges/BinanceFutures.ts:1097`, `src/http/OkxHttpClient.ts:103` и `src/http/OkxHttpClient.ts:124`.

Предыдущий выпуск: `0.26.0`.

- **Округление по шагу инструмента:** направление можно выбрать — к ближайшему значению, вверх или вниз.
- **Ступени плеча:** единое чтение ограничений позиции и требований к марже на Binance, Bybit и OKX.
- **Дочерние счета Binance и Bybit:** список счетов, переводы, поиск перевода и чтение остатков.
- **Исправления биржевых клиентов:** чтение страниц Bybit, ограничения запросов Binance, порядок свечей OKX и отмена всех заявок Binance Spot.
- **Совместимость соединений:** требуется `@solncebro/websocket-engine` версии не ниже 0.6.1 и ниже 1.0.0; эта версия разрешает текстовую проверку живости OKX.

Ранее в `0.25.0`:

- **Поддержка OKX:** третья биржа с единым договором клиента — бессрочные линейные контракты с расчётами в USDT/USDC и спот. Обозначения инструментов остаются общими (`BTCUSDT`), объёмы — в монетах. Перевод контрактов в монеты, обозначений инструментов и работа с отдельной службой условных заявок выполняются внутри библиотеки. Пользовательский номер заявки должен содержать от 1 до 32 букв или цифр. Объём контрактов в котируемой валюте вычисляется приближённо, направление срабатывания условия не используется, режим маржи хранится в клиенте, а поток цены маркировки не содержит индексную цену. Доказательство и условия использования реквизитов: [справка по OKX](https://github.com/solncebro/exchange-engine/blob/main/docs/api-reference.md#особенности-okx).

Previously in `0.24.0`:

- **Account balance fixes**: consumer-side summation across coins was adding balances denominated in different units — one BTC on an account was worth one dollar in the "free" total instead of six figures (live incident 2026-08-29, an empty Bybit account showed negative margin in use). `fetchBalances()` now sums only `Balance.usdValue` (the per-coin dollar valuation the exchange itself uses to build `totalWalletBalance`) for any account-level total, and margin in use is converted to dollars at each coin's own rate. Binance Futures margin in use is now read from `/fapi/v3/account`'s own `totalInitialMargin` field instead of derived by subtracting free from wallet balance (that subtraction silently drifts with unrealized PnL on an open position). `AccountBalances.availableBalanceSource` names where the free-balance number came from — `'exchange'`, `'derived'`, or `'unknown'` — so a consumer can tell a fact from a guess.
- **Bybit accounting fixes**: `fetchIncome` now reads a funding settlement from its `funding` field (the `cashFlow` of such a row is always zero — the old code reported every Bybit funding charge as 0), and `fetchClosedPnl` no longer returns Bybit's own `closedPnl`, which already subtracts the funding paid over the life of the position: the result is rebuilt from the record's own fields (`cumEntryValue − cumExitValue − openFee − closeFee`), so `closedPnl` means the same on both exchanges — net of trading commissions, funding NOT included. Consumers that added funding on top of a Bybit `closedPnl` were double-counting it; recount affected rows.
- **Binance Futures order-book stream fix**: the depth (`@depth20@100ms`) stream was subscribed on the same market endpoint as every other public stream, which the exchange acknowledges but never actually pushes frames on (live-verified 2026-09-06) — every order-book connection silently sat empty and got endlessly recreated by the stale-connection watchdog. It now opens on the combined endpoint (`wss://fstream.binance.com/stream`), the one that actually streams depth updates in the wrapped shape the parser expects.
- **Breaking — `@solncebro/websocket-engine` moved from a regular dependency to a peer dependency** (range `>=0.6.1 <1.0.0`; it stays a dev dependency so this package can still build and test itself). While it was a regular dependency pinned as `^0.5.0`, a consumer already running a newer branch of that channel was forced to carry a *second*, older copy nested inside this package — pre-1.0 caret ranges don't cross a minor boundary. Two implementations of the channel ended up in one process, and the sockets that actually talk to the exchange ran on the stale one, while fixes landed only in the app's own copy. A peer dependency removes the possibility itself, not just today's mismatch — this package no longer has the right to carry its own copy of the channel. Behavior is unchanged: the same two exports are used, the socket class and the status enum. **Action required on upgrade**: if you depend on this package directly, declare the channel yourself — `"@solncebro/websocket-engine": ">=0.6.1 <1.0.0"`. Yarn classic does not auto-install peer dependencies, so without that line the package won't find the channel at runtime. If the channel is already in your tree — your own install, or another package that declares it — there is nothing to do.

Previously in `0.22.0` — signed requests are now signed at send time rather than in advance (fixes stale-timestamp `-1021` rejections on Binance/Bybit), and four `ExchangeClient` argument types (`FetchIncomeArgs`, `IncomeTypeFilter`, `ResubscribeOrderbookArgs`, `ResubscribePublicTradesArgs`) that never left the package are now exported.

Previously in `0.21.0` — regular Binance Futures order origin remembered on creation (avoids a redundant `-2013` probe on first read/cancel), `setLeverage` returns the exchange-confirmed value instead of echoing the request, and a `fetchClosedPnl` fix on Binance (was built from a truncated trade sample when a close fragmented into hundreds of fills).

Previously in `0.20.0` — outbound WebSocket command pacing (`OutboundCommandQueue`) to stop resubscribe cascades from tripping Binance's 10-commands/sec connection limit, batched `resubscribeKlineList`, per-connection kline stream sharding via `publicStreamConnectionPacking`, and a nine-stage Binance↔Bybit parity audit (working Bybit trailing stop, `trailingDelta` removed in favor of `callbackRate` everywhere, closing-order intent parity, `workingType` respected on Bybit, spot market-unit default fixed in the batch path).

Previously in `0.18.x` — `fetchIncome` income-type filter, a batch order cancel fix on Binance Futures (`-1130` on every request), the `isTradifi` flag for tokenized TradFi perpetuals, and two Bybit fixes (ticker delta zeroing `indexPrice`, market orders carrying a stray `price`).

Previously in `0.16.0` — public-stream efficiency: opt-in lazy orderbook parse (`ExchangeConfig.lazyOrderbookParse`, Bybit), best bid/ask level 1 on `Ticker` (`bid1Price`/`ask1Price`/…) with a live `subscribeAllTickers` stream, Binance Futures public trades via `@aggTrade`, `fetchOpenConditionalOrders(settleCoin)`, `getMaxOrderQty` / `getMarketMaxOrderQty`, and the lightweight `@solncebro/exchange-engine/public` subpath export.

Full release notes: [CHANGELOG.md](./CHANGELOG.md)

## Features

- 🔀 **Single API for multiple exchanges** — same code works with Binance, Bybit or OKX
- 🎯 **Type-safe unified types** — all responses normalized to consistent types (Kline, Ticker, Position, etc.)
- **REST & WebSocket support** — fetch historical data and subscribe to real-time streams
- 🔄 **Automatic reconnection** — resilient WebSocket connections with exponential backoff
- 📝 **Comprehensive logging** — built-in structured logging via custom logger interface
- 🚀 **Minimal dependencies** — axios, agentkeepalive and websocket-engine

## Installation

`@solncebro/websocket-engine` is a peer dependency — install it alongside this package:

```bash
yarn add @solncebro/exchange-engine "@solncebro/websocket-engine@>=0.6.1 <1.0.0"
```

## Quick Start

```typescript
import { Exchange } from '@solncebro/exchange-engine';
import { pinoLogger } from './logger'; // your logger instance

// Create exchange instance (works identically for 'binance', 'bybit' or 'okx')
const exchange = new Exchange('binance', {
  config: { apiKey: process.env.API_KEY, secret: process.env.API_SECRET },
  logger: pinoLogger,
  onNotify: (msg) => telegramBot.send(msg), // optional notifications
});

const okx = new Exchange('okx', {
  config: {
    apiKey: process.env.OKX_API_KEY,
    secret: process.env.OKX_API_SECRET,
    passphrase: process.env.OKX_PASSPHRASE,
  },
  logger: pinoLogger,
});

// Load trade symbols (markets)
await exchange.futures.loadTradeSymbols();

// Fetch historical klines
const klines = await exchange.futures.fetchKlines('BTCUSDT', '1h', { limit: 100 });
console.log(klines[0]); // { openTimestamp, openPrice, highPrice, lowPrice, closePrice, volume, ... }

// Get current tickers
const tickers = await exchange.futures.fetchTickers();

// Subscribe to real-time klines
exchange.futures.subscribeKlines({
  symbol: 'BTCUSDT',
  interval: '1m',
  handler: (kline) => {
    console.log(`[${kline.openTimestamp}] ${kline.closePrice}`);
  },
});

// Create an order via WebSocket
const order = await exchange.futures.createOrderWebSocket({
  symbol: 'BTCUSDT',
  type: 'market',
  side: 'buy',
  amount: 0.01,
  price: 0, // ignored for market orders
});

// Fetch position info
const position = await exchange.futures.fetchPosition('BTCUSDT');
console.log(`Leverage: ${position.leverage}, Contracts: ${position.contracts}`);

// Set leverage
await exchange.futures.setLeverage(10, 'BTCUSDT');

// Close connection
await exchange.close();
```

## API Reference

### Exchange (Main Entry Point)

```typescript
const exchange = new Exchange('binance' | 'bybit' | 'okx', {
  config: { apiKey: string; secret: string; passphrase?: string; recvWindow?: number };
  logger: ExchangeLogger;
  onNotify?: (message: string) => void | Promise<void>;
});

// Access exchange clients
exchange.futures   // BinanceFutures | BybitLinear | OkxSwap
exchange.spot      // BinanceSpot | BybitSpot | OkxSpot

// Sub-accounts of the master account (Binance, Bybit; OKX and demo mode refuse)
exchange.subAccount.fetchSubAccountList();
exchange.subAccount.transferSubAccountAsset({
  subAccountId, direction: SubAccountTransferDirectionEnum.MasterToSub, asset: 'USDT', amount: 100,
  fromWalletType: WalletTypeEnum.Spot, toWalletType: WalletTypeEnum.UsdtFutures, transferId: randomUUID(),
});

// Cleanup
await exchange.close();
```

### ExchangeClient Interface

All six classes (BinanceFutures, BinanceSpot, BybitLinear, BybitSpot, OkxSwap, OkxSpot) implement this interface.
Which method is available on which market: see the support matrix in [docs/api-reference.md](https://github.com/solncebro/exchange-engine/blob/main/docs/api-reference.md#матрица-поддержки-методов).

#### Market Data (REST)

```typescript
// Load and cache trade symbols (markets)
await client.loadTradeSymbols(): Promise<TradeSymbolBySymbol>;

// Fetch current ticker prices
await client.fetchTickers(): Promise<TickerBySymbol>;

// Fetch historical candlestick data
await client.fetchKlines(
  symbol: string,
  interval: KlineInterval,
  options?: FetchPageWithLimitArgs
): Promise<Kline[]>;

// Get account balance
await client.fetchBalances(): Promise<AccountBalances>;
```

#### Trading (REST + WebSocket)

```typescript
// Create order via WebSocket
await client.createOrderWebSocket({
  symbol: string;
  type: 'market' | 'limit';
  side: 'buy' | 'sell';
  amount: number;
  price: number;
}): Promise<Order>;

// Cancel an order
await client.cancelOrder(symbol: string, orderId: string): Promise<Order>;

// Fetch order history
await client.fetchOrderHistory(symbol: string, options?: FetchPageWithLimitArgs): Promise<Order[]>;

// Fetch open orders
await client.fetchOpenOrders(symbol?: string): Promise<Order[]>;
```

#### Futures-Specific

```typescript
// Fetch position details
await client.fetchPosition(symbol: string): Promise<Position>;

// Set leverage (Binance: 2-125x, Bybit: 1-99.5x)
await client.setLeverage(leverage: number, symbol: string): Promise<SetLeverageResult>;

// Set margin mode
await client.setMarginMode(marginMode: 'isolated' | 'cross', symbol: string): Promise<void>;
```

#### Real-Time Data (WebSocket)

```typescript
// Subscribe to kline updates
client.subscribeKlines({
  symbol: string;
  interval: KlineInterval;
  handler: (kline: Kline) => void;
}): void;

// Unsubscribe
client.unsubscribeKlines({ symbol, interval, handler }): void;
```

#### Precision

```typescript
// Format amount to exchange precision
const formatted = client.amountToPrecision('BTCUSDT', 0.12345);

// Format price to exchange precision
const formatted = client.priceToPrecision('BTCUSDT', 65432.1);

// Direction of the rounding: 'nearest' (default), 'up' (never below the value), 'down' (never above)
const sellLimitPrice = client.priceToPrecision('BTCUSDT', 65432.13, 'up');
```

### Unified Types

All types are normalized across exchanges. No raw exchange formats leak out.

```typescript
// Candlestick
interface Kline {
  openTimestamp: number;
  openPrice: number;
  highPrice: number;
  lowPrice: number;
  closePrice: number;
  volume: number;
  closeTimestamp: number;
  quoteAssetVolume: number;
  numberOfTrades: number;
  isClosed?: boolean;
}

// Current price
interface Ticker {
  symbol: string;
  lastPrice: number;
  priceChangePercent: number; // 24h change %
  timestamp: number;
}

// Trade symbol (market metadata)
interface TradeSymbol {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  settle: string;
  isActive: boolean;
  type: 'spot' | 'swap' | 'future';
  isLinear: boolean;
  contractSize: number;
  contractType: string;
  filter: TradeSymbolFilter;
}

// Open position (futures)
interface Position {
  symbol: string;
  side: 'long' | 'short' | 'both';
  contracts: number;
  entryPrice: number;
  markPrice: number;
  unrealizedPnl: number;
  leverage: number;
  marginMode: 'isolated' | 'cross';
  liquidationPrice: number;
  info: Record<string, unknown>; // raw exchange data
}

// Placed order
interface Order {
  id: string;
  clientOrderId: string;
  symbol: string;
  side: 'Buy' | 'Sell';
  type: 'Market' | 'Limit' | 'StopMarket' | 'TakeProfit' | 'TrailingStop';
  amount: number;
  price: number;
  filledAmount: number;
  status: 'open' | 'closed' | 'canceled' | 'rejected';
  timestamp: number;
}

// Account balance
interface Balance {
  asset: string;
  free: number;
  locked: number;
  total: number;
}

// Account balances
interface AccountBalances {
  balanceByAsset: BalanceByAsset; // Map<string, Balance>
  totalWalletBalance: number;
  totalAvailableBalance: number;
}
```

## Logger Interface

Provide any logger that implements this interface:

```typescript
interface ExchangeLogger {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  fatal(message: string): void;
}
```

### Example with Pino

```typescript
import pino from 'pino';

const logger = pino({
  level: 'info',
  transport: {
    target: 'pino-pretty',
    options: { colorize: true },
  },
});

const exchange = new Exchange('binance', {
  config: { apiKey, secret },
  logger, // pino instance is compatible
});
```

## Exchange Differences

### API Keys & Permissions

- **Binance**: Read, Trade, Withdraw permissions (for different features)
- **Bybit**: Single API key handles all
- **OKX:** для закрытых HTTP-запросов нужны ключ, секрет и кодовая фраза (`ExchangeConfig.passphrase`). Для публичного чтения все три значения можно оставить пустыми. Ключ или секрет без кодовой фразы отклоняются при создании клиента. Доказательство: `src/http/OkxHttpClient.ts:103` и `src/http/OkxHttpClient.ts:124`.

### Order Placement

- **Binance**: `createOrderWebSocket()` prefers WebSocket with REST fallback
- **Bybit**: `createOrderWebSocket()` uses dedicated trade WebSocket stream
- **OKX**: `createOrderWebSocket()` uses the trade WebSocket when it is connected and healthy, REST otherwise; conditional orders (stop / take-profit / trailing) always go over REST, to OKX's separate algo-order service

### Position Modes

- **Binance**: Supports Hedge Mode (separate long/short) and One-Way Mode
- **Bybit**: Always supports both buy and sell sides simultaneously
- **OKX**: account-level mode read from `/api/v5/account/config` — `long_short_mode` maps to Hedge, `net_mode` to One-Way

### Margin Mode

- **Binance**, **Bybit**: a property of the symbol/account, changed on the exchange
- **OKX**: sent with every order, so `setMarginMode()` only remembers the choice in the client and applies it to subsequent orders (defaults to cross, and the memory is empty after a restart)

### Order Sizes

- **Binance**, **Bybit**: sizes are in coins on the wire
- **OKX**: perpetual sizes are in contracts on the wire; the client converts to and from coins, so the public API stays in coins on all three exchanges

### Funding Rates

- **Binance**: 8 times per day at fixed UTC times
- **Bybit**: Hourly funding
- **OKX**: interval is read per instrument from the exchange (the gap between the current and the next settlement), not assumed

These differences are transparent — the same code works for all three.

## Performance Tips

1. **Batch requests** — use `Promise.all()` for multiple operations
   ```typescript
   const [tickers, position, balance] = await Promise.all([
     client.fetchTickers(),
     client.fetchPosition('BTCUSDT'),
     client.fetchBalances(),
   ]);
   ```

2. **Reuse trade symbols** — call `loadTradeSymbols()` once at startup
   ```typescript
   const tradeSymbols = await client.loadTradeSymbols();
   const symbols = [...tradeSymbols.keys()];
   ```

3. **Limit historical data** — fetch only needed range
   ```typescript
   const klines = await client.fetchKlines('BTCUSDT', '1h', {
     limit: 100,
     startTime: Date.now() - 100 * 60 * 60 * 1000, // last 100 hours
   });
   ```

4. **Subscribe instead of polling** — WebSocket is more efficient
   ```typescript
   // Instead of:
   setInterval(() => fetchTickers(), 5000);

   // Use:
   client.subscribeKlines({ symbol, interval, handler });
   ```

## Error Handling

Exchange-specific errors are thrown as `ExchangeError` with structured `code` and `exchange` fields:

Binance futures returns no-op validation responses for unchanged settings. Codes `-4059` (`No need to change position side.`) and `-4046` (`No need to change margin type.`) are handled as successful no-op operations in `setPositionMode()` and `setMarginMode()`.

```typescript
import { ExchangeError } from '@solncebro/exchange-engine';

try {
  await exchange.futures.setLeverage(100, 'BTCUSDT');
} catch (error) {
  if (error instanceof ExchangeError) {
    console.error(`[${error.exchange}] Error ${error.code}: ${error.message}`);
  }
}
```

## Extending the Library

Adding new endpoints follows a standard pattern:

1. **HTTP Client** → add method to `BinanceFuturesHttpClient` or `BybitHttpClient`
2. **Normalizer** → add raw type + normalization function
3. **Interface** → add method to `ExchangeClient`
4. **Implementation** → implement in all 4 exchange classes

Example: adding `fetchOpenInterest(symbol)`

```typescript
// 1. In BinanceFuturesHttpClient
private async fetchOpenInterestRaw(symbol: string): Promise<BinanceRawOpenInterest> {
  return this.get('/fapi/v1/openInterest', { symbol });
}

// 2. In binanceNormalizer.ts
export function normalizeOpenInterest(raw: BinanceRawOpenInterest): OpenInterest {
  return { symbol: raw.symbol, openInterest: parseFloat(raw.openInterest) };
}

// 3. In ExchangeClient interface
fetchOpenInterest(symbol: string): Promise<OpenInterest>;

// 4. In BinanceFutures
async fetchOpenInterest(symbol: string): Promise<OpenInterest> {
  const raw = await this.httpClient.fetchOpenInterestRaw(symbol);
  return normalizeOpenInterest(raw);
}
```

## License

MIT

## Support

- GitHub Issues: [solncebro/exchange-engine](https://github.com/solncebro/exchange-engine/issues)
- Documentation: See inline JSDoc comments
- Examples: Check `examples/` directory
