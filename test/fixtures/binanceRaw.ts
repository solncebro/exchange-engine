import type {
  BinanceExchangeInfoRaw,
  BinanceTicker24hrRaw,
  BinanceWebSocketKlineRaw,
  BinancePositionRiskRaw,
  BinanceOrderResponseRaw,
  BinanceAccountRaw,
} from '../../src/normalizers/binanceNormalizer';

export const BINANCE_RAW_EXCHANGE_INFO: BinanceExchangeInfoRaw = {
  symbols: [
    {
      symbol: 'BTCUSDT',
      status: 'TRADING',
      baseAsset: 'BTC',
      quoteAsset: 'USDT',
      contractType: 'PERPETUAL',
      marginAsset: 'USDT',
      filters: [
        { filterType: 'PRICE_FILTER', tickSize: '0.10' },
        { filterType: 'LOT_SIZE', stepSize: '0.001', minQty: '0.001', maxQty: '1000' },
        { filterType: 'MIN_NOTIONAL', notional: '5' },
      ],
    },
    {
      symbol: 'ETHBTC',
      status: 'TRADING',
      baseAsset: 'ETH',
      quoteAsset: 'BTC',
      filters: [
        { filterType: 'PRICE_FILTER', tickSize: '0.00000100' },
        { filterType: 'LOT_SIZE', stepSize: '0.01', minQty: '0.01', maxQty: '100000' },
        { filterType: 'NOTIONAL', minNotional: '0.0001' },
      ],
    },
  ],
};

export const BINANCE_RAW_TICKER_LIST: BinanceTicker24hrRaw[] = [
  { symbol: 'BTCUSDT', lastPrice: '65432.10', priceChangePercent: '2.35', time: 1700000000000 },
  { symbol: 'ETHUSDT', lastPrice: '3456.78', priceChangePercent: '-1.20', time: 1700000000000 },
];

export const BINANCE_RAW_KLINE_LIST: unknown[][] = [
  [1700000000000, '65000.00', '66000.00', '64000.00', '65500.00', '1234.56', 1700003600000, '80500000.00', 5000],
  [1700003600000, '65500.00', '67000.00', '65000.00', '66800.00', '2345.67', 1700007200000, '155000000.00', 8000],
];

export const BINANCE_RAW_WEBSOCKET_KLINE: BinanceWebSocketKlineRaw = {
  t: 1700000000000,
  o: '65000.00',
  h: '66000.00',
  l: '64000.00',
  c: '65500.00',
  v: '1234.56',
  T: 1700003600000,
  q: '80500000.00',
  n: 5000,
};

export const BINANCE_RAW_POSITION_RISK: BinancePositionRiskRaw = {
  symbol: 'BTCUSDT',
  positionSide: 'LONG',
  positionAmt: '0.100',
  entryPrice: '65000.00',
  markPrice: '65500.00',
  unRealizedProfit: '50.00',
  leverage: '10',
  marginType: 'ISOLATED',
  liquidationPrice: '60000.00',
  notional: '6550.00',
  isolatedMargin: '655.00',
};

export const BINANCE_RAW_ORDER_RESPONSE: BinanceOrderResponseRaw = {
  orderId: 123456789,
  symbol: 'BTCUSDT',
  side: 'BUY',
  type: 'LIMIT',
  origQty: '0.100',
  price: '65000.00',
  status: 'FILLED',
  updateTime: 1700000000000,
};

export const BINANCE_RAW_ACCOUNT: BinanceAccountRaw = {
  balances: [
    { asset: 'USDT', free: '1000.50', locked: '200.00' },
    { asset: 'BTC', free: '0.5', locked: '0.1' },
    { asset: 'DOGE', free: '0', locked: '0' },
  ],
};
