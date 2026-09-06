import type {
  BybitInstrumentInfoRaw,
  BybitTickerRaw,
  BybitWebSocketKlineRaw,
  BybitPositionRaw,
  BybitOrderResponseRaw,
  BybitWalletBalanceRaw,
  BybitOrderBookRaw,
  BybitPublicTradeDataRaw,
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

/**
 * ЖИВОЙ ответ боевого счёта (Bybit UNIFIED, 29.08.2026): сводные поля — свободные средства, маржинальный
 * баланс, начальная маржа — приходят ПУСТЫМИ, availableToWithdraw пуст у каждой монеты, позиций и заявок
 * нет. Дороже всего здесь пыль в шести монетах помимо USDT: складывать их остатки с остатком USDT как
 * одно число — значит объявить биткойн равным доллару (экран баланса показал «занято −1$»).
 */
export const BYBIT_RAW_WALLET_BALANCE_NO_TOTALS: BybitWalletBalanceRaw = {
  list: [
    { accountType: 'UNIFIED', totalWalletBalance: '3914.56568348', totalAvailableBalance: '', totalMarginBalance: '', totalInitialMargin: '', coin: [
      { coin: 'BTC', availableToWithdraw: '', walletBalance: '0.00000004', usdValue: '0.00354068', totalOrderIM: '0', totalPositionIM: '0', locked: '0' },
      { coin: 'ETH', availableToWithdraw: '', walletBalance: '0', usdValue: '0.00000485', totalOrderIM: '0', totalPositionIM: '0', locked: '0' },
      { coin: 'USDT', availableToWithdraw: '', walletBalance: '3914.91240272', usdValue: '3914.51308166', totalOrderIM: '0', totalPositionIM: '0', locked: '0' },
      { coin: 'FRAX', availableToWithdraw: '', walletBalance: '0.0514', usdValue: '0.01530841', totalOrderIM: '0', totalPositionIM: '0', locked: '0' },
      { coin: 'ARX', availableToWithdraw: '', walletBalance: '0.0167', usdValue: '0.00201116', totalOrderIM: '0', totalPositionIM: '0', locked: '0' },
      { coin: 'CAP', availableToWithdraw: '', walletBalance: '0.07626', usdValue: '0.00529716', totalOrderIM: '0', totalPositionIM: '0', locked: '0' },
      { coin: 'POL', availableToWithdraw: '', walletBalance: '0.03029141', usdValue: '0.00323857', totalOrderIM: '0', totalPositionIM: '0', locked: '0' },
      { coin: 'BNB', availableToWithdraw: '', walletBalance: '0.00003377', usdValue: '0.02320097', totalOrderIM: '0', totalPositionIM: '0', locked: '0' },
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

export const BYBIT_RAW_PUBLIC_TRADE_STREAM_LIST: BybitPublicTradeDataRaw[] = [
  { T: 1700000000000, s: 'BTCUSDT', p: '65000.50', v: '0.100', S: 'Buy', i: 'stream-1', BT: false, L: 'PlusTick' },
  { T: 1700000001000, s: 'BTCUSDT', p: '65001.00', v: '0.200', S: 'Sell', i: 'stream-2', BT: false },
];

export const BYBIT_RAW_ORDER_BOOK_STREAM: BybitOrderBookRaw = {
  s: 'BTCUSDT',
  a: [['65001.00', '0.800'], ['65002.00', '1.200']],
  b: [['65000.00', '1.500'], ['64999.00', '2.300']],
  ts: 1700000000000,
  u: 999999,
  seq: 7961638724,
};

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
  // Закрытие шорта покупкой: вход 65000, выход 64000, валовой 100, комиссии 0.5 + 0.5, биржевое
  // поле closedPnl вычло ещё и фандинг 1.00 — наружу уходит 99.
  { symbol: 'BTCUSDT', orderId: 'order-1', side: 'Buy', qty: '0.100', avgEntryPrice: '65000.00', avgExitPrice: '64000.00', cumEntryValue: '6500.00', cumExitValue: '6400.00', openFee: '0.50', closeFee: '0.50', closedPnl: '98.00', createdTime: '1700000000000' },
];

export const BYBIT_RAW_TRANSACTION_LOG_LIST: BybitTransactionLogRaw[] = [
  { symbol: 'BTCUSDT', type: 'TRADE', qty: '0.100', cashFlow: '-6500.00', currency: 'USDT', transactionTime: '1700000000000', tradeId: 'trade-1', orderId: 'order-1' },
  { symbol: 'ETHUSDT', type: 'FUNDING', qty: '0', cashFlow: '0', funding: '0.50', currency: 'USDT', transactionTime: '1700000001000', tradeId: '', orderId: '' },
];

export const BYBIT_RAW_AMEND_BATCH_RESPONSE = {
  retCode: 0,
  retMsg: 'OK',
  result: {
    list: [
      { category: 'linear', symbol: 'BTCUSDT', orderId: '1', orderLinkId: '' },
      { category: 'linear', symbol: 'BTCUSDT', orderId: '2', orderLinkId: '' },
    ],
  },
  retExtInfo: { list: [{ code: 0, msg: 'OK' }, { code: 110001, msg: 'Order does not exist' }] },
  time: 1700000000000,
};

export const BYBIT_WS_RAW_CREATE_BATCH_RESPONSE = {
  op: 'order.create-batch',
  reqId: 'placeholder',
  retCode: 0,
  retMsg: 'OK',
  data: {
    list: [
      { category: 'linear', symbol: 'BTCUSDT', orderId: 'o-1', orderLinkId: '' },
      { category: 'linear', symbol: 'BTCUSDT', orderId: 'o-2', orderLinkId: '' },
    ],
  },
  retExtInfo: { list: [{ code: 0, msg: 'OK' }, { code: 0, msg: 'OK' }] },
};

export const BYBIT_WS_RAW_AMEND_BATCH_RESPONSE = {
  op: 'order.amend-batch',
  reqId: 'placeholder',
  retCode: 0,
  retMsg: 'OK',
  data: {
    list: [
      { category: 'linear', symbol: 'BTCUSDT', orderId: '1', orderLinkId: '' },
      { category: 'linear', symbol: 'BTCUSDT', orderId: '2', orderLinkId: '' },
    ],
  },
  retExtInfo: { list: [{ code: 0, msg: 'OK' }, { code: 110001, msg: 'Order does not exist' }] },
};

export const BYBIT_WS_RAW_CANCEL_BATCH_RESPONSE = {
  op: 'order.cancel-batch',
  reqId: 'placeholder',
  retCode: 0,
  retMsg: 'OK',
  data: {
    list: [
      { category: 'linear', symbol: 'BTCUSDT', orderId: 'o-1', orderLinkId: '' },
      { category: 'linear', symbol: 'BTCUSDT', orderId: 'o-2', orderLinkId: '' },
    ],
  },
  retExtInfo: { list: [{ code: 0, msg: 'OK' }, { code: 110001, msg: 'Order does not exist' }] },
};

/** Живая запись закрытия FLOCKUSDT 02.09.2026 16:00 UTC: биржевое поле closedPnl = 98.3460386 уже за
 *  вычетом фандинга 3.44912156; чистый после комиссий итог = 101.79516016. */
export const BYBIT_RAW_CLOSED_PNL_FLOCKUSDT: BybitClosedPnlRaw = {
  symbol: 'FLOCKUSDT',
  orderId: '1d49b11d-52ec-4638-bd3a-14ef4254e004',
  side: 'Buy',
  qty: '55994',
  avgEntryPrice: '0.03929',
  avgExitPrice: '0.03741455',
  cumEntryValue: '2200.00426',
  cumExitValue: '2094.99023',
  openFee: '0.91438047',
  closeFee: '2.30448937',
  closedPnl: '98.3460386',
  createdTime: '1788364800470',
};

/** Живая строка начисления фандинга FLOCKUSDT 02.09.2026 16:00 UTC: денежный поток ноль, сумма в `funding`. */
export const BYBIT_RAW_TRANSACTION_LOG_SETTLEMENT: BybitTransactionLogRaw = {
  symbol: 'FLOCKUSDT',
  type: 'SETTLEMENT',
  qty: '55994',
  cashFlow: '0',
  fee: '0',
  funding: '-2.3156522',
  currency: 'USDT',
  transactionTime: '1788364800000',
  tradeId: '',
  orderId: '',
};
