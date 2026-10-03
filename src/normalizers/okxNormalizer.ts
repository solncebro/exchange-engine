import type {
  Ticker,
  TickerBySymbol,
  Kline,
  TradeSymbol,
  TradeSymbolBySymbol,
  TradeSymbolFilter,
  TradingFunding,
  PriceLimitRisk,
  OrderBook,
  OrderBookLevel,
  OrderBookRawLevel,
  OrderBookUpdate,
  OrderBookUpdateType,
  PublicTrade,
  MarkPrice,
  MarkPriceUpdate,
  OpenInterest,
  FundingRateHistory,
  FundingInfo,
  Position,
  Order,
  Balance,
  BalanceByAsset,
  AccountBalances,
  Income,
  IncomeKind,
  ClosedPnl,
  OrderUpdateEvent,
  PositionUpdateEvent,
  BalanceUpdateEvent,
  ExchangeLogger,
  LeverageTier,
} from '../types/common';
import { TradeSymbolTypeEnum, PositionSideEnum, MarginModeEnum, OrderSideEnum, OrderTypeEnum, TimeInForceEnum } from '../types/common';
import type { CreateOrderWebSocketArgs, CreateOrderItemResult, ModifyOrderItemResult } from '../types/exchange';
import {
  OKX_ORDER_SIDE,
  OKX_POSITION_SIDE,
  OKX_POSITION_IDX,
  OKX_ORDER_STATUS,
  OKX_ALGO_STATUS,
  OKX_ORD_TYPE_TO_ORDER_TYPE,
  OKX_ORD_TYPE_TO_TIME_IN_FORCE,
} from '../constants/mappings';
import {
  OKX_ALGO_TRAILING_ORD_TYPE,
  OKX_FUNDING_BILL_TYPE,
  OKX_LINEAR_SETTLE_CURRENCY_LIST,
  OKX_MARKET_ORDER_PRICE,
  OKX_SWAP_INST_ID_SUFFIX,
  OKX_TRADABLE_INSTRUMENT_STATE_SET,
  OKX_TRADE_BILL_TYPE,
  OKX_TRADIFI_INST_CATEGORY_SET,
} from '../constants/okx';
import { multiplyDecimalStrings, convertContractsToCoins } from '../utils/decimalString';
import { countDecimalPlaces } from '../precision/precision';
import { parseOrderBookLevel, toOrderBookRawLevelList } from './normalizerUtils';
import { parseOkxInstId } from '../exchanges/okxSymbol';
import { ExchangeError } from '../errors/ExchangeError';
import { isConditionalOrderType } from '../constants/orderTypes';
import { buildPlacedOrderOutcome, buildRejectedOrderOutcome } from './batchOrderOutcome';
import type {
  NormalizeOkxOrderBookUpdateArgs,
  OkxAlgoTriggerLeg,
  ParseOkxOrderbookRawFrameArgs,
  NormalizeOkxFeeRateArgs,
  OkxFeeRateOutcome,
  TakeOkxBillRowArgs,
  TakeOkxRowContractValueArgs,
} from './okxNormalizer.types';

export interface OkxInstrumentRaw {
  instType: string;
  instId: string;
  uly?: string;
  instFamily?: string;
  baseCcy: string;
  quoteCcy: string;
  settleCcy: string;
  ctVal: string;
  ctMult: string;
  ctValCcy: string;
  ctType: string;
  lever: string;
  tickSz: string;
  lotSz: string;
  minSz: string;
  maxLmtSz: string;
  maxMktSz: string;
  maxLmtAmt?: string;
  maxMktAmt?: string;
  state: string;
  listTime: string;
  expTime?: string;
  ruleType?: string;
  instIdCode?: number | null;
  instCategory?: string;
  initPxLmtPct?: string;
  floatPxLmtPct?: string;
  maxPxLmtPct?: string;
  groupId?: string;
  [key: string]: unknown;
}

export interface OkxTickerRaw {
  instType: string;
  instId: string;
  last: string;
  lastSz: string;
  askPx: string;
  askSz: string;
  bidPx: string;
  bidSz: string;
  open24h: string;
  high24h: string;
  low24h: string;
  volCcy24h: string;
  vol24h: string;
  sodUtc0?: string;
  sodUtc8?: string;
  ts: string;
}

export interface OkxOrderBookRaw {
  asks: string[][];
  bids: string[][];
  ts: string;
  seqId?: number;
}

export interface OkxPublicTradeRaw {
  instId: string;
  tradeId: string;
  px: string;
  sz: string;
  side: string;
  ts: string;
  source?: string;
  count?: string;
  seqId?: number;
}

export interface OkxOrderBookWebSocketDataRaw {
  asks: string[][];
  bids: string[][];
  ts: string;
  seqId: number;
  prevSeqId: number;
  checksum?: number;
}

export interface OkxMarkPriceRaw {
  instType: string;
  instId: string;
  markPx: string;
  ts: string;
}

/** `GET /api/v5/market/index-tickers`: `instId` здесь — ИНДЕКС (`BTC-USDT`), а не контракт. */
export interface OkxIndexTickerRaw {
  instId: string;
  idxPx: string;
  high24h: string;
  low24h: string;
  open24h: string;
  sodUtc0: string;
  sodUtc8: string;
  ts: string;
}

export interface OkxOpenInterestRaw {
  instType: string;
  instId: string;
  oi: string;
  oiCcy: string;
  oiUsd: string;
  ts: string;
}

export interface OkxFundingRateRaw {
  instType: string;
  instId: string;
  fundingRate: string;
  nextFundingRate: string;
  fundingTime: string;
  nextFundingTime: string;
  minFundingRate: string;
  maxFundingRate: string;
  settFundingRate: string;
  settState: string;
  premium?: string;
  interestRate?: string;
  ts: string;
  [key: string]: unknown;
}

export interface OkxFundingRateHistoryRaw {
  instType: string;
  instId: string;
  fundingRate: string;
  realizedRate: string;
  fundingTime: string;
  method?: string;
  formulaType?: string;
}

interface OkxBalanceDetailRaw {
  ccy: string;
  eq: string;
  cashBal: string;
  availBal: string;
  availEq: string;
  frozenBal: string;
  ordFrozen: string;
  upl: string;
  eqUsd: string;
  imr: string;
  mmr: string;
  uTime: string;
  [key: string]: unknown;
}

export interface OkxBalanceRaw {
  uTime: string;
  totalEq: string;
  isoEq: string;
  adjEq: string;
  availEq: string;
  ordFroz: string;
  imr: string;
  mmr: string;
  mgnRatio: string;
  notionalUsd: string;
  upl: string;
  details?: OkxBalanceDetailRaw[];
  [key: string]: unknown;
}

export interface OkxPositionRaw {
  instType: string;
  instId: string;
  mgnMode: string;
  posId: string;
  posSide: string;
  pos?: string;
  posCcy: string;
  availPos: string;
  avgPx: string;
  upl: string;
  uplRatio: string;
  lever: string;
  liqPx: string;
  markPx: string;
  imr: string;
  margin: string;
  mgnRatio: string;
  mmr: string;
  notionalUsd: string;
  adl: string;
  ccy: string;
  last: string;
  idxPx: string;
  bePx: string;
  realizedPnl?: string;
  pnl?: string;
  fee?: string;
  fundingFee?: string;
  cTime: string;
  uTime: string;
  [key: string]: unknown;
}

export interface OkxPositionHistoryRaw {
  instType: string;
  instId: string;
  mgnMode: string;
  type: string;
  cTime: string;
  uTime: string;
  openAvgPx: string;
  closeAvgPx: string;
  posId: string;
  openMaxPos: string;
  closeTotalPos: string;
  realizedPnl: string;
  fee: string;
  fundingFee: string;
  liqPenalty: string;
  pnl: string;
  pnlRatio: string;
  posSide: string;
  lever: string;
  direction: string;
  triggerPx: string;
  uly: string;
  ccy: string;
  [key: string]: unknown;
}

export interface OkxAccountConfigRaw {
  uid: string;
  acctLv: string;
  posMode: string;
  autoLoan?: boolean;
  level?: string;
  ctIsoMode?: string;
  settleCcy?: string;
  [key: string]: unknown;
}

export interface OkxSetLeverageRaw {
  lever: string;
  mgnMode: string;
  instId: string;
  posSide: string;
}

export interface OkxPositionModeRaw {
  posMode: string;
}

interface OkxFeeGroupRaw {
  taker: string;
  maker: string;
  groupId: string;
  [key: string]: unknown;
}

export interface OkxFeeRateRaw {
  level: string;
  taker: string;
  maker: string;
  takerU?: string;
  makerU?: string;
  takerUSDC?: string;
  makerUSDC?: string;
  instType: string;
  ts: string;
  feeGroup?: OkxFeeGroupRaw[];
  [key: string]: unknown;
}

export interface OkxBillRaw {
  instType: string;
  billId: string;
  type: string;
  subType: string;
  ts: string;
  balChg: string;
  posBalChg: string;
  bal: string;
  posBal: string;
  sz: string;
  px: string;
  ccy: string;
  pnl: string;
  fee: string;
  mgnMode: string;
  instId: string;
  ordId: string;
  execType: string;
  fillTime: string;
  tradeId: string;
  clOrdId?: string;
  fillIdxPx?: string;
  fillMarkPx?: string;
  [key: string]: unknown;
}

export interface OkxOrderRaw {
  instType: string;
  instId: string;
  tgtCcy: string;
  ccy: string;
  ordId: string;
  clOrdId: string;
  tag: string;
  px: string;
  sz: string;
  pnl: string;
  ordType: string;
  side: string;
  posSide: string;
  tdMode: string;
  accFillSz: string;
  fillPx: string;
  tradeId: string;
  fillSz: string;
  fillTime: string;
  avgPx: string;
  state: string;
  lever: string;
  tpTriggerPx: string;
  tpOrdPx: string;
  slTriggerPx: string;
  slOrdPx: string;
  feeCcy: string;
  fee: string;
  rebateCcy: string;
  rebate: string;
  category: string;
  reduceOnly: string;
  cancelSource: string;
  algoClOrdId: string;
  algoId: string;
  uTime: string;
  cTime: string;
  source?: string;
  isTpLimit?: string;
  [key: string]: unknown;
}

/** Общая часть ответа по ОДНОЙ записи пакета — одинакова у обычной заявки и у условной. */
interface OkxBatchOutcomeRaw {
  sCode: string;
  sMsg: string;
}

export interface OkxOrderResultRaw {
  ordId: string;
  clOrdId: string;
  tag: string;
  ts: string;
  sCode: string;
  sMsg: string;
  reqId?: string;
}

export interface OkxAlgoOrderResultRaw {
  algoId: string;
  clOrdId: string;
  algoClOrdId: string;
  sCode: string;
  sMsg: string;
  tag?: string;
}

export interface OkxAlgoOrderRaw {
  instType: string;
  instId: string;
  ordId: string;
  ordIdList?: string[];
  algoId: string;
  clOrdId: string;
  algoClOrdId: string;
  sz: string;
  closeFraction: string;
  ordType: string;
  side: string;
  posSide: string;
  tdMode: string;
  tgtCcy: string;
  state: string;
  lever?: string;
  tpTriggerPx: string;
  tpTriggerPxType: string;
  tpOrdPx: string;
  slTriggerPx: string;
  slTriggerPxType: string;
  slOrdPx: string;
  triggerPx: string;
  triggerPxType: string;
  ordPx: string;
  actualSz: string;
  actualPx: string;
  actualSide: string;
  triggerTime: string;
  callbackRatio: string;
  callbackSpread: string;
  activePx: string;
  moveTriggerPx: string;
  reduceOnly: string;
  failCode: string;
  failMsg?: string;
  cTime: string;
  uTime: string;
  [key: string]: unknown;
}

function parseOkxNumber(value: string | undefined): number {
  if (value === undefined || value === '') {
    return 0;
  }

  const parsedValue = parseFloat(value);

  return Number.isFinite(parsedValue) ? parsedValue : 0;
}

function isOkxPositiveFiniteNumberString(value: string): boolean {
  if (value === '') {
    return false;
  }

  const parsedValue = parseFloat(value);

  return Number.isFinite(parsedValue) && parsedValue > 0;
}

function safeMultiplyDecimalStrings(left: string, right: string): string {
  if (!isOkxPositiveFiniteNumberString(left) || !isOkxPositiveFiniteNumberString(right)) {
    return '0';
  }

  return multiplyDecimalStrings(left, right);
}

function parseOkxContractSize(ctVal: string): number {
  const parsedContractSize = parseOkxNumber(ctVal);

  return parsedContractSize > 0 ? parsedContractSize : 1;
}

function resolveOkxSymbol(instId: string): string {
  return parseOkxInstId(instId)?.symbol ?? instId;
}

/**
 * Общее имя инструмента или «ничего», если обозначение биржи не разбирается. В СПИСКАХ такую
 * строку надо пропускать: иначе неразобранное обозначение уходит наружу ИМЕНЕМ символа, и в карте
 * тикеров рядом с обычным `BTCUSDT` появляется ключ `BTC-USDT-SWAP` с дефисами — по нему ни
 * заявку поставить, ни цену округлить. Список инструментов такую строку пропускает давно, а
 * тикеры, сделки и отчётные списки — нет.
 */
function takeOkxSymbol(instId: string): string | null {
  return parseOkxInstId(instId)?.symbol ?? null;
}

export function isOkxInstrumentSupported(raw: OkxInstrumentRaw, isSwap: boolean): boolean {
  if (isSwap && (raw.instType !== 'SWAP' || raw.ctType !== 'linear' || !OKX_LINEAR_SETTLE_CURRENCY_LIST.includes(raw.settleCcy))) {
    return false;
  }

  if (!isSwap && raw.instType !== 'SPOT') {
    return false;
  }

  const requiredFieldList = isSwap
    ? [raw.ctVal, raw.lotSz, raw.minSz, raw.tickSz]
    : [raw.lotSz, raw.minSz, raw.tickSz];

  return requiredFieldList.every(isOkxPositiveFiniteNumberString);
}

/**
 * Граница цены заявки, которую биржа отдаёт в том же ответе списка инструментов. Наружу — в
 * ПРОЦЕНТАХ: биржевое «0.03 represents 3%» превращается в 3 точной десятичной арифметикой (доли
 * в библиотеке не используются нигде). Строится, только если пришла хотя бы плавающая граница или
 * потолок: у опционов и событий биржа отдаёт пустые строки, и пустой набор процентов был бы
 * враньём о том, что границы нет.
 */
function buildOkxPriceLimitRisk(raw: OkxInstrumentRaw): PriceLimitRisk | undefined {
  const floatPercent = toOkxPercentString(raw.floatPxLmtPct);
  const maxPercent = toOkxPercentString(raw.maxPxLmtPct);

  if (floatPercent === '' && maxPercent === '') {
    return undefined;
  }

  return {
    source: 'okxPriceLimitPct',
    initialPriceLimitPercent: toOkxPercentString(raw.initPxLmtPct),
    floatPriceLimitPercent: floatPercent,
    maxPriceLimitPercent: maxPercent,
  };
}

function toOkxPercentString(ratio: string | undefined): string {
  if (ratio === undefined || !isOkxPositiveFiniteNumberString(ratio)) {
    return '';
  }

  return multiplyDecimalStrings(ratio, '100');
}

/**
 * Срок фандинга и его границы биржа держит НЕ в списке инструментов, а в ответе ставки фандинга —
 * поэтому они приходят сюда вторым списком (один запрос `funding-rate?instId=ANY` на всю
 * загрузку). Bybit те же три величины кладёт в `TradeSymbol.funding`, у OKX они пустовали.
 * Промежуток считается по паре «ближайшее начисление — следующее за ним», обе величины биржа
 * отдаёт в том же ответе.
 */
function buildOkxTradingFunding(raw: OkxFundingRateRaw): TradingFunding | undefined {
  const result: TradingFunding = {};
  const intervalMs = parseOkxNumber(raw.nextFundingTime) - parseOkxNumber(raw.fundingTime);

  if (intervalMs > 0) {
    result.fundingIntervalMinutes = Math.round(intervalMs / 60000);
  }

  if (raw.maxFundingRate !== '') {
    result.upperFundingRate = raw.maxFundingRate;
  }

  if (raw.minFundingRate !== '') {
    result.lowerFundingRate = raw.minFundingRate;
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

export function normalizeOkxTradeSymbols(
  rawList: OkxInstrumentRaw[],
  fundingRawList: OkxFundingRateRaw[] = [],
): TradeSymbolBySymbol {
  const tradeSymbolBySymbol = new Map<string, TradeSymbol>();
  const fundingByInstId = new Map<string, OkxFundingRateRaw>();

  for (const funding of fundingRawList) {
    fundingByInstId.set(funding.instId, funding);
  }

  for (const raw of rawList) {
    const identity = parseOkxInstId(raw.instId);

    if (identity === null) {
      continue;
    }

    const isSwap = raw.instType === 'SWAP';

    if (!isOkxInstrumentSupported(raw, isSwap)) {
      continue;
    }

    const baseAsset = !isSwap && raw.baseCcy !== '' ? raw.baseCcy : identity.baseAsset;
    const quoteAsset = !isSwap && raw.quoteCcy !== '' ? raw.quoteCcy : identity.quoteAsset;
    const symbol = identity.symbol;

    const stepSize = isSwap ? safeMultiplyDecimalStrings(raw.lotSz, raw.ctVal) : raw.lotSz;
    const minQty = isSwap ? safeMultiplyDecimalStrings(raw.minSz, raw.ctVal) : raw.minSz;
    const spotMaxQty = isOkxPositiveFiniteNumberString(raw.maxLmtSz) ? raw.maxLmtSz : '0';
    const maxQty = isSwap ? safeMultiplyDecimalStrings(raw.maxLmtSz, raw.ctVal) : spotMaxQty;

    const filter: TradeSymbolFilter = {
      tickSize: raw.tickSz,
      stepSize,
      minQty,
      maxQty,
      minNotional: '0',
    };

    if (isSwap && isOkxPositiveFiniteNumberString(raw.maxMktSz)) {
      filter.marketMaxQty = safeMultiplyDecimalStrings(raw.maxMktSz, raw.ctVal);
    }

    if (raw.maxLmtAmt !== undefined && isOkxPositiveFiniteNumberString(raw.maxLmtAmt)) {
      filter.maxNotional = raw.maxLmtAmt;
    }

    const tradeSymbol: TradeSymbol = {
      symbol,
      baseAsset,
      quoteAsset,
      settle: isSwap ? raw.settleCcy : '',
      isActive: OKX_TRADABLE_INSTRUMENT_STATE_SET.has(raw.state),
      type: isSwap ? TradeSymbolTypeEnum.Swap : TradeSymbolTypeEnum.Spot,
      isLinear: isSwap,
      contractSize: isSwap ? parseOkxContractSize(raw.ctVal) : 1,
      contractType: isSwap ? 'SWAP' : '',
      isTradifi: raw.instCategory !== undefined && OKX_TRADIFI_INST_CATEGORY_SET.has(raw.instCategory),
      filter,
      pricePrecision: countDecimalPlaces(raw.tickSz),
      quantityPrecision: countDecimalPlaces(stepSize),
      info: raw,
    };

    if (isSwap && raw.lever !== '') {
      tradeSymbol.leverageFilter = { minLeverage: '0', maxLeverage: raw.lever, leverageStep: '0' };
    }

    const fundingRaw = fundingByInstId.get(raw.instId);
    const funding = fundingRaw !== undefined ? buildOkxTradingFunding(fundingRaw) : undefined;

    if (funding !== undefined) {
      tradeSymbol.funding = funding;
    }

    const priceLimitRisk = buildOkxPriceLimitRisk(raw);

    if (priceLimitRisk !== undefined) {
      tradeSymbol.priceLimitRisk = priceLimitRisk;
    }

    const launchTimestamp = parseOkxNumber(raw.listTime);

    if (launchTimestamp > 0) {
      tradeSymbol.launchTimestamp = launchTimestamp;
    }

    tradeSymbolBySymbol.set(symbol, tradeSymbol);
  }

  return tradeSymbolBySymbol;
}

/**
 * OKX contract tickers carry no quote-currency turnover — only base-currency `volCcy24h`
 * (and contract-count `vol24h`). `quoteVolume` for a swap is therefore an ESTIMATE
 * (`volCcy24h × last`), not an exchange-reported figure, unlike the spot branch.
 *
 * Верх стакана (`bidSz`/`askSz`) у бессрочного контракта биржа считает В КОНТРАКТАХ — той же
 * мерой, что и `vol24h` («24h trading volume, with a unit of contract»), — поэтому размер
 * переводится в монеты множителем инструмента. Инструмент, которого нет в карте множителей
 * (`loadTradeSymbols` ещё не звали), размера НЕ получает вовсе: пустое поле честнее числа,
 * ошибающегося во столько раз, сколько монет в контракте.
 */
export function normalizeOkxTickers(
  rawList: OkxTickerRaw[],
  isSwap: boolean,
  contractValueBySymbol: Map<string, string>,
): TickerBySymbol {
  const tickerBySymbol = new Map<string, Ticker>();
  // Вход `market/tickers` принимает только вид рынка, поэтому по `instType=SWAP` приходят и
  // линейные, и ОБРАТНЫЕ контракты (`BTC-USD-SWAP`), которых нет ни в списке инструментов, ни в
  // цене маркировки: три списка одного клиента расходились. Потребитель, перебирающий тикеры
  // (обычный способ отобрать инструменты), получал нерабочее имя, а числа обратного контракта
  // несопоставимы с линейными. Отбираем по карте множителей — она заполняется ровно тем же
  // отбором, что и список инструментов. Пока карта пуста (инструменты не загружены), отбор не
  // применяется вовсе: так же поступают `fetchMarkPrice` и `fetchFundingInfo`.
  const isFilteredByInstrumentMap = isSwap && contractValueBySymbol.size > 0;

  for (const raw of rawList) {
    const symbol = takeOkxSymbol(raw.instId);

    if (symbol === null || (isFilteredByInstrumentMap && !contractValueBySymbol.has(symbol))) {
      continue;
    }

    const contractValue = isSwap ? contractValueBySymbol.get(symbol) : '';
    const lastPrice = parseOkxNumber(raw.last);
    const openPrice = parseOkxNumber(raw.open24h);
    const volCcy24h = parseOkxNumber(raw.volCcy24h);

    const ticker: Ticker = {
      symbol,
      lastPrice,
      openPrice,
      highPrice: parseOkxNumber(raw.high24h),
      lowPrice: parseOkxNumber(raw.low24h),
      priceChangePercent: openPrice > 0 ? ((lastPrice - openPrice) / openPrice) * 100 : 0,
      volume: isSwap ? volCcy24h : parseOkxNumber(raw.vol24h),
      quoteVolume: isSwap ? volCcy24h * lastPrice : volCcy24h,
      // Пустая отметка времени — не 1970 год: сторож устаревания потока счёл бы такой тикер
      // протухшим на полвека. Bybit в том же месте подставляет текущее время.
      timestamp: raw.ts !== '' ? parseOkxNumber(raw.ts) : Date.now(),
    };

    if (raw.bidPx !== '') {
      ticker.bid1Price = parseOkxNumber(raw.bidPx);
    }

    if (raw.bidSz !== '' && contractValue !== undefined) {
      ticker.bid1Size = convertContractsToCoins(raw.bidSz, contractValue);
    }

    if (raw.askPx !== '') {
      ticker.ask1Price = parseOkxNumber(raw.askPx);
    }

    if (raw.askSz !== '' && contractValue !== undefined) {
      ticker.ask1Size = convertContractsToCoins(raw.askSz, contractValue);
    }

    tickerBySymbol.set(symbol, ticker);
  }

  return tickerBySymbol;
}

function normalizeOkxKlineRow(row: string[], isSwap: boolean, intervalMs?: number): Kline {
  const openTimestamp = parseOkxNumber(row[0]);

  return {
    openTimestamp,
    openPrice: parseOkxNumber(row[1]),
    highPrice: parseOkxNumber(row[2]),
    lowPrice: parseOkxNumber(row[3]),
    closePrice: parseOkxNumber(row[4]),
    volume: isSwap ? parseOkxNumber(row[6]) : parseOkxNumber(row[5]),
    // Минус миллисекунда — как у Binance, которая отдаёт своё `closeTime` последней миллисекундой
    // интервала, а не первой миллисекундой следующего. Без этого сравнение «свеча закрылась в …»
    // между биржами разъезжалось на миллисекунду, и попадание отметки в интервал по «не позже»
    // давало на границе разный ответ.
    closeTimestamp: intervalMs !== undefined && intervalMs > 0 ? openTimestamp + intervalMs - 1 : 0,
    quoteAssetVolume: parseOkxNumber(row[7]),
    numberOfTrades: 0,
    takerBuyBaseAssetVolume: 0,
    takerBuyQuoteAssetVolume: 0,
    isClosed: row[8] === '1',
  };
}

export function normalizeOkxKlines(rawList: string[][], isSwap: boolean, intervalMs?: number): Kline[] {
  return rawList.map((row) => normalizeOkxKlineRow(row, isSwap, intervalMs)).reverse();
}

export function normalizeOkxKlineWebSocketMessage(row: string[], isSwap: boolean, intervalMs?: number): Kline {
  return normalizeOkxKlineRow(row, isSwap, intervalMs);
}

/**
 * Глубина стакана бессрочного контракта приходит В КОНТРАКТАХ: документация книги заявок о паре
 * «цена, количество» говорит дословно «"10" is the quantity at the price (number of contracts for
 * derivatives, quantity in base currency for Spot and Spot Margin)». Наружу библиотека везде
 * говорит монетами — так отдают Binance и Bybit и так же разобраны соседние ответы самой OKX
 * (публичная сделка, свеча, позиция, заявка), поэтому количество переводится множителем
 * контракта. У спота множитель пуст: количество уже в монетах, и умножать нечем.
 */
function toOkxOrderBookLevel(level: string[], contractValue: string): OrderBookLevel {
  if (contractValue === '') {
    return parseOrderBookLevel(level);
  }

  return { price: parseFloat(level[0]), quantity: convertContractsToCoins(level[1], contractValue) };
}

/**
 * То же для потока, где уровень хранится парой сырых decimal-строк: множим точной арифметикой,
 * чтобы не потерять разряд. Пустое количество остаётся пустым, нулевое — нулевым: приращение
 * стакана нулём УДАЛЯЕТ цену, и подменить этот ноль нечем.
 */
function toOkxOrderBookRawLevelList(rawList: string[][], contractValue: string): OrderBookRawLevel[] {
  if (contractValue === '') {
    return toOrderBookRawLevelList(rawList);
  }

  return rawList.map((level): OrderBookRawLevel => {
    const size = level[1];

    return [level[0], size === '' ? size : multiplyDecimalStrings(size, contractValue)];
  });
}

export function normalizeOkxOrderBook(raw: OkxOrderBookRaw, symbol: string, contractValue: string): OrderBook {
  const timestamp = parseOkxNumber(raw.ts);

  const orderBook: OrderBook = {
    symbol,
    askList: raw.asks.map((level) => toOkxOrderBookLevel(level, contractValue)),
    bidList: raw.bids.map((level) => toOkxOrderBookLevel(level, contractValue)),
    timestamp,
    eventTimestamp: timestamp,
  };

  if (raw.seqId !== undefined) {
    orderBook.updateId = raw.seqId;
  }

  return orderBook;
}

export function normalizeOkxOrderBookUpdate(
  raw: OkxOrderBookWebSocketDataRaw,
  args: NormalizeOkxOrderBookUpdateArgs,
): OrderBookUpdate {
  const { symbol, updateType, receivedTimestamp, contractValue } = args;

  return {
    symbol,
    updateType,
    bidList: toOkxOrderBookRawLevelList(raw.bids, contractValue),
    askList: toOkxOrderBookRawLevelList(raw.asks, contractValue),
    updateId: raw.seqId,
    eventTimestamp: parseOkxNumber(raw.ts),
    receivedTimestamp,
  };
}

interface OkxOrderbookFrameArg {
  channel?: string;
}

interface OkxOrderbookFrameEnvelope {
  arg?: OkxOrderbookFrameArg;
  action?: string;
  data?: unknown;
}

const OKX_INCREMENTAL_ORDERBOOK_CHANNEL = 'books';

/**
 * Инкрементным у OKX является только канал `books`: там кадр без `action 'snapshot'` — это
 * приращение к уже собранной книге. Каналы `books5` и `bbo-tbt` присылают полную книгу на каждый
 * кадр и поля `action` не несут вовсе, поэтому такой кадр — всегда снимок. Канал в кадре не указан
 * только у испорченного кадра: там сохраняется прежнее (осторожное) прочтение по `action`.
 */
function resolveOkxOrderbookUpdateType(envelope: OkxOrderbookFrameEnvelope): OrderBookUpdateType {
  const channel = envelope.arg?.channel;
  const isIncrementalChannel = channel === undefined || channel === OKX_INCREMENTAL_ORDERBOOK_CHANNEL;

  if (!isIncrementalChannel || envelope.action === 'snapshot') {
    return 'snapshot';
  }

  return 'delta';
}

export function parseOkxOrderbookRawFrame(args: ParseOkxOrderbookRawFrameArgs): OrderBookUpdate | undefined {
  const { raw, symbol, receivedTimestamp, contractValue } = args;

  let parsedRoot: unknown;

  try {
    parsedRoot = JSON.parse(raw);
  } catch {
    return undefined;
  }

  if (typeof parsedRoot !== 'object' || parsedRoot === null || Array.isArray(parsedRoot)) {
    return undefined;
  }

  const envelope = parsedRoot as OkxOrderbookFrameEnvelope;
  const data = envelope.data;

  if (
    !Array.isArray(data) ||
    data.length === 0 ||
    typeof data[0] !== 'object' ||
    data[0] === null ||
    Array.isArray(data[0])
  ) {
    return undefined;
  }

  const updateType = resolveOkxOrderbookUpdateType(envelope);

  return normalizeOkxOrderBookUpdate(data[0] as OkxOrderBookWebSocketDataRaw, {
    symbol,
    updateType,
    receivedTimestamp,
    contractValue,
  });
}

export function normalizeOkxPublicTradeList(rawList: OkxPublicTradeRaw[], contractValue: string): PublicTrade[] {
  return rawList.flatMap((raw) => {
    const symbol = takeOkxSymbol(raw.instId);

    if (symbol === null) {
      return [];
    }

    const price = parseOkxNumber(raw.px);
    const quantity = convertContractsToCoins(raw.sz, contractValue);

    const trade: PublicTrade = {
      id: raw.tradeId,
      symbol,
      price,
      quantity,
      quoteQuantity: price * quantity,
      timestamp: parseOkxNumber(raw.ts),
      isBuyerMaker: raw.side === 'sell',
    };

    const mappedSide = OKX_ORDER_SIDE[raw.side];

    if (mappedSide !== undefined) {
      trade.side = mappedSide;
    }

    return trade;
  });
}

/**
 * OKX names its OWN nearest-settlement field `fundingTime` and the settlement AFTER that
 * `nextFundingTime`. The unified `MarkPrice.nextFundingTime` means "next settlement from now",
 * which on OKX is `funding.fundingTime` — NOT `funding.nextFundingTime`.
 *
 * Индексная цена приходит ТРЕТЬИМ ответом — своей ручкой (`/api/v5/market/index-tickers`), потому
 * что ответ цены маркировки её не несёт вовсе, а у обеих соседних бирж это поле заполнено.
 * Обозначение индекса — контракт без хвоста `-SWAP` (`BTC-USDT-SWAP` → индекс `BTC-USDT`, он же
 * `uly` инструмента). Индекса нет в ответе — поле остаётся ПУСТЫМ, а не нулём: поддельный ноль
 * молча отключал бы у потребителя составляющую `Max(Индекс, …)` в расчёте границы цены.
 */
function buildOkxIndexPriceByInstId(indexList: OkxIndexTickerRaw[]): Map<string, number> {
  const indexPriceByInstId = new Map<string, number>();

  for (const index of indexList) {
    if (isOkxPositiveFiniteNumberString(index.idxPx)) {
      indexPriceByInstId.set(index.instId, parseOkxNumber(index.idxPx));
    }
  }

  return indexPriceByInstId;
}

export function normalizeOkxMarkPriceList(
  markList: OkxMarkPriceRaw[],
  fundingList: OkxFundingRateRaw[],
  indexList: OkxIndexTickerRaw[] = [],
): MarkPrice[] {
  const fundingByInstId = new Map<string, OkxFundingRateRaw>();

  for (const funding of fundingList) {
    fundingByInstId.set(funding.instId, funding);
  }

  const indexPriceByInstId = buildOkxIndexPriceByInstId(indexList);

  return markList.flatMap((mark) => {
    const symbol = takeOkxSymbol(mark.instId);

    if (symbol === null) {
      return [];
    }

    const funding = fundingByInstId.get(mark.instId);
    const indexPrice = indexPriceByInstId.get(toOkxIndexInstId(mark.instId));

    const result: MarkPrice = {
      symbol,
      markPrice: parseOkxNumber(mark.markPx),
      lastFundingRate: funding !== undefined ? parseOkxNumber(funding.fundingRate) : 0,
      nextFundingTime: funding !== undefined ? parseOkxNumber(funding.fundingTime) : 0,
      timestamp: parseOkxNumber(mark.ts),
    };

    if (indexPrice !== undefined) {
      result.indexPrice = indexPrice;
    }

    return result;
  });
}

export function toOkxIndexInstId(instId: string): string {
  return instId.endsWith(OKX_SWAP_INST_ID_SUFFIX) ? instId.slice(0, -OKX_SWAP_INST_ID_SUFFIX.length) : instId;
}

export function normalizeOkxMarkPriceWebSocketList(rawList: OkxMarkPriceRaw[]): MarkPriceUpdate[] {
  return rawList.flatMap((raw) => {
    const symbol = takeOkxSymbol(raw.instId);

    if (symbol === null) {
      return [];
    }

    return { symbol, markPrice: parseOkxNumber(raw.markPx), timestamp: parseOkxNumber(raw.ts) };
  });
}

export function normalizeOkxOpenInterest(raw: OkxOpenInterestRaw): OpenInterest {
  return {
    symbol: resolveOkxSymbol(raw.instId),
    openInterest: parseOkxNumber(raw.oiCcy),
    timestamp: parseOkxNumber(raw.ts),
  };
}

export function normalizeOkxFundingRateHistoryList(rawList: OkxFundingRateHistoryRaw[]): FundingRateHistory[] {
  return rawList
    .flatMap((raw) => {
      const symbol = takeOkxSymbol(raw.instId);

      if (symbol === null) {
        return [];
      }

      return {
        symbol,
        fundingRate: parseOkxNumber(raw.realizedRate !== '' ? raw.realizedRate : raw.fundingRate),
        fundingTime: parseOkxNumber(raw.fundingTime),
        markPrice: null,
      };
    })
    .sort((left, right) => left.fundingTime - right.fundingTime);
}

export function normalizeOkxFundingInfoList(rawList: OkxFundingRateRaw[]): FundingInfo[] {
  return rawList.flatMap((raw) => {
    const symbol = takeOkxSymbol(raw.instId);

    if (symbol === null) {
      return [];
    }

    const fundingTime = parseOkxNumber(raw.fundingTime);
    const nextFundingTime = parseOkxNumber(raw.nextFundingTime);
    const intervalMs = nextFundingTime - fundingTime;

    const fundingIntervalHours = intervalMs > 0 ? Math.round((intervalMs / 3600000) * 100) / 100 : 0;

    return {
      symbol,
      fundingIntervalHours,
      adjustedFundingRateCap: parseOkxNumber(raw.maxFundingRate),
      adjustedFundingRateFloor: parseOkxNumber(raw.minFundingRate),
    };
  });
}

function normalizeOkxFeeRateSign(value: string): number {
  const parsedValue = -parseOkxNumber(value);

  return parsedValue === 0 ? 0 : parsedValue;
}

function isOkxFeeRateValueUsable(value: string): boolean {
  return value !== '' && Number.isFinite(parseFloat(value));
}

interface OkxFeeRateSource {
  maker: string;
  taker: string;
  /** Ставка взята из верхнеуровневых полей ответа — устаревших, привязанных не к группе. */
  isFromOutdatedField: boolean;
}

function selectOkxFeeRateSource(raw: OkxFeeRateRaw, args: NormalizeOkxFeeRateArgs): OkxFeeRateSource {
  const { groupId, settle, isSwap } = args;

  // Пустое обозначение группы — это «группы нет», а не «группа с пустым именем»: с ним поиск
  // ничего не находил, а разумный запасной путь «в ответе ровно одна группа — берём её» лежал в
  // другой ветке и пропускался. У спота из примера биржи верхнеуровневые поля как раз пустые,
  // поэтому получался отказ там, где ответ содержал единственную подходящую группу.
  if (groupId !== undefined && groupId !== '') {
    const feeGroupEntry = raw.feeGroup?.find((group) => group.groupId === groupId);

    if (feeGroupEntry !== undefined) {
      return { maker: feeGroupEntry.maker, taker: feeGroupEntry.taker, isFromOutdatedField: false };
    }
  } else if (raw.feeGroup !== undefined && raw.feeGroup.length === 1) {
    const [soleFeeGroupEntry] = raw.feeGroup;

    return { maker: soleFeeGroupEntry.maker, taker: soleFeeGroupEntry.taker, isFromOutdatedField: false };
  }

  if (isSwap && settle === 'USDC') {
    return { maker: raw.makerUSDC ?? '', taker: raw.takerUSDC ?? '', isFromOutdatedField: true };
  }

  if (isSwap) {
    return { maker: raw.makerU ?? '', taker: raw.takerU ?? '', isFromOutdatedField: true };
  }

  return { maker: raw.maker, taker: raw.taker, isFromOutdatedField: true };
}

/**
 * Ставку комиссии несёт группа инструмента; верхнеуровневые поля ответа биржа держит для старых
 * потребителей и по группам не разделяет. Уход на них — не ошибка, но и не факт про ЭТОТ
 * инструмент, поэтому признак возвращается наружу: нормализатор — чистая функция без журнала,
 * предупредить может только клиент. Признак идёт отдельным полем обёртки, `FeeRate` не меняется.
 */
export function normalizeOkxFeeRate(raw: OkxFeeRateRaw, args: NormalizeOkxFeeRateArgs): OkxFeeRateOutcome {
  const { symbol } = args;
  const { maker, taker, isFromOutdatedField } = selectOkxFeeRateSource(raw, args);

  if (!isOkxFeeRateValueUsable(maker) || !isOkxFeeRateValueUsable(taker)) {
    throw new ExchangeError(`OKX fee rate for ${symbol} is unavailable in the response`, 'OKX_FEE_RATE_UNAVAILABLE', 'OKX');
  }

  return {
    feeRate: {
      symbol,
      makerRate: normalizeOkxFeeRateSign(maker),
      takerRate: normalizeOkxFeeRateSign(taker),
    },
    isFromOutdatedField,
  };
}

function resolveOkxPositionDirection(posSide: string, posValue: number): 'long' | 'short' | null {
  if (posSide === 'long') {
    return 'long';
  }

  if (posSide === 'short') {
    return 'short';
  }

  if (posValue > 0) {
    return 'long';
  }

  if (posValue < 0) {
    return 'short';
  }

  return null;
}

export function normalizeOkxPosition(raw: OkxPositionRaw, contractValue: string): Position {
  const posValue = parseOkxNumber(raw.pos);
  const unsignedPos = (raw.pos ?? '').replace('-', '');

  return {
    symbol: resolveOkxSymbol(raw.instId),
    side: OKX_POSITION_SIDE[raw.posSide] ?? PositionSideEnum.Both,
    direction: resolveOkxPositionDirection(raw.posSide, posValue),
    contracts: convertContractsToCoins(unsignedPos, contractValue),
    entryPrice: parseOkxNumber(raw.avgPx),
    markPrice: parseOkxNumber(raw.markPx),
    unrealizedPnl: parseOkxNumber(raw.upl),
    leverage: parseOkxNumber(raw.lever),
    marginMode: raw.mgnMode === 'isolated' ? MarginModeEnum.Isolated : MarginModeEnum.Cross,
    liquidationPrice: parseOkxNumber(raw.liqPx),
    positionIdx: OKX_POSITION_IDX[raw.posSide] ?? 0,
    info: raw,
  };
}

interface ResolveOkxOrderAmountArgs {
  sz: string;
  accFillSz: string;
  tgtCcy: string;
  contractValue: string;
}

/**
 * Спотовая рыночная покупка в котируемой валюте (`tgtCcy 'quote_ccy'`) выражает `sz` в quote,
 * не в base — единственное честное количество там `accFillSz`, которое OKX всегда отдаёт в base.
 * Общий для обычной заявки (`normalizeOkxOrder`, `buildOkxOrderUpdateEvent`, где `accFillSz`
 * приходит от биржи как есть) и условной (`normalizeOkxAlgoOrder`, `buildOkxAlgoOrderUpdateEvent`,
 * где вызывающий передаёт в `accFillSz` значение `actualSz` только при `state 'effective'` —
 * до срабатывания количество монет неизвестно).
 */
function resolveOkxOrderAmount(args: ResolveOkxOrderAmountArgs): number {
  const { sz, accFillSz, tgtCcy, contractValue } = args;

  if (tgtCcy === 'quote_ccy') {
    const quoteFillAmount = convertContractsToCoins(accFillSz, contractValue);

    return quoteFillAmount > 0 ? quoteFillAmount : 0;
  }

  return convertContractsToCoins(sz, contractValue);
}

/**
 * Цена срабатывания ПРИКРЕПЛЁННОЙ защиты обычной заявки. Библиотека свою защиту ставит отдельной
 * условной службой, поэтому у СВОИХ заявок эти поля пусты; но заявку с прикреплённой защитой могли
 * поставить не библиотекой (приложение биржи, другой процесс), и такая заявка читалась как заявка
 * БЕЗ защиты — ноль в `stopPrice` вместо реальной цены. Нога защиты от убытка важнее ноги прибыли,
 * поэтому при обеих заполненных берётся она — так же выбирает и чтение условной заявки.
 */
function resolveOkxAttachedTriggerPrice(raw: OkxOrderRaw): number {
  if (raw.slTriggerPx !== '') {
    return parseOkxNumber(raw.slTriggerPx);
  }

  return parseOkxNumber(raw.tpTriggerPx);
}

export function normalizeOkxOrder(raw: OkxOrderRaw, contractValue: string): Order {
  const avgPrice = parseOkxNumber(raw.avgPx);
  const filledAmount = convertContractsToCoins(raw.accFillSz, contractValue);
  const updatedTimestamp = raw.uTime !== '' ? parseOkxNumber(raw.uTime) : parseOkxNumber(raw.cTime);

  return {
    id: raw.ordId,
    clientOrderId: raw.clOrdId,
    symbol: resolveOkxSymbol(raw.instId),
    side: OKX_ORDER_SIDE[raw.side] ?? OrderSideEnum.Buy,
    type: OKX_ORD_TYPE_TO_ORDER_TYPE[raw.ordType] ?? OrderTypeEnum.Limit,
    timeInForce: OKX_ORD_TYPE_TO_TIME_IN_FORCE[raw.ordType] ?? TimeInForceEnum.Gtc,
    price: parseOkxNumber(raw.px),
    avgPrice,
    stopPrice: resolveOkxAttachedTriggerPrice(raw),
    amount: resolveOkxOrderAmount({ sz: raw.sz, accFillSz: raw.accFillSz, tgtCcy: raw.tgtCcy, contractValue }),
    filledAmount,
    filledQuoteAmount: filledAmount * avgPrice,
    status: OKX_ORDER_STATUS[raw.state] ?? raw.state,
    reduceOnly: raw.reduceOnly === 'true',
    timestamp: parseOkxNumber(raw.cTime),
    updatedTimestamp,
    isConditional: false,
  };
}

interface OkxAlgoOrderTypeAndPrice {
  type: OrderTypeEnum;
  price: number;
  stopPrice: number;
}

/**
 * НА КАКОЙ НОГЕ живёт условная заявка. Единственная точка, где этот выбор делается: по ней и
 * читают заявку наружу (`resolveOkxAlgoOrderTypeAndPrice`), и правят её на бирже
 * (`OkxBaseClient.amendOkxConditionalOrder`). Пока выбор был сделан в двух местах и в разном
 * порядке, чтение показывало ногу защиты, а правка уезжала в ногу прибыли: подтягиваешь стоп с
 * 60 000 до 62 000 — на бирже переезжает взятие прибыли, а защита остаётся на месте.
 *
 * Порядок выбора:
 * 1. `move_order_stop` — скользящий стоп, ног у него нет вовсе;
 * 2. фактически сработавшая нога (`actualSide`, «tp: take profit, sl: stop loss») — она известна
 *    только у сработавшей заявки «одна отменяет другую» и точнее любой догадки по заполненности;
 * 3. нога защиты (`sl*`), если заполнена, — у заявки с обеими ногами наружу отдаётся именно она:
 *    для управления риском она важнее, а `Order` несёт только одну пару «тип + цена + триггер»;
 * 4. нога прибыли (`tp*`);
 * 5. общая пара `triggerPx`/`ordPx` — заявка вида `trigger`, поставленная не этой библиотекой.
 */
export function resolveOkxAlgoTriggerLeg(raw: OkxAlgoOrderRaw): OkxAlgoTriggerLeg {
  if (raw.ordType === OKX_ALGO_TRAILING_ORD_TYPE) {
    return 'trailing';
  }

  if (raw.actualSide === 'tp' && raw.tpTriggerPx !== '') {
    return 'takeProfit';
  }

  if (raw.actualSide === 'sl' && raw.slTriggerPx !== '') {
    return 'stopLoss';
  }

  if (raw.slTriggerPx !== '') {
    return 'stopLoss';
  }

  if (raw.tpTriggerPx !== '') {
    return 'takeProfit';
  }

  return 'generic';
}

/**
 * Условная заявка OKX не несёт единого поля «тип+цена» — оно складывается из того, какая нога
 * выбрана (`resolveOkxAlgoTriggerLeg`). Используется и полной нормализацией
 * (`normalizeOkxAlgoOrder`), и событием приватного канала (`buildOkxAlgoOrderUpdateEvent`).
 */
function resolveOkxAlgoOrderTypeAndPrice(raw: OkxAlgoOrderRaw): OkxAlgoOrderTypeAndPrice {
  const leg = resolveOkxAlgoTriggerLeg(raw);

  if (leg === 'trailing') {
    return { type: OrderTypeEnum.TrailingStop, price: 0, stopPrice: parseOkxNumber(raw.moveTriggerPx) };
  }

  if (leg === 'stopLoss') {
    const isMarket = raw.slOrdPx === OKX_MARKET_ORDER_PRICE;

    return {
      type: isMarket ? OrderTypeEnum.StopMarket : OrderTypeEnum.StopLimit,
      price: isMarket ? 0 : parseOkxNumber(raw.slOrdPx),
      stopPrice: parseOkxNumber(raw.slTriggerPx),
    };
  }

  if (leg === 'takeProfit') {
    const isMarket = raw.tpOrdPx === OKX_MARKET_ORDER_PRICE;

    return {
      type: isMarket ? OrderTypeEnum.TakeProfitMarket : OrderTypeEnum.TakeProfitLimit,
      price: isMarket ? 0 : parseOkxNumber(raw.tpOrdPx),
      stopPrice: parseOkxNumber(raw.tpTriggerPx),
    };
  }

  const isMarket = raw.ordPx === OKX_MARKET_ORDER_PRICE;

  return {
    type: isMarket ? OrderTypeEnum.StopMarket : OrderTypeEnum.StopLimit,
    price: isMarket ? 0 : parseOkxNumber(raw.ordPx),
    stopPrice: parseOkxNumber(raw.triggerPx),
  };
}

function resolveOkxAlgoTriggeredOrderId(raw: OkxAlgoOrderRaw): string | undefined {
  const candidate = raw.ordIdList?.[0] ?? raw.ordId ?? '';

  return candidate !== '' ? candidate : undefined;
}

/**
 * Количество монет условной заявки в котируемой валюте (`tgtCcy 'quote_ccy'`) известно ТОЛЬКО
 * после срабатывания — до `state 'effective'` OKX не публикует, сколько монет купится на
 * заданную сумму. `actualSz` — единственное честное поле, и оно валидно лишь при этом статусе.
 */
function resolveOkxAlgoQuoteFillSource(raw: OkxAlgoOrderRaw): string {
  return raw.state === 'effective' ? raw.actualSz : '';
}

/**
 * Исполнение условной заявки НЕ берётся из её собственных полей: `actualPx`/`actualSz` — это
 * цена и объём ПОРОЖДЁННОЙ заявки («Actual order price» / «Actual order quantity»), а не её
 * исполнение, и у рыночного срабатывания цена приходит пустой. Средняя цена и заполненный объём
 * дочитываются из порождённой заявки (`mergeOkxTriggeredOrder` в `getOrder`); до этого они нули.
 */
export function normalizeOkxAlgoOrder(raw: OkxAlgoOrderRaw, contractValue: string): Order {
  const { type, price, stopPrice } = resolveOkxAlgoOrderTypeAndPrice(raw);
  const triggeredOrderId = resolveOkxAlgoTriggeredOrderId(raw);

  const order: Order = {
    id: raw.algoId,
    clientOrderId: raw.algoClOrdId,
    symbol: resolveOkxSymbol(raw.instId),
    side: OKX_ORDER_SIDE[raw.side] ?? OrderSideEnum.Buy,
    type,
    timeInForce: TimeInForceEnum.Gtc,
    price,
    avgPrice: 0,
    stopPrice,
    amount: resolveOkxOrderAmount({ sz: raw.sz, accFillSz: resolveOkxAlgoQuoteFillSource(raw), tgtCcy: raw.tgtCcy, contractValue }),
    filledAmount: 0,
    filledQuoteAmount: 0,
    status: OKX_ALGO_STATUS[raw.state] ?? raw.state,
    reduceOnly: raw.reduceOnly === 'true',
    timestamp: parseOkxNumber(raw.cTime),
    updatedTimestamp: parseOkxNumber(raw.uTime),
    isConditional: true,
    closePosition: raw.closeFraction === '1',
  };

  if (triggeredOrderId !== undefined) {
    order.triggeredOrderId = triggeredOrderId;
  }

  return order;
}

export function mergeOkxTriggeredOrder(conditionalOrder: Order, triggeredRaw: OkxOrderRaw, contractValue: string): Order {
  const avgPrice = parseOkxNumber(triggeredRaw.avgPx);
  const filledAmount = convertContractsToCoins(triggeredRaw.accFillSz, contractValue);

  return {
    ...conditionalOrder,
    avgPrice,
    filledAmount,
    filledQuoteAmount: filledAmount * avgPrice,
    status: OKX_ORDER_STATUS[triggeredRaw.state] ?? conditionalOrder.status,
  };
}

const OKX_MISSING_BATCH_ENTRY_ERROR_TEXT = 'OKX returned no result for this batch entry';

/**
 * `amount` — размер, который РЕАЛЬНО ушёл на биржу, в монетах, а не тот, о котором просили.
 * У бессрочного контракта биржа принимает только целое число контрактов, поэтому просьба о
 * 0.0157 монеты уходит как один контракт (0.01 монеты); заявка, докладывающая о 0.0157, врала бы
 * вызывающему на треть объёма, и узнать правду ему было бы неоткуда.
 */
export function buildOkxOrderFromCreateResponse(args: CreateOrderWebSocketArgs, orderId: string, amount: number): Order {
  return {
    id: orderId,
    clientOrderId: args.clientOrderId ?? '',
    symbol: args.symbol,
    side: args.side,
    type: args.type,
    timeInForce: args.timeInForce ?? TimeInForceEnum.Gtc,
    price: args.price ?? 0,
    avgPrice: 0,
    stopPrice: args.stopPrice ?? 0,
    amount,
    filledAmount: 0,
    filledQuoteAmount: 0,
    status: 'open',
    reduceOnly: args.reduceOnly ?? false,
    timestamp: Date.now(),
    updatedTimestamp: Date.now(),
    isConditional: isConditionalOrderType(args.type),
  };
}

export function buildOkxCreateOutcome(
  args: CreateOrderWebSocketArgs,
  item: OkxOrderResultRaw | undefined,
  amount: number,
): CreateOrderItemResult {
  if (item === undefined) {
    return buildRejectedOrderOutcome(null, OKX_MISSING_BATCH_ENTRY_ERROR_TEXT);
  }

  if (item.sCode !== '0') {
    const parsedErrorCode = Number(item.sCode);

    return buildRejectedOrderOutcome(Number.isFinite(parsedErrorCode) ? parsedErrorCode : null, item.sMsg);
  }

  return buildPlacedOrderOutcome(buildOkxOrderFromCreateResponse(args, item.ordId, amount));
}

/**
 * Исход одной записи пакетной отмены или правки. OKX кладёт его в `sCode`/`sMsg` каждой записи
 * ответа, и делает это одинаково для обычных заявок и условных — поэтому сборка одна на обе
 * службы и на оба пути (канал связи и обычный запрос). Отсутствие записи — отказ, а не успех:
 * молчание биржи о заявке нельзя читать как «снята».
 */
export function buildOkxBatchItemResult(orderId: string, item: OkxBatchOutcomeRaw | undefined): ModifyOrderItemResult {
  if (item === undefined) {
    return {
      orderId,
      isSuccess: false,
      errorCode: null,
      errorText: OKX_MISSING_BATCH_ENTRY_ERROR_TEXT,
    };
  }

  const isSuccess = item.sCode === '0';
  const parsedErrorCode = Number(item.sCode);
  const errorCode = Number.isFinite(parsedErrorCode) ? parsedErrorCode : null;

  return {
    orderId,
    isSuccess,
    errorCode: isSuccess ? null : errorCode,
    errorText: isSuccess ? null : item.sMsg,
  };
}

function isOkxFiniteNumberString(value: string): boolean {
  return value !== '' && Number.isFinite(parseFloat(value));
}

/**
 * Курс монеты к доллару, как его даёт сама биржа: долларовая оценка остатка, делённая на остаток
 * (`eqUsd / eq`, у биржи это `coinUsdPrice` потока счёта). `null` — делить не на что.
 */
function resolveOkxCoinUsdRate(detail: OkxBalanceDetailRaw): number | null {
  const equity = parseFloat(detail.eq);
  const equityUsd = parseFloat(detail.eqUsd);

  if (!Number.isFinite(equity) || equity <= 0 || !Number.isFinite(equityUsd)) {
    return null;
  }

  return equityUsd / equity;
}

/**
 * Маржа ПОЗИЦИЙ монеты. Начальная маржа монеты (`imr`) уже включает маржу висящих заявок
 * (`ordFrozen`) — живая сверка на демо-счёте 09.09.2026: одна лимитная заявка без единой открытой
 * позиции дала `imr` и `ordFrozen` одним и тем же числом (132.0266), а свободный остаток монеты
 * упал ровно на него, один раз. Пока весь `imr` записывался в маржу позиции, а `ordFrozen` — ещё
 * и отдельной строкой, счёт видел занятыми 264 доллара вместо 132 и на столько же занижал
 * свободные: заявка вычиталась дважды.
 *
 * Разность зажата снизу нулём: отрицательная означала бы, что заявки заняли больше, чем вся
 * начальная маржа монеты, — это след вычитания, а не факт биржи.
 */
function resolveOkxPositionInitialMargin(detail: OkxBalanceDetailRaw): number {
  const initialMargin = parseOkxNumber(detail.imr);
  const orderMargin = detail.ordFrozen === '' ? 0 : parseOkxNumber(detail.ordFrozen);
  const positionMargin = initialMargin - orderMargin;

  return positionMargin > 0 ? positionMargin : 0;
}

/**
 * Свободные средства счёта В ДОЛЛАРАХ, собранные из готового числа биржи по каждой монете
 * (`availBal`, «Available balance of currency») её же курсом. Это не наш расчёт, а сумма
 * биржевых величин: маржа заявок и позиций из неё вычтена самой биржей и ровно один раз.
 *
 * `null` — если у монеты с ненулевым свободным остатком нет курса: сложить остатки разных монет
 * без пересчёта нельзя (биткойн иначе весит как доллар).
 */
function sumOkxAvailableUsdValue(detailList: OkxBalanceDetailRaw[]): number | null {
  let sum: number | null = null;

  for (const detail of detailList) {
    if (!isOkxFiniteNumberString(detail.availBal)) {
      continue;
    }

    const available = parseFloat(detail.availBal);

    if (available === 0) {
      sum = sum ?? 0;

      continue;
    }

    const usdRate = resolveOkxCoinUsdRate(detail);

    if (usdRate === null) {
      return null;
    }

    sum = (sum ?? 0) + available * usdRate;
  }

  return sum;
}

/**
 * Занятая маржа счёта В ДОЛЛАРАХ, выведенная по каждой монете отдельно (её собственная маржа
 * переведена в доллары её же курсом). `null` — если у монеты с ненулевым остатком нет курса
 * (`usdValue`) или не с чем делить (остаток ≤ 0): досчитать нечем, отдавать оценку опасно.
 *
 * Слагаемое монеты — маржа позиций плюс маржа заявок, то есть ровно `imr` монеты: маржа заявок
 * из него уже вычленена (`resolveOkxPositionInitialMargin`), поэтому сверху она НЕ прибавляется.
 */
function sumOkxMarginUsdValue(balanceByAsset: BalanceByAsset): number | null {
  let sum = 0;

  for (const balance of balanceByAsset.values()) {
    if (balance.total === 0) {
      continue;
    }

    if (balance.usdValue === undefined || balance.total <= 0) {
      return null;
    }

    const margin = (balance.totalPositionInitialMargin ?? 0) + (balance.totalOrderInitialMargin ?? 0);

    sum += (margin * balance.usdValue) / balance.total;
  }

  return sum;
}

/**
 * Нижняя граница для ВЫВЕДЕННЫХ нами свободных средств: отрицательная разность — след вычитания,
 * а не факт биржи (отрицательных свободных биржа не называет никогда). Верхней границы здесь нет
 * и быть не должно: свободные средства СЧИТАЮТСЯ ОТ КАПИТАЛА, в который входит плавающая
 * прибыль, а `totalWalletBalance` во всей библиотеке — остаток БЕЗ неё. Позиция в плюсе законно
 * даёт свободных больше, чем в кошельке, и подрезать это нельзя.
 */
function floorOkxDerivedBalance(value: number): number {
  return value > 0 ? value : 0;
}

interface OkxAvailableBalance {
  totalAvailableBalance: number;
  availableBalanceSource: NonNullable<AccountBalances['availableBalanceSource']>;
}

/**
 * Число, которое биржа ПРЯМО назвала свободными (`availEq`), отдаётся как есть — ни подрезки, ни
 * поправки. Прежде оно урезалось до остатка кошелька и при этом называлось фактом биржи: счёт с
 * плавающей прибылью 600 показывал 55 237 вместо названных биржей 55 415, и отличить факт от
 * поправки было нечем — ровно тот обман, ради борьбы с которым поле «откуда взялись свободные» и
 * заводилось. Binance на том же месте отдаёт своё `availableBalance` как есть.
 */
function resolveOkxAvailableBalance(raw: OkxBalanceRaw, marginUsd: number | null, totalMarginBalance: number): OkxAvailableBalance {
  if (isOkxFiniteNumberString(raw.availEq)) {
    return { totalAvailableBalance: parseFloat(raw.availEq), availableBalanceSource: 'exchange' };
  }

  if (isOkxFiniteNumberString(raw.adjEq) && isOkxFiniteNumberString(raw.imr)) {
    const derived = parseFloat(raw.adjEq) - parseFloat(raw.imr);

    return { totalAvailableBalance: floorOkxDerivedBalance(derived), availableBalanceSource: 'derived' };
  }

  // Дальше идёт расчётный путь по монетам, и первым — сумма готовых биржевых `availBal`. Он
  // предпочтён вычитанию «капитал минус занятая маржа» потому, что вообще не опирается на нашу
  // арифметику марж: сколько заняли заявки и позиции, биржа посчитала сама и вычла ровно один раз.
  const availableUsd = sumOkxAvailableUsdValue(raw.details ?? []);

  if (availableUsd !== null) {
    return { totalAvailableBalance: availableUsd, availableBalanceSource: 'derived' };
  }

  // Запасной путь на случай, когда свободный остаток монеты пересчитать нечем, а её маржу — есть.
  // Вычитается из КАПИТАЛА, а не из кошелька. Кошелёк плавающего убытка не содержит, поэтому
  // «кошелёк минус занятая маржа» на позиции в минусе называл свободными деньги, которых на
  // счёте уже нет: убыток на 320 давал ровно на 320 больше свободных, чем весь капитал счёта.
  if (marginUsd !== null) {
    return {
      totalAvailableBalance: floorOkxDerivedBalance(totalMarginBalance - marginUsd),
      availableBalanceSource: 'derived',
    };
  }

  return { totalAvailableBalance: 0, availableBalanceSource: 'unknown' };
}

/**
 * Нереализованный итог счёта в долларах, собранный ПО МОНЕТАМ. Поле монеты `upl` — «The sum of
 * the unrealized profit & loss of all margin and derivatives positions of currency. Applicable to
 * Futures mode / Multi-currency margin / Portfolio margin»: оно есть в каждом режиме счёта, где
 * бессрочные контракты вообще торгуются (в оставшемся режиме «Spot mode» биржа допускает только
 * «SPOT and OPTION buyer»), и считает ОБЕ маржи — общую и изолированную. В доллары переводится
 * курсом самой монеты: `eqUsd / eq` (у биржи это `coinUsdPrice` потока счёта).
 *
 * `null` — если у монеты с ненулевым итогом нет пригодного курса: досчитать нечем.
 */
function sumOkxCoinUnrealizedUsdValue(detailList: OkxBalanceDetailRaw[]): number | null {
  let sum: number | null = null;

  for (const detail of detailList) {
    if (!isOkxFiniteNumberString(detail.upl)) {
      continue;
    }

    const unrealized = parseFloat(detail.upl);

    if (unrealized === 0) {
      sum = sum ?? 0;

      continue;
    }

    const usdRate = resolveOkxCoinUsdRate(detail);

    if (usdRate === null) {
      return null;
    }

    sum = (sum ?? 0) + unrealized * usdRate;
  }

  return sum;
}

/**
 * Нереализованный итог счёта в долларах. Нужен, чтобы отделить денежный остаток кошелька от
 * капитала счёта: биржа отдаёт только капитал (`totalEq`, «Total account assets denominated in
 * USD»), а `AccountBalances.totalWalletBalance` во всей библиотеке означает остаток БЕЗ плавающей
 * прибыли и убытка — так его заполняет Binance. Без вычитания правило риска «остановить торговлю,
 * если кошелёк за сутки просел на 5%» срабатывало бы у OKX от ЖИВОГО убытка по открытой позиции,
 * а у Binance на том же месте молчало.
 *
 * Считается по монетам, а не по сводному полю `upl`: сводное — «Unrealized PnL across all open
 * CROSS-MARGIN positions at the account level, in USD… Returns empty string in Simple mode and
 * Single-currency margin mode», то есть в двух режимах счёта из четырёх его нет вовсе (и тогда
 * вычитать было нечего — кошелёк молча становился капиталом), а изолированные позиции не входят
 * в него никогда. Сводное поле остаётся запасным путём, если по монетам досчитать нечем.
 */
function resolveOkxAccountUnrealizedPnl(raw: OkxBalanceRaw): number {
  const coinUnrealizedUsd = sumOkxCoinUnrealizedUsdValue(raw.details ?? []);

  if (coinUnrealizedUsd !== null) {
    return coinUnrealizedUsd;
  }

  return isOkxFiniteNumberString(raw.upl) ? parseFloat(raw.upl) : 0;
}

/**
 * `accountLevel` — режим счёта (`acctLv` из `/api/v5/account/config`): `1` спотовый, `2` фьючерсный,
 * `3` мультивалютная маржа, `4` портфельная. В самом ответе баланса его нет, поэтому он приходит
 * доводом от клиента; без него подпись режима не выдумывается, а просто отсутствует.
 */
export function normalizeOkxBalances(raw: OkxBalanceRaw, accountLevel?: string): AccountBalances {
  const balanceByAsset = new Map<string, Balance>();

  for (const detail of raw.details ?? []) {
    const totalRaw = parseFloat(detail.eq);
    const freeRaw = parseFloat(detail.availBal);
    const lockedRaw = parseFloat(detail.frozenBal);

    if (!Number.isFinite(totalRaw) || !Number.isFinite(freeRaw) || !Number.isFinite(lockedRaw)) {
      continue;
    }

    if (freeRaw + lockedRaw === 0 && totalRaw === 0) {
      continue;
    }

    const balance: Balance = { asset: detail.ccy, free: freeRaw, locked: lockedRaw, total: totalRaw };

    if (detail.cashBal !== '') {
      balance.walletBalance = parseOkxNumber(detail.cashBal);
    }

    if (detail.ordFrozen !== '') {
      balance.totalOrderInitialMargin = parseOkxNumber(detail.ordFrozen);
    }

    if (detail.imr !== '') {
      balance.totalPositionInitialMargin = resolveOkxPositionInitialMargin(detail);
    }

    if (detail.eqUsd !== '') {
      balance.usdValue = parseOkxNumber(detail.eqUsd);
    }

    balanceByAsset.set(detail.ccy, balance);
  }

  const totalMarginBalance = parseOkxNumber(raw.totalEq);
  const totalWalletBalance = totalMarginBalance - resolveOkxAccountUnrealizedPnl(raw);
  const marginUsd = sumOkxMarginUsdValue(balanceByAsset);
  const { totalAvailableBalance, availableBalanceSource } = resolveOkxAvailableBalance(raw, marginUsd, totalMarginBalance);

  const result: AccountBalances = {
    totalWalletBalance,
    totalAvailableBalance,
    balanceByAsset,
    totalMarginBalance,
    availableBalanceSource,
  };

  if (accountLevel !== undefined && accountLevel !== '') {
    result.accountType = `acctLv:${accountLevel}`;
  }

  const totalInitialMargin = isOkxFiniteNumberString(raw.imr) ? parseFloat(raw.imr) : marginUsd;

  if (totalInitialMargin !== null) {
    result.totalInitialMargin = totalInitialMargin;
  }

  return result;
}

/**
 * Множитель контракта для ОТЧЁТНЫХ путей (журнал начислений, итоги закрытых позиций). Молча
 * выдать контракты под видом монет нельзя, но и ронять ВЕСЬ ответ из-за одной строки — тоже:
 * биржа снятый с торгов инструмент в списке не отдаёт («When a product is going to be delisted…,
 * the instrument will not be available»), а история — как раз то место, где такие инструменты
 * неизбежны. Прежде одна такая строка уносила с собой сотни правильных: за три месяца торговли
 * инструментом, который биржа с тех пор сняла, `fetchIncome` и `fetchClosedPnl` не возвращали
 * НИЧЕГО. У Binance и Bybit эти два метода метаданных инструмента не требуют вовсе.
 *
 * Поэтому здесь `null` — «строку пропустить», и о пропуске говорится вслух: номер строки и
 * обозначение инструмента.
 */
function takeOkxRowContractValue(args: TakeOkxRowContractValueArgs): string | null {
  const { contractValueBySymbol, symbol, instId, instType, index, methodName, logger } = args;
  const contractValue = contractValueBySymbol.get(symbol);

  if (contractValue !== undefined) {
    return contractValue;
  }

  if (instType !== 'SWAP') {
    return '';
  }

  logger?.warn(`[OKX] ${methodName}: entry ${index} on ${instId} is not in the loaded instrument map — skipping it`);

  return null;
}

interface BuildOkxBillIncomeArgs {
  raw: OkxBillRaw;
  contractValue: string;
  incomeType: string;
  kind: IncomeKind;
  income: number;
}

function buildOkxBillIncome(args: BuildOkxBillIncomeArgs): Income {
  const { raw, contractValue, incomeType, income, kind } = args;

  const result: Income = {
    symbol: resolveOkxSymbol(raw.instId),
    incomeType,
    kind,
    income,
    asset: raw.ccy,
    timestamp: parseOkxNumber(raw.ts),
    info: { billId: raw.billId, ordId: raw.ordId, tradeId: raw.tradeId, subType: raw.subType, execType: raw.execType },
  };

  if (raw.sz !== '') {
    result.quantity = convertContractsToCoins(raw.sz, contractValue);
  }

  return result;
}

/**
 * Документация OKX (раздел журнала счёта): «Funding Fee expense (subType = 173) — You may refer
 * to "pnl" for the fee payment» — денежный поток списания фандинга лежит в `pnl`, не в `balChg`.
 * Для начисления (`subType 174`) документация поле явно не называет; по аналогии со списанием
 * тоже берём `pnl`, если он ненулевой (Гипотеза: подтвердить живой записью с демо-счёта).
 * Для всех остальных типов записи журнала (сделки и т.д.) сумма — по-прежнему `balChg`.
 */
function resolveOkxBillAmount(raw: OkxBillRaw): number {
  if (raw.type === OKX_FUNDING_BILL_TYPE) {
    const pnl = parseOkxNumber(raw.pnl);

    return pnl !== 0 ? pnl : parseOkxNumber(raw.balChg);
  }

  return parseOkxNumber(raw.balChg);
}

/**
 * Одна запись журнала сделки несёт СРАЗУ ДВА вида начисления: реализованный итог в поле `pnl`
 * («Profit and loss») и торговую комиссию в поле `fee` («Negative number represents the user
 * transaction fee charged by the platform»). Поэтому без фильтра запись сделки раскладывается на
 * ДВЕ строки — ровно те же, что вернут запросы с фильтром, и ровно так же, как отдаёт Binance
 * отдельными строками. Раньше на её месте стояла одна строка вида «реализованный итог» с суммой
 * из общего изменения остатка (`balChg`), то есть УЖЕ за вычетом комиссии: открытие позиции
 * приезжало как итог −0.55 (на деле это была комиссия), закрытие — как 11.45 вместо валовых 12,
 * а строк комиссии не было вовсе.
 *
 * Запись сделки без обеих сумм (спотовая покупка без комиссии и без итога) не пропадает: она
 * отдаётся видом `other` с изменением остатка, чтобы журнал не терял записи молча.
 */
function buildOkxTradeBillIncomeList(raw: OkxBillRaw, contractValue: string): Income[] {
  const realizedPnl = parseOkxNumber(raw.pnl);
  const commission = parseOkxNumber(raw.fee);
  const incomeList: Income[] = [];

  if (realizedPnl !== 0) {
    incomeList.push(buildOkxBillIncome({ raw, contractValue, incomeType: 'REALIZED_PNL', kind: 'realizedPnl', income: realizedPnl }));
  }

  if (commission !== 0) {
    incomeList.push(buildOkxBillIncome({ raw, contractValue, incomeType: 'COMMISSION', kind: 'commission', income: commission }));
  }

  if (incomeList.length === 0) {
    incomeList.push(buildOkxBillIncome({ raw, contractValue, incomeType: raw.type, kind: 'other', income: parseOkxNumber(raw.balChg) }));
  }

  return incomeList;
}

/**
 * Множитель нужен только там, где у записи есть количество: запись без него (перевод, начисление
 * без объёма) переживает неизвестный инструмент и остаётся в журнале.
 */
function takeOkxBillContractValue(args: TakeOkxBillRowArgs): string | null {
  const { raw, contractValueBySymbol, index, methodName, logger } = args;

  if (raw.sz === '') {
    return '';
  }

  const symbol = takeOkxSymbol(raw.instId);

  if (symbol === null) {
    logger?.warn(`[OKX] ${methodName}: entry ${index} carries an unreadable instrument id ${raw.instId} — skipping it`);

    return null;
  }

  return takeOkxRowContractValue({
    contractValueBySymbol,
    symbol,
    instId: raw.instId,
    instType: raw.instType,
    index,
    methodName,
    logger,
  });
}

export function normalizeOkxIncomeList(
  rawList: OkxBillRaw[],
  contractValueBySymbol: Map<string, string>,
  logger?: ExchangeLogger,
): Income[] {
  const incomeList: Income[] = [];

  for (const [index, raw] of rawList.entries()) {
    const contractValue = takeOkxBillContractValue({ raw, contractValueBySymbol, index, methodName: 'fetchIncome', logger });

    if (contractValue === null) {
      continue;
    }

    if (raw.type === OKX_FUNDING_BILL_TYPE) {
      incomeList.push(buildOkxBillIncome({ raw, contractValue, incomeType: 'FUNDING_FEE', kind: 'funding', income: resolveOkxBillAmount(raw) }));

      continue;
    }

    if (raw.type === OKX_TRADE_BILL_TYPE) {
      incomeList.push(...buildOkxTradeBillIncomeList(raw, contractValue));

      continue;
    }

    incomeList.push(buildOkxBillIncome({ raw, contractValue, incomeType: raw.type, kind: 'other', income: resolveOkxBillAmount(raw) }));
  }

  return incomeList;
}

export function buildOkxRealizedPnlIncomeList(
  rawList: OkxBillRaw[],
  contractValueBySymbol: Map<string, string>,
  logger?: ExchangeLogger,
): Income[] {
  const incomeList: Income[] = [];

  for (const [index, raw] of rawList.entries()) {
    if (raw.type !== OKX_TRADE_BILL_TYPE || parseOkxNumber(raw.pnl) === 0) {
      continue;
    }

    const contractValue = takeOkxBillContractValue({ raw, contractValueBySymbol, index, methodName: 'fetchIncome', logger });

    if (contractValue === null) {
      continue;
    }

    incomeList.push(buildOkxBillIncome({ raw, contractValue, incomeType: 'REALIZED_PNL', kind: 'realizedPnl', income: parseOkxNumber(raw.pnl) }));
  }

  return incomeList;
}

export function buildOkxCommissionIncomeList(
  rawList: OkxBillRaw[],
  contractValueBySymbol: Map<string, string>,
  logger?: ExchangeLogger,
): Income[] {
  const incomeList: Income[] = [];

  for (const [index, raw] of rawList.entries()) {
    if (raw.type !== OKX_TRADE_BILL_TYPE || parseOkxNumber(raw.fee) === 0) {
      continue;
    }

    const contractValue = takeOkxBillContractValue({ raw, contractValueBySymbol, index, methodName: 'fetchIncome', logger });

    if (contractValue === null) {
      continue;
    }

    incomeList.push(buildOkxBillIncome({ raw, contractValue, incomeType: 'COMMISSION', kind: 'commission', income: parseOkxNumber(raw.fee) }));
  }

  return incomeList;
}

function resolveOkxClosedPositionSide(direction: string): OrderSideEnum {
  return direction === 'long' ? OrderSideEnum.Sell : OrderSideEnum.Buy;
}

export function normalizeOkxClosedPnlList(
  rawList: OkxPositionHistoryRaw[],
  contractValueBySymbol: Map<string, string>,
  logger?: ExchangeLogger,
): ClosedPnl[] {
  const closedPnlList: ClosedPnl[] = [];

  for (const [index, raw] of rawList.entries()) {
    const symbol = takeOkxSymbol(raw.instId);

    if (symbol === null) {
      logger?.warn(`[OKX] fetchClosedPnl: entry ${index} carries an unreadable instrument id ${raw.instId} — skipping it`);

      continue;
    }

    const contractValue = takeOkxRowContractValue({
      contractValueBySymbol,
      symbol,
      instId: raw.instId,
      instType: raw.instType,
      index,
      methodName: 'fetchClosedPnl',
      logger,
    });

    if (contractValue === null) {
      continue;
    }

    closedPnlList.push({
      symbol,
      orderId: raw.posId,
      side: resolveOkxClosedPositionSide(raw.direction),
      quantity: convertContractsToCoins(raw.closeTotalPos, contractValue),
      entryPrice: parseOkxNumber(raw.openAvgPx),
      exitPrice: parseOkxNumber(raw.closeAvgPx),
      closedPnl: parseOkxNumber(raw.pnl) + parseOkxNumber(raw.fee),
      timestamp: parseOkxNumber(raw.uTime),
    });
  }

  return closedPnlList;
}

export function buildOkxOrderUpdateEvent(raw: OkxOrderRaw, contractValue: string): OrderUpdateEvent {
  const event: OrderUpdateEvent = {
    symbol: resolveOkxSymbol(raw.instId),
    orderId: raw.ordId,
    clientOrderId: raw.clOrdId,
    side: OKX_ORDER_SIDE[raw.side] ?? OrderSideEnum.Buy,
    status: OKX_ORDER_STATUS[raw.state] ?? raw.state,
    price: parseOkxNumber(raw.px),
    avgPrice: parseOkxNumber(raw.avgPx),
    amount: resolveOkxOrderAmount({ sz: raw.sz, accFillSz: raw.accFillSz, tgtCcy: raw.tgtCcy, contractValue }),
    filledAmount: convertContractsToCoins(raw.accFillSz, contractValue),
    timestamp: parseOkxNumber(raw.uTime),
    isConditional: false,
  };

  if (raw.cancelSource !== '') {
    event.cancelType = raw.cancelSource;
  }

  return event;
}

/**
 * Событие условной заявки в потоке счёта. Заполнения у него нет: сработавшая заявка лишь
 * породила обычную, и цена с объёмом того исполнения приходят отдельным событием по
 * порождённой заявке (`triggeredOrderId`) — см. `normalizeOkxAlgoOrder`.
 *
 * Причина отказа берётся ТОЛЬКО у заявки, которую биржа признала отвергнутой: в живых примерах
 * биржи поле `failCode` несёт «0» у работающей заявки и «1» у сработавшей, а настоящая причина
 * («e.g. 51008») появляется лишь в состояниях `order_failed`/`partially_failed`. Без этой сверки
 * «0» уезжало бы наружу как «позиция осталась без защиты, нужен человек».
 */
export function buildOkxAlgoOrderUpdateEvent(raw: OkxAlgoOrderRaw, contractValue: string): OrderUpdateEvent {
  const { price } = resolveOkxAlgoOrderTypeAndPrice(raw);
  const quoteFillSource = resolveOkxAlgoQuoteFillSource(raw);
  const triggeredOrderId = resolveOkxAlgoTriggeredOrderId(raw);
  const status = OKX_ALGO_STATUS[raw.state] ?? raw.state;

  const event: OrderUpdateEvent = {
    symbol: resolveOkxSymbol(raw.instId),
    orderId: raw.algoId,
    clientOrderId: raw.algoClOrdId,
    side: OKX_ORDER_SIDE[raw.side] ?? OrderSideEnum.Buy,
    status,
    price,
    avgPrice: 0,
    amount: resolveOkxOrderAmount({ sz: raw.sz, accFillSz: quoteFillSource, tgtCcy: raw.tgtCcy, contractValue }),
    filledAmount: 0,
    timestamp: parseOkxNumber(raw.uTime),
    isConditional: true,
  };

  if (triggeredOrderId !== undefined) {
    event.triggeredOrderId = triggeredOrderId;
  }

  if (status === 'rejected' && raw.failCode !== '') {
    event.rejectReason = raw.failMsg !== undefined && raw.failMsg !== '' ? `${raw.failCode}: ${raw.failMsg}` : raw.failCode;
  }

  return event;
}

/**
 * Сторона события — на словаре соседей (`'Buy'`/`'Sell'`/`''`, `BybitBaseClient`/`BinanceBaseClient`),
 * а не сырое `net`/`long`/`short` OKX: сторож позиции у потребителя один на три биржи. В
 * одностороннем режиме `posSide` всегда `net`, и направление живёт ТОЛЬКО в знаке `pos`, который
 * `size` отбрасывает по модулю — как это делают и соседи.
 */
function resolveOkxPositionUpdateSide(posSide: string, posValue: number): string {
  const direction = resolveOkxPositionDirection(posSide, posValue);

  if (direction === null) {
    return '';
  }

  return direction === 'long' ? 'Buy' : 'Sell';
}

export function buildOkxPositionUpdateEvent(raw: OkxPositionRaw, contractValue: string): PositionUpdateEvent {
  const unsignedPos = (raw.pos ?? '').replace('-', '');

  return {
    symbol: resolveOkxSymbol(raw.instId),
    side: resolveOkxPositionUpdateSide(raw.posSide, parseOkxNumber(raw.pos)),
    size: convertContractsToCoins(unsignedPos, contractValue),
    entryPrice: parseOkxNumber(raw.avgPx),
    unrealisedPnl: parseOkxNumber(raw.upl),
    positionSide: raw.posSide,
    timestamp: parseOkxNumber(raw.uTime),
    markPrice: raw.markPx !== '' ? parseOkxNumber(raw.markPx) : null,
    leverage: raw.lever !== '' ? parseOkxNumber(raw.lever) : null,
    liquidationPrice: raw.liqPx !== '' ? parseOkxNumber(raw.liqPx) : null,
  };
}

export function buildOkxBalanceUpdateEvent(raw: OkxBalanceRaw): BalanceUpdateEvent {
  return {
    balanceList: (raw.details ?? []).map((detail) => ({
      asset: detail.ccy,
      free: detail.availBal !== '' ? parseOkxNumber(detail.availBal) : null,
      locked: detail.frozenBal !== '' ? parseOkxNumber(detail.frozenBal) : null,
      total: detail.eq !== '' ? parseOkxNumber(detail.eq) : null,
    })),
    timestamp: parseOkxNumber(raw.uTime),
  };
}

export interface OkxPositionTierRaw {
  baseMaxLoan: string;
  imr: string;
  instFamily: string;
  instId: string;
  maxLever: string;
  maxSz: string;
  minSz: string;
  mmr: string;
  optMgnFactor: string;
  quoteMaxLoan: string;
  tier: string;
  uly: string;
}

export function normalizeOkxPositionTierList(
  rawList: OkxPositionTierRaw[],
  contractValue: string,
): LeverageTier[] {
  return [...rawList]
    .sort((a, b) => parseOkxNumber(a.maxSz) - parseOkxNumber(b.maxSz))
    .map((raw) => ({
      maxLeverage: parseOkxNumber(raw.maxLever),
      maxNotional: null,
      maxBaseAmount: convertContractsToCoins(raw.maxSz, contractValue),
      initialMarginRate: parseOkxNumber(raw.imr),
      maintenanceMarginRate: parseOkxNumber(raw.mmr),
    }));
}
