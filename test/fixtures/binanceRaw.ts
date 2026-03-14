import type {
  BinanceExchangeInfoRaw,
  BinanceTicker24hrRaw,
  BinanceWebSocketKlineRaw,
  BinancePositionRiskRaw,
  BinanceOrderResponseRaw,
  BinanceAccountRaw,
  BinanceFundingRateHistoryRaw,
  BinanceFundingInfoRaw,
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
  { symbol: 'BTCUSDT', lastPrice: '65432.10', openPrice: '63900.00', highPrice: '66000.00', lowPrice: '63500.00', priceChangePercent: '2.35', volume: '12345.67', quoteVolume: '805000000.00', time: 1700000000000 },
  { symbol: 'ETHUSDT', lastPrice: '3456.78', openPrice: '3498.78', highPrice: '3550.00', lowPrice: '3400.00', priceChangePercent: '-1.20', volume: '98765.43', quoteVolume: '340000000.00', time: 1700000000000 },
];

export const BINANCE_RAW_KLINE_LIST: unknown[][] = [
  [1700000000000, '65000.00', '66000.00', '64000.00', '65500.00', '1234.56', 1700003600000, '80500000.00', 5000, '600.00', '39000000.00'],
  [1700003600000, '65500.00', '67000.00', '65000.00', '66800.00', '2345.67', 1700007200000, '155000000.00', 8000, '1100.00', '73000000.00'],
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
  V: '600.00',
  Q: '39000000.00',
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
  clientOrderId: 'myOrder123',
  symbol: 'BTCUSDT',
  side: 'BUY',
  type: 'LIMIT',
  timeInForce: 'GTC',
  origQty: '0.100',
  executedQty: '0.100',
  price: '65000.00',
  avgPrice: '64950.00',
  stopPrice: '0',
  cumQuote: '6495.00',
  status: 'FILLED',
  reduceOnly: false,
  time: 1699999990000,
  updateTime: 1700000000000,
};

export const BINANCE_RAW_ACCOUNT: BinanceAccountRaw = {
  balances: [
    { asset: 'USDT', free: '1000.50', locked: '200.00' },
    { asset: 'BTC', free: '0.5', locked: '0.1' },
    { asset: 'DOGE', free: '0', locked: '0' },
  ],
};

export const BINANCE_RAW_FUNDING_RATE_HISTORY_LIST: BinanceFundingRateHistoryRaw[] = [
  { symbol: 'BTCUSDT', fundingRate: '0.00010000', fundingTime: 1700006400000, markPrice: '65500.00' },
  { symbol: 'BTCUSDT', fundingRate: '-0.00005000', fundingTime: 1700035200000, markPrice: '' },
];

export const BINANCE_RAW_FUNDING_INFO_LIST: BinanceFundingInfoRaw[] = [
  { symbol: 'BTCUSDT', adjustedFundingRateCap: '0.02000000', adjustedFundingRateFloor: '-0.02000000', fundingIntervalHours: 8 },
  { symbol: 'ETHUSDT', adjustedFundingRateCap: '0.01500000', adjustedFundingRateFloor: '-0.01500000', fundingIntervalHours: 4 },
];

export const BINANCE_RAW_POSITION_MODE_HEDGE = { dualSidePosition: true };

export const BINANCE_RAW_POSITION_MODE_ONE_WAY = { dualSidePosition: false };
