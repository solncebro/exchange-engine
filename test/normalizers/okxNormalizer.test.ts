import {
  normalizeOkxTradeSymbols,
  normalizeOkxTickers,
  buildOkxBatchItemResult,
  normalizeOkxKlines,
  normalizeOkxKlineWebSocketMessage,
  normalizeOkxOrderBook,
  normalizeOkxOrderBookUpdate,
  parseOkxOrderbookRawFrame,
  normalizeOkxPublicTradeList,
  normalizeOkxMarkPriceList,
  normalizeOkxMarkPriceWebSocketList,
  normalizeOkxOpenInterest,
  normalizeOkxFundingRateHistoryList,
  normalizeOkxFundingInfoList,
  normalizeOkxFeeRate,
  normalizeOkxPosition,
  normalizeOkxOrder,
  normalizeOkxAlgoOrder,
  mergeOkxTriggeredOrder,
  resolveOkxAlgoTriggerLeg,
  buildOkxOrderFromCreateResponse,
  buildOkxCreateOutcome,
  normalizeOkxBalances,
  normalizeOkxIncomeList,
  buildOkxRealizedPnlIncomeList,
  buildOkxCommissionIncomeList,
  normalizeOkxClosedPnlList,
  buildOkxOrderUpdateEvent,
  buildOkxAlgoOrderUpdateEvent,
  buildOkxPositionUpdateEvent,
  buildOkxBalanceUpdateEvent,
  normalizeOkxPositionTierList,
} from '../../src/normalizers/okxNormalizer';
import type {
  OkxFeeRateRaw,
  OkxInstrumentRaw,
  OkxPublicTradeRaw,
  OkxTickerRaw,
  OkxPositionRaw,
  OkxOrderRaw,
  OkxBalanceRaw,
  OkxBillRaw,
} from '../../src/normalizers/okxNormalizer';
import { OrderSideEnum, OrderTypeEnum, TimeInForceEnum, PositionSideEnum, MarginModeEnum, TradeSymbolTypeEnum } from '../../src/types/common';
import { ExchangeError } from '../../src/errors/ExchangeError';
import { MISSING_ORDER_ID_ERROR_TEXT } from '../../src/normalizers/batchOrderOutcome';
import {
  OKX_RAW_INSTRUMENT_SPOT,
  OKX_RAW_INSTRUMENT_SWAP,
  OKX_RAW_INDEX_TICKER_LIST,
  OKX_RAW_INSTRUMENT_INVERSE,
  OKX_RAW_INSTRUMENT_USDC_SWAP,
  OKX_RAW_INSTRUMENT_STOCK_SWAP,
  OKX_RAW_TICKER_LIST,
  OKX_RAW_KLINE_LIST,
  OKX_RAW_ORDER_BOOK,
  OKX_RAW_ORDER_BOOK_STREAM_SNAPSHOT,
  OKX_RAW_ORDER_BOOK_STREAM_UPDATE,
  OKX_RAW_PUBLIC_TRADE_LIST,
  OKX_RAW_MARK_PRICE_LIST,
  OKX_RAW_OPEN_INTEREST,
  OKX_RAW_FUNDING_RATE,
  OKX_RAW_FUNDING_RATE_HISTORY_LIST,
  OKX_RAW_FEE_RATE,
  OKX_RAW_BALANCE,
  OKX_RAW_BALANCE_FUTURES_MODE,
  OKX_RAW_BALANCE_ISOLATED_POSITION,
  OKX_RAW_BALANCE_PENDING_ORDER,
  OKX_RAW_BALANCE_SPOT_MODE,
  OKX_RAW_POSITION_NET_LONG,
  OKX_RAW_POSITION_NET_SHORT,
  OKX_RAW_POSITION_HEDGE_SHORT,
  OKX_RAW_POSITION_HISTORY_LIST,
  OKX_RAW_ORDER_FILLED,
  OKX_RAW_ORDER_LIVE_POST_ONLY,
  OKX_RAW_ORDER_SPOT_MARKET_QUOTE,
  OKX_RAW_ALGO_ORDER_STOP_MARKET,
  OKX_RAW_ALGO_ORDER_SPOT_MARKET_QUOTE,
  OKX_RAW_ALGO_ORDER_TAKE_PROFIT_LIMIT,
  OKX_RAW_ALGO_ORDER_TRAILING,
  OKX_RAW_ALGO_ORDER_EFFECTIVE,
  OKX_RAW_ALGO_ORDER_FAILED,
  OKX_RAW_ALGO_ORDER_OCO,
  OKX_RAW_ALGO_ORDER_OCO_TAKE_PROFIT_FIRED,
  OKX_RAW_ALGO_ORDER_TRIGGER,
  OKX_RAW_BILL_FUNDING_EXPENSE,
  OKX_RAW_BILL_FUNDING_INCOME,
  OKX_RAW_BILL_FUNDING_EXPENSE_BALCHG_ONLY,
  OKX_RAW_BILL_TRADE_CLOSE,
  OKX_RAW_BILL_TRADE_OPEN,
  OKX_RAW_ORDER_RESULT_OK,
  OKX_RAW_ORDER_RESULT_REJECTED,
  OKX_RAW_POSITION_TIER_LIST,
} from '../fixtures/okxRaw';

/** Курс USDT в долларах, каким его даёт заготовка баланса: `eqUsd / eq` (у биржи — `coinUsdPrice`). */
const USDT_TO_USD_RATE = 4991.542013297616 / 4992.890093622894;

const OKX_TEST_CONTRACT_VALUE_BY_SYMBOL = new Map<string, string>([
  ['LTCUSD', '1'],
  ['BTCUSDT', '0.01'],
]);

describe('normalizeOkxTradeSymbols', () => {
  it('converts SWAP filter values from contracts into coins', () => {
    const result = normalizeOkxTradeSymbols([OKX_RAW_INSTRUMENT_SWAP]);
    const tradeSymbol = result.get('BTCUSDT');

    expect(tradeSymbol).toBeDefined();
    expect(tradeSymbol?.symbol).toBe('BTCUSDT');
    expect(tradeSymbol?.baseAsset).toBe('BTC');
    expect(tradeSymbol?.quoteAsset).toBe('USDT');
    expect(tradeSymbol?.filter.stepSize).toBe('0.01');
    expect(tradeSymbol?.filter.minQty).toBe('0.01');
    expect(tradeSymbol?.filter.maxQty).toBe('1000000');
    expect(tradeSymbol?.filter.marketMaxQty).toBe('120');
    expect(tradeSymbol?.contractSize).toBe(0.01);
    expect(tradeSymbol?.settle).toBe('USDT');
    expect(tradeSymbol?.isLinear).toBe(true);
    expect(tradeSymbol?.type).toBe(TradeSymbolTypeEnum.Swap);
    expect(tradeSymbol?.leverageFilter?.maxLeverage).toBe('100');
    expect(tradeSymbol?.pricePrecision).toBe(1);
    expect(tradeSymbol?.quantityPrecision).toBe(2);
    expect(tradeSymbol?.launchTimestamp).toBe(1611916800000);
  });

  it('converts USDC-settled SWAP filter values without floating point tails', () => {
    const result = normalizeOkxTradeSymbols([OKX_RAW_INSTRUMENT_USDC_SWAP]);
    const tradeSymbol = result.get('ETHUSDC');

    expect(tradeSymbol?.filter.stepSize).toBe('0.0001');
    expect(tradeSymbol?.settle).toBe('USDC');
  });

  it('skips inverse contracts', () => {
    const result = normalizeOkxTradeSymbols([OKX_RAW_INSTRUMENT_INVERSE]);

    expect(result.has('BTCUSD')).toBe(false);
    expect(result.size).toBe(0);
  });

  it('keys the symbol from instId, using baseCcy/quoteCcy only for baseAsset/quoteAsset', () => {
    const result = normalizeOkxTradeSymbols([
      { ...OKX_RAW_INSTRUMENT_SPOT, instId: 'RENDER-USDT', baseCcy: 'RNDR', quoteCcy: 'USDT' },
    ]);

    expect(result.has('RENDERUSDT')).toBe(true);
    expect(result.has('RNDRUSDT')).toBe(false);
    expect(result.get('RENDERUSDT')?.baseAsset).toBe('RNDR');
    expect(result.get('RENDERUSDT')?.quoteAsset).toBe('USDT');
  });

  it('keeps spot filter values in base units without conversion', () => {
    const result = normalizeOkxTradeSymbols([OKX_RAW_INSTRUMENT_SPOT]);
    const tradeSymbol = result.get('BTCUSDT');

    expect(tradeSymbol?.filter.stepSize).toBe('0.00000001');
    expect(tradeSymbol?.filter.marketMaxQty).toBeUndefined();
    expect(tradeSymbol?.filter.maxNotional).toBe('1000000');
    expect(tradeSymbol?.settle).toBe('');
    expect(tradeSymbol?.isLinear).toBe(false);
    expect(tradeSymbol?.type).toBe(TradeSymbolTypeEnum.Spot);
  });

  it('marks a stock SWAP as tradifi', () => {
    const result = normalizeOkxTradeSymbols([OKX_RAW_INSTRUMENT_STOCK_SWAP]);
    const tradeSymbol = result.get('AAPLUSDT');

    expect(tradeSymbol?.isTradifi).toBe(true);
  });

  it('marks a suspended instrument as inactive', () => {
    const result = normalizeOkxTradeSymbols([{ ...OKX_RAW_INSTRUMENT_SPOT, state: 'suspend' }]);

    expect(result.get('BTCUSDT')?.isActive).toBe(false);
  });

  it('counts an instrument that is about to start trading as active, as Bybit counts PreLaunch', () => {
    const result = normalizeOkxTradeSymbols([{ ...OKX_RAW_INSTRUMENT_SPOT, state: 'preopen' }]);

    expect(result.get('BTCUSDT')?.isActive).toBe(true);
  });

  it('marks a forex perpetual as TradFi, not as ordinary crypto', () => {
    const result = normalizeOkxTradeSymbols([{ ...OKX_RAW_INSTRUMENT_SPOT, instCategory: '5' }]);

    expect(result.get('BTCUSDT')?.isTradifi).toBe(true);
  });

  it('marks a bond perpetual as TradFi as well', () => {
    const result = normalizeOkxTradeSymbols([{ ...OKX_RAW_INSTRUMENT_SPOT, instCategory: '6' }]);

    expect(result.get('BTCUSDT')?.isTradifi).toBe(true);
  });

  it('keeps crypto out of TradFi', () => {
    const result = normalizeOkxTradeSymbols([{ ...OKX_RAW_INSTRUMENT_SPOT, instCategory: '1' }]);

    expect(result.get('BTCUSDT')?.isTradifi).toBe(false);
  });

  it('preserves the raw payload in info', () => {
    const result = normalizeOkxTradeSymbols([OKX_RAW_INSTRUMENT_SPOT]);
    const tradeSymbol = result.get('BTCUSDT');

    expect(tradeSymbol?.info).toBe(OKX_RAW_INSTRUMENT_SPOT);
  });

  it('skips instruments whose instId cannot be parsed', () => {
    const result = normalizeOkxTradeSymbols([{ ...OKX_RAW_INSTRUMENT_SPOT, instId: 'INVALID' }]);

    expect(result.size).toBe(0);
  });

  it('skips instrument types other than SWAP and SPOT', () => {
    const result = normalizeOkxTradeSymbols([{ ...OKX_RAW_INSTRUMENT_SPOT, instType: 'MARGIN' }]);

    expect(result.size).toBe(0);
  });

  it('skips a SWAP with an empty ctVal instead of publishing a degenerate contract', () => {
    const result = normalizeOkxTradeSymbols([{ ...OKX_RAW_INSTRUMENT_SWAP, ctVal: '' }]);

    expect(result.has('BTCUSDT')).toBe(false);
    expect(result.size).toBe(0);
  });

  it('skips a record with a non-numeric lotSz while parsing the neighboring valid one', () => {
    const invalidRaw: OkxInstrumentRaw = { ...OKX_RAW_INSTRUMENT_SPOT, lotSz: 'N/A' };
    const result = normalizeOkxTradeSymbols([invalidRaw, OKX_RAW_INSTRUMENT_SWAP]);

    expect(result.has('BTCUSDT')).toBe(true);
    expect(result.size).toBe(1);
  });
});

describe('buildOkxBatchItemResult', () => {
  it('reports success and clears both error fields when the exchange said zero', () => {
    expect(buildOkxBatchItemResult('order-1', { sCode: '0', sMsg: '' })).toEqual({
      orderId: 'order-1',
      isSuccess: true,
      errorCode: null,
      errorText: null,
    });
  });

  it('reports the exchange refusal with its numeric code and text', () => {
    expect(buildOkxBatchItemResult('order-2', { sCode: '51400', sMsg: 'order does not exist' })).toEqual({
      orderId: 'order-2',
      isSuccess: false,
      errorCode: 51400,
      errorText: 'order does not exist',
    });
  });

  it('never claims success when the exchange said nothing about the entry', () => {
    const result = buildOkxBatchItemResult('order-3', undefined);

    expect(result.isSuccess).toBe(false);
    expect(result.errorCode).toBeNull();
    expect(result.errorText).toBe('OKX returned no result for this batch entry');
  });

  it('keeps the entry unsuccessful when the refusal code is not a number', () => {
    const result = buildOkxBatchItemResult('order-4', { sCode: 'oops', sMsg: 'weird' });

    expect(result.isSuccess).toBe(false);
    expect(result.errorCode).toBeNull();
    expect(result.errorText).toBe('weird');
  });

  it('keeps the asked order id, not the one the exchange echoed back', () => {
    expect(buildOkxBatchItemResult('asked-5', { sCode: '0', sMsg: '' }).orderId).toBe('asked-5');
  });
});

describe('an unreadable instrument id never leaks out as a symbol name', () => {
  it('drops such a row from the ticker map instead of keying it by the raw instrument id', () => {
    const result = normalizeOkxTickers([{ ...OKX_RAW_TICKER_LIST[1], instId: 'WEIRD' }], true, new Map());

    expect(result.size).toBe(0);
  });

  it('drops such a row from the public trade list', () => {
    const raw = { ...OKX_RAW_PUBLIC_TRADE_LIST[0], instId: 'WEIRD' };

    expect(normalizeOkxPublicTradeList([raw], '')).toEqual([]);
  });

  it('drops such a row from the mark price list and from its stream form', () => {
    const raw = { instType: 'SWAP', instId: 'WEIRD', markPx: '1', ts: '1' };

    expect(normalizeOkxMarkPriceList([raw], [])).toEqual([]);
    expect(normalizeOkxMarkPriceWebSocketList([raw])).toEqual([]);
  });

  it('drops such a row from the funding history and from the funding info', () => {
    const historyRaw = { ...OKX_RAW_FUNDING_RATE_HISTORY_LIST[0], instId: 'WEIRD' };
    const infoRaw = { ...OKX_RAW_FUNDING_RATE, instId: 'WEIRD' };

    expect(normalizeOkxFundingRateHistoryList([historyRaw])).toEqual([]);
    expect(normalizeOkxFundingInfoList([infoRaw])).toEqual([]);
  });
});

describe('normalizeOkxOrder — attached protection', () => {
  it('reads the stop-loss trigger of an order that carries its protection attached', () => {
    const raw = { ...OKX_RAW_ORDER_FILLED, slTriggerPx: '59000', tpTriggerPx: '' };
    const order = normalizeOkxOrder(raw, '');

    expect(order.stopPrice).toBe(59000);
  });

  it('reads the take-profit trigger when only that leg is attached', () => {
    const raw = { ...OKX_RAW_ORDER_FILLED, slTriggerPx: '', tpTriggerPx: '70000' };
    const order = normalizeOkxOrder(raw, '');

    expect(order.stopPrice).toBe(70000);
  });

  it('prefers the stop-loss leg when both are attached', () => {
    const raw = { ...OKX_RAW_ORDER_FILLED, slTriggerPx: '59000', tpTriggerPx: '70000' };
    const order = normalizeOkxOrder(raw, '');

    expect(order.stopPrice).toBe(59000);
  });

  it('keeps a plain order without attached protection at zero', () => {
    const order = normalizeOkxOrder({ ...OKX_RAW_ORDER_FILLED, slTriggerPx: '', tpTriggerPx: '' }, '');

    expect(order.stopPrice).toBe(0);
  });
});

describe('normalizeOkxTickers — timestamp', () => {
  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(1700000000000);
  });

  it('stamps a ticker without a time with now, not with 1970', () => {
    const raw = { ...OKX_RAW_TICKER_LIST[1], ts: '' };
    const result = normalizeOkxTickers([raw], true, new Map());

    expect(result.get('BTCUSDT')?.timestamp).toBe(1700000000000);
  });
});

describe('normalizeOkxTradeSymbols — funding', () => {
  it('fills the funding interval and its bounds from the funding-rate answer', () => {
    const result = normalizeOkxTradeSymbols([OKX_RAW_INSTRUMENT_SWAP], [OKX_RAW_FUNDING_RATE]);

    expect(result.get('BTCUSDT')?.funding).toEqual({
      fundingIntervalMinutes: 480,
      upperFundingRate: '0.00375',
      lowerFundingRate: '-0.00375',
    });
  });

  it('leaves funding unset when the funding-rate answer was not read', () => {
    const result = normalizeOkxTradeSymbols([OKX_RAW_INSTRUMENT_SWAP]);

    expect(result.get('BTCUSDT')?.funding).toBeUndefined();
  });

  it('keeps the bounds when the two settlement times cannot give an interval', () => {
    const raw = { ...OKX_RAW_FUNDING_RATE, nextFundingTime: '' };
    const result = normalizeOkxTradeSymbols([OKX_RAW_INSTRUMENT_SWAP], [raw]);

    expect(result.get('BTCUSDT')?.funding).toEqual({ upperFundingRate: '0.00375', lowerFundingRate: '-0.00375' });
  });
});

describe('normalizeOkxMarkPriceList — index price', () => {
  const MARK_RAW_LIST = [{ instType: 'SWAP', instId: 'BTC-USDT-SWAP', markPx: '200', ts: '1' }];

  it('takes the index price from the index list, matched without the -SWAP suffix', () => {
    const result = normalizeOkxMarkPriceList(MARK_RAW_LIST, [], OKX_RAW_INDEX_TICKER_LIST);

    expect(result[0].indexPrice).toBe(43350);
  });

  it('leaves the index price empty when the index list has nothing for the instrument', () => {
    const result = normalizeOkxMarkPriceList(MARK_RAW_LIST, [], []);

    expect(result[0].indexPrice).toBeUndefined();
  });

  it('never turns an empty index into a zero', () => {
    const result = normalizeOkxMarkPriceList(MARK_RAW_LIST, [], [{ ...OKX_RAW_INDEX_TICKER_LIST[0], idxPx: '' }]);

    expect(result[0].indexPrice).toBeUndefined();
  });
});

describe('normalizeOkxTradeSymbols — price limit', () => {
  it('reports the exchange price-limit bands in percent, not in fractions', () => {
    const result = normalizeOkxTradeSymbols([OKX_RAW_INSTRUMENT_SWAP]);

    expect(result.get('BTCUSDT')?.priceLimitRisk).toEqual({
      source: 'okxPriceLimitPct',
      initialPriceLimitPercent: '5',
      floatPriceLimitPercent: '3',
      maxPriceLimitPercent: '15',
    });
  });

  it('leaves the price limit unset when the exchange sent empty bands', () => {
    const raw = { ...OKX_RAW_INSTRUMENT_SWAP, initPxLmtPct: '', floatPxLmtPct: '', maxPxLmtPct: '' };
    const result = normalizeOkxTradeSymbols([raw]);

    expect(result.get('BTCUSDT')?.priceLimitRisk).toBeUndefined();
  });

  it('keeps the bands it has when only one of them is missing', () => {
    const raw = { ...OKX_RAW_INSTRUMENT_SWAP, initPxLmtPct: '' };
    const result = normalizeOkxTradeSymbols([raw]);

    expect(result.get('BTCUSDT')?.priceLimitRisk).toEqual({
      source: 'okxPriceLimitPct',
      initialPriceLimitPercent: '',
      floatPriceLimitPercent: '3',
      maxPriceLimitPercent: '15',
    });
  });
});

describe('normalizeOkxTickers', () => {
  it('drops an inverse contract that the instrument list never had', () => {
    const result = normalizeOkxTickers(OKX_RAW_TICKER_LIST, true, new Map([['BTCUSDT', '0.01']]));

    expect(result.has('LTCUSD')).toBe(false);
    expect(result.has('BTCUSDT')).toBe(true);
  });

  it('keeps every row while the instrument map is still empty, as mark price and funding do', () => {
    const result = normalizeOkxTickers(OKX_RAW_TICKER_LIST, true, new Map());

    expect([...result.keys()]).toEqual(['LTCUSD', 'BTCUSDT']);
  });

  it('never filters spot, where the instrument map carries no contract value', () => {
    const spotRawList = OKX_RAW_TICKER_LIST.map((raw) => ({ ...raw, instType: 'SPOT', instId: 'BTC-USDT' }));
    const result = normalizeOkxTickers(spotRawList, false, new Map([['ETHUSDT', '']]));

    expect(result.has('BTCUSDT')).toBe(true);
  });

  it('computes priceChangePercent from open24h', () => {
    const result = normalizeOkxTickers([OKX_RAW_TICKER_LIST[0]], true, OKX_TEST_CONTRACT_VALUE_BY_SYMBOL);
    const ticker = result.get('LTCUSD');

    expect(ticker?.priceChangePercent).toBeCloseTo(11.111);
  });

  it('reports no priceChangePercent when open24h is zero', () => {
    const raw: OkxTickerRaw = { ...OKX_RAW_TICKER_LIST[0], open24h: '0' };
    const result = normalizeOkxTickers([raw], true, OKX_TEST_CONTRACT_VALUE_BY_SYMBOL);
    const ticker = result.get('LTCUSD');

    expect(ticker?.priceChangePercent).toBe(0);
  });

  it('reads volume from volCcy24h and estimates quoteVolume for a swap', () => {
    const result = normalizeOkxTickers([OKX_RAW_TICKER_LIST[1]], true, OKX_TEST_CONTRACT_VALUE_BY_SYMBOL);
    const ticker = result.get('BTCUSDT');

    expect(ticker?.volume).toBe(1500);
    expect(ticker?.quoteVolume).toBeCloseTo(1500 * 65000);
  });

  it('reads volume from vol24h and quoteVolume from volCcy24h for spot', () => {
    const raw: OkxTickerRaw = { ...OKX_RAW_TICKER_LIST[1], instId: 'BTC-USDT' };
    const result = normalizeOkxTickers([raw], false, OKX_TEST_CONTRACT_VALUE_BY_SYMBOL);
    const ticker = result.get('BTCUSDT');

    expect(ticker?.volume).toBe(150000);
    expect(ticker?.quoteVolume).toBe(1500);
  });

  it('captures bid1/ask1 from bidPx/bidSz/askPx/askSz', () => {
    const result = normalizeOkxTickers([OKX_RAW_TICKER_LIST[0]], true, OKX_TEST_CONTRACT_VALUE_BY_SYMBOL);
    const ticker = result.get('LTCUSD');

    expect(ticker?.bid1Price).toBe(8888.88);
    expect(ticker?.bid1Size).toBe(5);
    expect(ticker?.ask1Price).toBe(9999.99);
    expect(ticker?.ask1Size).toBe(11);
  });

  it('reports the top of book in coins, not in contracts, for a swap', () => {
    const result = normalizeOkxTickers([OKX_RAW_TICKER_LIST[1]], true, OKX_TEST_CONTRACT_VALUE_BY_SYMBOL);
    const ticker = result.get('BTCUSDT');

    expect(ticker?.bid1Size).toBeCloseTo(0.03);
    expect(ticker?.ask1Size).toBeCloseTo(0.02);
  });

  it('omits the top-of-book size when the contract value of a swap is unknown', () => {
    const result = normalizeOkxTickers([OKX_RAW_TICKER_LIST[1]], true, new Map<string, string>());
    const ticker = result.get('BTCUSDT');

    expect(ticker?.bid1Price).toBe(64999);
    expect(ticker?.bid1Size).toBeUndefined();
    expect(ticker?.ask1Size).toBeUndefined();
  });

  it('leaves the spot top-of-book size alone — it is already in coins', () => {
    const raw: OkxTickerRaw = { ...OKX_RAW_TICKER_LIST[1], instId: 'BTC-USDT' };
    const result = normalizeOkxTickers([raw], false, OKX_TEST_CONTRACT_VALUE_BY_SYMBOL);
    const ticker = result.get('BTCUSDT');

    expect(ticker?.bid1Size).toBe(3);
    expect(ticker?.ask1Size).toBe(2);
  });

  it('reports zero (not NaN) numeric fields when the exchange sends empty strings', () => {
    const raw: OkxTickerRaw = {
      ...OKX_RAW_TICKER_LIST[1],
      last: '',
      open24h: '',
      high24h: '',
      low24h: '',
      volCcy24h: '',
      vol24h: '',
      ts: '',
    };

    const result = normalizeOkxTickers([raw], true, OKX_TEST_CONTRACT_VALUE_BY_SYMBOL);
    const ticker = result.get('BTCUSDT');

    expect(ticker).toBeDefined();
    expect(Number.isNaN(ticker?.lastPrice)).toBe(false);
    expect(Number.isNaN(ticker?.openPrice)).toBe(false);
    expect(Number.isNaN(ticker?.highPrice)).toBe(false);
    expect(Number.isNaN(ticker?.lowPrice)).toBe(false);
    expect(Number.isNaN(ticker?.volume)).toBe(false);
    expect(Number.isNaN(ticker?.quoteVolume)).toBe(false);
    expect(Number.isNaN(ticker?.timestamp)).toBe(false);
    expect(ticker?.lastPrice).toBe(0);
    expect(ticker?.volume).toBe(0);
    expect(ticker?.quoteVolume).toBe(0);
  });
});

describe('normalizeOkxKlines', () => {
  it('reverses REST rows into chronological order', () => {
    const result = normalizeOkxKlines(OKX_RAW_KLINE_LIST, false);

    expect(parseFloat(OKX_RAW_KLINE_LIST[0][0])).toBeGreaterThan(parseFloat(OKX_RAW_KLINE_LIST[1][0]));
    expect(result[0].openTimestamp).toBe(parseFloat(OKX_RAW_KLINE_LIST[1][0]));
    expect(result[1].openTimestamp).toBe(parseFloat(OKX_RAW_KLINE_LIST[0][0]));
    expect(result[1].openTimestamp).toBeGreaterThan(result[0].openTimestamp);
  });

  it('reads swap volume from volCcy (index 6)', () => {
    const result = normalizeOkxKlines(OKX_RAW_KLINE_LIST, true);

    expect(result[1].volume).toBe(22698348.04828491);
  });

  it('reads spot volume from vol (index 5)', () => {
    const result = normalizeOkxKlines(OKX_RAW_KLINE_LIST, false);

    expect(result[1].volume).toBe(8422410);
  });

  it('maps confirm to isClosed', () => {
    const result = normalizeOkxKlines(OKX_RAW_KLINE_LIST, false);

    expect(result[0].isClosed).toBe(true);
    expect(result[1].isClosed).toBe(false);
  });

  it('closes a candle on the last millisecond of the interval, exactly as Binance does', () => {
    const kline = normalizeOkxKlineWebSocketMessage(OKX_RAW_KLINE_LIST[0], false, 60000);

    expect(kline.closeTimestamp).toBe(kline.openTimestamp + 60000 - 1);
  });

  it('leaves closeTimestamp at zero without intervalMs', () => {
    const kline = normalizeOkxKlineWebSocketMessage(OKX_RAW_KLINE_LIST[0], false);

    expect(kline.closeTimestamp).toBe(0);
  });
});

describe('normalizeOkxOrderBook', () => {
  it('normalizes REST order book levels', () => {
    const result = normalizeOkxOrderBook(OKX_RAW_ORDER_BOOK, 'BTCUSDT', '');

    expect(result.askList).toEqual([{ price: 41006.8, quantity: 0.60038921 }]);
    expect(result.bidList).toEqual([{ price: 41006.3, quantity: 0.30178218 }]);
    expect(result.timestamp).toBe(1629966436396);
    expect(result.updateId).toBe(3235851742);
    expect(result.eventTimestamp).toBe(1629966436396);
  });

  it('converts swap depth from contracts into coins', () => {
    const result = normalizeOkxOrderBook(OKX_RAW_ORDER_BOOK, 'BTCUSDT', '0.01');

    expect(result.askList).toEqual([{ price: 41006.8, quantity: 0.0060038921 }]);
    expect(result.bidList).toEqual([{ price: 41006.3, quantity: 0.0030178218 }]);
  });

  it('reports the same unit as a public trade of the same instrument', () => {
    const raw = { ...OKX_RAW_ORDER_BOOK, asks: [['62000', '10', '0', '4']], bids: [['61999', '10', '0', '4']] };

    const depthQuantity = normalizeOkxOrderBook(raw, 'BTCUSDT', '0.01').askList[0].quantity;
    const tradeQuantity = normalizeOkxPublicTradeList(
      [{ ...OKX_RAW_PUBLIC_TRADE_LIST[0], instId: 'BTC-USDT-SWAP', sz: '10' }],
      '0.01',
    )[0].quantity;

    expect(depthQuantity).toBeCloseTo(tradeQuantity);
  });
});

describe('normalizeOkxOrderBookUpdate', () => {
  it('keeps raw decimal-string levels and maps seqId/ts', () => {
    const result = normalizeOkxOrderBookUpdate(OKX_RAW_ORDER_BOOK_STREAM_SNAPSHOT.data[0], {
      symbol: 'BTCUSDT',
      updateType: 'snapshot',
      receivedTimestamp: 1700000000000,
      contractValue: '',
    });

    expect(result.symbol).toBe('BTCUSDT');
    expect(result.updateType).toBe('snapshot');
    expect(result.askList[0]).toEqual(['8476.98', '415']);
    expect(result.bidList[0]).toEqual(['8476.97', '256']);
    expect(result.updateId).toBe(123456);
    expect(result.eventTimestamp).toBe(1597026383085);
    expect(result.receivedTimestamp).toBe(1700000000000);
  });

  it('converts swap stream levels from contracts into coins without losing precision', () => {
    const result = normalizeOkxOrderBookUpdate(OKX_RAW_ORDER_BOOK_STREAM_SNAPSHOT.data[0], {
      symbol: 'BTCUSDT',
      updateType: 'snapshot',
      receivedTimestamp: 1700000000000,
      contractValue: '0.01',
    });

    expect(result.askList[0]).toEqual(['8476.98', '4.15']);
    expect(result.bidList[0]).toEqual(['8476.97', '2.56']);
  });

  it('keeps a zero level as zero so that a delta can still delete a price', () => {
    const raw = { ...OKX_RAW_ORDER_BOOK_STREAM_SNAPSHOT.data[0], asks: [['8476.98', '0', '0', '0']] };
    const result = normalizeOkxOrderBookUpdate(raw, {
      symbol: 'BTCUSDT',
      updateType: 'delta',
      receivedTimestamp: 1700000000000,
      contractValue: '0.01',
    });

    expect(result.askList[0]).toEqual(['8476.98', '0']);
  });
});

describe('parseOkxOrderbookRawFrame', () => {
  it('converts swap levels from contracts into coins', () => {
    const result = parseOkxOrderbookRawFrame({
      raw: JSON.stringify(OKX_RAW_ORDER_BOOK_STREAM_SNAPSHOT),
      symbol: 'BTCUSDT',
      receivedTimestamp: 1700000000000,
      contractValue: '0.01',
    });

    expect(result?.askList[0]).toEqual(['8476.98', '4.15']);
  });

  it('parses a snapshot frame', () => {
    const result = parseOkxOrderbookRawFrame({
      raw: JSON.stringify(OKX_RAW_ORDER_BOOK_STREAM_SNAPSHOT),
      symbol: 'BTCUSDT',
      receivedTimestamp: 1700000000000,
      contractValue: '',
    });

    expect(result?.updateType).toBe('snapshot');
    expect(result?.updateId).toBe(123456);
  });

  it('parses an update frame as delta', () => {
    const result = parseOkxOrderbookRawFrame({
      raw: JSON.stringify(OKX_RAW_ORDER_BOOK_STREAM_UPDATE),
      symbol: 'BTCUSDT',
      receivedTimestamp: 1700000000000,
      contractValue: '',
    });

    expect(result?.updateType).toBe('delta');
    expect(result?.updateId).toBe(123457);
  });

  it('parses a books5 frame without action as a snapshot', () => {
    const result = parseOkxOrderbookRawFrame({
      raw: JSON.stringify({
        arg: { channel: 'books5', instId: 'BCH-USDT-SWAP' },
        data: [
          {
            asks: [['111.06', '55154', '0', '2'], ['111.07', '53276', '0', '2']],
            bids: [['111.05', '57745', '0', '2'], ['111.04', '57109', '0', '2']],
            instId: 'BCH-USDT-SWAP',
            ts: '1670324386802',
            seqId: 363996337,
          },
        ],
      }),
      symbol: 'BCHUSDT',
      receivedTimestamp: 1700000000000,
      contractValue: '',
    });

    expect(result?.updateType).toBe('snapshot');
    expect(result?.updateId).toBe(363996337);
  });

  it('parses a bbo-tbt frame without action as a snapshot', () => {
    const result = parseOkxOrderbookRawFrame({
      raw: JSON.stringify({
        arg: { channel: 'bbo-tbt', instId: 'BCH-USDT-SWAP' },
        data: [
          {
            asks: [['111.06', '55154', '0', '2']],
            bids: [['111.05', '57745', '0', '2']],
            ts: '1670324386802',
            seqId: 363996338,
          },
        ],
      }),
      symbol: 'BCHUSDT',
      receivedTimestamp: 1700000000000,
      contractValue: '',
    });

    expect(result?.updateType).toBe('snapshot');
  });

  it('keeps treating a books frame without action as a delta', () => {
    const result = parseOkxOrderbookRawFrame({
      raw: JSON.stringify({
        arg: { channel: 'books', instId: 'BTC-USDT' },
        data: [{ asks: [], bids: [], ts: '1670324386802', seqId: 1, prevSeqId: 0 }],
      }),
      symbol: 'BTCUSDT',
      receivedTimestamp: 1700000000000,
      contractValue: '',
    });

    expect(result?.updateType).toBe('delta');
  });

  it('keeps treating a frame without channel and without action as a delta', () => {
    const result = parseOkxOrderbookRawFrame({
      raw: JSON.stringify({ data: [{ asks: [], bids: [], ts: '1670324386802', seqId: 2, prevSeqId: 1 }] }),
      symbol: 'BTCUSDT',
      receivedTimestamp: 1700000000000,
      contractValue: '',
    });

    expect(result?.updateType).toBe('delta');
  });

  it('returns undefined on malformed JSON', () => {
    const result = parseOkxOrderbookRawFrame({
      raw: '{not valid json',
      symbol: 'BTCUSDT',
      receivedTimestamp: 0,
      contractValue: '',
    });

    expect(result).toBeUndefined();
  });

  it('returns undefined when data is empty', () => {
    const result = parseOkxOrderbookRawFrame({
      raw: JSON.stringify({ arg: { channel: 'books', instId: 'BTC-USDT' }, action: 'snapshot', data: [] }),
      symbol: 'BTCUSDT',
      receivedTimestamp: 0,
      contractValue: '',
    });

    expect(result).toBeUndefined();
  });

  it('returns undefined when the parsed root is null', () => {
    const result = parseOkxOrderbookRawFrame({ raw: 'null', symbol: 'BTCUSDT', receivedTimestamp: 0, contractValue: '' });

    expect(result).toBeUndefined();
  });

  it('returns undefined when the parsed root is an array', () => {
    const result = parseOkxOrderbookRawFrame({ raw: '[]', symbol: 'BTCUSDT', receivedTimestamp: 0, contractValue: '' });

    expect(result).toBeUndefined();
  });

  it('returns undefined when data[0] is an array instead of an object', () => {
    const result = parseOkxOrderbookRawFrame({
      raw: JSON.stringify({ action: 'snapshot', data: [[1, 2]] }),
      symbol: 'BTCUSDT',
      receivedTimestamp: 0,
      contractValue: '',
    });

    expect(result).toBeUndefined();
  });

  it('returns undefined when data[0] is null', () => {
    const result = parseOkxOrderbookRawFrame({
      raw: JSON.stringify({ action: 'snapshot', data: [null] }),
      symbol: 'BTCUSDT',
      receivedTimestamp: 0,
      contractValue: '',
    });

    expect(result).toBeUndefined();
  });
});

describe('normalizeOkxPublicTradeList', () => {
  it('keeps quantity as-is for spot (empty contractValue)', () => {
    const result = normalizeOkxPublicTradeList(OKX_RAW_PUBLIC_TRADE_LIST, '');

    expect(result[0].quantity).toBe(parseFloat(OKX_RAW_PUBLIC_TRADE_LIST[0].sz));
    expect(result[0].symbol).toBe('BTCUSDT');
  });

  it('converts quantity from contracts into coins for a swap', () => {
    const raw: OkxPublicTradeRaw = { ...OKX_RAW_PUBLIC_TRADE_LIST[0], sz: '5' };
    const result = normalizeOkxPublicTradeList([raw], '0.01');

    expect(result[0].quantity).toBeCloseTo(0.05);
  });

  it('maps isBuyerMaker from the taker side', () => {
    const result = normalizeOkxPublicTradeList(OKX_RAW_PUBLIC_TRADE_LIST, '');

    expect(result[0].isBuyerMaker).toBe(true);
  });
});

describe('normalizeOkxMarkPriceList', () => {
  it('merges mark price with the matching funding record', () => {
    const result = normalizeOkxMarkPriceList(OKX_RAW_MARK_PRICE_LIST, [OKX_RAW_FUNDING_RATE]);
    const markPrice = result[0];

    expect(markPrice.markPrice).toBe(200);
    expect(markPrice.lastFundingRate).toBeCloseTo(0.0000182221218054);
    expect(markPrice.nextFundingTime).toBe(1743609600000);
    expect(markPrice.indexPrice).toBeUndefined();
  });

  it('reports zero funding fields without a matching funding record', () => {
    const result = normalizeOkxMarkPriceList(OKX_RAW_MARK_PRICE_LIST, []);
    const markPrice = result[0];

    expect(markPrice.lastFundingRate).toBe(0);
    expect(markPrice.nextFundingTime).toBe(0);
  });
});

describe('normalizeOkxMarkPriceWebSocketList', () => {
  it('normalizes a websocket mark price update without indexPrice', () => {
    const result = normalizeOkxMarkPriceWebSocketList(OKX_RAW_MARK_PRICE_LIST);

    expect(result[0]).toEqual({ symbol: 'BTCUSDT', markPrice: 200, timestamp: 1597026383085 });
  });
});

describe('normalizeOkxOpenInterest', () => {
  it('reads open interest in coins from oiCcy', () => {
    const result = normalizeOkxOpenInterest(OKX_RAW_OPEN_INTEREST);

    expect(result.symbol).toBe('BTCUSDT');
    expect(result.openInterest).toBe(555.55);
  });
});

describe('normalizeOkxFundingRateHistoryList', () => {
  it('prefers realizedRate and sorts by fundingTime ascending', () => {
    const result = normalizeOkxFundingRateHistoryList(OKX_RAW_FUNDING_RATE_HISTORY_LIST);

    expect(result[0].fundingTime).toBe(1703030400000);
    expect(result[0].fundingRate).toBeCloseTo(0.0002279755647389);
    expect(result[1].fundingTime).toBe(1703059200000);
    expect(result[1].fundingRate).toBeCloseTo(0.0000746572360545);
  });
});

describe('normalizeOkxFundingInfoList', () => {
  it('derives fundingIntervalHours from the funding/next-funding gap', () => {
    const result = normalizeOkxFundingInfoList([OKX_RAW_FUNDING_RATE]);

    expect(result[0].fundingIntervalHours).toBe(8);
    expect(result[0].adjustedFundingRateCap).toBe(0.00375);
    expect(result[0].adjustedFundingRateFloor).toBe(-0.00375);
  });
});

describe('normalizeOkxFeeRate', () => {
  it('reads rates from feeGroup matching groupId', () => {
    const result = normalizeOkxFeeRate(OKX_RAW_FEE_RATE, { symbol: 'BTCUSDT', groupId: '1', settle: '', isSwap: false });

    expect(result.feeRate.makerRate).toBeCloseTo(0.0008);
    expect(result.feeRate.takerRate).toBeCloseTo(0.001);
  });

  it('falls back to takerU/makerU for a USDT-settled swap without a matching group', () => {
    const raw: OkxFeeRateRaw = { ...OKX_RAW_FEE_RATE, feeGroup: undefined, takerU: '-0.0004', makerU: '-0.0002' };
    const result = normalizeOkxFeeRate(raw, { symbol: 'BTCUSDT', settle: 'USDT', isSwap: true });

    expect(result.feeRate.makerRate).toBeCloseTo(0.0002);
    expect(result.feeRate.takerRate).toBeCloseTo(0.0004);
  });

  it('falls back to takerUSDC/makerUSDC for a USDC-settled swap without a matching group', () => {
    const raw: OkxFeeRateRaw = { ...OKX_RAW_FEE_RATE, feeGroup: undefined, takerUSDC: '-0.0005', makerUSDC: '-0.0003' };
    const result = normalizeOkxFeeRate(raw, { symbol: 'ETHUSDC', settle: 'USDC', isSwap: true });

    expect(result.feeRate.makerRate).toBeCloseTo(0.0003);
    expect(result.feeRate.takerRate).toBeCloseTo(0.0005);
  });

  it('falls back to taker/maker for spot without a matching group', () => {
    const raw: OkxFeeRateRaw = { ...OKX_RAW_FEE_RATE, feeGroup: undefined, taker: '-0.001', maker: '-0.0008' };
    const result = normalizeOkxFeeRate(raw, { symbol: 'BTCUSDT', settle: '', isSwap: false });

    expect(result.feeRate.makerRate).toBeCloseTo(0.0008);
    expect(result.feeRate.takerRate).toBeCloseTo(0.001);
  });

  it('inverts the sign so a paid fee is positive and a rebate is negative', () => {
    const raw: OkxFeeRateRaw = { ...OKX_RAW_FEE_RATE, feeGroup: undefined, taker: '-0.0005', maker: '0.0001' };
    const result = normalizeOkxFeeRate(raw, { symbol: 'BTCUSDT', settle: '', isSwap: false });

    expect(result.feeRate.takerRate).toBeCloseTo(0.0005);
    expect(result.feeRate.makerRate).toBeCloseTo(-0.0001);
  });

  it('throws when the requested group is not found and the fallback fields are empty', () => {
    const raw: OkxFeeRateRaw = {
      ...OKX_RAW_FEE_RATE,
      feeGroup: [{ groupId: '99', maker: '-0.0008', taker: '-0.001' }],
      maker: '',
      taker: '',
    };

    expect(() => normalizeOkxFeeRate(raw, { symbol: 'BTCUSDT', groupId: '1', settle: '', isSwap: false })).toThrow(
      'OKX fee rate for BTCUSDT is unavailable in the response',
    );
  });

  it('throws with the OKX_FEE_RATE_UNAVAILABLE code when no rate source is usable', () => {
    const raw: OkxFeeRateRaw = { ...OKX_RAW_FEE_RATE, feeGroup: undefined, taker: '', maker: '' };

    try {
      normalizeOkxFeeRate(raw, { symbol: 'BTCUSDT', settle: '', isSwap: false });
      throw new Error('expected normalizeOkxFeeRate to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ExchangeError);
      expect((error as ExchangeError).code).toBe('OKX_FEE_RATE_UNAVAILABLE');
      expect((error as ExchangeError).exchange).toBe('OKX');
    }
  });

  it('uses the single feeGroup entry when groupId is not passed', () => {
    const raw: OkxFeeRateRaw = {
      ...OKX_RAW_FEE_RATE,
      feeGroup: [{ groupId: '7', maker: '-0.0003', taker: '-0.0006' }],
    };

    const result = normalizeOkxFeeRate(raw, { symbol: 'BTCUSDT', settle: '', isSwap: false });

    expect(result.feeRate.makerRate).toBeCloseTo(0.0003);
    expect(result.feeRate.takerRate).toBeCloseTo(0.0006);
  });

  it('uses the single feeGroup entry when the instrument carries an empty group id', () => {
    const raw: OkxFeeRateRaw = {
      ...OKX_RAW_FEE_RATE,
      maker: '',
      taker: '',
      feeGroup: [{ groupId: '7', maker: '-0.0003', taker: '-0.0006' }],
    };

    const result = normalizeOkxFeeRate(raw, { symbol: 'BTCUSDT', groupId: '', settle: '', isSwap: false });

    expect(result.feeRate.makerRate).toBeCloseTo(0.0003);
    expect(result.feeRate.takerRate).toBeCloseTo(0.0006);
  });

  it('returns an explicit zero rate reported by the exchange without throwing', () => {
    const raw: OkxFeeRateRaw = { ...OKX_RAW_FEE_RATE, feeGroup: undefined, taker: '0', maker: '0' };

    const result = normalizeOkxFeeRate(raw, { symbol: 'BTCUSDT', settle: '', isSwap: false });

    expect(result.feeRate.makerRate).toBe(0);
    expect(result.feeRate.takerRate).toBe(0);
  });

  it('reports that the rate came from the group of the instrument, not from the outdated fields', () => {
    const result = normalizeOkxFeeRate(OKX_RAW_FEE_RATE, { symbol: 'BTCUSDT', groupId: '1', settle: '', isSwap: false });

    expect(result.isFromOutdatedField).toBe(false);
  });

  it('reports that the rate was taken from the outdated top-level fields', () => {
    const raw: OkxFeeRateRaw = { ...OKX_RAW_FEE_RATE, feeGroup: undefined, taker: '-0.001', maker: '-0.0008' };

    const result = normalizeOkxFeeRate(raw, { symbol: 'BTCUSDT', settle: '', isSwap: false });

    expect(result.isFromOutdatedField).toBe(true);
  });

  it('reports the same for the settle-currency fields of a swap', () => {
    const raw: OkxFeeRateRaw = { ...OKX_RAW_FEE_RATE, feeGroup: undefined, takerU: '-0.0004', makerU: '-0.0002' };

    const result = normalizeOkxFeeRate(raw, { symbol: 'BTCUSDT', settle: 'USDT', isSwap: true });

    expect(result.isFromOutdatedField).toBe(true);
  });
});

describe('normalizeOkxPosition', () => {
  it('converts contracts into coins using ctVal', () => {
    const result = normalizeOkxPosition(OKX_RAW_POSITION_NET_LONG, '0.01');

    expect(result.contracts).toBeCloseTo(0.05);
  });

  it('keeps contracts as-is for spot (empty contractValue)', () => {
    const result = normalizeOkxPosition(OKX_RAW_POSITION_NET_LONG, '');

    expect(result.contracts).toBeCloseTo(5);
  });

  it('reads a long direction from a positive net pos', () => {
    const result = normalizeOkxPosition(OKX_RAW_POSITION_NET_LONG, '0.01');

    expect(result.direction).toBe('long');
    expect(result.side).toBe(PositionSideEnum.Both);
  });

  it('reads a short direction from a negative net pos', () => {
    const result = normalizeOkxPosition(OKX_RAW_POSITION_NET_SHORT, '0.01');

    expect(result.direction).toBe('short');
    expect(result.contracts).toBeCloseTo(0.05);
  });

  it('reports null direction for a zero net pos', () => {
    const result = normalizeOkxPosition({ ...OKX_RAW_POSITION_NET_LONG, pos: '0' }, '0.01');

    expect(result.direction).toBeNull();
  });

  it('reads direction straight from posSide in hedge mode', () => {
    const result = normalizeOkxPosition(OKX_RAW_POSITION_HEDGE_SHORT, '0.01');

    expect(result.direction).toBe('short');
    expect(result.side).toBe(PositionSideEnum.Short);
  });

  it('maps positionIdx by posSide', () => {
    expect(normalizeOkxPosition(OKX_RAW_POSITION_NET_LONG, '0.01').positionIdx).toBe(0);
    expect(normalizeOkxPosition(OKX_RAW_POSITION_HEDGE_SHORT, '0.01').positionIdx).toBe(2);
  });

  it('maps isolated and cross margin mode', () => {
    expect(normalizeOkxPosition(OKX_RAW_POSITION_NET_LONG, '0.01').marginMode).toBe(MarginModeEnum.Isolated);
    expect(normalizeOkxPosition({ ...OKX_RAW_POSITION_NET_LONG, mgnMode: 'cross' }, '0.01').marginMode).toBe(
      MarginModeEnum.Cross,
    );
  });

  it('reports zero liquidation price when liqPx is empty', () => {
    const result = normalizeOkxPosition({ ...OKX_RAW_POSITION_NET_LONG, liqPx: '' }, '0.01');

    expect(result.liquidationPrice).toBe(0);
  });

  it('preserves the raw payload in info', () => {
    const result = normalizeOkxPosition(OKX_RAW_POSITION_NET_LONG, '0.01');

    expect(result.info).toBe(OKX_RAW_POSITION_NET_LONG);
  });

  it('does not throw when pos is missing from a malformed response', () => {
    const raw: OkxPositionRaw = { ...OKX_RAW_POSITION_NET_LONG, pos: undefined };
    const result = normalizeOkxPosition(raw, '0.01');

    expect(result.contracts).toBe(0);
    expect(result.direction).toBeNull();
  });
});

describe('normalizeOkxOrder', () => {
  it('maps a filled spot market order', () => {
    const result = normalizeOkxOrder(OKX_RAW_ORDER_FILLED, '');

    expect(result.id).toBe('680800019749904384');
    expect(result.symbol).toBe('BTCUSDT');
    expect(result.side).toBe(OrderSideEnum.Buy);
    expect(result.type).toBe(OrderTypeEnum.Market);
    expect(result.avgPrice).toBeCloseTo(51858);
    expect(result.status).toBe('closed');
    expect(result.isConditional).toBe(false);
  });

  it('computes filledQuoteAmount as filledAmount times avgPrice', () => {
    const result = normalizeOkxOrder(OKX_RAW_ORDER_FILLED, '');

    expect(result.filledQuoteAmount).toBeCloseTo(0.00192834 * 51858, 5);
  });

  it('maps post_only into Limit type with PostOnly time in force', () => {
    const result = normalizeOkxOrder(OKX_RAW_ORDER_LIVE_POST_ONLY, '');

    expect(result.type).toBe(OrderTypeEnum.Limit);
    expect(result.timeInForce).toBe(TimeInForceEnum.PostOnly);
    expect(result.status).toBe('open');
    expect(result.price).toBeCloseTo(13013.5);
  });

  it('converts sz/accFillSz from contracts into coins for a swap', () => {
    const raw: OkxOrderRaw = { ...OKX_RAW_ORDER_FILLED, instId: 'BTC-USDT-SWAP', sz: '500', accFillSz: '500', tgtCcy: '' };
    const result = normalizeOkxOrder(raw, '0.01');

    expect(result.amount).toBeCloseTo(5);
    expect(result.filledAmount).toBeCloseTo(5);
  });

  it('falls back updatedTimestamp to cTime when uTime is empty', () => {
    const result = normalizeOkxOrder({ ...OKX_RAW_ORDER_FILLED, uTime: '' }, '');

    expect(result.updatedTimestamp).toBe(result.timestamp);
  });

  it('reads amount from accFillSz for a spot market buy priced in quote currency', () => {
    const result = normalizeOkxOrder(OKX_RAW_ORDER_SPOT_MARKET_QUOTE, '');

    expect(result.amount).toBeCloseTo(0.0015);
    expect(result.filledAmount).toBeCloseTo(0.0015);
  });

  it('reports zero amount for a quote-currency market order with no fill yet', () => {
    const raw: OkxOrderRaw = { ...OKX_RAW_ORDER_SPOT_MARKET_QUOTE, accFillSz: '0' };
    const result = normalizeOkxOrder(raw, '');

    expect(result.amount).toBe(0);
  });

  it('maps canceled and live statuses', () => {
    expect(normalizeOkxOrder({ ...OKX_RAW_ORDER_FILLED, state: 'canceled' }, '').status).toBe('canceled');
    expect(normalizeOkxOrder({ ...OKX_RAW_ORDER_FILLED, state: 'partially_filled' }, '').status).toBe('open');
  });

  it('reports reduceOnly from the string flag', () => {
    expect(normalizeOkxOrder({ ...OKX_RAW_ORDER_FILLED, reduceOnly: 'true' }, '').reduceOnly).toBe(true);
    expect(normalizeOkxOrder(OKX_RAW_ORDER_FILLED, '').reduceOnly).toBe(false);
  });
});

describe('normalizeOkxAlgoOrder', () => {
  it('maps a stop-market conditional order', () => {
    const result = normalizeOkxAlgoOrder(OKX_RAW_ALGO_ORDER_STOP_MARKET, '0.01');

    expect(result.id).toBe('1753184812254216192');
    expect(result.type).toBe(OrderTypeEnum.StopMarket);
    expect(result.stopPrice).toBeCloseTo(60000);
    expect(result.price).toBe(0);
    expect(result.isConditional).toBe(true);
  });

  it('reads the stop-loss leg of an oco order and ignores the take-profit leg', () => {
    const raw = {
      ...OKX_RAW_ALGO_ORDER_STOP_MARKET,
      ordType: 'oco',
      slTriggerPx: '60000',
      slOrdPx: '59000',
      tpTriggerPx: '70000',
      tpOrdPx: '71000',
    };

    const result = normalizeOkxAlgoOrder(raw, '0.01');

    expect(result.type).toBe(OrderTypeEnum.StopLimit);
    expect(result.stopPrice).toBeCloseTo(60000);
    expect(result.price).toBeCloseTo(59000);
  });

  it('maps a take-profit limit conditional order', () => {
    const result = normalizeOkxAlgoOrder(OKX_RAW_ALGO_ORDER_TAKE_PROFIT_LIMIT, '0.01');

    expect(result.type).toBe(OrderTypeEnum.TakeProfitLimit);
    expect(result.stopPrice).toBeCloseTo(64500);
    expect(result.price).toBeCloseTo(65000);
  });

  it('maps a trailing stop from move_order_stop', () => {
    const result = normalizeOkxAlgoOrder(OKX_RAW_ALGO_ORDER_TRAILING, '0.01');

    expect(result.type).toBe(OrderTypeEnum.TrailingStop);
    expect(result.stopPrice).toBeCloseTo(62500);
    expect(result.price).toBe(0);
  });

  it('reports zero amount when closeFraction closes the whole position', () => {
    const raw = { ...OKX_RAW_ALGO_ORDER_STOP_MARKET, sz: '', closeFraction: '1' };
    const result = normalizeOkxAlgoOrder(raw, '0.01');

    expect(result.amount).toBe(0);
    expect(result.closePosition).toBe(true);
  });

  it('never reports a fill it cannot prove', () => {
    const result = normalizeOkxAlgoOrder(OKX_RAW_ALGO_ORDER_STOP_MARKET, '0.01');

    expect(result.filledAmount).toBe(0);
    expect(result.filledQuoteAmount).toBe(0);
  });

  it('leaves triggeredOrderId unset while nothing has fired', () => {
    expect(normalizeOkxAlgoOrder(OKX_RAW_ALGO_ORDER_STOP_MARKET, '0.01').triggeredOrderId).toBeUndefined();
  });

  it('exposes triggeredOrderId from ordIdList once fired and keeps the order open', () => {
    const result = normalizeOkxAlgoOrder(OKX_RAW_ALGO_ORDER_EFFECTIVE, '0.01');

    expect(result.triggeredOrderId).toBe('1753184812254216200');
    expect(result.status).toBe('open');
  });

  it('reports no execution of its own once fired — that belongs to the triggered order', () => {
    const result = normalizeOkxAlgoOrder(OKX_RAW_ALGO_ORDER_EFFECTIVE, '0.01');

    expect(result.avgPrice).toBe(0);
    expect(result.filledAmount).toBe(0);
    expect(result.filledQuoteAmount).toBe(0);
  });

  it('falls back triggeredOrderId to ordId when ordIdList is empty', () => {
    const raw = { ...OKX_RAW_ALGO_ORDER_STOP_MARKET, ordIdList: [], ordId: '999' };
    const result = normalizeOkxAlgoOrder(raw, '0.01');

    expect(result.triggeredOrderId).toBe('999');
  });

  it('falls back triggeredOrderId to ordId when ordIdList is missing from a malformed response', () => {
    const raw = { ...OKX_RAW_ALGO_ORDER_STOP_MARKET, ordIdList: undefined, ordId: '999' };
    const result = normalizeOkxAlgoOrder(raw, '0.01');

    expect(result.triggeredOrderId).toBe('999');
  });

  it('maps a rejected algo order', () => {
    const result = normalizeOkxAlgoOrder(OKX_RAW_ALGO_ORDER_FAILED, '0.01');

    expect(result.status).toBe('rejected');
  });

  it('reports zero amount for a spot conditional buy priced in quote currency before it fires', () => {
    const result = normalizeOkxAlgoOrder(OKX_RAW_ALGO_ORDER_SPOT_MARKET_QUOTE, '');

    expect(result.amount).toBe(0);
  });

  it('reads amount from actualSz once a quote-currency algo order becomes effective', () => {
    const raw = { ...OKX_RAW_ALGO_ORDER_SPOT_MARKET_QUOTE, state: 'effective', actualSz: '0.0019' };
    const result = normalizeOkxAlgoOrder(raw, '');

    expect(result.amount).toBeCloseTo(0.0019);
  });
});

describe('resolveOkxAlgoTriggerLeg', () => {
  it('picks the stop-loss leg of an order that carries both legs', () => {
    expect(resolveOkxAlgoTriggerLeg(OKX_RAW_ALGO_ORDER_OCO)).toBe('stopLoss');
  });

  it('agrees with what reading the same order reports', () => {
    const order = normalizeOkxAlgoOrder(OKX_RAW_ALGO_ORDER_OCO, '0.01');

    expect(resolveOkxAlgoTriggerLeg(OKX_RAW_ALGO_ORDER_OCO)).toBe('stopLoss');
    expect(order.type).toBe(OrderTypeEnum.StopMarket);
    expect(order.stopPrice).toBe(60000);
  });

  it('follows the leg the exchange says actually fired', () => {
    const order = normalizeOkxAlgoOrder(OKX_RAW_ALGO_ORDER_OCO_TAKE_PROFIT_FIRED, '0.01');

    expect(resolveOkxAlgoTriggerLeg(OKX_RAW_ALGO_ORDER_OCO_TAKE_PROFIT_FIRED)).toBe('takeProfit');
    expect(order.type).toBe(OrderTypeEnum.TakeProfitMarket);
    expect(order.stopPrice).toBe(70000);
  });

  it('recognises a trailing stop, which has no legs at all', () => {
    expect(resolveOkxAlgoTriggerLeg(OKX_RAW_ALGO_ORDER_TRAILING)).toBe('trailing');
  });

  it('recognises the take-profit leg when only it is filled', () => {
    expect(resolveOkxAlgoTriggerLeg(OKX_RAW_ALGO_ORDER_TAKE_PROFIT_LIMIT)).toBe('takeProfit');
  });

  it('falls back to the generic trigger pair of a plain trigger order', () => {
    expect(resolveOkxAlgoTriggerLeg(OKX_RAW_ALGO_ORDER_TRIGGER)).toBe('generic');
    expect(normalizeOkxAlgoOrder(OKX_RAW_ALGO_ORDER_TRIGGER, '0.01').stopPrice).toBe(58000);
  });
});

describe('mergeOkxTriggeredOrder', () => {
  it('overlays the fill from the triggered plain order onto the conditional order', () => {
    const conditionalOrder = normalizeOkxAlgoOrder(OKX_RAW_ALGO_ORDER_STOP_MARKET, '0.01');
    const triggeredRaw: OkxOrderRaw = { ...OKX_RAW_ORDER_FILLED, avgPx: '59980', accFillSz: '10', state: 'filled' };

    const result = mergeOkxTriggeredOrder(conditionalOrder, triggeredRaw, '0.01');

    expect(result.avgPrice).toBeCloseTo(59980);
    expect(result.filledAmount).toBeCloseTo(0.1);
    expect(result.filledQuoteAmount).toBeCloseTo(0.1 * 59980);
    expect(result.status).toBe('closed');
    expect(result.stopPrice).toBe(conditionalOrder.stopPrice);
    expect(result.id).toBe(conditionalOrder.id);
  });

  it('keeps the conditional status when the triggered state is unknown', () => {
    const conditionalOrder = normalizeOkxAlgoOrder(OKX_RAW_ALGO_ORDER_STOP_MARKET, '0.01');
    const triggeredRaw: OkxOrderRaw = { ...OKX_RAW_ORDER_FILLED, state: 'not_a_real_state' };

    const result = mergeOkxTriggeredOrder(conditionalOrder, triggeredRaw, '0.01');

    expect(result.status).toBe(conditionalOrder.status);
  });
});

describe('buildOkxOrderFromCreateResponse', () => {
  it('builds an open order with zeroed execution from the request args', () => {
    const order = buildOkxOrderFromCreateResponse(
      { symbol: 'BTCUSDT', type: OrderTypeEnum.Limit, side: OrderSideEnum.Buy, amount: 1, price: 60000 },
      '123',
      1,
    );

    expect(order.id).toBe('123');
    expect(order.status).toBe('open');
    expect(order.filledAmount).toBe(0);
    expect(order.isConditional).toBe(false);
  });

  it('marks a conditional order type as isConditional', () => {
    const order = buildOkxOrderFromCreateResponse(
      { symbol: 'BTCUSDT', type: OrderTypeEnum.StopMarket, side: OrderSideEnum.Sell, amount: 1, stopPrice: 55000 },
      '124',
      1,
    );

    expect(order.isConditional).toBe(true);
  });
});

describe('buildOkxCreateOutcome', () => {
  const args = { symbol: 'BTCUSDT', type: OrderTypeEnum.Market, side: OrderSideEnum.Buy, amount: 1 };

  it('builds a placed outcome for a successful result', () => {
    const outcome = buildOkxCreateOutcome(args, OKX_RAW_ORDER_RESULT_OK, 1);

    expect(outcome.isSuccess).toBe(true);
    expect(outcome.order?.id).toBe('312269865356374016');
  });

  it('builds a rejected outcome from a non-zero sCode', () => {
    const outcome = buildOkxCreateOutcome(args, OKX_RAW_ORDER_RESULT_REJECTED, 1);

    expect(outcome.isSuccess).toBe(false);
    expect(outcome.errorCode).toBe(51008);
    expect(outcome.order).toBeNull();
  });

  it('builds a rejected outcome when no result item exists for this batch entry', () => {
    const outcome = buildOkxCreateOutcome(args, undefined, 1);

    expect(outcome.isSuccess).toBe(false);
    expect(outcome.errorText).toBe('OKX returned no result for this batch entry');
  });

  it('builds a rejected outcome when sCode is 0 but the exchange returned no ordId', () => {
    const outcome = buildOkxCreateOutcome(args, { ...OKX_RAW_ORDER_RESULT_OK, ordId: '' }, 1);

    expect(outcome.isSuccess).toBe(false);
    expect(outcome.errorText).toBe(MISSING_ORDER_ID_ERROR_TEXT);
    expect(outcome.order).toBeNull();
  });

  it('reports a null errorCode when sCode is non-numeric instead of NaN', () => {
    const outcome = buildOkxCreateOutcome(args, { ...OKX_RAW_ORDER_RESULT_REJECTED, sCode: 'ABC' }, 1);

    expect(outcome.isSuccess).toBe(false);
    expect(outcome.errorCode).toBeNull();
  });
});

describe('normalizeOkxBalances — wallet balance versus equity', () => {
  it('keeps the unrealized result out of the wallet balance and inside the margin balance', () => {
    const raw: OkxBalanceRaw = {
      ...OKX_RAW_BALANCE,
      upl: '2000',
      availEq: '50000',
      details: [{ ...OKX_RAW_BALANCE.details![0], upl: '2000' }],
    };
    const result = normalizeOkxBalances(raw);

    expect(result.totalMarginBalance).toBeCloseTo(55837.43556134779);
    expect(result.totalWalletBalance).toBeCloseTo(55837.43556134779 - 2000 * USDT_TO_USD_RATE);
  });

  it('reports the same number for both when nothing floats', () => {
    const result = normalizeOkxBalances({
      ...OKX_RAW_BALANCE,
      upl: '0',
      details: [{ ...OKX_RAW_BALANCE.details![0], upl: '0' }],
    });

    expect(result.totalWalletBalance).toBeCloseTo(result.totalMarginBalance ?? 0);
  });

  it('adds a floating loss back — the wallet is bigger than the equity while a position bleeds', () => {
    const result = normalizeOkxBalances({
      ...OKX_RAW_BALANCE,
      upl: '-1500',
      details: [{ ...OKX_RAW_BALANCE.details![0], upl: '-1500' }],
    });

    expect(result.totalWalletBalance).toBeCloseTo(55837.43556134779 + 1500 * USDT_TO_USD_RATE);
  });

  it('keeps the free money the exchange named even when a floating profit puts it above the wallet', () => {
    const result = normalizeOkxBalances({
      ...OKX_RAW_BALANCE,
      upl: '2000',
      details: [{ ...OKX_RAW_BALANCE.details![0], upl: '2000' }],
    });

    expect(result.totalAvailableBalance).toBe(55415.624719833286);
    expect(result.availableBalanceSource).toBe('exchange');
    expect(result.totalAvailableBalance).toBeGreaterThan(result.totalWalletBalance);
    expect(result.totalAvailableBalance).toBeLessThanOrEqual(result.totalMarginBalance ?? 0);
  });

  it('separates the wallet from the equity in Futures mode, where the account-level unrealized result is an empty string', () => {
    const result = normalizeOkxBalances(OKX_RAW_BALANCE_FUTURES_MODE);

    expect(OKX_RAW_BALANCE_FUTURES_MODE.upl).toBe('');
    expect(result.totalMarginBalance).toBeCloseTo(55837.43556134779);
    expect(result.totalWalletBalance).toBeCloseTo(55837.43556134779 + 7.545600000000006 * USDT_TO_USD_RATE);
  });

  it('takes the floating result of an isolated position out of the wallet, which the account-level field never counts', () => {
    const result = normalizeOkxBalances(OKX_RAW_BALANCE_ISOLATED_POSITION);

    expect(result.totalWalletBalance).toBeCloseTo(55837.43556134779 + 320);
  });

  it('derives the free money from the per-coin figure of the exchange, so a floating loss is not handed back as free', () => {
    const result = normalizeOkxBalances(OKX_RAW_BALANCE_ISOLATED_POSITION);

    expect(result.availableBalanceSource).toBe('derived');
    expect(result.totalAvailableBalance).toBeCloseTo(4521.862693622894);
    expect(result.totalAvailableBalance).toBeLessThan(result.totalWalletBalance);
  });

  it('leaves the wallet equal to the equity in Spot mode, where no perpetual can float', () => {
    const result = normalizeOkxBalances(OKX_RAW_BALANCE_SPOT_MODE);

    expect(result.totalWalletBalance).toBeCloseTo(55837.43556134779);
    expect(result.totalWalletBalance).toBeCloseTo(result.totalMarginBalance ?? 0);
  });

  it('falls back to the account-level unrealized result when no coin rate can convert the coin one', () => {
    const raw: OkxBalanceRaw = {
      ...OKX_RAW_BALANCE,
      upl: '2000',
      details: [{ ...OKX_RAW_BALANCE.details![0], upl: '-500', eqUsd: '' }],
    };
    const result = normalizeOkxBalances(raw);

    expect(result.totalWalletBalance).toBeCloseTo(55837.43556134779 - 2000);
  });
});

describe('normalizeOkxBalances', () => {
  it('reads totalAvailableBalance from availEq when present', () => {
    const result = normalizeOkxBalances(OKX_RAW_BALANCE);

    expect(result.availableBalanceSource).toBe('exchange');
    expect(result.totalAvailableBalance).toBeCloseTo(55415.624719833286);
    expect(result.totalWalletBalance).toBeCloseTo(55837.43556134779 + 7.545600000000006 * USDT_TO_USD_RATE);
  });

  it('derives totalAvailableBalance from adjEq − imr when availEq is empty (imr already counts pending orders)', () => {
    const raw: OkxBalanceRaw = { ...OKX_RAW_BALANCE, availEq: '', adjEq: '10000', imr: '1000', ordFroz: '1000' };
    const result = normalizeOkxBalances(raw);

    expect(result.availableBalanceSource).toBe('derived');
    expect(result.totalAvailableBalance).toBe(9000);
  });

  it('derives totalAvailableBalance from per-coin usdValue margin in Futures mode', () => {
    const result = normalizeOkxBalances(OKX_RAW_BALANCE_FUTURES_MODE);

    expect(result.availableBalanceSource).toBe('derived');
    expect(result.totalAvailableBalance).toBeLessThan(result.totalWalletBalance);
    expect(result.totalInitialMargin).toBeCloseTo(158.573 * (4991.542013297616 / 4992.890093622894));
  });

  /**
   * Живая сверка на демо-счёте 09.09.2026 (одна висящая заявка, ни одной позиции). Начальная маржа
   * монеты `imr` уже включает маржу заявок `ordFrozen` — биржа прислала обе одним числом, 132.0266,
   * а свободный остаток монеты упал на него один раз. До правки маржа заявки шла в свод дважды:
   * занято 264.05 вместо 132.03, свободных на 132 меньше правды.
   */
  describe('a pending order costs its margin exactly once', () => {
    const PENDING_ORDER_MARGIN = 132.0266;
    const PENDING_ORDER_USD_RATE = 4999.300648051667 / 4999.800648051667;

    it('counts the order margin as an order margin, never as a margin of a position that does not exist', () => {
      const result = normalizeOkxBalances(OKX_RAW_BALANCE_PENDING_ORDER);
      const usdt = result.balanceByAsset.get('USDT');

      expect(usdt?.totalOrderInitialMargin).toBeCloseTo(PENDING_ORDER_MARGIN);
      expect(usdt?.totalPositionInitialMargin).toBe(0);
    });

    it('reports the margin in use once, not twice', () => {
      const result = normalizeOkxBalances(OKX_RAW_BALANCE_PENDING_ORDER);

      expect(result.totalInitialMargin).toBeCloseTo(PENDING_ORDER_MARGIN * PENDING_ORDER_USD_RATE);
      expect(result.totalInitialMargin).toBeLessThan(2 * PENDING_ORDER_MARGIN * PENDING_ORDER_USD_RATE);
    });

    it('takes the free money from the per-coin figure of the exchange, which already nets the order out once', () => {
      const result = normalizeOkxBalances(OKX_RAW_BALANCE_PENDING_ORDER);

      expect(result.availableBalanceSource).toBe('derived');
      expect(result.totalAvailableBalance).toBeCloseTo(4867.575948051667 * PENDING_ORDER_USD_RATE);

      // Занятым числится ровно то, что биржа заморозила под эту заявку (132.22), — один раз, а не
      // дважды. Прежний вычет «капитал минус наша занятая маржа» отнимал 264 и занижал свободные.
      expect((result.totalMarginBalance ?? 0) - result.totalAvailableBalance).toBeCloseTo(
        132.2247 * PENDING_ORDER_USD_RATE,
      );
      expect((result.totalMarginBalance ?? 0) - result.totalAvailableBalance).toBeLessThan(2 * PENDING_ORDER_MARGIN);
    });

    it('leaves the summary untouched on the same account once the order is gone', () => {
      const detail = OKX_RAW_BALANCE_PENDING_ORDER.details![0];
      const result = normalizeOkxBalances({
        ...OKX_RAW_BALANCE_PENDING_ORDER,
        details: [{ ...detail, availBal: detail.eq, frozenBal: '0', imr: '0', ordFrozen: '0' }],
      });

      expect(result.totalInitialMargin).toBe(0);
      expect(result.totalAvailableBalance).toBeCloseTo(result.totalMarginBalance ?? 0);
    });
  });

  it('reports unknown when nothing can be computed', () => {
    const raw: OkxBalanceRaw = {
      ...OKX_RAW_BALANCE,
      availEq: '',
      adjEq: '',
      imr: '',
      ordFroz: '',
      details: [{ ...OKX_RAW_BALANCE.details![0], eqUsd: '' }],
    };

    const result = normalizeOkxBalances(raw);

    expect(result.availableBalanceSource).toBe('unknown');
    expect(result.totalAvailableBalance).toBe(0);
  });

  it('reports the exchange figure verbatim and never calls a changed number a fact of the exchange', () => {
    const raw: OkxBalanceRaw = { ...OKX_RAW_BALANCE, availEq: '999999' };
    const result = normalizeOkxBalances(raw);

    expect(result.totalAvailableBalance).toBe(999999);
    expect(result.availableBalanceSource).toBe('exchange');
  });

  it('floors a derived difference at zero, because the exchange never names negative free money', () => {
    const raw: OkxBalanceRaw = { ...OKX_RAW_BALANCE, availEq: '', adjEq: '100', imr: '400' };
    const result = normalizeOkxBalances(raw);

    expect(result.totalAvailableBalance).toBe(0);
    expect(result.availableBalanceSource).toBe('derived');
  });

  it('skips a coin balance with zero total, free and locked', () => {
    const raw: OkxBalanceRaw = {
      ...OKX_RAW_BALANCE,
      details: [{ ...OKX_RAW_BALANCE.details![0], eq: '0', availBal: '0', frozenBal: '0' }],
    };

    const result = normalizeOkxBalances(raw);

    expect(result.balanceByAsset.size).toBe(0);
  });

  it('does not throw when details is missing from a malformed response', () => {
    const raw: OkxBalanceRaw = { ...OKX_RAW_BALANCE, details: undefined };
    const result = normalizeOkxBalances(raw);

    expect(result.balanceByAsset.size).toBe(0);
    expect(result.totalAvailableBalance).toBeCloseTo(55415.624719833286);
  });

  it('carries walletBalance, margin and usdValue per coin', () => {
    const result = normalizeOkxBalances(OKX_RAW_BALANCE);
    const usdt = result.balanceByAsset.get('USDT');

    expect(usdt?.walletBalance).toBeCloseTo(4850.435693622894);
    expect(usdt?.usdValue).toBeCloseTo(4991.542013297616);
  });

  it('names the account mode from the account level passed alongside the balance', () => {
    expect(normalizeOkxBalances(OKX_RAW_BALANCE, '2').accountType).toBe('acctLv:2');
    expect(normalizeOkxBalances(OKX_RAW_BALANCE, '4').accountType).toBe('acctLv:4');
  });

  it('leaves the account mode unnamed when the account level is unknown', () => {
    expect(normalizeOkxBalances(OKX_RAW_BALANCE).accountType).toBeUndefined();
    expect(normalizeOkxBalances(OKX_RAW_BALANCE, '').accountType).toBeUndefined();
  });
});

describe('normalizeOkxIncomeList', () => {
  it('reports a funding expense from pnl, per OKX documentation ("refer to pnl for the fee payment")', () => {
    const contractValueBySymbol = new Map([['BTCUSDT', '0.01']]);
    const result = normalizeOkxIncomeList([OKX_RAW_BILL_FUNDING_EXPENSE], contractValueBySymbol);

    expect(result[0].incomeType).toBe('FUNDING_FEE');
    expect(result[0].income).toBeCloseTo(-2.3156522);
    expect(result[0].asset).toBe('USDT');
  });

  it('reports a funding income from pnl', () => {
    const contractValueBySymbol = new Map([['BTCUSDT', '0.01']]);
    const result = normalizeOkxIncomeList([OKX_RAW_BILL_FUNDING_INCOME], contractValueBySymbol);

    expect(result[0].incomeType).toBe('FUNDING_FEE');
    expect(result[0].income).toBeCloseTo(1.25);
  });

  it('falls back to balChg for a funding bill when pnl is zero', () => {
    const contractValueBySymbol = new Map([['BTCUSDT', '0.01']]);
    const result = normalizeOkxIncomeList([OKX_RAW_BILL_FUNDING_EXPENSE_BALCHG_ONLY], contractValueBySymbol);

    expect(result[0].income).toBeCloseTo(-0.5);
  });

  it('reports the commission of a trade bill as commission, not as realized PnL', () => {
    const contractValueBySymbol = new Map([['BTCUSDT', '0.01']]);
    const result = normalizeOkxIncomeList([OKX_RAW_BILL_TRADE_OPEN], contractValueBySymbol);

    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe('commission');
    expect(result[0].incomeType).toBe('COMMISSION');
    expect(result[0].income).toBeCloseTo(parseFloat(OKX_RAW_BILL_TRADE_OPEN.fee));
  });

  it('splits a closing trade bill into gross realized PnL and its commission', () => {
    const contractValueBySymbol = new Map([['BTCUSDT', '0.01']]);
    const result = normalizeOkxIncomeList([OKX_RAW_BILL_TRADE_CLOSE], contractValueBySymbol);

    expect(result).toHaveLength(2);
    expect(result[0].kind).toBe('realizedPnl');
    expect(result[0].income).toBeCloseTo(parseFloat(OKX_RAW_BILL_TRADE_CLOSE.pnl));
    expect(result[1].kind).toBe('commission');
    expect(result[1].income).toBeCloseTo(parseFloat(OKX_RAW_BILL_TRADE_CLOSE.fee));
  });

  it('never reports the balance change of a trade bill as realized PnL', () => {
    const contractValueBySymbol = new Map([['BTCUSDT', '0.01']]);
    const result = normalizeOkxIncomeList([OKX_RAW_BILL_TRADE_CLOSE], contractValueBySymbol);
    const realizedPnl = result.find((income) => income.kind === 'realizedPnl');

    expect(realizedPnl?.income).not.toBeCloseTo(parseFloat(OKX_RAW_BILL_TRADE_CLOSE.balChg));
  });

  it('gives the unfiltered journal exactly the rows both filters return', () => {
    const contractValueBySymbol = new Map([['BTCUSDT', '0.01']]);
    const rawList = [OKX_RAW_BILL_TRADE_OPEN, OKX_RAW_BILL_TRADE_CLOSE];

    const unfiltered = normalizeOkxIncomeList(rawList, contractValueBySymbol);
    const filtered = [
      ...buildOkxRealizedPnlIncomeList(rawList, contractValueBySymbol),
      ...buildOkxCommissionIncomeList(rawList, contractValueBySymbol),
    ];

    expect(unfiltered).toHaveLength(filtered.length);
    expect(unfiltered.map((income) => `${income.kind}:${income.income}`).sort())
      .toEqual(filtered.map((income) => `${income.kind}:${income.income}`).sort());
  });

  it('keeps a trade bill without pnl and without fee as an "other" row instead of dropping it', () => {
    const contractValueBySymbol = new Map([['BTCUSDT', '0.01']]);
    const raw: OkxBillRaw = { ...OKX_RAW_BILL_TRADE_OPEN, pnl: '0', fee: '0', balChg: '1.25' };
    const result = normalizeOkxIncomeList([raw], contractValueBySymbol);

    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe('other');
    expect(result[0].income).toBeCloseTo(1.25);
  });

  it('looks up contractValue by the bill own symbol', () => {
    const contractValueBySymbol = new Map([['BTCUSDT', '0.01']]);
    const raw: OkxBillRaw = { ...OKX_RAW_BILL_TRADE_OPEN, sz: '5' };

    const result = normalizeOkxIncomeList([raw], contractValueBySymbol);

    expect(result[0].quantity).toBeCloseTo(0.05);
  });
});

describe('buildOkxRealizedPnlIncomeList', () => {
  it('reports the gross pnl of a closing trade', () => {
    const contractValueBySymbol = new Map([['BTCUSDT', '']]);
    const result = buildOkxRealizedPnlIncomeList([OKX_RAW_BILL_TRADE_CLOSE], contractValueBySymbol);

    expect(result).toHaveLength(1);
    expect(result[0].incomeType).toBe('REALIZED_PNL');
    expect(result[0].income).toBeCloseTo(15.5);
  });

  it('skips an opening trade with zero pnl', () => {
    const contractValueBySymbol = new Map([['BTCUSDT', '']]);
    const result = buildOkxRealizedPnlIncomeList([OKX_RAW_BILL_TRADE_OPEN], contractValueBySymbol);

    expect(result).toHaveLength(0);
  });

  it('skips a funding bill entirely', () => {
    const contractValueBySymbol = new Map([['BTCUSDT', '0.01']]);
    const result = buildOkxRealizedPnlIncomeList([OKX_RAW_BILL_FUNDING_EXPENSE], contractValueBySymbol);

    expect(result).toHaveLength(0);
  });
});

describe('buildOkxCommissionIncomeList', () => {
  it('reports the fee without inverting its sign', () => {
    const contractValueBySymbol = new Map([['BTCUSDT', '']]);
    const result = buildOkxCommissionIncomeList([OKX_RAW_BILL_TRADE_CLOSE], contractValueBySymbol);

    expect(result).toHaveLength(1);
    expect(result[0].incomeType).toBe('COMMISSION');
    expect(result[0].income).toBeCloseTo(-0.02022168);
  });

  it('skips a trade bill with zero fee', () => {
    const contractValueBySymbol = new Map([['BTCUSDT', '']]);
    const raw: OkxBillRaw = { ...OKX_RAW_BILL_TRADE_CLOSE, fee: '0' };

    const result = buildOkxCommissionIncomeList([raw], contractValueBySymbol);

    expect(result).toHaveLength(0);
  });
});

describe('normalizeOkxClosedPnlList', () => {
  it('reports the closing side opposite to the position direction', () => {
    const contractValueBySymbol = new Map([['BTCUSD', '1']]);
    const result = normalizeOkxClosedPnlList(OKX_RAW_POSITION_HISTORY_LIST, contractValueBySymbol);

    expect(result[0].side).toBe(OrderSideEnum.Sell);
  });

  it('reports Buy for a closed short position', () => {
    const contractValueBySymbol = new Map([['BTCUSD', '1']]);
    const raw = { ...OKX_RAW_POSITION_HISTORY_LIST[0], direction: 'short' };
    const result = normalizeOkxClosedPnlList([raw], contractValueBySymbol);

    expect(result[0].side).toBe(OrderSideEnum.Buy);
  });

  it('computes closedPnl as pnl plus fee and honors the gross-pnl identity for a long', () => {
    const contractValueBySymbol = new Map([['BTCUSD', '1']]);
    const result = normalizeOkxClosedPnlList(OKX_RAW_POSITION_HISTORY_LIST, contractValueBySymbol);
    const record = result[1];

    expect(record.closedPnl).toBeCloseTo(9.6);

    const grossFromPriceDiff = (record.exitPrice - record.entryPrice) * record.quantity;

    expect(grossFromPriceDiff - record.closedPnl).toBeCloseTo(0.4);
  });

  it('converts closeTotalPos from contracts into coins', () => {
    const contractValueBySymbol = new Map([['BTCUSD', '0.01']]);
    const result = normalizeOkxClosedPnlList(OKX_RAW_POSITION_HISTORY_LIST, contractValueBySymbol);

    expect(result[1].quantity).toBeCloseTo(0.2);
  });
});

describe('buildOkxOrderUpdateEvent', () => {
  it('maps the private order channel event', () => {
    const event = buildOkxOrderUpdateEvent(OKX_RAW_ORDER_FILLED, '');

    expect(event.orderId).toBe('680800019749904384');
    expect(event.status).toBe('closed');
    expect(event.isConditional).toBe(false);
  });

  it('reports no cancelType when cancelSource is empty', () => {
    const event = buildOkxOrderUpdateEvent(OKX_RAW_ORDER_FILLED, '');

    expect(event.cancelType).toBeUndefined();
  });

  it('reports cancelType from a non-empty cancelSource', () => {
    const event = buildOkxOrderUpdateEvent({ ...OKX_RAW_ORDER_FILLED, cancelSource: '1' }, '');

    expect(event.cancelType).toBe('1');
  });

  it('reads amount from accFillSz for a spot market buy priced in quote currency', () => {
    const event = buildOkxOrderUpdateEvent(OKX_RAW_ORDER_SPOT_MARKET_QUOTE, '');

    expect(event.amount).toBeCloseTo(0.0015);
    expect(event.filledAmount).toBeCloseTo(0.0015);
  });
});

describe('buildOkxAlgoOrderUpdateEvent', () => {
  it('reports the stop-loss leg price for an oco order and ignores the take-profit leg', () => {
    const raw = {
      ...OKX_RAW_ALGO_ORDER_STOP_MARKET,
      ordType: 'oco',
      slTriggerPx: '60000',
      slOrdPx: '59000',
      tpTriggerPx: '70000',
      tpOrdPx: '71000',
    };

    const event = buildOkxAlgoOrderUpdateEvent(raw, '0.01');

    expect(event.price).toBeCloseTo(59000);
  });

  it('maps the private algo order channel event', () => {
    const event = buildOkxAlgoOrderUpdateEvent(OKX_RAW_ALGO_ORDER_STOP_MARKET, '0.01');

    expect(event.orderId).toBe('1753184812254216192');
    expect(event.status).toBe('open');
    expect(event.price).toBe(0);
    expect(event.isConditional).toBe(true);
  });

  it('never reports a fill of its own — a triggered conditional order has executed nothing yet', () => {
    expect(buildOkxAlgoOrderUpdateEvent(OKX_RAW_ALGO_ORDER_STOP_MARKET, '0.01').filledAmount).toBe(0);

    const event = buildOkxAlgoOrderUpdateEvent(OKX_RAW_ALGO_ORDER_EFFECTIVE, '0.01');

    expect(event.filledAmount).toBe(0);
    expect(event.avgPrice).toBe(0);
    expect(event.status).toBe('open');
    expect(event.triggeredOrderId).toBe('1753184812254216200');
  });

  it('reports no rejection reason for an order the exchange has not rejected', () => {
    const liveEvent = buildOkxAlgoOrderUpdateEvent({ ...OKX_RAW_ALGO_ORDER_STOP_MARKET, failCode: '0' }, '0.01');
    const firedEvent = buildOkxAlgoOrderUpdateEvent(OKX_RAW_ALGO_ORDER_EFFECTIVE, '0.01');

    expect(liveEvent.rejectReason).toBeUndefined();
    expect(firedEvent.rejectReason).toBeUndefined();
  });

  it('reports rejectReason from failCode when the algo order has failed', () => {
    const event = buildOkxAlgoOrderUpdateEvent(OKX_RAW_ALGO_ORDER_FAILED, '0.01');

    expect(event.rejectReason).toBe('51008: Order failed. Insufficient balance');
  });

  it('reports zero amount for a quote-currency algo order before it fires', () => {
    const event = buildOkxAlgoOrderUpdateEvent(OKX_RAW_ALGO_ORDER_SPOT_MARKET_QUOTE, '');

    expect(event.amount).toBe(0);
  });

  it('reports no rejectReason when failCode is empty', () => {
    const event = buildOkxAlgoOrderUpdateEvent(OKX_RAW_ALGO_ORDER_STOP_MARKET, '0.01');

    expect(event.rejectReason).toBeUndefined();
  });
});

describe('buildOkxPositionUpdateEvent', () => {
  it('maps the private positions channel event', () => {
    const event = buildOkxPositionUpdateEvent(OKX_RAW_POSITION_NET_LONG, '0.01');

    expect(event.symbol).toBe('BTCUSDT');
    expect(event.size).toBeCloseTo(0.05);
    expect(event.side).toBe('Buy');
    expect(event.positionSide).toBe('net');
  });

  it('tells a net long from a net short, where the sign of pos is the only direction there is', () => {
    const longEvent = buildOkxPositionUpdateEvent(OKX_RAW_POSITION_NET_LONG, '0.01');
    const shortEvent = buildOkxPositionUpdateEvent(OKX_RAW_POSITION_NET_SHORT, '0.01');

    expect(longEvent.side).toBe('Buy');
    expect(shortEvent.side).toBe('Sell');
    expect(shortEvent).not.toEqual(longEvent);
  });

  it('reports the side in the same dialect as Binance and Bybit in hedge mode', () => {
    const event = buildOkxPositionUpdateEvent(OKX_RAW_POSITION_HEDGE_SHORT, '0.01');

    expect(event.side).toBe('Sell');
    expect(event.positionSide).toBe('short');
  });

  it('reports an empty side for a closed position, as Binance does', () => {
    const raw: OkxPositionRaw = { ...OKX_RAW_POSITION_NET_LONG, pos: '0' };
    const event = buildOkxPositionUpdateEvent(raw, '0.01');

    expect(event.side).toBe('');
  });

  it('reports null for markPrice, leverage and liquidationPrice when the fields are empty', () => {
    const raw: OkxPositionRaw = { ...OKX_RAW_POSITION_NET_LONG, markPx: '', lever: '', liqPx: '' };
    const event = buildOkxPositionUpdateEvent(raw, '0.01');

    expect(event.markPrice).toBeNull();
    expect(event.leverage).toBeNull();
    expect(event.liquidationPrice).toBeNull();
  });

  it('reports numeric values when the fields are present', () => {
    const event = buildOkxPositionUpdateEvent(OKX_RAW_POSITION_NET_LONG, '0.01');

    expect(event.markPrice).toBeCloseTo(62891.9);
    expect(event.leverage).toBeCloseTo(5);
    expect(event.liquidationPrice).toBeCloseTo(53615.448336593756);
  });

  it('does not throw when pos is missing from a malformed response', () => {
    const raw: OkxPositionRaw = { ...OKX_RAW_POSITION_NET_LONG, pos: undefined };
    const event = buildOkxPositionUpdateEvent(raw, '0.01');

    expect(event.size).toBe(0);
  });
});

describe('buildOkxBalanceUpdateEvent', () => {
  it('maps the private account channel event', () => {
    const event = buildOkxBalanceUpdateEvent(OKX_RAW_BALANCE);

    expect(event.balanceList).toHaveLength(1);
    expect(event.balanceList[0].asset).toBe('USDT');
    expect(event.balanceList[0].free).toBeCloseTo(4834.317093622894);
    expect(event.balanceList[0].total).toBeCloseTo(4992.890093622894);
  });

  it('reports null for empty fields instead of a fake zero', () => {
    const raw: OkxBalanceRaw = {
      ...OKX_RAW_BALANCE,
      details: [{ ...OKX_RAW_BALANCE.details![0], availBal: '', frozenBal: '', eq: '' }],
    };

    const event = buildOkxBalanceUpdateEvent(raw);

    expect(event.balanceList[0].free).toBeNull();
    expect(event.balanceList[0].locked).toBeNull();
    expect(event.balanceList[0].total).toBeNull();
  });

  it('does not throw when details is missing from a malformed response', () => {
    const raw: OkxBalanceRaw = { ...OKX_RAW_BALANCE, details: undefined };
    const event = buildOkxBalanceUpdateEvent(raw);

    expect(event.balanceList).toEqual([]);
  });
});

describe('normalizeOkxPositionTierList', () => {
  it('normalizes the first tier', () => {
    const result = normalizeOkxPositionTierList(OKX_RAW_POSITION_TIER_LIST, '0.01');

    expect(result[0]?.maxLeverage).toBe(100);
    expect(result[0]?.maxNotional).toBeNull();
    expect(result[0]?.maxBaseAmount).toBeCloseTo(10, 9);
    expect(result[0]?.initialMarginRate).toBeCloseTo(0.01, 9);
    expect(result[0]?.maintenanceMarginRate).toBeCloseTo(0.004, 9);
  });

  it('sorts by maxBaseAmount ascending', () => {
    const result = normalizeOkxPositionTierList(OKX_RAW_POSITION_TIER_LIST, '0.01');
    const amountList = result.map((tier) => tier.maxBaseAmount);

    for (let i = 1; i < amountList.length; i++) {
      expect(amountList[i]).toBeGreaterThan(amountList[i - 1] ?? 0);
    }
  });
});
