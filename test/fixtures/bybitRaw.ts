import type {
  BybitRawInstrumentInfo,
  BybitRawTicker,
  BybitRawWsKline,
  BybitRawPosition,
  BybitRawOrderResponse,
  BybitRawWalletBalance,
} from '../../src/normalizers/bybitNormalizer';

export const BYBIT_RAW_INSTRUMENT_LIST: BybitRawInstrumentInfo[] = [
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

export const BYBIT_RAW_TICKER_LIST: BybitRawTicker[] = [
  { symbol: 'BTCUSDT', lastPrice: '65432.10', price24hPcnt: '0.0235', time: 1700000000000 },
  { symbol: 'ETHUSDT', lastPrice: '3456.78', price24hPcnt: '-0.0120' },
];

export const BYBIT_RAW_KLINE_LIST: string[][] = [
  ['1700000000000', '65000.00', '66000.00', '64000.00', '65500.00', '1234.56', '80500000.00'],
  ['1700003600000', '65500.00', '67000.00', '65000.00', '66800.00', '2345.67', '155000000.00'],
];

export const BYBIT_RAW_WS_KLINE: BybitRawWsKline = {
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

export const BYBIT_RAW_POSITION: BybitRawPosition = {
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

export const BYBIT_RAW_ORDER_RESPONSE: BybitRawOrderResponse = {
  orderId: 'abc-123-def',
  symbol: 'BTCUSDT',
  side: 'Buy',
  orderType: 'Limit',
  qty: '0.100',
  price: '65000.00',
  orderStatus: 'Filled',
  createdTime: '1700000000000',
};

export const BYBIT_RAW_WALLET_BALANCE: BybitRawWalletBalance = {
  list: [
    { coin: 'USDT', availableToWithdraw: '1000.50', walletBalance: '1200.50', locked: '200.00' },
    { coin: 'BTC', availableToWithdraw: '0.5', walletBalance: '0.6', locked: '0.1' },
    { coin: 'DOGE', availableToWithdraw: '0', walletBalance: '0', locked: '0' },
    { coin: 'USDT', availableToWithdraw: '500.00', walletBalance: '600.00', locked: '100.00' },
  ],
};
