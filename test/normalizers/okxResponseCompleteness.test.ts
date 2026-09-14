import {
  OKX_RAW_INSTRUMENT_SPOT,
  OKX_RAW_ORDER_FILLED,
  OKX_RAW_POSITION_NET_LONG,
  OKX_RAW_BALANCE,
  OKX_RAW_ALGO_ORDER_STOP_MARKET,
  OKX_RAW_BILL_TRADE_CLOSE,
  OKX_RAW_POSITION_HISTORY_LIST,
} from '../fixtures/okxRaw';
import { normalizeOkxBalances } from '../../src/normalizers/okxNormalizer';

describe('OKX instrument field completeness (guard against silent drops)', () => {
  const MODELED_KEYS = new Set<string>([
    'instId',
    'instType',
    'baseCcy',
    'quoteCcy',
    'settleCcy',
    'ctVal',
    'ctType',
    'lever',
    'tickSz',
    'lotSz',
    'minSz',
    'maxLmtSz',
    'maxMktSz',
    'maxLmtAmt',
    'state',
    'listTime',
    'instCategory',
    'initPxLmtPct',
    'floatPxLmtPct',
    'maxPxLmtPct',
    'groupId',
    'instIdCode',
  ]);

  const INTENTIONALLY_IGNORED_KEYS = new Set<string>([
    'alias',
    'auctionEndTime',
    'category',
    'ctMult',
    'ctValCcy',
    'contTdSwTime',
    'expTime',
    'futureSettlement',
    'instFamily',
    'maxIcebergSz',
    'maxMktAmt',
    'maxStopSz',
    'maxTriggerSz',
    'maxTwapSz',
    'optType',
    'openType',
    'preMktSwTime',
    'tradeQuoteCcyList',
    'ruleType',
    'stk',
    'uly',
    'upcChg',
  ]);

  it('every field in a real instrument snapshot is either modeled or explicitly ignored', () => {
    const unaccounted = Object.keys(OKX_RAW_INSTRUMENT_SPOT).filter(
      (key) => !MODELED_KEYS.has(key) && !INTENTIONALLY_IGNORED_KEYS.has(key)
    );

    expect(unaccounted).toEqual([]);
  });
});

describe('OKX ticker field completeness (guard against silent drops)', () => {
  const TICKER_SNAPSHOT: Record<string, unknown> = {
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
  };

  const MODELED_KEYS = new Set<string>([
    'instId',
    'last',
    'open24h',
    'high24h',
    'low24h',
    'volCcy24h',
    'vol24h',
    'bidPx',
    'bidSz',
    'askPx',
    'askSz',
    'ts',
  ]);

  const INTENTIONALLY_IGNORED_KEYS = new Set<string>(['instType', 'lastSz', 'sodUtc0', 'sodUtc8']);

  it('every field in a real ticker snapshot is either modeled or explicitly ignored', () => {
    const unaccounted = Object.keys(TICKER_SNAPSHOT).filter(
      (key) => !MODELED_KEYS.has(key) && !INTENTIONALLY_IGNORED_KEYS.has(key)
    );

    expect(unaccounted).toEqual([]);
  });
});

describe('OKX order field completeness (guard against silent drops)', () => {
  const MODELED_KEYS = new Set<string>([
    'ordId',
    'clOrdId',
    'instId',
    'side',
    'ordType',
    'px',
    'sz',
    'accFillSz',
    'avgPx',
    'state',
    'reduceOnly',
    'cTime',
    'uTime',
    'tgtCcy',
    'cancelSource',
    'slTriggerPx',
    'tpTriggerPx',
  ]);

  const INTENTIONALLY_IGNORED_KEYS = new Set<string>([
    'algoClOrdId',
    'algoId',
    'attachAlgoClOrdId',
    'attachAlgoOrds',
    'category',
    'cancelSourceReason',
    'ccy',
    'fee',
    'feeCcy',
    'fillPx',
    'fillSz',
    'fillTime',
    'instType',
    'isTpLimit',
    'lever',
    'linkedAlgoOrd',
    'pnl',
    'posSide',
    'pxType',
    'pxUsd',
    'pxVol',
    'quickMgnType',
    'rebate',
    'rebateCcy',
    'slOrdPx',
    'slTriggerPxType',
    'source',
    'stpId',
    'stpMode',
    'tag',
    'tdMode',
    'tpOrdPx',
    'tpTriggerPxType',
    'tradeId',
    'tradeQuoteCcy',
  ]);

  it('every field in a real order snapshot is either modeled or explicitly ignored', () => {
    const unaccounted = Object.keys(OKX_RAW_ORDER_FILLED).filter(
      (key) => !MODELED_KEYS.has(key) && !INTENTIONALLY_IGNORED_KEYS.has(key)
    );

    expect(unaccounted).toEqual([]);
  });
});

describe('OKX position field completeness (guard against silent drops)', () => {
  const MODELED_KEYS = new Set<string>([
    'instId',
    'pos',
    'posSide',
    'avgPx',
    'markPx',
    'upl',
    'lever',
    'mgnMode',
    'liqPx',
    'uTime',
  ]);

  const INTENTIONALLY_IGNORED_KEYS = new Set<string>([
    'adl',
    'availPos',
    'baseBal',
    'baseBorrowed',
    'baseInterest',
    'bePx',
    'bizRefId',
    'bizRefType',
    'cTime',
    'ccy',
    'clSpotInUseAmt',
    'closeOrderAlgo',
    'deltaBS',
    'deltaPA',
    'fee',
    'fundingFee',
    'gammaBS',
    'gammaPA',
    'hedgedPos',
    'idxPx',
    'imr',
    'instType',
    'interest',
    'last',
    'liab',
    'liabCcy',
    'liqPenalty',
    'margin',
    'maxSpotInUseAmt',
    'mgnRatio',
    'mmr',
    'notionalUsd',
    'optVal',
    'pendingCloseOrdLiabVal',
    'pnl',
    'posCcy',
    'posId',
    'quoteBal',
    'quoteBorrowed',
    'quoteInterest',
    'realizedPnl',
    'spotInUseAmt',
    'spotInUseCcy',
    'thetaBS',
    'thetaPA',
    'tradeId',
    'uplLastPx',
    'uplRatio',
    'uplRatioLastPx',
    'usdPx',
    'vegaBS',
    'vegaPA',
    'nonSettleAvgPx',
    'settledPnl',
  ]);

  it('every field in a real position snapshot is either modeled or explicitly ignored', () => {
    const unaccounted = Object.keys(OKX_RAW_POSITION_NET_LONG).filter(
      (key) => !MODELED_KEYS.has(key) && !INTENTIONALLY_IGNORED_KEYS.has(key)
    );

    expect(unaccounted).toEqual([]);
  });
});

describe('OKX balance account-level field completeness (guard against silent drops)', () => {
  const MODELED_KEYS = new Set<string>(['totalEq', 'upl', 'availEq', 'adjEq', 'imr', 'details']);

  const INTENTIONALLY_IGNORED_KEYS = new Set<string>([
    'uTime',
    'isoEq',
    'borrowFroz',
    'delta',
    'deltaLever',
    'deltaNeutralStatus',
    'ordFroz',
    'mmr',
    'mgnRatio',
    'notionalUsd',
    'notionalUsdForBorrow',
    'notionalUsdForFutures',
    'notionalUsdForOption',
    'notionalUsdForSwap',
  ]);

  it('every account-level field in a real balance snapshot is either modeled or explicitly ignored', () => {
    const unaccounted = Object.keys(OKX_RAW_BALANCE).filter(
      (key) => !MODELED_KEYS.has(key) && !INTENTIONALLY_IGNORED_KEYS.has(key)
    );

    expect(unaccounted).toEqual([]);
  });

  it('reads the account totals from the account level, not from the coin rows', () => {
    const balances = normalizeOkxBalances(OKX_RAW_BALANCE);

    expect(balances.totalMarginBalance).toBe(parseFloat(OKX_RAW_BALANCE.totalEq));
    expect(balances.totalAvailableBalance).toBe(parseFloat(OKX_RAW_BALANCE.availEq));
    expect(balances.totalInitialMargin).toBe(parseFloat(OKX_RAW_BALANCE.imr));
  });
});

describe('OKX balance detail field completeness (guard against silent drops)', () => {
  const MODELED_KEYS = new Set<string>(['ccy', 'eq', 'availBal', 'frozenBal', 'cashBal', 'ordFrozen', 'imr', 'eqUsd']);

  const INTENTIONALLY_IGNORED_KEYS = new Set<string>([
    'autoLendStatus',
    'autoLendMtAmt',
    'availEq',
    'borrowFroz',
    'crossLiab',
    'colRes',
    'collateralEnabled',
    'collateralRestrict',
    'colBorrAutoConversion',
    'disEq',
    'smtSyncEq',
    'spotCopyTradingEq',
    'fixedBal',
    'frpType',
    'interest',
    'isoEq',
    'isoLiab',
    'isoUpl',
    'liab',
    'maxLoan',
    'mgnRatio',
    'mmr',
    'notionalLever',
    'rewardBal',
    'spotInUseAmt',
    'clSpotInUseAmt',
    'maxSpotInUse',
    'spotIsoBal',
    'stgyEq',
    'twap',
    'upl',
    'uplLiab',
    'spotBal',
    'openAvgPx',
    'accAvgPx',
    'spotUpl',
    'spotUplRatio',
    'totalPnl',
    'totalPnlRatio',
    'uTime',
  ]);

  it('every field in a real balance detail snapshot is either modeled or explicitly ignored', () => {
    const unaccounted = Object.keys(OKX_RAW_BALANCE.details![0]).filter(
      (key) => !MODELED_KEYS.has(key) && !INTENTIONALLY_IGNORED_KEYS.has(key)
    );

    expect(unaccounted).toEqual([]);
  });
});

describe('OKX algo order field completeness (guard against silent drops)', () => {
  const MODELED_KEYS = new Set<string>([
    'algoId',
    'algoClOrdId',
    'instId',
    'side',
    'ordType',
    'sz',
    'closeFraction',
    'state',
    'reduceOnly',
    'cTime',
    'uTime',
    'slTriggerPx',
    'slOrdPx',
    'tpTriggerPx',
    'tpOrdPx',
    'triggerPx',
    'ordPx',
    'moveTriggerPx',
    'actualPx',
    'actualSz',
    'ordIdList',
    'ordId',
    'failCode',
    'failMsg',
    'tgtCcy',
    'actualSide',
  ]);

  const INTENTIONALLY_IGNORED_KEYS = new Set<string>([
    'activePx',
    'amendPxOnTriggerType',
    'attachAlgoOrds',
    'callbackRatio',
    'callbackSpread',
    'ccy',
    'chaseType',
    'chaseVal',
    'clOrdId',
    'instType',
    'isTradeBorrowMode',
    'last',
    'lever',
    'linkedOrd',
    'maxChaseType',
    'maxChaseVal',
    'posSide',
    'pxLimit',
    'pxSpread',
    'pxVar',
    'quickMgnType',
    'slTriggerPxType',
    'szLimit',
    'tag',
    'tdMode',
    'timeInterval',
    'tpTriggerPxType',
    'tradeQuoteCcy',
    'triggerPxType',
    'triggerTime',
  ]);

  it('every field in a real algo order snapshot is either modeled or explicitly ignored', () => {
    const unaccounted = Object.keys(OKX_RAW_ALGO_ORDER_STOP_MARKET).filter(
      (key) => !MODELED_KEYS.has(key) && !INTENTIONALLY_IGNORED_KEYS.has(key)
    );

    expect(unaccounted).toEqual([]);
  });
});

describe('OKX bill field completeness (guard against silent drops)', () => {
  const MODELED_KEYS = new Set<string>(['instId', 'type', 'subType', 'ts', 'balChg', 'sz', 'ccy', 'billId', 'ordId', 'tradeId', 'execType', 'pnl', 'fee']);

  const INTENTIONALLY_IGNORED_KEYS = new Set<string>([
    'bal',
    'clOrdId',
    'earnAmt',
    'earnApr',
    'fillFwdPx',
    'fillIdxPx',
    'fillMarkPx',
    'fillMarkVol',
    'fillPxUsd',
    'fillPxVol',
    'fillTime',
    'from',
    'instType',
    'interest',
    'mgnMode',
    'notes',
    'posBal',
    'posBalChg',
    'px',
    'tag',
    'to',
  ]);

  it('every field in a real bill snapshot is either modeled or explicitly ignored', () => {
    const unaccounted = Object.keys(OKX_RAW_BILL_TRADE_CLOSE).filter(
      (key) => !MODELED_KEYS.has(key) && !INTENTIONALLY_IGNORED_KEYS.has(key)
    );

    expect(unaccounted).toEqual([]);
  });
});

describe('OKX position history field completeness (guard against silent drops)', () => {
  const MODELED_KEYS = new Set<string>(['instId', 'posId', 'direction', 'closeTotalPos', 'openAvgPx', 'closeAvgPx', 'pnl', 'fee', 'uTime']);

  const INTENTIONALLY_IGNORED_KEYS = new Set<string>([
    'instType',
    'mgnMode',
    'type',
    'cTime',
    'openMaxPos',
    'realizedPnl',
    'fundingFee',
    'liqPenalty',
    'pnlRatio',
    'posSide',
    'lever',
    'triggerPx',
    'uly',
    'ccy',
    'nonSettleAvgPx',
    'settledPnl',
  ]);

  it('every field in a real position-history snapshot is either modeled or explicitly ignored', () => {
    const unaccounted = Object.keys(OKX_RAW_POSITION_HISTORY_LIST[0]).filter(
      (key) => !MODELED_KEYS.has(key) && !INTENTIONALLY_IGNORED_KEYS.has(key)
    );

    expect(unaccounted).toEqual([]);
  });
});
