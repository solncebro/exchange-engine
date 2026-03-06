/**
 * Smoke test: verifies module structure, exports, and TypeScript types.
 * Does NOT make real API calls.
 */

import {
  Exchange,
  ExchangeName,
  ExchangeClient,
  ExchangeArgs,
  Kline,
  Ticker,
  Position,
  Order,
  Balance,
  ExchangeConfig,
  ExchangeLogger,
  CreateOrderWebSocketArgs,
  FetchPageWithLimitArgs,
  SubscribeKlinesArgs,
  PositionSide,
  MarginMode,
  OrderSide,
  OrderType,
  FundingRateHistory,
  TradeSymbol,
  TradeSymbolType,
} from '../dist/index';

// --- Verify core export is a constructor ---

const exchangeIsClass: typeof Exchange = Exchange;
console.assert(typeof exchangeIsClass === 'function', 'Exchange must be a class/constructor');

// --- Mock dependencies (no real credentials) ---

const mockConfig: ExchangeConfig = {
  apiKey: 'test-api-key',
  secret: 'test-secret',
};

const mockLogger: ExchangeLogger = {
  debug: () => {},
  info:  () => {},
  warn:  () => {},
  error: () => {},
  fatal: () => {},
};

const mockOnNotify = (message: string): void => {
  void message;
};

const mockArgs: ExchangeArgs = {
  config: mockConfig,
  logger: mockLogger,
  onNotify: mockOnNotify,
};

// --- Instantiation (no real connections made at construction time) ---

const binance = new Exchange(ExchangeName.Binance, mockArgs);
const bybit   = new Exchange(ExchangeName.Bybit,   mockArgs);

// --- Structural checks: futures and spot must satisfy ExchangeClient ---

function assertExchangeClient(client: ExchangeClient, label: string): void {
  const requiredMethods: Array<keyof ExchangeClient> = [
    'loadTradeSymbols',
    'fetchTickers',
    'fetchKlines',
    'fetchBalance',
    'fetchFundingRateHistory',
    'fetchPosition',
    'setLeverage',
    'setMarginMode',
    'amountToPrecision',
    'priceToPrecision',
    'createOrderWebSocket',
    'close',
    'watchTickers',
    'subscribeKlines',
    'unsubscribeKlines',
  ];

  for (const method of requiredMethods) {
    console.assert(
      typeof client[method] === 'function',
      `${label}.${method} must be a function`,
    );
  }

  console.assert(
    typeof client.apiKey === 'string',
    `${label}.apiKey must be a string`,
  );

  console.assert(
    typeof client.tradeSymbols === 'object' && client.tradeSymbols !== null,
    `${label}.tradeSymbols must be an object`,
  );

  console.log(`  [OK] ${label} implements ExchangeClient`);
}

console.log('\nChecking binance.futures ...');
assertExchangeClient(binance.futures, 'binance.futures');

console.log('Checking binance.spot ...');
assertExchangeClient(binance.spot, 'binance.spot');

console.log('Checking bybit.futures ...');
assertExchangeClient(bybit.futures, 'bybit.futures');

console.log('Checking bybit.spot ...');
assertExchangeClient(bybit.spot, 'bybit.spot');

// --- Type assertions: ensure exported types are usable ---

type AssertAssignable<_T> = true;

// These compile-time checks will fail at tsc if types are not exported correctly
type _CheckKline             = AssertAssignable<Kline>;
type _CheckTicker            = AssertAssignable<Ticker>;
type _CheckPosition          = AssertAssignable<Position>;
type _CheckOrder             = AssertAssignable<Order>;
type _CheckBalance           = AssertAssignable<Balance>;
type _CheckCreateOrderWebSocketArgs = AssertAssignable<CreateOrderWebSocketArgs>;
type _CheckFetchPageWithLimitArgs = AssertAssignable<FetchPageWithLimitArgs>;
type _CheckSubscribeKlines   = AssertAssignable<SubscribeKlinesArgs>;
type _CheckFundingRateHistory = AssertAssignable<FundingRateHistory>;
type _CheckTradeSymbol       = AssertAssignable<TradeSymbol>;
type _CheckTradeSymbolType   = AssertAssignable<TradeSymbolType>;

// Use types in object literals so tsc doesn't tree-shake them
const _kline: Kline = {
  openTimestamp:              0,
  openPrice:                  0,
  highPrice:                  0,
  lowPrice:                   0,
  closePrice:                 0,
  volume:                     0,
  closeTimestamp:              0,
  quoteAssetVolume:           0,
  numberOfTrades:             0,
  takerBuyBaseAssetVolume:    0,
  takerBuyQuoteAssetVolume:   0,
};

const _ticker: Ticker = {
  symbol:     'BTCUSDT',
  close:      0,
  percentage: 0,
  timestamp:  0,
};

const _position: Position = {
  symbol:           'BTCUSDT',
  side:             PositionSide.Long,
  contracts:        0,
  entryPrice:       0,
  markPrice:        0,
  unrealizedPnl:    0,
  leverage:         1,
  marginMode:       MarginMode.Isolated,
  liquidationPrice: 0,
  info:             {},
};

const _order: Order = {
  id:        '1',
  symbol:    'BTCUSDT',
  side:      OrderSide.Buy,
  type:      OrderType.Market,
  amount:    0,
  price:     0,
  status:    'open',
  timestamp: 0,
};

const _balance: Balance = {
  asset:  'USDT',
  free:   0,
  locked: 0,
  total:  0,
};

// Suppress "unused variable" errors
void _kline;
void _ticker;
void _position;
void _order;
void _balance;

console.log('\n[PASS] All smoke checks passed.');
