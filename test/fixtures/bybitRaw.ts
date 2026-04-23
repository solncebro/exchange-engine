import type {
  BybitInstrumentInfoRaw,
  BybitTickerRaw,
  BybitWebSocketKlineRaw,
  BybitPositionRaw,
  BybitOrderResponseRaw,
  BybitWalletBalanceRaw,
  BybitOrderBookRaw,
  BybitPublicTradeRaw,
  BybitOpenInterestRaw,
  BybitFeeRateRaw,
  BybitFundingRateHistoryRaw,
  BybitClosedPnlRaw,
  BybitTransactionLogRaw,
} from '../../src/normalizers/bybitNormalizer';

export const BYBIT_RAW_INSTRUMENT_LIST: BybitInstrumentInfoRaw[] = [
  {
    symbol: 'BTCUSDT',
    status: 'Trading',
    baseCoin: 'BTC',
    quoteCoin: 'USDT',
    settleCoin: 'USDT',
    contractType: 'LinearPerpetual',
    contractSize: '0.01',
    lotSizeFilter: {
      qtyStep: '0.001',
      minOrderQty: '0.001',
      maxOrderQty: '100',
      minNotionalValue: '5',
      postOnlyMaxOrderQty: '1500.000',
      maxMktOrderQty: '150.000',
    },
    priceFilter: { tickSize: '0.10', minPrice: '0.10', maxPrice: '1999999.80' },
    leverageFilter: { minLeverage: '1', maxLeverage: '100.00', leverageStep: '0.01' },
    launchTime: '1584230400000',
    priceScale: '2',
    unifiedMarginTrade: true,
    fundingInterval: 480,
    upperFundingRate: '0.005',
    lowerFundingRate: '-0.005',
    isPreListing: false,
    riskParameters: { priceLimitRatioX: '0.01', priceLimitRatioY: '0.02' },
  },
  {
    symbol: 'ETHBTC',
    status: 'Trading',
    baseCoin: 'ETH',
    quoteCoin: 'BTC',
    lotSizeFilter: { basePrecision: '0.01', minOrderQty: '0.01', maxOrderQty: '10000', minOrderAmt: '0.0001' },
    priceFilter: { tickSize: '0.000001' },
  },
];

export const BYBIT_RAW_TICKER_LIST: BybitTickerRaw[] = [
  { symbol: 'BTCUSDT', lastPrice: '65432.10', prevPrice24h: '63900.00', highPrice24h: '66000.00', lowPrice24h: '63500.00', price24hPcnt: '0.0235', volume24h: '12345.67', turnover24h: '805000000.00', time: 1700000000000 },
  { symbol: 'ETHUSDT', lastPrice: '3456.78', prevPrice24h: '3498.78', highPrice24h: '3550.00', lowPrice24h: '3400.00', price24hPcnt: '-0.0120', volume24h: '98765.43', turnover24h: '340000000.00' },
];

export const BYBIT_RAW_KLINE_LIST: string[][] = [
  ['1700003600000', '65500.00', '67000.00', '65000.00', '66800.00', '2345.67', '155000000.00'],
  ['1700000000000', '65000.00', '66000.00', '64000.00', '65500.00', '1234.56', '80500000.00'],
];

export const BYBIT_RAW_WEBSOCKET_KLINE: BybitWebSocketKlineRaw = {
  start: 1700000000000,
  open: '65000.00',
  high: '66000.00',
  low: '64000.00',
  close: '65500.00',
  volume: '1234.56',
  turnover: '80500000.00',
  confirm: true,
  timestamp: 1700003600000,
};

export const BYBIT_RAW_POSITION: BybitPositionRaw = {
  symbol: 'BTCUSDT',
  side: 'Buy',
  size: '0.100',
  avgPrice: '65000.00',
  markPrice: '65500.00',
  unrealisedPnl: '50.00',
  leverage: '10',
  tradeMode: 1,
  liqPrice: '60000.00',
  positionIdx: 1,
};

export const BYBIT_RAW_ORDER_RESPONSE: BybitOrderResponseRaw = {
  orderId: 'abc-123-def',
  orderLinkId: 'myBybitOrder123',
  symbol: 'BTCUSDT',
  side: 'Buy',
  orderType: 'Limit',
  timeInForce: 'GTC',
  qty: '0.100',
  price: '65000.00',
  avgPrice: '64950.00',
  triggerPrice: '0',
  cumExecQty: '0.100',
  cumExecValue: '6495.00',
  orderStatus: 'Filled',
  reduceOnly: false,
  createdTime: '1700000000000',
  updatedTime: '1700000010000',
};

export const BYBIT_RAW_INSTRUMENT_FUTURES: BybitInstrumentInfoRaw = {
  symbol: 'BTCUSD',
  status: 'Trading',
  baseCoin: 'BTC',
  quoteCoin: 'USD',
  settleCoin: 'BTC',
  contractType: 'InverseFutures',
  contractSize: '1',
  lotSizeFilter: { qtyStep: '1', minOrderQty: '1', maxOrderQty: '1000000', minNotionalValue: '1' },
  priceFilter: { tickSize: '0.50' },
};

export const BYBIT_RAW_INSTRUMENT_NO_FILTERS: BybitInstrumentInfoRaw = {
  symbol: 'XYZUSDT',
  status: 'Trading',
  baseCoin: 'XYZ',
  quoteCoin: 'USDT',
  settleCoin: 'USDT',
  contractType: 'LinearPerpetual',
  contractSize: '0.1',
  lotSizeFilter: undefined,
  priceFilter: undefined,
};

export const BYBIT_RAW_WALLET_BALANCE: BybitWalletBalanceRaw = {
  list: [
    { accountType: 'UNIFIED', totalWalletBalance: '1801.10', totalAvailableBalance: '1501.10', totalMarginBalance: '1801.10', totalInitialMargin: '300.00', coin: [
      { coin: 'USDT', availableToWithdraw: '', walletBalance: '1200.50', totalOrderIM: '200', totalPositionIM: '0', locked: '200.00' },
      { coin: 'BTC', availableToWithdraw: '', walletBalance: '0.6', totalOrderIM: '0.1', totalPositionIM: '0', locked: '0.1' },
      { coin: 'DOGE', walletBalance: '0', totalOrderIM: '0', totalPositionIM: '0', locked: '0' },
    ]},
    { accountType: 'UNIFIED', coin: [
      { coin: 'USDT', availableToWithdraw: '', walletBalance: '600.00', totalOrderIM: '100', totalPositionIM: '0', locked: '100.00' },
    ]},
  ],
};

export const BYBIT_RAW_ORDER_BOOK: BybitOrderBookRaw = {
  a: [['65001.00', '0.800'], ['65002.00', '1.200']],
  b: [['65000.00', '1.500'], ['64999.00', '2.300']],
  ts: 1700000000000,
  u: 123456,
};

export const BYBIT_RAW_PUBLIC_TRADE_LIST: BybitPublicTradeRaw[] = [
  { execId: 'exec-1', symbol: 'BTCUSDT', price: '65000.50', size: '0.100', side: 'Buy', time: '1700000000000', isBlockTrade: false },
  { execId: 'exec-2', symbol: 'BTCUSDT', price: '65001.00', size: '0.200', side: 'Sell', time: '1700000001000', isBlockTrade: false },
];

export const BYBIT_RAW_MARK_PRICE_TICKER_LIST: BybitTickerRaw[] = [
  { symbol: 'BTCUSDT', lastPrice: '65432.10', prevPrice24h: '63900.00', highPrice24h: '66000.00', lowPrice24h: '63500.00', price24hPcnt: '0.0235', volume24h: '12345.67', turnover24h: '805000000.00', markPrice: '65450.50', indexPrice: '65440.20', fundingRate: '0.0001', nextFundingTime: '1700028800000', time: 1700000000000 },
  { symbol: 'ETHUSDT', lastPrice: '3456.78', prevPrice24h: '3498.78', highPrice24h: '3550.00', lowPrice24h: '3400.00', price24hPcnt: '-0.0120', volume24h: '98765.43', turnover24h: '340000000.00', markPrice: '3458.30', indexPrice: '3457.10', fundingRate: '-0.00005', nextFundingTime: '1700028800000', time: 1700000000000 },
];

export const BYBIT_RAW_OPEN_INTEREST: BybitOpenInterestRaw = {
  openInterest: '12345.678',
  timestamp: '1700000000000',
};

export const BYBIT_RAW_FEE_RATE_LIST: BybitFeeRateRaw[] = [
  { symbol: 'BTCUSDT', makerFeeRate: '0.0001', takerFeeRate: '0.0006' },
  { symbol: 'ETHUSDT', makerFeeRate: '0.0001', takerFeeRate: '0.0006' },
];

export const BYBIT_RAW_FUNDING_RATE_HISTORY_LIST: BybitFundingRateHistoryRaw[] = [
  { symbol: 'BTCUSDT', fundingRate: '0.0001', fundingRateTimestamp: '1700000000000' },
  { symbol: 'BTCUSDT', fundingRate: '0.00015', fundingRateTimestamp: '1700028800000' },
];

export const BYBIT_RAW_CLOSED_PNL_LIST: BybitClosedPnlRaw[] = [
  { symbol: 'BTCUSDT', orderId: 'order-1', side: 'Buy', qty: '0.100', avgEntryPrice: '64000.00', avgExitPrice: '65000.00', closedPnl: '100.00', createdTime: '1700000000000' },
];

export const BYBIT_RAW_TRANSACTION_LOG_LIST: BybitTransactionLogRaw[] = [
  { symbol: 'BTCUSDT', type: 'TRADE', qty: '0.100', cashFlow: '-6500.00', currency: 'USDT', transactionTime: '1700000000000', tradeId: 'trade-1', orderId: 'order-1' },
  { symbol: 'ETHUSDT', type: 'FUNDING', qty: '0', cashFlow: '0.50', currency: 'USDT', transactionTime: '1700000001000', tradeId: '', orderId: '' },
];
