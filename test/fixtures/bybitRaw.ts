import type {
  BybitInstrumentInfoRaw,
  BybitTickerRaw,
  BybitWebSocketKlineRaw,
  BybitPositionRaw,
  BybitOrderResponseRaw,
  BybitWalletBalanceRaw,
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
    lotSizeFilter: { qtyStep: '0.001', minOrderQty: '0.001', maxOrderQty: '100', minNotionalValue: '5' },
    priceFilter: { tickSize: '0.10' },
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
  ['1700000000000', '65000.00', '66000.00', '64000.00', '65500.00', '1234.56', '80500000.00'],
  ['1700003600000', '65500.00', '67000.00', '65000.00', '66800.00', '2345.67', '155000000.00'],
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

export const BYBIT_RAW_WALLET_BALANCE: BybitWalletBalanceRaw = {
  list: [
    { accountType: 'UNIFIED', coin: [
      { coin: 'USDT', availableToWithdraw: '', walletBalance: '1200.50', totalOrderIM: '200', totalPositionIM: '0', locked: '200.00' },
      { coin: 'BTC', availableToWithdraw: '', walletBalance: '0.6', totalOrderIM: '0.1', totalPositionIM: '0', locked: '0.1' },
      { coin: 'DOGE', walletBalance: '0', totalOrderIM: '0', totalPositionIM: '0', locked: '0' },
    ]},
    { accountType: 'UNIFIED', coin: [
      { coin: 'USDT', availableToWithdraw: '', walletBalance: '600.00', totalOrderIM: '100', totalPositionIM: '0', locked: '100.00' },
    ]},
  ],
};
