# @solncebro/exchange-engine

Universal TypeScript client library for cryptocurrency trading on Binance and Bybit with unified API, WebSocket support, and native type safety.

## Features

- 🔀 **Single API for multiple exchanges** — same code works with Binance or Bybit
- 🎯 **Type-safe unified types** — all responses normalized to consistent types (Kline, Ticker, Position, etc.)
- 📊 **REST & WebSocket support** — fetch historical data and subscribe to real-time streams
- 🔄 **Automatic reconnection** — resilient WebSocket connections with exponential backoff
- 📝 **Comprehensive logging** — built-in structured logging via custom logger interface
- 🚀 **Zero dependencies** — only axios and websocket-engine

## Installation

```bash
npm install @solncebro/exchange-engine
# or
yarn add @solncebro/exchange-engine
```

## Quick Start

```typescript
import { Exchange } from '@solncebro/exchange-engine';
import { pinoLogger } from './logger'; // your logger instance

// Create exchange instance (works identically for 'binance' or 'bybit')
const exchange = new Exchange('binance', {
  config: { apiKey: process.env.API_KEY, secret: process.env.API_SECRET },
  logger: pinoLogger,
  onNotify: (msg) => telegramBot.send(msg), // optional notifications
});

// Load markets
await exchange.futures.loadMarkets();

// Fetch historical klines
const klines = await exchange.futures.fetchKlines('BTCUSDT', '1h', { limit: 100 });
console.log(klines[0]); // { openTime, open, high, low, close, volume, ... }

// Get current tickers
const tickers = await exchange.futures.fetchTickers();

// Subscribe to real-time klines
exchange.futures.subscribeKlines({
  symbol: 'BTCUSDT',
  interval: '1m',
  handler: (kline) => {
    console.log(`[${kline.openTime}] ${kline.close}`);
  },
});

// Create an order
const order = await exchange.futures.createOrderWs({
  symbol: 'BTCUSDT',
  type: 'market',
  side: 'buy',
  amount: 0.01,
  price: 0, // ignored for market orders
  params: {}, // exchange-specific params
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
const exchange = new Exchange('binance' | 'bybit', {
  config: { apiKey: string; secret: string; recvWindow?: number };
  logger: ExchangeLogger;
  onNotify?: (message: string) => void | Promise<void>;
});

// Access exchange clients
exchange.futures   // BinanceFutures | BybitLinear
exchange.spot      // BinanceSpot | BybitSpot

// Cleanup
await exchange.close();
```

### ExchangeClient Interface

All four classes (BinanceFutures, BinanceSpot, BybitLinear, BybitSpot) implement this interface:

#### Market Data (REST)

```typescript
// Load and cache market information
await client.loadMarkets(reload?: boolean): Promise<MarketBySymbol>;

// Get all markets (already loaded)
const markets = client.markets; // Record<string, Market>

// Fetch current ticker prices
await client.fetchTickers(): Promise<TickerBySymbol>;

// Fetch historical candlestick data
await client.fetchKlines(
  symbol: string,
  interval: KlineInterval,
  opts?: { limit?: number; startTime?: number; endTime?: number }
): Promise<Kline[]>;

// Get account balance
await client.fetchBalance(): Promise<BalanceByAsset>;
```

#### Trading (REST + WebSocket)

```typescript
// Create order via WebSocket (recommended for speed)
await client.createOrderWs({
  symbol: string;
  type: 'market' | 'limit';
  side: 'buy' | 'sell';
  amount: number;
  price: number;
  params?: Record<string, unknown>; // hedgeMode, timeInForce, etc.
}): Promise<Order>;
```

#### Futures-Specific

```typescript
// Fetch position details
await client.fetchPosition(symbol: string): Promise<Position>;

// Set leverage (Binance: 2-125x, Bybit: 1-99.5x)
await client.setLeverage(leverage: number, symbol: string): Promise<void>;

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
```

### Unified Types

All types are normalized across exchanges. No raw exchange formats leak out.

```typescript
// Candlestick
interface Kline {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
  quoteVolume: number;
  trades: number;
}

// Current price
interface Ticker {
  symbol: string;
  close: number;
  percentage: number; // 24h change %
  timestamp: number;
}

// Market metadata
interface Market {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  settle: string;
  active: boolean;
  type: 'spot' | 'swap' | 'future';
  linear: boolean;
  contractSize: number;
  filter: MarketFilter;
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
  symbol: string;
  side: 'buy' | 'sell';
  type: 'market' | 'limit';
  amount: number;
  price: number;
  status: string;
  timestamp: number;
}

// Account balance
interface Balance {
  asset: string;
  free: number;
  locked: number;
  total: number;
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

### Order Placement

- **Binance**: `createOrderWs()` uses REST (faster than WS)
- **Bybit**: `createOrderWs()` uses dedicated trade WebSocket stream

### Position Modes

- **Binance**: Supports Hedge Mode (separate long/short) and One-Way Mode
- **Bybit**: Always supports both buy and sell sides simultaneously

### Funding Rates

- **Binance**: 8 times per day at fixed UTC times
- **Bybit**: Hourly funding

These differences are transparent — the same code works for both.

## Performance Tips

1. **Batch requests** — use `Promise.all()` for multiple operations
   ```typescript
   const [tickers, position, balance] = await Promise.all([
     client.fetchTickers(),
     client.fetchPosition('BTCUSDT'),
     client.fetchBalance(),
   ]);
   ```

2. **Reuse markets** — call `loadMarkets()` once at startup
   ```typescript
   await client.loadMarkets();
   const symbols = Object.keys(client.markets);
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

All errors are logged and thrown. Wrap calls in try-catch:

```typescript
try {
  await exchange.futures.setLeverage(100, 'BTCUSDT');
} catch (error) {
  console.error(`Failed to set leverage: ${error.message}`);
  // error has code, status, response fields for detailed handling
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
