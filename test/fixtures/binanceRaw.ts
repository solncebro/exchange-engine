import type {
  BinanceExchangeInfoRaw,
  BinanceTicker24hrRaw,
  BinanceWebSocketKlineRaw,
  BinancePositionRiskRaw,
  BinanceOrderResponseRaw,
  BinanceAlgoOrderRaw,
  BinanceAccountRaw,
  BinanceFuturesAccountRaw,
  BinanceFundingRateHistoryRaw,
  BinanceFundingInfoRaw,
  BinanceOrderBookRaw,
  BinancePublicTradeRaw,
  BinanceMarkPriceRaw,
  BinanceOpenInterestRaw,
  BinanceCommissionRateRaw,
  BinanceIncomeRaw,
  BinanceLeverageBracketRaw,
} from '../../src/normalizers/binanceNormalizer';

export const BINANCE_RAW_EXCHANGE_INFO: BinanceExchangeInfoRaw = {
  symbols: [
    {
      symbol: 'BTCUSDT',
      pair: 'BTCUSDT',
      status: 'TRADING',
      baseAsset: 'BTC',
      quoteAsset: 'USDT',
      contractType: 'PERPETUAL',
      marginAsset: 'USDT',
      deliveryDate: 4133404800000,
      onboardDate: 1569398400000,
      maintMarginPercent: '2.5000',
      requiredMarginPercent: '5.0000',
      pricePrecision: 2,
      quantityPrecision: 3,
      baseAssetPrecision: 8,
      quotePrecision: 8,
      underlyingType: 'COIN',
      underlyingSubType: ['PoW'],
      triggerProtect: '0.0500',
      liquidationFee: '0.017500',
      marketTakeBound: '0.05',
      maxMoveOrderLimit: 10000,
      orderTypes: ['LIMIT', 'MARKET', 'STOP', 'STOP_MARKET', 'TAKE_PROFIT', 'TAKE_PROFIT_MARKET', 'TRAILING_STOP_MARKET'],
      timeInForce: ['GTC', 'IOC', 'FOK', 'GTX', 'GTD'],
      filters: [
        { filterType: 'PRICE_FILTER', tickSize: '0.10', minPrice: '556.80', maxPrice: '4529764' },
        { filterType: 'LOT_SIZE', stepSize: '0.001', minQty: '0.001', maxQty: '1000' },
        { filterType: 'MARKET_LOT_SIZE', stepSize: '0.001', minQty: '0.001', maxQty: '120' },
        { filterType: 'MIN_NOTIONAL', notional: '5' },
        { filterType: 'PERCENT_PRICE', multiplierUp: '1.0500', multiplierDown: '0.9500', multiplierDecimal: '4' },
        { filterType: 'MAX_NUM_ORDERS', limit: 200 },
        { filterType: 'MAX_NUM_ALGO_ORDERS', maxNumAlgoOrders: 10 },
        { filterType: 'POSITION_RISK_CONTROL', positionControlSide: 'BOTH' },
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
        { filterType: 'PERCENT_PRICE_BY_SIDE', bidMultiplierUp: '5', bidMultiplierDown: '0.2', askMultiplierUp: '5', askMultiplierDown: '0.2', avgPriceMins: 5 },
      ],
    },
  ],
};

export const BINANCE_RAW_EXCHANGE_INFO_SETTLE_VARIANTS: BinanceExchangeInfoRaw = {
  symbols: [
    {
      symbol: 'BTCUSDC',
      pair: 'BTCUSDC',
      status: 'TRADING',
      baseAsset: 'BTC',
      quoteAsset: 'USDC',
      contractType: 'PERPETUAL',
      marginAsset: 'USDC',
      deliveryDate: 4133404800000,
      onboardDate: 1704285000000,
      filters: [
        { filterType: 'PRICE_FILTER', tickSize: '0.1', minPrice: '0.1', maxPrice: '500000' },
        { filterType: 'LOT_SIZE', stepSize: '0.001', minQty: '0.001', maxQty: '800' },
        { filterType: 'MIN_NOTIONAL', notional: '100' },
      ],
    },
    {
      symbol: 'ETHUSDT_250627',
      pair: 'ETHUSDT',
      status: 'DELIVERING',
      baseAsset: 'ETH',
      quoteAsset: 'USDT',
      contractType: 'CURRENT_QUARTER DELIVERING',
      marginAsset: 'USDT',
      deliveryDate: 1751011200000,
      onboardDate: 1735027200000,
      filters: [
        { filterType: 'PRICE_FILTER', tickSize: '0.01', minPrice: '41.10', maxPrice: '100000' },
        { filterType: 'LOT_SIZE', stepSize: '0.001', minQty: '0.001', maxQty: '10000' },
        { filterType: 'MIN_NOTIONAL', notional: '5' },
      ],
    },
  ],
};

export const BINANCE_RAW_TICKER_FUTURES: BinanceTicker24hrRaw = {
  symbol: 'BTCUSDT',
  priceChange: '48.30',
  priceChangePercent: '0.062',
  weightedAvgPrice: '78882.12',
  lastPrice: '78516.30',
  lastQty: '0.0010',
  openPrice: '78468.00',
  highPrice: '79663.50',
  lowPrice: '78315.50',
  volume: '1371508.3717',
  quoteVolume: '108187493027.15',
  openTime: 1788893400000,
  closeTime: 1788979852109,
  firstId: 535867432,
  lastId: 536191437,
  count: 323989,
};

export const BINANCE_RAW_TICKER_SPOT: BinanceTicker24hrRaw = {
  symbol: 'ETHBTC',
  priceChange: '-0.00002000',
  priceChangePercent: '-0.063',
  weightedAvgPrice: '0.03165338',
  prevClosePrice: '0.03170000',
  lastPrice: '0.03169000',
  lastQty: '0.27600000',
  bidPrice: '0.03168000',
  bidQty: '34.98980000',
  askPrice: '0.03169000',
  askQty: '38.29120000',
  openPrice: '0.03171000',
  highPrice: '0.03174000',
  lowPrice: '0.03145000',
  volume: '2976.76230000',
  quoteVolume: '94.22458944',
  openTime: 1788893456357,
  closeTime: 1788979856357,
  firstId: 9551104,
  lastId: 9557799,
  count: 6696,
};

export const BINANCE_RAW_TICKER_LIST: BinanceTicker24hrRaw[] = [
  BINANCE_RAW_TICKER_FUTURES,
  {
    symbol: 'ETHUSDT',
    priceChange: '-2.49',
    priceChangePercent: '-0.100',
    weightedAvgPrice: '2495.35',
    lastPrice: '2485.51',
    lastQty: '0.011',
    openPrice: '2488.00',
    highPrice: '2520.68',
    lowPrice: '2471.38',
    volume: '40605465.232',
    quoteVolume: '101324890603.69',
    openTime: 1788893460000,
    closeTime: 1788979917852,
    firstId: 324823713,
    lastId: 325218962,
    count: 395245,
  },
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
  x: true,
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

// Форма ответа Algo-службы. Снята с живого ответа биржи 07.08.2026: айсберг приходит
// настоящим пустым значением, срок действия — GTE_GTC.
export const BINANCE_RAW_ALGO_ORDER_RESPONSE: BinanceAlgoOrderRaw = {
  algoId: 3000000000003505,
  clientAlgoId: 'myAlgo123',
  algoType: 'CONDITIONAL',
  orderType: 'STOP_MARKET',
  symbol: 'BTCUSDT',
  side: 'SELL',
  positionSide: 'BOTH',
  timeInForce: 'GTE_GTC',
  quantity: '0.100',
  algoStatus: 'NEW',
  actualOrderId: '',
  actualPrice: '0.00000',
  triggerPrice: '60000',
  price: '0',
  icebergQuantity: null,
  selfTradePreventionMode: 'EXPIRE_MAKER',
  workingType: 'CONTRACT_PRICE',
  priceMatch: 'NONE',
  closePosition: false,
  priceProtect: false,
  reduceOnly: false,
  createTime: 1699999990000,
  updateTime: 1700000000000,
  triggerTime: 0,
  goodTillDate: 0,
};

export const BINANCE_RAW_ACCOUNT: BinanceAccountRaw = {
  balances: [
    { asset: 'USDT', free: '1000.50', locked: '200.00' },
    { asset: 'BTC', free: '0.5', locked: '0.1' },
    { asset: 'DOGE', free: '0', locked: '0' },
  ],
};

export const BINANCE_RAW_FUTURES_ACCOUNT: BinanceFuturesAccountRaw = {
  totalWalletBalance: '1205.50',
  availableBalance: '1000.50',
  assets: [
    { asset: 'USDT', walletBalance: '1200.50', availableBalance: '1000.50' },
    { asset: 'BNB', walletBalance: '5.00', availableBalance: '3.50' },
    { asset: 'DOGE', walletBalance: '0', availableBalance: '0' },
  ],
};

/**
 * Ответ /fapi/v3/account с ОТКРЫТОЙ позицией и всеми сводными полями, которые биржа действительно
 * отдаёт. Именно этот случай показывает, зачем читать занятую маржу, а не выводить её вычитанием:
 * свободные средства биржа уже уменьшила на нереализованный убыток (маржа 300, убыток 50, поэтому
 * свободно 850 при кошельке 1200), и разность кошелька со свободными дала бы 350 вместо 300.
 */
export const BINANCE_RAW_FUTURES_ACCOUNT_WITH_POSITION: BinanceFuturesAccountRaw = {
  totalWalletBalance: '1200.00',
  availableBalance: '850.00',
  totalMarginBalance: '1150.00',
  totalUnrealizedProfit: '-50.00',
  totalInitialMargin: '300.00',
  totalPositionInitialMargin: '250.00',
  totalOpenOrderInitialMargin: '50.00',
  assets: [
    { asset: 'USDT', walletBalance: '1200.00', availableBalance: '850.00' },
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

export const BINANCE_RAW_FUTURE_SYMBOL = {
  symbol: 'BTCUSDT_250627',
  status: 'TRADING',
  baseAsset: 'BTC',
  quoteAsset: 'USDT',
  contractType: 'CURRENT_QUARTER',
  marginAsset: 'USDT',
  filters: [
    { filterType: 'PRICE_FILTER', tickSize: '0.10' },
    { filterType: 'LOT_SIZE', stepSize: '0.001', minQty: '0.001', maxQty: '500' },
    { filterType: 'MIN_NOTIONAL', notional: '5' },
  ],
};

export const BINANCE_RAW_SYMBOL_NO_FILTERS = {
  symbol: 'XYZUSDT',
  status: 'TRADING',
  baseAsset: 'XYZ',
  quoteAsset: 'USDT',
  contractType: 'PERPETUAL',
  marginAsset: 'USDT',
  filters: [],
};

export const BINANCE_RAW_POSITION_MODE_HEDGE = { dualSidePosition: true };

export const BINANCE_RAW_POSITION_MODE_ONE_WAY = { dualSidePosition: false };

export const BINANCE_RAW_ORDER_BOOK: BinanceOrderBookRaw = {
  lastUpdateId: 123456,
  E: 1700000000000,
  T: 1700000000000,
  bids: [['65000.00', '1.500'], ['64999.00', '2.300']],
  asks: [['65001.00', '0.800'], ['65002.00', '1.200']],
};

export const BINANCE_RAW_PUBLIC_TRADE_LIST: BinancePublicTradeRaw[] = [
  { id: 12345, price: '65000.50', qty: '0.100', quoteQty: '6500.05', time: 1700000000000, isBuyerMaker: false },
  { id: 12346, price: '65001.00', qty: '0.200', quoteQty: '13000.20', time: 1700000001000, isBuyerMaker: true },
];

export const BINANCE_RAW_MARK_PRICE_LIST: BinanceMarkPriceRaw[] = [
  { symbol: 'BTCUSDT', markPrice: '65000.50', indexPrice: '65001.00', lastFundingRate: '0.0001', nextFundingTime: 1700003600000, time: 1700000000000 },
  { symbol: 'ETHUSDT', markPrice: '3500.25', indexPrice: '3500.50', lastFundingRate: '0.00015', nextFundingTime: 1700003600000, time: 1700000000000 },
];

export const BINANCE_RAW_OPEN_INTEREST: BinanceOpenInterestRaw = {
  symbol: 'BTCUSDT',
  openInterest: '12345.678',
  time: 1700000000000,
};

export const BINANCE_RAW_COMMISSION_RATE: BinanceCommissionRateRaw = {
  symbol: 'BTCUSDT',
  makerCommissionRate: '0.0002',
  takerCommissionRate: '0.0004',
};

export const BINANCE_RAW_INCOME_LIST: BinanceIncomeRaw[] = [
  { symbol: 'BTCUSDT', incomeType: 'REALIZED_PNL', income: '15.50', asset: 'USDT', time: 1700000000000, info: '', tranId: 123456, tradeId: '789' },
  { symbol: 'ETHUSDT', incomeType: 'FUNDING_FEE', income: '-0.05', asset: 'USDT', time: 1700000001000, info: '', tranId: 123457, tradeId: '790' },
];

export const BINANCE_RAW_MODIFY_BATCH_RESPONSE_MIXED: Array<Record<string, unknown>> = [
  {
    orderId: 100,
    symbol: 'BTCUSDT',
    status: 'NEW',
    clientOrderId: 'cli-1',
    price: '30005',
    origQty: '1',
    executedQty: '0',
    side: 'BUY',
    positionSide: 'LONG',
    timeInForce: 'GTC',
    type: 'LIMIT',
    updateTime: 1700000000000,
  },
  { code: -2022, msg: 'ReduceOnly Order is rejected.' },
];

export const BINANCE_RAW_LEVERAGE_BRACKET_LIST: BinanceLeverageBracketRaw[] = [
  {
    symbol: 'AVAUSDT',
    brackets: [
      { bracket: 1, initialLeverage: 25, notionalCap: 5000, notionalFloor: 0, maintMarginRatio: 0.02, cum: 0.0 },
      { bracket: 2, initialLeverage: 20, notionalCap: 10000, notionalFloor: 5000, maintMarginRatio: 0.025, cum: 25.0 },
      { bracket: 3, initialLeverage: 10, notionalCap: 20000, notionalFloor: 10000, maintMarginRatio: 0.05, cum: 275.0 },
      { bracket: 4, initialLeverage: 5, notionalCap: 50000, notionalFloor: 20000, maintMarginRatio: 0.1, cum: 1275.0 },
      { bracket: 5, initialLeverage: 4, notionalCap: 100000, notionalFloor: 50000, maintMarginRatio: 0.125, cum: 2525.0 },
      { bracket: 6, initialLeverage: 3, notionalCap: 250000, notionalFloor: 100000, maintMarginRatio: 0.1667, cum: 6695.0 },
      { bracket: 7, initialLeverage: 2, notionalCap: 2500000, notionalFloor: 250000, maintMarginRatio: 0.25, cum: 27520.0 },
      { bracket: 8, initialLeverage: 1, notionalCap: 5000000, notionalFloor: 2500000, maintMarginRatio: 0.5, cum: 652520.0 },
    ],
  },
];
