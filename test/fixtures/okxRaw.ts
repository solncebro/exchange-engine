import type {
  OkxInstrumentRaw,
  OkxTickerRaw,
  OkxOrderBookRaw,
  OkxOrderBookWebSocketDataRaw,
  OkxPublicTradeRaw,
  OkxMarkPriceRaw,
  OkxIndexTickerRaw,
  OkxOpenInterestRaw,
  OkxFundingRateRaw,
  OkxFundingRateHistoryRaw,
  OkxFeeRateRaw,
  OkxBalanceRaw,
  OkxPositionRaw,
  OkxPositionHistoryRaw,
  OkxOrderRaw,
  OkxAlgoOrderRaw,
  OkxBillRaw,
  OkxOrderResultRaw,
  OkxPositionTierRaw,
} from '../../src/normalizers/okxNormalizer';

export const OKX_RAW_INSTRUMENT_SPOT: OkxInstrumentRaw = {
  alias: '',
  auctionEndTime: '',
  baseCcy: 'BTC',
  category: '1',
  ctMult: '',
  ctType: '',
  ctVal: '',
  ctValCcy: '',
  contTdSwTime: '1704876947000',
  expTime: '',
  futureSettlement: false,
  groupId: '1',
  instFamily: '',
  instId: 'BTC-USDT',
  instType: 'SPOT',
  lever: '10',
  listTime: '1606468572000',
  lotSz: '0.00000001',
  maxIcebergSz: '9999999999.0000000000000000',
  maxLmtAmt: '1000000',
  maxLmtSz: '9999999999',
  maxMktAmt: '1000000',
  maxMktSz: '',
  maxStopSz: '',
  maxTriggerSz: '9999999999.0000000000000000',
  maxTwapSz: '9999999999.0000000000000000',
  minSz: '0.00001',
  optType: '',
  openType: 'call_auction',
  preMktSwTime: '',
  quoteCcy: 'USDT',
  tradeQuoteCcyList: ['USDT'],
  settleCcy: '',
  state: 'live',
  ruleType: 'normal',
  stk: '',
  tickSz: '0.1',
  uly: '',
  instIdCode: 1000000000,
  instCategory: '1',
  initPxLmtPct: '0.05',
  floatPxLmtPct: '0.03',
  maxPxLmtPct: '0.15',
  upcChg: [{ param: 'tickSz', newValue: '0.0001', effTime: '1704876947000' }],
};

export const OKX_RAW_INSTRUMENT_SWAP: OkxInstrumentRaw = {
  instType: 'SWAP',
  instId: 'BTC-USDT-SWAP',
  uly: 'BTC-USDT',
  instFamily: 'BTC-USDT',
  baseCcy: '',
  quoteCcy: '',
  settleCcy: 'USDT',
  ctVal: '0.01',
  ctMult: '1',
  ctValCcy: 'BTC',
  ctType: 'linear',
  lever: '100',
  tickSz: '0.1',
  lotSz: '1',
  minSz: '1',
  maxLmtSz: '100000000',
  maxMktSz: '12000',
  maxLmtAmt: '20000000',
  maxMktAmt: '',
  state: 'live',
  listTime: '1611916800000',
  expTime: '',
  ruleType: 'normal',
  instIdCode: 1000000123,
  instCategory: '1',
  initPxLmtPct: '0.05',
  floatPxLmtPct: '0.03',
  maxPxLmtPct: '0.15',
  groupId: '4',
};

export const OKX_RAW_INSTRUMENT_INVERSE: OkxInstrumentRaw = {
  ...OKX_RAW_INSTRUMENT_SWAP,
  instId: 'BTC-USD-SWAP',
  uly: 'BTC-USD',
  instFamily: 'BTC-USD',
  settleCcy: 'BTC',
  ctType: 'inverse',
  ctValCcy: 'USD',
};

export const OKX_RAW_INSTRUMENT_USDC_SWAP: OkxInstrumentRaw = {
  ...OKX_RAW_INSTRUMENT_SWAP,
  instId: 'ETH-USDC-SWAP',
  uly: 'ETH-USDC',
  instFamily: 'ETH-USDC',
  settleCcy: 'USDC',
  ctVal: '0.001',
  ctValCcy: 'ETH',
  lotSz: '0.1',
  minSz: '0.1',
};

export const OKX_RAW_INSTRUMENT_STOCK_SWAP: OkxInstrumentRaw = {
  ...OKX_RAW_INSTRUMENT_SWAP,
  instId: 'AAPL-USDT-SWAP',
  uly: 'AAPL-USDT',
  instFamily: 'AAPL-USDT',
  ctValCcy: 'AAPL',
  ctVal: '1',
  lotSz: '1',
  minSz: '1',
  maxLmtSz: '100000',
  maxMktSz: '1000',
  maxLmtAmt: '1000000',
  lever: '5',
  instCategory: '3',
};

export const OKX_RAW_TICKER_LIST: OkxTickerRaw[] = [
  {
    instType: 'SWAP',
    instId: 'LTC-USD-SWAP',
    last: '9999.99',
    lastSz: '1',
    askPx: '9999.99',
    askSz: '11',
    bidPx: '8888.88',
    bidSz: '5',
    open24h: '9000',
    high24h: '10000',
    low24h: '8888.88',
    volCcy24h: '2222',
    vol24h: '2222',
    sodUtc0: '0.1',
    sodUtc8: '0.1',
    ts: '1597026383085',
  },
  {
    instType: 'SWAP',
    instId: 'BTC-USDT-SWAP',
    last: '65000',
    lastSz: '1',
    askPx: '65001',
    askSz: '2',
    bidPx: '64999',
    bidSz: '3',
    open24h: '64000',
    high24h: '66000',
    low24h: '63500',
    volCcy24h: '1500',
    vol24h: '150000',
    sodUtc0: '0.1',
    sodUtc8: '0.1',
    ts: '1700000000000',
  },
];

export const OKX_RAW_KLINE_LIST: string[][] = [
  ['1597026443085', '3.721', '3.743', '3.677', '3.708', '8422410', '22698348.04828491', '12698348.04828491', '0'],
  ['1597026383085', '3.731', '3.799', '3.494', '3.72', '24912403', '67632347.24399722', '37632347.24399722', '1'],
];

export const OKX_RAW_ORDER_BOOK: OkxOrderBookRaw = {
  asks: [['41006.8', '0.60038921', '0', '1']],
  bids: [['41006.3', '0.30178218', '0', '2']],
  ts: '1629966436396',
  seqId: 3235851742,
};

export const OKX_RAW_ORDER_BOOK_STREAM_SNAPSHOT = {
  arg: { channel: 'books', instId: 'BTC-USDT' },
  action: 'snapshot',
  data: [
    {
      asks: [
        ['8476.98', '415', '0', '13'],
        ['8477', '7', '0', '2'],
        ['8477.34', '85', '0', '1'],
        ['8477.56', '1', '0', '1'],
        ['8505.84', '8', '0', '1'],
        ['8506.37', '85', '0', '1'],
        ['8506.49', '2', '0', '1'],
        ['8506.96', '100', '0', '2'],
      ],
      bids: [
        ['8476.97', '256', '0', '12'],
        ['8475.55', '101', '0', '1'],
        ['8475.54', '100', '0', '1'],
        ['8475.3', '1', '0', '1'],
        ['8447.32', '6', '0', '1'],
        ['8447.02', '246', '0', '1'],
        ['8446.83', '24', '0', '1'],
        ['8446', '95', '0', '3'],
      ],
      ts: '1597026383085',
      checksum: 0,
      prevSeqId: -1,
      seqId: 123456,
    } satisfies OkxOrderBookWebSocketDataRaw,
  ],
};

export const OKX_RAW_ORDER_BOOK_STREAM_UPDATE = {
  arg: { channel: 'books', instId: 'BTC-USDT' },
  action: 'update',
  data: [
    {
      asks: [
        ['8476.98', '415', '0', '13'],
        ['8477', '7', '0', '2'],
        ['8477.34', '85', '0', '1'],
        ['8477.56', '1', '0', '1'],
        ['8505.84', '8', '0', '1'],
        ['8506.37', '85', '0', '1'],
        ['8506.49', '2', '0', '1'],
        ['8506.96', '100', '0', '2'],
      ],
      bids: [
        ['8476.97', '256', '0', '12'],
        ['8475.55', '101', '0', '1'],
        ['8475.54', '100', '0', '1'],
        ['8475.3', '1', '0', '1'],
        ['8447.32', '6', '0', '1'],
        ['8447.02', '246', '0', '1'],
        ['8446.83', '24', '0', '1'],
        ['8446', '95', '0', '3'],
      ],
      ts: '1597026383085',
      checksum: 0,
      prevSeqId: 123456,
      seqId: 123457,
    } satisfies OkxOrderBookWebSocketDataRaw,
  ],
};

export const OKX_RAW_PUBLIC_TRADE_LIST: OkxPublicTradeRaw[] = [
  { instId: 'BTC-USDT', side: 'sell', sz: '0.00001', source: '0', px: '29963.2', tradeId: '242720720', ts: '1654161646974' },
  { instId: 'BTC-USDT', side: 'sell', sz: '0.00001', source: '0', px: '29964.1', tradeId: '242720719', ts: '1654161641568' },
];

export const OKX_RAW_MARK_PRICE_LIST: OkxMarkPriceRaw[] = [
  { instType: 'SWAP', instId: 'BTC-USDT-SWAP', markPx: '200', ts: '1597026383085' },
];

/** `GET /api/v5/market/index-tickers`: обозначение здесь — ИНДЕКС `BTC-USDT`, без хвоста `-SWAP`. */
export const OKX_RAW_INDEX_TICKER_LIST: OkxIndexTickerRaw[] = [
  {
    instId: 'BTC-USDT',
    idxPx: '43350',
    high24h: '43649.7',
    low24h: '43261.9',
    open24h: '43640.8',
    sodUtc0: '43444.1',
    sodUtc8: '43328.7',
    ts: '1649419644492',
  },
];

export const OKX_RAW_OPEN_INTEREST: OkxOpenInterestRaw = {
  instType: 'SWAP',
  instId: 'BTC-USDT-SWAP',
  oi: '5000',
  oiCcy: '555.55',
  oiUsd: '50000',
  ts: '1597026383085',
};

export const OKX_RAW_FUNDING_RATE: OkxFundingRateRaw = {
  formulaType: 'noRate',
  fundingRate: '0.0000182221218054',
  fundingTime: '1743609600000',
  impactValue: '',
  instId: 'BTC-USDT-SWAP',
  instType: 'SWAP',
  interestRate: '',
  maxFundingRate: '0.00375',
  method: 'current_period',
  minFundingRate: '-0.00375',
  nextFundingRate: '',
  nextFundingTime: '1743638400000',
  premium: '0.0000910113652644',
  settFundingRate: '0.0000145824401745',
  settState: 'settled',
  ts: '1743588686291',
};

export const OKX_RAW_FUNDING_RATE_HISTORY_LIST: OkxFundingRateHistoryRaw[] = [
  {
    formulaType: 'noRate',
    fundingRate: '0.0000746604960499',
    fundingTime: '1703059200000',
    instId: 'BTC-USD-SWAP',
    instType: 'SWAP',
    method: 'next_period',
    realizedRate: '0.0000746572360545',
  },
  {
    formulaType: 'noRate',
    fundingRate: '0.000227985782722',
    fundingTime: '1703030400000',
    instId: 'BTC-USD-SWAP',
    instType: 'SWAP',
    method: 'next_period',
    realizedRate: '0.0002279755647389',
  },
];

export const OKX_RAW_FEE_RATE: OkxFeeRateRaw = {
  category: '1',
  delivery: '',
  exercise: '',
  feeGroup: [{ elpMaker: '-0.0008', rpiMaker: '-0.0008', groupId: '1', maker: '-0.0008', taker: '-0.001' }],
  fiat: [],
  instType: 'SPOT',
  level: 'Lv1',
  maker: '-0.0008',
  makerU: '',
  makerUSDC: '',
  ruleType: 'normal',
  taker: '-0.001',
  takerU: '',
  takerUSDC: '',
  ts: '1763979985847',
};

/**
 * Полный набор полей из документации `trading-account-rest-api-get-balance` (режим 3), включая
 * `details[0]`. Изменено относительно примера: `ordFroz` (в документации пустая строка) заполнено
 * значением `'10'` — поле не участвует в формуле свободных средств (документация: `imr` уже
 * включает маржу под заявками), но остаётся полем ответа, которое нормализатор должен пережить.
 */
export const OKX_RAW_BALANCE: OkxBalanceRaw = {
  uTime: '1705474164160',
  totalEq: '55837.43556134779',
  isoEq: '0',
  adjEq: '55415.624719833286',
  availEq: '55415.624719833286',
  borrowFroz: '0',
  delta: '0',
  deltaLever: '0',
  deltaNeutralStatus: '0',
  ordFroz: '10',
  imr: '0',
  mmr: '0',
  mgnRatio: '',
  notionalUsd: '0',
  notionalUsdForBorrow: '0',
  notionalUsdForFutures: '0',
  notionalUsdForOption: '0',
  notionalUsdForSwap: '0',
  upl: '0',
  details: [
    {
      autoLendStatus: 'off',
      autoLendMtAmt: '0',
      availBal: '4834.317093622894',
      availEq: '4834.3170936228935',
      borrowFroz: '0',
      cashBal: '4850.435693622894',
      ccy: 'USDT',
      crossLiab: '0',
      colRes: '0',
      collateralEnabled: false,
      collateralRestrict: false,
      colBorrAutoConversion: '0',
      disEq: '4991.542013297616',
      eq: '4992.890093622894',
      eqUsd: '4991.542013297616',
      smtSyncEq: '0',
      spotCopyTradingEq: '0',
      fixedBal: '0',
      frozenBal: '158.573',
      frpType: '0',
      imr: '',
      interest: '0',
      isoEq: '0',
      isoLiab: '0',
      isoUpl: '0',
      liab: '0',
      maxLoan: '0',
      mgnRatio: '',
      mmr: '',
      notionalLever: '',
      ordFrozen: '0',
      rewardBal: '0',
      spotInUseAmt: '',
      clSpotInUseAmt: '',
      maxSpotInUse: '',
      spotIsoBal: '0',
      stgyEq: '150',
      twap: '0',
      uTime: '1705449605015',
      upl: '-7.545600000000006',
      uplLiab: '0',
      spotBal: '',
      openAvgPx: '',
      accAvgPx: '',
      spotUpl: '',
      spotUplRatio: '',
      totalPnl: '',
      totalPnlRatio: '',
    },
  ],
};

/**
 * Тот же счёт, что и `OKX_RAW_BALANCE`, но в режиме «Futures mode» (`acctLv 2`): верхний уровень
 * `adjEq`/`availEq`/`imr`/`ordFroz` пуст, а долларовая занятая маржа перенесена на монету
 * (`details[0].imr`/`eqUsd`). Сводного нереализованного итога в этом режиме биржа не даёт вовсе
 * («Returns empty string in Simple mode and Single-currency margin mode»), плавающий итог
 * остаётся только на монете.
 */
export const OKX_RAW_BALANCE_FUTURES_MODE: OkxBalanceRaw = {
  ...OKX_RAW_BALANCE,
  adjEq: '',
  availEq: '',
  ordFroz: '',
  imr: '',
  upl: '',
  details: [
    {
      ...OKX_RAW_BALANCE.details![0],
      imr: '158.573',
    },
  ],
};

/**
 * Счёт в режиме «Spot mode» (`acctLv 1`, он же «простой»): сводного нереализованного итога нет,
 * и на монете его тоже нет — в этом режиме биржа допускает только «SPOT and OPTION buyer», то
 * есть плавать нечему.
 */
export const OKX_RAW_BALANCE_SPOT_MODE: OkxBalanceRaw = {
  ...OKX_RAW_BALANCE,
  isoEq: '',
  availEq: '',
  upl: '',
  details: [
    {
      ...OKX_RAW_BALANCE.details![0],
      availEq: '',
      isoEq: '',
      isoUpl: '',
      upl: '',
    },
  ],
};

/**
 * Тот же счёт, но позиция в ПЛЮСЕ на 600 USDT. Кошелёк без плавающего итога (55 237) оказывается
 * МЕНЬШЕ свободных средств, которые биржа назвала сама (`availEq` 55 415), — и это правда, а не
 * противоречие: свободные считаются от капитала, в который плавающая прибыль входит, а кошелёк —
 * это остаток без неё. Держит запрет подрезать число биржи под внутреннее правило.
 */
export const OKX_RAW_BALANCE_FLOATING_PROFIT: OkxBalanceRaw = {
  ...OKX_RAW_BALANCE,
  upl: '600',
  details: [{ ...OKX_RAW_BALANCE.details![0], upl: '600' }],
};

/**
 * Счёт в режиме «Futures mode» с ИЗОЛИРОВАННОЙ позицией в минусе на 320 USDT. Сводного
 * нереализованного итога нет (режим), да и в тех режимах, где он есть, изолированные позиции в
 * него не входят — он считает только «all open cross-margin positions». Плавающий итог виден
 * лишь на монете: `upl` («all margin and derivatives positions of currency») равен `isoUpl`.
 * Курс монеты ровно единица (`eq === eqUsd`), поэтому вычитание читается без пересчёта.
 *
 * Свободный остаток монеты согласован с её же остатком и занятым: 4680.44 = 4521.86 + 158.57.
 * Прежде он достался заготовке по наследству и был БОЛЬШЕ всего остатка монеты — пока свободные
 * средства выводились вычитанием из капитала счёта, это не всплывало, а теперь читается прямо.
 */
export const OKX_RAW_BALANCE_ISOLATED_POSITION: OkxBalanceRaw = {
  ...OKX_RAW_BALANCE,
  adjEq: '',
  availEq: '',
  ordFroz: '',
  imr: '',
  upl: '',
  isoEq: '1200',
  details: [
    {
      ...OKX_RAW_BALANCE.details![0],
      availBal: '4521.862693622894',
      eq: '4680.435693622894',
      eqUsd: '4680.435693622894',
      imr: '158.573',
      isoEq: '1200',
      isoUpl: '-320',
      upl: '-320',
    },
  ],
};

/**
 * Живая сверка на демо-счёте 09.09.2026: одна ВИСЯЩАЯ лимитная заявка на один контракт
 * BTC-USDT-SWAP, ни одной открытой позиции. Числа монеты — с провода: биржа положила маржу этой
 * заявки И в `imr` монеты, И в `ordFrozen` (одно и то же 132.0266), а свободный остаток монеты
 * упал на неё ровно один раз — с 4999.80 до 4867.58. Заготовка держит запрет считать эту маржу
 * дважды: до правки счёт объявлял занятыми 264 доллара вместо 132 и на столько же занижал
 * свободные средства.
 *
 * Режим счёта — «Futures mode» (`acctLv 2`), поэтому верхний уровень пуст и свод собирается по
 * монетам. Капитал счёта равен долларовой оценке единственной монеты: заготовка согласована сама
 * с собой, как и живой ответ биржи.
 */
export const OKX_RAW_BALANCE_PENDING_ORDER: OkxBalanceRaw = {
  ...OKX_RAW_BALANCE,
  totalEq: '4999.300648051667',
  adjEq: '',
  availEq: '',
  ordFroz: '',
  imr: '',
  upl: '',
  details: [
    {
      ...OKX_RAW_BALANCE.details![0],
      availBal: '4867.575948051667',
      availEq: '4867.575948051667',
      cashBal: '4999.800648051667',
      eq: '4999.800648051667',
      eqUsd: '4999.300648051667',
      frozenBal: '132.2247',
      imr: '132.0266',
      ordFrozen: '132.0266',
      upl: '0',
    },
  ],
};

/**
 * Полный набор полей из `trading-account-rest-api-get-positions`. Изменено относительно примера:
 * пример — MARGIN-инструмент; здесь `instId`/`instType`/`pos`/`posCcy`/`notionalUsd` заменены на
 * SWAP-сценарий net-режима, чтобы фикстура покрывала конверсию контрактов через `ctVal`.
 */
export const OKX_RAW_POSITION_NET_LONG: OkxPositionRaw = {
  adl: '1',
  availPos: '5',
  avgPx: '62961.4',
  baseBal: '',
  baseBorrowed: '',
  baseInterest: '',
  bePx: '',
  bizRefId: '',
  bizRefType: '',
  cTime: '1724740225685',
  ccy: 'USDT',
  clSpotInUseAmt: '',
  closeOrderAlgo: [],
  deltaBS: '',
  deltaPA: '',
  fee: '',
  fundingFee: '',
  gammaBS: '',
  gammaPA: '',
  hedgedPos: '',
  idxPx: '62890.5',
  imr: '',
  instId: 'BTC-USDT-SWAP',
  instType: 'SWAP',
  interest: '0',
  last: '62892.9',
  lever: '5',
  liab: '0',
  liabCcy: '',
  liqPenalty: '',
  liqPx: '53615.448336593756',
  margin: '0.000317654',
  markPx: '62891.9',
  maxSpotInUseAmt: '',
  mgnMode: 'isolated',
  mgnRatio: '9.404143929947395',
  mmr: '0.0000318005395854',
  notionalUsd: '119.756628017499',
  optVal: '',
  pendingCloseOrdLiabVal: '0',
  pnl: '',
  pos: '5',
  posCcy: '',
  posId: '1752810569801498626',
  posSide: 'net',
  quoteBal: '',
  quoteBorrowed: '',
  quoteInterest: '',
  realizedPnl: '',
  spotInUseAmt: '',
  spotInUseCcy: '',
  thetaBS: '',
  thetaPA: '',
  tradeId: '',
  uTime: '1724742632153',
  upl: '-0.0000033452492717',
  uplLastPx: '-0.0000033199677697',
  uplRatio: '-0.0105311101755551',
  uplRatioLastPx: '-0.0104515220008934',
  usdPx: '',
  vegaBS: '',
  vegaPA: '',
  nonSettleAvgPx: '',
  settledPnl: '',
};

export const OKX_RAW_POSITION_NET_SHORT: OkxPositionRaw = {
  ...OKX_RAW_POSITION_NET_LONG,
  pos: '-5',
};

export const OKX_RAW_POSITION_HEDGE_SHORT: OkxPositionRaw = {
  ...OKX_RAW_POSITION_NET_LONG,
  posSide: 'short',
  pos: '5',
};

/**
 * Первая запись — дословно из `trading-account-rest-api-get-positions-history`. Вторая —
 * подобрана так, чтобы `(closeAvgPx − openAvgPx) × closeTotalPos × ctVal(=1)` совпало с `pnl`:
 * `(100.5 − 100) × 20 = 10`.
 */
export const OKX_RAW_POSITION_HISTORY_LIST: OkxPositionHistoryRaw[] = [
  {
    instType: 'SWAP',
    instId: 'BTC-USD-SWAP',
    mgnMode: 'cross',
    type: '1',
    cTime: '1654177169995',
    uTime: '1654177174419',
    openAvgPx: '29783.8999999995535393',
    closeAvgPx: '29786.5999999789081085',
    posId: '452587086133239818',
    openMaxPos: '1',
    closeTotalPos: '1',
    realizedPnl: '0.001',
    fee: '-0.0001',
    fundingFee: '0',
    liqPenalty: '0',
    pnl: '0.0011',
    pnlRatio: '0.000906447858888',
    posSide: 'long',
    lever: '10.0',
    direction: 'long',
    triggerPx: '',
    uly: 'BTC-USD',
    ccy: 'BTC',
    nonSettleAvgPx: '',
    settledPnl: '',
  },
  {
    instType: 'SWAP',
    instId: 'BTC-USD-SWAP',
    mgnMode: 'cross',
    type: '1',
    cTime: '1654177169995',
    uTime: '1654177174420',
    openAvgPx: '100',
    closeAvgPx: '100.5',
    posId: '452587086133239819',
    openMaxPos: '20',
    closeTotalPos: '20',
    realizedPnl: '9.1',
    fee: '-0.4',
    fundingFee: '-1.5',
    liqPenalty: '0',
    pnl: '10',
    pnlRatio: '0.1',
    posSide: 'long',
    lever: '10.0',
    direction: 'long',
    triggerPx: '',
    uly: 'BTC-USD',
    ccy: 'BTC',
  },
];

/** Дословно из `order-book-trading-trade-get-order-details`. */
export const OKX_RAW_ORDER_FILLED: OkxOrderRaw = {
  accFillSz: '0.00192834',
  algoClOrdId: '',
  algoId: '',
  attachAlgoClOrdId: '',
  attachAlgoOrds: [],
  avgPx: '51858',
  cTime: '1708587373361',
  cancelSource: '',
  cancelSourceReason: '',
  category: 'normal',
  ccy: '',
  clOrdId: '',
  fee: '-0.00000192834',
  feeCcy: 'BTC',
  fillPx: '51858',
  fillSz: '0.00192834',
  fillTime: '1708587373361',
  instId: 'BTC-USDT',
  instType: 'SPOT',
  isTpLimit: 'false',
  lever: '',
  linkedAlgoOrd: { algoId: '' },
  ordId: '680800019749904384',
  ordType: 'market',
  pnl: '0',
  posSide: 'net',
  px: '',
  pxType: '',
  pxUsd: '',
  pxVol: '',
  quickMgnType: '',
  rebate: '0',
  rebateCcy: 'USDT',
  reduceOnly: 'false',
  side: 'buy',
  slOrdPx: '',
  slTriggerPx: '',
  slTriggerPxType: '',
  source: '',
  state: 'filled',
  stpId: '',
  stpMode: '',
  sz: '100',
  tag: '',
  tdMode: 'cash',
  tgtCcy: 'quote_ccy',
  tpOrdPx: '',
  tpTriggerPx: '',
  tpTriggerPxType: '',
  tradeId: '744876980',
  tradeQuoteCcy: 'USDT',
  uTime: '1708587373362',
};

/** Дословно из `order-book-trading-trade-get-order-list`. */
export const OKX_RAW_ORDER_LIVE_POST_ONLY: OkxOrderRaw = {
  accFillSz: '0',
  algoClOrdId: '',
  algoId: '',
  avgPx: '',
  cTime: '1724733617998',
  cancelSource: '',
  category: 'normal',
  ccy: '',
  clOrdId: '',
  fee: '0',
  feeCcy: 'BTC',
  fillPx: '',
  fillSz: '0',
  fillTime: '',
  instId: 'BTC-USDT',
  instType: 'SPOT',
  isTpLimit: 'false',
  lever: '',
  ordId: '1752588852617379840',
  ordType: 'post_only',
  pnl: '0',
  posSide: 'net',
  px: '13013.5',
  rebate: '0',
  rebateCcy: 'USDT',
  reduceOnly: 'false',
  side: 'buy',
  slOrdPx: '',
  slTriggerPx: '',
  source: '',
  state: 'live',
  sz: '0.001',
  tag: '',
  tdMode: 'cash',
  tgtCcy: '',
  tpOrdPx: '',
  tpTriggerPx: '',
  tradeId: '',
  uTime: '1724733617998',
};

/**
 * Спотовая рыночная покупка с суммой в котируемой валюте (`tgtCcy 'quote_ccy'`): `sz` — это
 * сумма USDT (100), а не количество базовой монеты; фактическое исполнение — в `accFillSz`.
 */
export const OKX_RAW_ORDER_SPOT_MARKET_QUOTE: OkxOrderRaw = {
  ...OKX_RAW_ORDER_FILLED,
  accFillSz: '0.0015',
  avgPx: '66666.67',
  fillPx: '66666.67',
  fillSz: '0.0015',
  ordType: 'market',
  sz: '100',
  tgtCcy: 'quote_ccy',
};

/**
 * Полный набор полей из `order-book-trading-algo-trading-get-algo-order-details` (тот же
 * `algoId`/`cTime`/`uTime`, что в примере документации). Изменено относительно примера: пример —
 * SPOT с тейк-профитом (`tpTriggerPx`/`tpOrdPx`, `tgtCcy 'quote_ccy'`, `tdMode 'cash'`); здесь —
 * SWAP со стопом (`slTriggerPx`/`slOrdPx`, `tgtCcy ''`, `tdMode 'cross'`, `instId`/`instType`
 * заменены на фьючерсные), чтобы фикстура покрывала ветку `StopMarket` и продолжала обслуживать
 * уже существующие тесты условных заявок. `failCode` — пустая строка, как в
 * `ws-algo-orders-channel` для не сработавшей заявки (REST `get-algo-order-details` возвращает
 * здесь `'0'`, но это уже отказ от него).
 */
export const OKX_RAW_ALGO_ORDER_STOP_MARKET: OkxAlgoOrderRaw = {
  activePx: '',
  actualPx: '',
  actualSide: '',
  actualSz: '0',
  algoClOrdId: '',
  algoId: '1753184812254216192',
  amendPxOnTriggerType: '0',
  attachAlgoOrds: [],
  cTime: '1724751378980',
  callbackRatio: '',
  callbackSpread: '',
  ccy: '',
  chaseType: '',
  chaseVal: '',
  clOrdId: '',
  closeFraction: '',
  failCode: '',
  instId: 'BTC-USDT-SWAP',
  instType: 'SWAP',
  isTradeBorrowMode: '',
  last: '62916.5',
  lever: '10',
  linkedOrd: { ordId: '' },
  maxChaseType: '',
  maxChaseVal: '',
  moveTriggerPx: '',
  ordId: '',
  ordIdList: [],
  ordPx: '',
  ordType: 'conditional',
  posSide: 'net',
  pxLimit: '',
  pxSpread: '',
  pxVar: '',
  quickMgnType: '',
  reduceOnly: 'false',
  side: 'sell',
  slOrdPx: '-1',
  slTriggerPx: '60000',
  slTriggerPxType: 'last',
  sz: '10',
  szLimit: '',
  tag: '',
  tdMode: 'cross',
  tgtCcy: '',
  timeInterval: '',
  tpOrdPx: '',
  tpTriggerPx: '',
  tpTriggerPxType: '',
  tradeQuoteCcy: '',
  triggerPx: '',
  triggerPxType: '',
  triggerTime: '',
  state: 'live',
  uTime: '1724751378980',
};

/**
 * Дословно из `order-book-trading-algo-trading-get-algo-order-details` — SPOT-заявка с суммой в
 * котируемой валюте (`tgtCcy 'quote_ccy'`, `sz '10'` — это 10 USDT, не 10 монет). Изменено
 * относительно примера: `failCode` — пустая строка вместо `'0'` (см. пояснение у
 * `OKX_RAW_ALGO_ORDER_STOP_MARKET` — REST-пример несёт отказавший код на незапустившейся заявке).
 */
export const OKX_RAW_ALGO_ORDER_SPOT_MARKET_QUOTE: OkxAlgoOrderRaw = {
  activePx: '',
  actualPx: '',
  actualSide: '',
  actualSz: '0',
  algoClOrdId: '',
  algoId: '1753184812254216193',
  amendPxOnTriggerType: '0',
  attachAlgoOrds: [],
  cTime: '1724751378980',
  callbackRatio: '',
  callbackSpread: '',
  ccy: '',
  chaseType: '',
  chaseVal: '',
  clOrdId: '',
  closeFraction: '',
  failCode: '',
  instId: 'BTC-USDT',
  instType: 'SPOT',
  isTradeBorrowMode: '',
  last: '62916.5',
  lever: '',
  linkedOrd: { ordId: '' },
  maxChaseType: '',
  maxChaseVal: '',
  moveTriggerPx: '',
  ordId: '',
  ordIdList: [],
  ordPx: '',
  ordType: 'conditional',
  posSide: 'net',
  pxLimit: '',
  pxSpread: '',
  pxVar: '',
  quickMgnType: '',
  reduceOnly: 'false',
  side: 'buy',
  slOrdPx: '',
  slTriggerPx: '',
  slTriggerPxType: '',
  sz: '10',
  szLimit: '',
  tag: '',
  tdMode: 'cash',
  tgtCcy: 'quote_ccy',
  timeInterval: '',
  tpOrdPx: '-1',
  tpTriggerPx: '10000',
  tpTriggerPxType: 'last',
  tradeQuoteCcy: 'USDT',
  triggerPx: '',
  triggerPxType: '',
  triggerTime: '',
  state: 'live',
  uTime: '1724751378980',
};

export const OKX_RAW_ALGO_ORDER_TAKE_PROFIT_LIMIT: OkxAlgoOrderRaw = {
  ...OKX_RAW_ALGO_ORDER_STOP_MARKET,
  side: 'buy',
  slOrdPx: '',
  slTriggerPx: '',
  slTriggerPxType: '',
  tpOrdPx: '65000',
  tpTriggerPx: '64500',
  tpTriggerPxType: 'last',
};

export const OKX_RAW_ALGO_ORDER_TRAILING: OkxAlgoOrderRaw = {
  ...OKX_RAW_ALGO_ORDER_STOP_MARKET,
  activePx: '63000',
  callbackRatio: '0.01',
  moveTriggerPx: '62500',
  ordType: 'move_order_stop',
  slOrdPx: '',
  slTriggerPx: '',
  slTriggerPxType: '',
};

export const OKX_RAW_ALGO_ORDER_EFFECTIVE: OkxAlgoOrderRaw = {
  ...OKX_RAW_ALGO_ORDER_STOP_MARKET,
  actualPx: '59980',
  actualSide: 'sl',
  actualSz: '10',
  failCode: '1',
  ordId: '1753184812254216200',
  ordIdList: ['1753184812254216200'],
  state: 'effective',
};

/** Заявка «одна отменяет другую»: заполнены ОБЕ ноги — защита на 60 000 и прибыль на 70 000. */
export const OKX_RAW_ALGO_ORDER_OCO: OkxAlgoOrderRaw = {
  ...OKX_RAW_ALGO_ORDER_STOP_MARKET,
  algoId: '1880721064716505088',
  ordType: 'oco',
  slOrdPx: '-1',
  slTriggerPx: '60000',
  slTriggerPxType: 'last',
  tpOrdPx: '-1',
  tpTriggerPx: '70000',
  tpTriggerPxType: 'last',
};

/** Та же заявка после срабатывания ноги ПРИБЫЛИ — биржа называет её в `actualSide`. */
export const OKX_RAW_ALGO_ORDER_OCO_TAKE_PROFIT_FIRED: OkxAlgoOrderRaw = {
  ...OKX_RAW_ALGO_ORDER_OCO,
  actualSide: 'tp',
  actualSz: '10',
  failCode: '1',
  ordId: '1884789786215137280',
  ordIdList: ['1884789786215137280'],
  state: 'effective',
};

/** Заявка вида «триггерная» (`trigger`) — такие ставит личный кабинет, а не эта библиотека. */
export const OKX_RAW_ALGO_ORDER_TRIGGER: OkxAlgoOrderRaw = {
  ...OKX_RAW_ALGO_ORDER_STOP_MARKET,
  algoId: '2510789768709120',
  ordPx: '-1',
  ordType: 'trigger',
  slOrdPx: '',
  slTriggerPx: '',
  slTriggerPxType: '',
  triggerPx: '58000',
  triggerPxType: 'last',
};

export const OKX_RAW_ALGO_ORDER_FAILED: OkxAlgoOrderRaw = {
  ...OKX_RAW_ALGO_ORDER_STOP_MARKET,
  failCode: '51008',
  failMsg: 'Order failed. Insufficient balance',
  state: 'order_failed',
};

/** Дословно из `trading-account-rest-api-get-bills-details-last-7-days`, `type '2'`, `pnl '0'` — открытие. */
export const OKX_RAW_BILL_TRADE_OPEN: OkxBillRaw = {
  bal: '8694.2179403378290202',
  balChg: '0.0219338232210000',
  billId: '623950854533513219',
  ccy: 'USDT',
  execType: 'T',
  fee: '-0.000021955779',
  fillTime: '1695033476166',
  instId: 'BTC-USDT',
  instType: 'SPOT',
  mgnMode: 'isolated',
  ordId: '623950854525124608',
  pnl: '0',
  posBal: '0',
  posBalChg: '0',
  px: '27105.9',
  subType: '1',
  sz: '0.021955779',
  tradeId: '586760148',
  ts: '1695033476167',
  type: '2',
};

/**
 * По образцу той же записи журнала, но закрытие сделки: `pnl`/`fee` ненулевые. Поля вне
 * `OkxBillRaw` (`earnAmt`, `earnApr`, `fillFwdPx`, `fillMarkVol`, `fillPxUsd`, `fillPxVol`,
 * `from`, `interest`, `notes`, `tag`, `to`) сохранены дословно из документации ради теста
 * полноты полей.
 */
export const OKX_RAW_BILL_TRADE_CLOSE: OkxBillRaw = {
  bal: '4850.0',
  balChg: '15.47977832',
  billId: '623950854533513221',
  ccy: 'USDT',
  clOrdId: '',
  earnAmt: '',
  earnApr: '',
  execType: 'T',
  fee: '-0.02022168',
  fillFwdPx: '',
  fillIdxPx: '27104.1',
  fillMarkPx: '',
  fillMarkVol: '',
  fillPxUsd: '',
  fillPxVol: '',
  fillTime: '1695033476166',
  from: '',
  instId: 'BTC-USDT-SWAP',
  instType: 'SWAP',
  interest: '0',
  mgnMode: 'cross',
  notes: '',
  ordId: '623950854525124609',
  pnl: '15.5',
  posBal: '0',
  posBalChg: '0',
  px: '27105.9',
  subType: '2',
  sz: '0.021955779',
  tag: '',
  to: '',
  tradeId: '586760149',
  ts: '1695033476167',
  type: '2',
};

/**
 * Списание фандинга (`type '8'`/`subType '173'`). Документация раздела журнала: «Funding Fee
 * expense (subType = 173) — You may refer to "pnl" for the fee payment» — денежный поток лежит
 * в `pnl`, `balChg` здесь нарочно нулевой, как в реальном ответе биржи для этого подтипа.
 */
export const OKX_RAW_BILL_FUNDING_EXPENSE: OkxBillRaw = {
  bal: '8694.2179403378290202',
  balChg: '0',
  billId: '623950854533513220',
  ccy: 'USDT',
  execType: '',
  fee: '0',
  fillTime: '',
  instId: 'BTC-USDT-SWAP',
  instType: 'SWAP',
  mgnMode: 'cross',
  ordId: '',
  pnl: '-2.3156522',
  posBal: '0',
  posBalChg: '0',
  px: '',
  subType: '173',
  sz: '',
  tradeId: '',
  ts: '1695033476200',
  type: '8',
};

/**
 * Начисление фандинга (`type '8'`/`subType '174'`) — документация не называет поле явно для этой
 * стороны; по аналогии со списанием (`pnl`) берём `pnl` тоже. Гипотеза: подтвердить живой записью
 * с демо-счёта (см. `scratchpad/DECISIONS.md`, раздел «для живой проверки»).
 */
export const OKX_RAW_BILL_FUNDING_INCOME: OkxBillRaw = {
  ...OKX_RAW_BILL_FUNDING_EXPENSE,
  billId: '623950854533513222',
  balChg: '1.25',
  pnl: '1.25',
  subType: '174',
};

/** Списание фандинга, где `pnl` пуст (нулевой) — сумма должна упасть на `balChg`. */
export const OKX_RAW_BILL_FUNDING_EXPENSE_BALCHG_ONLY: OkxBillRaw = {
  ...OKX_RAW_BILL_FUNDING_EXPENSE,
  billId: '623950854533513223',
  balChg: '-0.5',
  pnl: '0',
};

/** Дословно из `order-book-trading-trade-post-place-order`. */
export const OKX_RAW_ORDER_RESULT_OK: OkxOrderResultRaw = {
  clOrdId: 'oktswap6',
  ordId: '312269865356374016',
  tag: '',
  ts: '1695190491421',
  sCode: '0',
  sMsg: '',
};

export const OKX_RAW_ORDER_RESULT_REJECTED: OkxOrderResultRaw = {
  clOrdId: 'oktswap7',
  ordId: '',
  tag: '',
  ts: '1695190491421',
  sCode: '51008',
  sMsg: 'Order failed. Insufficient balance',
};

export const OKX_RAW_POSITION_TIER_LIST: OkxPositionTierRaw[] = [
  { baseMaxLoan: '', imr: '0.01', instFamily: 'BTC-USDT', instId: '', maxLever: '100', maxSz: '1000', minSz: '0', mmr: '0.004', optMgnFactor: '0', quoteMaxLoan: '', tier: '1', uly: 'BTC-USDT' },
  { baseMaxLoan: '', imr: '0.015', instFamily: 'BTC-USDT', instId: '', maxLever: '66.66', maxSz: '5000', minSz: '1000.01', mmr: '0.005', optMgnFactor: '0', quoteMaxLoan: '', tier: '2', uly: 'BTC-USDT' },
  { baseMaxLoan: '', imr: '0.02', instFamily: 'BTC-USDT', instId: '', maxLever: '50', maxSz: '20000', minSz: '5000.01', mmr: '0.0075', optMgnFactor: '0', quoteMaxLoan: '', tier: '3', uly: 'BTC-USDT' },
  { baseMaxLoan: '', imr: '0.025', instFamily: 'BTC-USDT', instId: '', maxLever: '40', maxSz: '40000', minSz: '20000.01', mmr: '0.0125', optMgnFactor: '0', quoteMaxLoan: '', tier: '4', uly: 'BTC-USDT' },
];
