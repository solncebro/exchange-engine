import {
  Exchange,
  ExchangeNameEnum,
  ExchangeClient,
  ExchangeArgs,
  Kline,
  KlineInterval,
  KlineHandler,
  Ticker,
  TickerBySymbol,
  Position,
  Order,
  Balance,
  BalanceByAsset,
  AccountBalances,
  ExchangeConfig,
  ExchangeLogger,
  CreateOrderWebSocketArgs,
  FetchAllKlinesOptions,
  FetchPageWithLimitArgs,
  ModifyOrderArgs,
  SubscribeKlinesArgs,
  PositionSideEnum,
  PositionModeEnum,
  MarginModeEnum,
  OrderSideEnum,
  OrderTypeEnum,
  TimeInForceEnum,
  WorkingTypeEnum,
  TradeSymbolTypeEnum,
  FundingRateHistory,
  FundingInfo,
  TradeSymbol,
  TradeSymbolBySymbol,
  TradeSymbolFilter,
  OrderBook,
  OrderBookLevel,
  PublicTrade,
  MarkPrice,
  OpenInterest,
  FeeRate,
  Income,
  ClosedPnl,
} from '../dist/index';

const exchangeIsClass: typeof Exchange = Exchange;
console.assert(typeof exchangeIsClass === 'function', 'Exchange must be a class/constructor');

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

const binance = new Exchange(ExchangeNameEnum.Binance, mockArgs);
const bybit   = new Exchange(ExchangeNameEnum.Bybit,   mockArgs);

function assertExchangeClient(client: ExchangeClient, label: string): void {
  const requiredMethodList: Array<keyof ExchangeClient> = [
    'loadTradeSymbols',
    'fetchTickers',
    'fetchKlines',
    'fetchAllKlines',
    'fetchBalances',
    'fetchFundingRateHistory',
    'fetchFundingInfo',
    'fetchPosition',
    'fetchPositionMode',
    'fetchOrderHistory',
    'setLeverage',
    'setMarginMode',
    'amountToPrecision',
    'priceToPrecision',
    'getMinOrderQty',
    'getMinNotional',
    'createOrderWebSocket',
    'cancelOrder',
    'getOrder',
    'fetchOpenOrders',
    'modifyOrder',
    'cancelAllOrders',
    'createBatchOrders',
    'cancelBatchOrders',
    'fetchOrderBook',
    'fetchTrades',
    'fetchMarkPrice',
    'fetchOpenInterest',
    'fetchFeeRate',
    'fetchIncome',
    'fetchClosedPnl',
    'setPositionMode',
    'close',
    'watchTickers',
    'subscribeKlines',
    'unsubscribeKlines',
  ];

  for (const method of requiredMethodList) {
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
    client.tradeSymbols instanceof Map,
    `${label}.tradeSymbols must be a Map`,
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

console.assert(
  Object.values(ExchangeNameEnum).length === 2,
  'ExchangeNameEnum must have 2 values',
);

console.assert(
  Object.values(OrderSideEnum).length === 2,
  'OrderSideEnum must have 2 values',
);

console.assert(
  Object.values(OrderTypeEnum).length >= 2,
  'OrderTypeEnum must have at least 2 values',
);

console.assert(
  Object.values(MarginModeEnum).length === 2,
  'MarginModeEnum must have 2 values',
);

console.assert(
  Object.values(PositionSideEnum).length === 3,
  'PositionSideEnum must have 3 values',
);

console.assert(
  Object.values(PositionModeEnum).length === 2,
  'PositionModeEnum must have 2 values',
);

console.assert(
  Object.values(TradeSymbolTypeEnum).length === 3,
  'TradeSymbolTypeEnum must have 3 values',
);

console.assert(
  Object.values(TimeInForceEnum).length === 4,
  'TimeInForceEnum must have 4 values',
);

console.assert(
  Object.values(WorkingTypeEnum).length === 2,
  'WorkingTypeEnum must have 2 values',
);

type AssertAssignable<_T> = true;

type _CheckKline             = AssertAssignable<Kline>;
type _CheckKlineInterval     = AssertAssignable<KlineInterval>;
type _CheckKlineHandler      = AssertAssignable<KlineHandler>;
type _CheckTicker            = AssertAssignable<Ticker>;
type _CheckTickerBySymbol    = AssertAssignable<TickerBySymbol>;
type _CheckPosition          = AssertAssignable<Position>;
type _CheckOrder             = AssertAssignable<Order>;
type _CheckBalance           = AssertAssignable<Balance>;
type _CheckBalanceByAsset    = AssertAssignable<BalanceByAsset>;
type _CheckAccountBalances   = AssertAssignable<AccountBalances>;
type _CheckCreateOrderArgs   = AssertAssignable<CreateOrderWebSocketArgs>;
type _CheckFetchAllKlinesOptions = AssertAssignable<FetchAllKlinesOptions>;
type _CheckFetchPageArgs     = AssertAssignable<FetchPageWithLimitArgs>;
type _CheckSubscribeKlines   = AssertAssignable<SubscribeKlinesArgs>;
type _CheckFundingHistory    = AssertAssignable<FundingRateHistory>;
type _CheckFundingInfo       = AssertAssignable<FundingInfo>;
type _CheckTradeSymbol       = AssertAssignable<TradeSymbol>;
type _CheckTradeSymbolBySymbol = AssertAssignable<TradeSymbolBySymbol>;
type _CheckTradeSymbolFilter = AssertAssignable<TradeSymbolFilter>;
type _CheckModifyOrderArgs  = AssertAssignable<ModifyOrderArgs>;
type _CheckOrderBook        = AssertAssignable<OrderBook>;
type _CheckOrderBookLevel   = AssertAssignable<OrderBookLevel>;
type _CheckPublicTrade      = AssertAssignable<PublicTrade>;
type _CheckMarkPrice        = AssertAssignable<MarkPrice>;
type _CheckOpenInterest     = AssertAssignable<OpenInterest>;
type _CheckFeeRate          = AssertAssignable<FeeRate>;
type _CheckIncome           = AssertAssignable<Income>;
type _CheckClosedPnl        = AssertAssignable<ClosedPnl>;

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
  symbol:             'BTCUSDT',
  lastPrice:          0,
  openPrice:          0,
  highPrice:          0,
  lowPrice:           0,
  priceChangePercent: 0,
  volume:             0,
  quoteVolume:        0,
  timestamp:          0,
};

const _position: Position = {
  symbol:           'BTCUSDT',
  side:             PositionSideEnum.Long,
  contracts:        0,
  entryPrice:       0,
  markPrice:        0,
  unrealizedPnl:    0,
  leverage:         1,
  marginMode:       MarginModeEnum.Isolated,
  liquidationPrice: 0,
  info:             {},
};

const _order: Order = {
  id:                '1',
  clientOrderId:     '',
  symbol:            'BTCUSDT',
  side:              OrderSideEnum.Buy,
  type:              OrderTypeEnum.Market,
  timeInForce:       TimeInForceEnum.Gtc,
  price:             0,
  avgPrice:          0,
  stopPrice:         0,
  amount:            0,
  filledAmount:      0,
  filledQuoteAmount: 0,
  status:            'open',
  reduceOnly:        false,
  timestamp:         0,
  updatedTimestamp:   0,
};

const _balance: Balance = {
  asset:  'USDT',
  free:   0,
  locked: 0,
  total:  0,
};

const _fundingInfo: FundingInfo = {
  symbol:                   'BTCUSDT',
  fundingIntervalHours:     8,
  adjustedFundingRateCap:   0.02,
  adjustedFundingRateFloor: -0.02,
};

const _fundingRateHistory: FundingRateHistory = {
  symbol:      'BTCUSDT',
  fundingRate: 0.0001,
  fundingTime: 1700000000000,
  markPrice:   65000,
};

const _tradeSymbolFilter: TradeSymbolFilter = {
  tickSize:    '0.01',
  stepSize:    '0.001',
  minQty:      '0.001',
  maxQty:      '1000',
  minNotional: '5',
};

const _tradeSymbol: TradeSymbol = {
  symbol:       'BTCUSDT',
  baseAsset:    'BTC',
  quoteAsset:   'USDT',
  settle:       'USDT',
  isActive:     true,
  type:         TradeSymbolTypeEnum.Swap,
  isLinear:     true,
  contractSize: 1,
  contractType: 'PERPETUAL',
  filter:       _tradeSymbolFilter,
};

void _kline;
void _ticker;
void _position;
void _order;
void _balance;
void _fundingInfo;
void _fundingRateHistory;
void _tradeSymbol;

console.log('\n[PASS] All smoke checks passed.');
