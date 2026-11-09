import type {
  Ticker,
  TickerBySymbol,
  Kline,
  TradeSymbol,
  TradeSymbolBySymbol,
  Position,
  Order,
  Balance,
  AccountBalances,
  AccountTrade,
  FundingRateHistory,
  FundingInfo,
  OrderBook,
  OrderBookRawLevel,
  OrderBookUpdate,
  PublicTrade,
  MarkPrice,
  MarkPriceUpdate,
  OpenInterest,
  FeeRate,
  Income,
  ClosedPnl,
  PriceLimitRisk,
  LeverageTier,
  LeverageTierListBySymbol,
} from '../types/common';
import { TradeSymbolTypeEnum, PositionSideEnum, MarginModeEnum, TimeInForceEnum, OrderSideEnum } from '../types/common';
import type { OrderRateLimit } from '../types/exchange';
import { BINANCE_POSITION_SIDE, BINANCE_POSITION_IDX, BINANCE_ORDER_SIDE, BINANCE_ORDER_TYPE, BINANCE_ORDER_STATUS, BINANCE_ALGO_STATUS, BINANCE_TIME_IN_FORCE, resolveBinanceIncomeKind } from '../constants/mappings';
import { parseOrderBookLevel } from './normalizerUtils';
import { isConditionalOrderType } from '../constants/orderTypes';
import { BINANCE_USD_COMMISSION_ASSET_LIST } from '../constants/binance';
import type { BinanceClosingGroup, BinanceOpeningPool, BinancePositionSettings } from './binanceNormalizer.types';

interface BinancePriceFilterRaw {
  filterType: 'PRICE_FILTER';
  tickSize?: string;
  minPrice?: string;
  maxPrice?: string;
}

interface BinanceLotSizeFilterRaw {
  filterType: 'LOT_SIZE';
  stepSize?: string;
  minQty?: string;
  maxQty?: string;
}

interface BinanceMarketLotSizeFilterRaw {
  filterType: 'MARKET_LOT_SIZE';
  stepSize?: string;
  minQty?: string;
  maxQty?: string;
}

interface BinanceMinNotionalFilterRaw {
  filterType: 'MIN_NOTIONAL';
  notional?: string;
  applyMinToMarket?: boolean;
  maxNotional?: string;
  applyMaxToMarket?: boolean;
  avgPriceMins?: number;
}

interface BinanceNotionalFilterRaw {
  filterType: 'NOTIONAL';
  minNotional?: string;
  maxNotional?: string;
  applyMinToMarket?: boolean;
  applyMaxToMarket?: boolean;
  avgPriceMins?: number;
}

interface BinanceMaxNumOrdersFilterRaw {
  filterType: 'MAX_NUM_ORDERS';
  limit?: number;
  maxNumOrders?: number;
}

interface BinancePercentPriceFilterRaw {
  filterType: 'PERCENT_PRICE';
  multiplierUp: string;
  multiplierDown: string;
  multiplierDecimal: string;
}

interface BinancePercentPriceBySideFilterRaw {
  filterType: 'PERCENT_PRICE_BY_SIDE';
  bidMultiplierUp: string;
  bidMultiplierDown: string;
  askMultiplierUp: string;
  askMultiplierDown: string;
  avgPriceMins: number;
}

interface BinancePositionRiskControlFilterRaw {
  filterType: 'POSITION_RISK_CONTROL';
  positionControlSide: string;
}

interface BinanceIcebergPartsFilterRaw {
  filterType: 'ICEBERG_PARTS';
  limit: number;
}

interface BinanceTrailingDeltaFilterRaw {
  filterType: 'TRAILING_DELTA';
  minTrailingAboveDelta: number;
  maxTrailingAboveDelta: number;
  minTrailingBelowDelta: number;
  maxTrailingBelowDelta: number;
}

interface BinanceMaxNumOrderListsFilterRaw {
  filterType: 'MAX_NUM_ORDER_LISTS';
  maxNumOrderLists: number;
}

interface BinanceMaxNumAlgoOrdersFilterRaw {
  filterType: 'MAX_NUM_ALGO_ORDERS';
  maxNumAlgoOrders: number;
}

interface BinanceMaxNumOrderAmendsFilterRaw {
  filterType: 'MAX_NUM_ORDER_AMENDS';
  maxNumOrderAmends: number;
}

interface BinanceUnknownFilterRaw {
  filterType: string;
  [key: string]: unknown;
}

type BinanceKnownFilterRaw =
  | BinancePriceFilterRaw
  | BinanceLotSizeFilterRaw
  | BinanceMarketLotSizeFilterRaw
  | BinanceMinNotionalFilterRaw
  | BinanceNotionalFilterRaw
  | BinanceMaxNumOrdersFilterRaw
  | BinancePercentPriceFilterRaw
  | BinancePercentPriceBySideFilterRaw
  | BinancePositionRiskControlFilterRaw
  | BinanceIcebergPartsFilterRaw
  | BinanceTrailingDeltaFilterRaw
  | BinanceMaxNumOrderListsFilterRaw
  | BinanceMaxNumAlgoOrdersFilterRaw
  | BinanceMaxNumOrderAmendsFilterRaw;

type BinanceFilterRaw = BinanceKnownFilterRaw | BinanceUnknownFilterRaw;

interface BinanceSymbolRaw {
  symbol: string;
  status: string;
  baseAsset: string;
  quoteAsset: string;
  contractType?: string;
  marginAsset?: string;
  filters: BinanceFilterRaw[];
  pair?: string;
  deliveryDate?: number;
  onboardDate?: number;
  maintMarginPercent?: string;
  requiredMarginPercent?: string;
  pricePrecision?: number;
  quantityPrecision?: number;
  baseAssetPrecision?: number;
  quotePrecision?: number;
  quoteAssetPrecision?: number;
  baseCommissionPrecision?: number;
  quoteCommissionPrecision?: number;
  underlyingType?: string;
  underlyingSubType?: string[];
  triggerProtect?: string;
  liquidationFee?: string;
  marketTakeBound?: string;
  maxMoveOrderLimit?: number;
  orderTypes?: string[];
  timeInForce?: string[];
  permissionSets?: unknown;
  icebergAllowed?: boolean;
  ocoAllowed?: boolean;
  otoAllowed?: boolean;
  opoAllowed?: boolean;
  quoteOrderQtyMarketAllowed?: boolean;
  allowTrailingStop?: boolean;
  cancelReplaceAllowed?: boolean;
  amendAllowed?: boolean;
  pegInstructionsAllowed?: boolean;
  isSpotTradingAllowed?: boolean;
  isMarginTradingAllowed?: boolean;
  [key: string]: unknown;
}

export interface BinanceRateLimitRaw {
  rateLimitType: string;
  interval: string;
  intervalNum: number;
  limit: number;
}

export interface BinanceExchangeInfoRaw {
  symbols: BinanceSymbolRaw[];
  rateLimits?: BinanceRateLimitRaw[];
}

/**
 * Ответ суточной сводки Binance: `/fapi/v1/ticker/24hr` и `/api/v3/ticker/24hr`. Поля `time` в нём
 * НЕТ ни на контрактах, ни на споте — окно суток задано парой `openTime`/`closeTime`, и правый край
 * этой пары и есть отметка сводки. Сверено живым ответом обеих ручек (боевой и демо) 10.09.2026.
 * Спот кладёт сверх контрактного набора цену предыдущего закрытия и верх стакана — на контрактах
 * этих полей нет, поэтому они необязательны.
 */
export interface BinanceTicker24hrRaw {
  symbol: string;
  priceChange: string;
  priceChangePercent: string;
  weightedAvgPrice: string;
  lastPrice: string;
  lastQty: string;
  openPrice: string;
  highPrice: string;
  lowPrice: string;
  volume: string;
  quoteVolume: string;
  openTime: number;
  closeTime: number;
  firstId: number;
  lastId: number;
  count: number;
  prevClosePrice?: string;
  bidPrice?: string;
  bidQty?: string;
  askPrice?: string;
  askQty?: string;
}

export interface BinanceWebSocketKlineRaw {
  t: number;
  o: string;
  h: string;
  l: string;
  c: string;
  v: string;
  T: number;
  q: string;
  n: number;
  V: string;
  Q: string;
  i?: string;
  f?: number;
  L?: number;
  x: boolean;
  B?: string;
}

export interface BinanceContinuousKlineMessageRaw {
  e: string;
  E: number;
  ps: string;
  ct: string;
  k: BinanceWebSocketKlineRaw;
}

export interface BinanceSymbolConfigRaw {
  symbol: string;
  marginType: string;
  isAutoAddMargin: boolean;
  leverage?: number;
  maxNotionalValue: string;
}

export interface BinanceSetLeverageResponseRaw {
  leverage: number;
  maxNotionalValue: string;
  symbol: string;
}

export interface BinancePositionRiskRaw {
  updateTime?: number;
  symbol: string;
  positionSide: string;
  positionAmt: string;
  entryPrice: string;
  markPrice: string;
  unRealizedProfit: string;
  liquidationPrice: string;
  notional: string;
  isolatedMargin: string;
  isolatedWallet?: string;
  [key: string]: unknown;
}

export interface BinanceOrderResponseRaw {
  positionSide?: string;
  closePosition?: boolean;
  orderId: number | string;
  clientOrderId: string;
  symbol: string;
  side: string;
  type: string;
  timeInForce: string;
  origQty: string;
  executedQty: string;
  price: string;
  avgPrice: string;
  stopPrice: string;
  cumQuote: string;
  status: string;
  reduceOnly: boolean;
  time: number;
  updateTime: number;
}

/**
 * Ответ Algo-службы Binance USDⓈ-M. Имена полей отличаются от обычной заявки:
 * algoId вместо orderId, clientAlgoId вместо clientOrderId, triggerPrice вместо stopPrice.
 * Замерено на живом ответе биржи 07.08.2026.
 */
export interface BinanceAlgoOrderRaw {
  algoId: number | string;
  clientAlgoId: string;
  algoType: string;
  orderType: string;
  symbol: string;
  side: string;
  positionSide?: string;
  /** Возвращается в том числе как GTE_GTC — значения нет ни в одном перечне на вход. */
  timeInForce?: string;
  /** У заявки «закрыть всю позицию» биржа отдаёт "0". */
  quantity: string;
  algoStatus: string;
  /** Номер порождённой обычной заявки; пустая строка, пока не сработала. */
  actualOrderId?: string;
  actualPrice?: string;
  actualType?: string;
  actualQty?: string;
  triggerPrice: string;
  price: string;
  /** Живая биржа отдаёт настоящий null, хотя в примере документации стоит строка "null". */
  icebergQuantity?: string | null;
  tpOrderType?: string;
  selfTradePreventionMode?: string;
  workingType?: string;
  priceMatch?: string;
  closePosition?: boolean;
  priceProtect?: boolean;
  reduceOnly?: boolean;
  createTime: number;
  updateTime: number;
  triggerTime?: number;
  goodTillDate?: number;
}

interface BinanceBalanceRaw {
  asset: string;
  free: string;
  locked: string;
}

export interface BinanceAccountRaw {
  balances: BinanceBalanceRaw[];
}

interface BinanceFuturesAssetRaw {
  asset: string;
  walletBalance: string;
  availableBalance: string;
}

export interface BinanceFuturesAccountRaw {
  totalWalletBalance: string;
  availableBalance: string;
  /** Сводные числа счёта, которые биржа отдаёт вместе с балансом. Необязательные: у ответа могут
   *  отсутствовать, а выдумывать их нельзя. Занятая маржа нужна отдельным числом потому, что
   *  свободные средства биржа считает уже с учётом нереализованного итога, и разность кошелька со
   *  свободными занятую маржу не даёт (экран баланса 29.08.2026). */
  totalMarginBalance?: string;
  totalUnrealizedProfit?: string;
  totalInitialMargin?: string;
  totalPositionInitialMargin?: string;
  totalOpenOrderInitialMargin?: string;
  assets: BinanceFuturesAssetRaw[];
}

function extractFilter<T extends BinanceKnownFilterRaw['filterType']>(
  filterList: BinanceFilterRaw[],
  filterType: T,
): Extract<BinanceKnownFilterRaw, { filterType: T }> | undefined {
  const filter = filterList.find((entry) => entry.filterType === filterType);

  return filter as Extract<BinanceKnownFilterRaw, { filterType: T }> | undefined;
}

function buildBinancePriceLimitRisk(filterList: BinanceFilterRaw[]): PriceLimitRisk | undefined {
  const percentPrice = extractFilter(filterList, 'PERCENT_PRICE');

  if (percentPrice !== undefined) {
    return {
      source: 'binancePercentPrice',
      multiplierUp: percentPrice.multiplierUp,
      multiplierDown: percentPrice.multiplierDown,
      multiplierDecimal: percentPrice.multiplierDecimal,
    };
  }

  const percentPriceBySide = extractFilter(filterList, 'PERCENT_PRICE_BY_SIDE');

  if (percentPriceBySide !== undefined) {
    return {
      source: 'binancePercentPriceBySide',
      bidMultiplierUp: percentPriceBySide.bidMultiplierUp,
      bidMultiplierDown: percentPriceBySide.bidMultiplierDown,
      askMultiplierUp: percentPriceBySide.askMultiplierUp,
      askMultiplierDown: percentPriceBySide.askMultiplierDown,
      avgPriceMins: percentPriceBySide.avgPriceMins,
    };
  }

  return undefined;
}

const BINANCE_ORDER_RATE_LIMIT_FALLBACK_RPS = 15;

function intervalToSeconds(interval: string): number {
  if (interval === 'SECOND') {
    return 1;
  }
  if (interval === 'MINUTE') {
    return 60;
  }
  if (interval === 'HOUR') {
    return 3600;
  }
  if (interval === 'DAY') {
    return 86400;
  }
  throw new Error(`Unsupported Binance rate-limit interval: ${interval}`);
}

export function parseBinanceOrderRateLimit(raw: BinanceExchangeInfoRaw): OrderRateLimit {
  const orderLimitList = (raw.rateLimits ?? []).filter((entry) => entry.rateLimitType === 'ORDERS');

  if (orderLimitList.length === 0) {
    return {
      writeRequestsPerSecond: BINANCE_ORDER_RATE_LIMIT_FALLBACK_RPS,
      source: 'fallback',
    };
  }

  const perSecondList = orderLimitList.map((entry) => {
    const secondsInInterval = intervalToSeconds(entry.interval);

    return entry.limit / (entry.intervalNum * secondsInInterval);
  });

  return {
    writeRequestsPerSecond: Math.min(...perSecondList),
    source: 'binance-exchange-info',
  };
}

// Binance marks tokenized TradFi perpetuals (tokenized equities, metals) with this contractType.
const TRADIFI_PERPETUAL_CONTRACT_TYPE = 'TRADIFI_PERPETUAL';

export function normalizeBinanceTradeSymbols(raw: BinanceExchangeInfoRaw): TradeSymbolBySymbol {
  const result = new Map<string, TradeSymbol>();

  for (const symbol of raw.symbols) {
    const priceFilter = extractFilter(symbol.filters, 'PRICE_FILTER');
    const lotSizeFilter = extractFilter(symbol.filters, 'LOT_SIZE');
    const marketLotSizeFilter = extractFilter(symbol.filters, 'MARKET_LOT_SIZE');
    const minNotionalFilter = extractFilter(symbol.filters, 'MIN_NOTIONAL');
    const notionalFilter = extractFilter(symbol.filters, 'NOTIONAL');

    const rawContractType = symbol.contractType ?? '';
    const isPerp = rawContractType === 'PERPETUAL' || rawContractType === TRADIFI_PERPETUAL_CONTRACT_TYPE;
    const isSpot = rawContractType === '' || rawContractType === undefined;

    let tradeSymbolType: TradeSymbolTypeEnum = TradeSymbolTypeEnum.Future;

    if (isPerp) {
      tradeSymbolType = TradeSymbolTypeEnum.Swap;
    } else if (isSpot) {
      tradeSymbolType = TradeSymbolTypeEnum.Spot;
    }

    const tradeSymbol: TradeSymbol = {
      symbol: symbol.symbol,
      baseAsset: symbol.baseAsset,
      quoteAsset: symbol.quoteAsset,
      settle: symbol.marginAsset ?? '',
      isActive: symbol.status === 'TRADING',
      type: tradeSymbolType,
      isLinear: isPerp,
      contractSize: 1,
      contractType: rawContractType,
      isTradifi: rawContractType === TRADIFI_PERPETUAL_CONTRACT_TYPE,
      filter: {
        tickSize: priceFilter?.tickSize ?? '0',
        stepSize: lotSizeFilter?.stepSize ?? '0',
        minQty: lotSizeFilter?.minQty ?? '0',
        maxQty: lotSizeFilter?.maxQty ?? '0',
        minNotional: minNotionalFilter?.notional
          ?? notionalFilter?.minNotional
          ?? '0',
        ...(priceFilter?.minPrice !== undefined ? { minPrice: priceFilter.minPrice } : {}),
        ...(priceFilter?.maxPrice !== undefined ? { maxPrice: priceFilter.maxPrice } : {}),
        ...(notionalFilter?.maxNotional !== undefined ? { maxNotional: notionalFilter.maxNotional } : {}),
        ...(marketLotSizeFilter?.minQty !== undefined ? { marketMinQty: marketLotSizeFilter.minQty } : {}),
        ...(marketLotSizeFilter?.maxQty !== undefined ? { marketMaxQty: marketLotSizeFilter.maxQty } : {}),
        ...(marketLotSizeFilter?.stepSize !== undefined ? { marketStepSize: marketLotSizeFilter.stepSize } : {}),
      },
    };

    const priceLimitRisk = buildBinancePriceLimitRisk(symbol.filters);

    if (priceLimitRisk !== undefined) {
      tradeSymbol.priceLimitRisk = priceLimitRisk;
    }

    if (symbol.pricePrecision !== undefined) {
      tradeSymbol.pricePrecision = symbol.pricePrecision;
    }

    if (symbol.quantityPrecision !== undefined) {
      tradeSymbol.quantityPrecision = symbol.quantityPrecision;
    }

    if (symbol.onboardDate !== undefined) {
      tradeSymbol.launchTimestamp = symbol.onboardDate;
    }

    if (symbol.triggerProtect !== undefined) {
      tradeSymbol.triggerProtect = symbol.triggerProtect;
    }

    if (symbol.liquidationFee !== undefined) {
      tradeSymbol.liquidationFee = symbol.liquidationFee;
    }

    if (symbol.orderTypes !== undefined) {
      tradeSymbol.orderTypeList = symbol.orderTypes;
    }

    if (symbol.timeInForce !== undefined) {
      tradeSymbol.timeInForceList = symbol.timeInForce;
    }

    tradeSymbol.info = symbol as unknown as Record<string, unknown>;

    result.set(symbol.symbol, tradeSymbol);
  }

  return result;
}

export function normalizeBinanceTickers(rawList: BinanceTicker24hrRaw[]): TickerBySymbol {
  const result = new Map<string, Ticker>();

  for (const raw of rawList) {
    const ticker: Ticker = {
      symbol: raw.symbol,
      lastPrice: parseFloat(raw.lastPrice),
      openPrice: parseFloat(raw.openPrice),
      highPrice: parseFloat(raw.highPrice),
      lowPrice: parseFloat(raw.lowPrice),
      priceChangePercent: parseFloat(raw.priceChangePercent),
      volume: parseFloat(raw.volume),
      quoteVolume: parseFloat(raw.quoteVolume),
      timestamp: raw.closeTime,
    };

    result.set(raw.symbol, ticker);
  }

  return result;
}

/**
 * Кадр потока `!miniTicker@arr` — и на контрактах, и на споте. Имена полей КОРОТКИЕ и с суточной
 * сводкой не совпадают ни одним: `c` — последняя цена, `o` — цена сутки назад, `E` — время события.
 * Процента изменения в кадре НЕТ, биржа его тут не считает. Сверено живыми кадрами обоих рынков
 * 10.09.2026 (`ps` и `st` приходят только на контрактах).
 */
export interface BinanceMiniTickerWebSocketRaw {
  e: '24hrMiniTicker';
  E: number;
  s: string;
  c: string;
  o: string;
  h: string;
  l: string;
  v: string;
  q: string;
  ps?: string;
  st?: number;
}

/**
 * Поток даёт лишь цену суточной давности, поэтому процент изменения считается здесь — ровно так же,
 * как он считается для OKX. Нулевая цена открытия даёт ноль, а не бесконечность.
 */
export function normalizeBinanceMiniTickerList(rawList: BinanceMiniTickerWebSocketRaw[]): TickerBySymbol {
  const result = new Map<string, Ticker>();

  for (const raw of rawList) {
    const lastPrice = parseFloat(raw.c);
    const openPrice = parseFloat(raw.o);
    const hasComparablePrices = Number.isFinite(lastPrice) && Number.isFinite(openPrice) && openPrice > 0;

    result.set(raw.s, {
      symbol: raw.s,
      lastPrice,
      openPrice,
      highPrice: parseFloat(raw.h),
      lowPrice: parseFloat(raw.l),
      priceChangePercent: hasComparablePrices ? ((lastPrice - openPrice) / openPrice) * 100 : 0,
      volume: parseFloat(raw.v),
      quoteVolume: parseFloat(raw.q),
      timestamp: raw.E,
    });
  }

  return result;
}

export function normalizeBinanceKlines(rawList: unknown[][]): Kline[] {
  return rawList.map((row) => ({
    openTimestamp: row[0] as number,
    openPrice: parseFloat(row[1] as string),
    highPrice: parseFloat(row[2] as string),
    lowPrice: parseFloat(row[3] as string),
    closePrice: parseFloat(row[4] as string),
    volume: parseFloat(row[5] as string),
    closeTimestamp: row[6] as number,
    quoteAssetVolume: parseFloat(row[7] as string),
    numberOfTrades: row[8] as number,
    takerBuyBaseAssetVolume: parseFloat(row[9] as string),
    takerBuyQuoteAssetVolume: parseFloat(row[10] as string),
  }));
}

export function normalizeBinanceKlineWebSocketMessage(raw: BinanceWebSocketKlineRaw): Kline {
  return {
    openTimestamp: raw.t,
    openPrice: parseFloat(raw.o),
    highPrice: parseFloat(raw.h),
    lowPrice: parseFloat(raw.l),
    closePrice: parseFloat(raw.c),
    volume: parseFloat(raw.v),
    closeTimestamp: raw.T,
    quoteAssetVolume: parseFloat(raw.q),
    numberOfTrades: raw.n,
    takerBuyBaseAssetVolume: parseFloat(raw.V),
    takerBuyQuoteAssetVolume: parseFloat(raw.Q),
    isClosed: raw.x,
  };
}

function resolveBinanceDirection(raw: BinancePositionRiskRaw): 'long' | 'short' | null {
  if (raw.positionSide === 'LONG') {
    return 'long';
  }

  if (raw.positionSide === 'SHORT') {
    return 'short';
  }

  const amt = parseFloat(raw.positionAmt);

  if (!Number.isFinite(amt) || amt === 0) {
    return null;
  }

  return amt > 0 ? 'long' : 'short';
}

export function normalizeBinancePositionLeverage(rawList: BinanceSymbolConfigRaw[], symbol: string): number | null {
  const matchingList = rawList.filter((raw) => raw.symbol === symbol);

  if (matchingList.length !== 1) {
    return null;
  }

  const leverage = matchingList[0].leverage;

  return typeof leverage === 'number' && Number.isFinite(leverage) && leverage > 0 ? leverage : null;
}

function resolveBinanceMarginTypeMode(marginType: unknown): MarginModeEnum | null {
  if (typeof marginType !== 'string') {
    return null;
  }

  const upperMarginType = marginType.toUpperCase();

  if (upperMarginType === 'ISOLATED') {
    return MarginModeEnum.Isolated;
  }

  return upperMarginType === 'CROSSED' || upperMarginType === 'CROSS' ? MarginModeEnum.Cross : null;
}

function buildBinancePositionSettings(leverage: number, marginType: unknown): BinancePositionSettings | null {
  const marginMode = resolveBinanceMarginTypeMode(marginType);

  if (marginMode === null || !Number.isFinite(leverage) || leverage <= 0) {
    return null;
  }

  return { leverage, marginMode };
}

export function buildBinanceSymbolConfigSettingsBySymbol(rawList: BinanceSymbolConfigRaw[]): Map<string, BinancePositionSettings> {
  const settingsBySymbol = new Map<string, BinancePositionSettings>();

  for (const raw of rawList) {
    const settings = buildBinancePositionSettings(typeof raw.leverage === 'number' ? raw.leverage : NaN, raw.marginType);

    if (settings !== null) {
      settingsBySymbol.set(raw.symbol, settings);
    }
  }

  return settingsBySymbol;
}

export function normalizeBinancePosition(raw: BinancePositionRiskRaw, settings: BinancePositionSettings | null): Position {
  const side = BINANCE_POSITION_SIDE[raw.positionSide] ?? PositionSideEnum.Both;
  const direction = resolveBinanceDirection(raw);
  const liquidationPriceRaw = parseFloat(raw.liquidationPrice);
  const rawContracts = parseFloat(raw.positionAmt);
  const safeContracts = Number.isFinite(rawContracts) ? Math.abs(rawContracts) : 0;
  const updatedAtMs = Number(raw.updateTime);

  return {
    symbol: raw.symbol,
    side,
    direction,
    contracts: safeContracts,
    updatedAtMs: Number.isFinite(updatedAtMs) && updatedAtMs > 0 ? updatedAtMs : undefined,
    entryPrice: parseFloat(raw.entryPrice),
    markPrice: parseFloat(raw.markPrice),
    unrealizedPnl: parseFloat(raw.unRealizedProfit),
    leverage: settings?.leverage ?? 0,
    marginMode: settings?.marginMode ?? null,
    liquidationPrice: isNaN(liquidationPriceRaw) ? 0 : liquidationPriceRaw,
    // Какая из двух сторон — сведения, которые уже есть в ответе, поэтому заполняются ЗДЕСЬ,
    // на всех путях чтения сразу: раньше три метода дописывали это вручную, а четвёртый
    // забывал, и читатель в двустороннем режиме не понимал, какую позицию ему дали.
    // Односторонний режим помечается нулём — тем же числом, что и у соседней биржи.
    positionIdx: BINANCE_POSITION_IDX[raw.positionSide] ?? 0,
    info: raw,
  };
}

function normalizeBinanceOrderPositionSide(positionSide: string | undefined): PositionSideEnum | undefined {
  if (positionSide === undefined || !Object.hasOwn(BINANCE_POSITION_SIDE, positionSide)) {
    return undefined;
  }

  return BINANCE_POSITION_SIDE[positionSide];
}

export function normalizeBinanceOrder(raw: BinanceOrderResponseRaw): Order {
  const type = BINANCE_ORDER_TYPE[raw.type] ?? raw.type.toLowerCase() as never;

  return {
    id: String(raw.orderId),
    clientOrderId: raw.clientOrderId ?? '',
    symbol: raw.symbol,
    side: BINANCE_ORDER_SIDE[raw.side] ?? OrderSideEnum.Buy,
    positionSide: normalizeBinanceOrderPositionSide(raw.positionSide),
    type,
    // Условность — свойство ТИПА заявки, а не её цены срабатывания. Раньше защитные
    // заявки отбирались условием «цена срабатывания больше нуля», и заявка с нулевой
    // ценой была невидима.
    isConditional: isConditionalOrderType(type),
    timeInForce: BINANCE_TIME_IN_FORCE[raw.timeInForce] ?? TimeInForceEnum.Gtc,
    price: parseFloat(raw.price),
    avgPrice: parseFloat(raw.avgPrice ?? '0'),
    stopPrice: parseFloat(raw.stopPrice ?? '0'),
    amount: parseFloat(raw.origQty),
    filledAmount: parseFloat(raw.executedQty ?? '0'),
    filledQuoteAmount: parseFloat(raw.cumQuote ?? '0'),
    status: BINANCE_ORDER_STATUS[raw.status] ?? raw.status.toLowerCase(),
    reduceOnly: raw.reduceOnly ?? false,
    closePosition: raw.closePosition,
    timestamp: raw.time ?? raw.updateTime,
    updatedTimestamp: raw.updateTime,
  };
}

function parseFiniteFloat(value: string | null | undefined): number {
  if (value === undefined || value === null || value === '') {
    return 0;
  }

  const parsed = parseFloat(value);

  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Ответ действительно принадлежит Algo-службе, а не пришёл из обычной книги.
 * Нужна потому, что при неизвестном происхождении номера мы спрашиваем обе службы, и принять
 * чужой ответ за свой значит вернуть не ту заявку.
 */
/** Ответ действительно принадлежит обычной книге заявок. Пара к проверке ниже. */
export function isBinanceOrderResponseRaw(value: unknown): value is BinanceOrderResponseRaw {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<BinanceOrderResponseRaw>;

  return isBinanceNumericId(candidate.orderId) && typeof candidate.type === 'string';
}

export function isBinanceAlgoOrderRaw(value: unknown): value is BinanceAlgoOrderRaw {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<BinanceAlgoOrderRaw>;

  return isBinanceNumericId(candidate.algoId) && typeof candidate.orderType === 'string';
}

function isBinanceNumericId(value: unknown): value is number | string {
  return typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value));
}

export function normalizeBinanceAlgoOrder(raw: BinanceAlgoOrderRaw): Order {
  const triggeredOrderId =
    raw.actualOrderId !== undefined && raw.actualOrderId !== '' ? raw.actualOrderId : undefined;

  return {
    id: String(raw.algoId),
    clientOrderId: raw.clientAlgoId ?? '',
    symbol: raw.symbol,
    side: BINANCE_ORDER_SIDE[raw.side] ?? OrderSideEnum.Buy,
    positionSide: normalizeBinanceOrderPositionSide(raw.positionSide),
    type: BINANCE_ORDER_TYPE[raw.orderType] ?? raw.orderType.toLowerCase() as never,
    timeInForce: BINANCE_TIME_IN_FORCE[raw.timeInForce ?? ''] ?? TimeInForceEnum.Gtc,
    price: parseFiniteFloat(raw.price),
    avgPrice: parseFiniteFloat(raw.actualPrice),
    stopPrice: parseFiniteFloat(raw.triggerPrice),
    amount: parseFiniteFloat(raw.quantity),
    // actualQty НЕ берём: документация не говорит, исполненный это объём или заявленный,
    // а принять заявленный за исполненный значит записать закрытие, которого не было.
    // Честное заполнение подмешивается из порождённой заявки (mergeBinanceTriggeredOrder).
    filledAmount: 0,
    filledQuoteAmount: 0,
    status: BINANCE_ALGO_STATUS[raw.algoStatus] ?? raw.algoStatus.toLowerCase(),
    reduceOnly: raw.reduceOnly ?? false,
    timestamp: raw.createTime,
    updatedTimestamp: raw.updateTime,
    isConditional: true,
    closePosition: raw.closePosition ?? false,
    ...(triggeredOrderId === undefined ? {} : { triggeredOrderId }),
  };
}

/**
 * Подмешивает в условную заявку фактическое исполнение из порождённой обычной заявки.
 * Собственные поля условной (номер, цена срабатывания, заявленный объём) не трогаются —
 * снаружи это по-прежнему та же заявка, у которой лишь стало известно исполнение.
 */
export function mergeBinanceTriggeredOrder(
  conditionalOrder: Order,
  triggeredRaw: BinanceOrderResponseRaw,
): Order {
  return {
    ...conditionalOrder,
    avgPrice: parseFiniteFloat(triggeredRaw.avgPrice),
    filledAmount: parseFiniteFloat(triggeredRaw.executedQty),
    filledQuoteAmount: parseFiniteFloat(triggeredRaw.cumQuote),
    status: BINANCE_ORDER_STATUS[triggeredRaw.status] ?? conditionalOrder.status,
  };
}

export function normalizeBinanceBalances(raw: BinanceAccountRaw): AccountBalances {
  const result = new Map<string, Balance>();

  for (const entry of raw.balances) {
    const free = parseFloat(entry.free);
    const locked = parseFloat(entry.locked);

    if (!Number.isFinite(free) || !Number.isFinite(locked)) {
      continue;
    }

    if (free + locked === 0) {
      continue;
    }

    const balance: Balance = {
      asset: entry.asset,
      free,
      locked,
      total: free + locked,
    };

    result.set(entry.asset, balance);
  }

  let totalWalletBalance = 0;
  let totalAvailableBalance = 0;

  for (const balance of result.values()) {
    totalWalletBalance += balance.total;
    totalAvailableBalance += balance.free;
  }

  return { totalWalletBalance, totalAvailableBalance, balanceByAsset: result };
}

export function normalizeBinanceFuturesBalances(raw: BinanceFuturesAccountRaw): AccountBalances {
  const result = new Map<string, Balance>();

  for (const entry of raw.assets) {
    const walletBalance = parseFloat(entry.walletBalance);
    const availableBalance = parseFloat(entry.availableBalance);

    if (walletBalance === 0) {
      continue;
    }

    result.set(entry.asset, {
      asset: entry.asset,
      free: availableBalance,
      locked: walletBalance - availableBalance,
      total: walletBalance,
    });
  }

  const totalWalletBalance = parseFloat(raw.totalWalletBalance);
  const exchangeAvailable = parseFloat(raw.availableBalance);
  const initialMargin = raw.totalInitialMargin !== undefined ? parseFloat(raw.totalInitialMargin) : NaN;

  let totalAvailableBalance: number;
  let availableBalanceSource: NonNullable<AccountBalances['availableBalanceSource']>;

  if (!isNaN(exchangeAvailable)) {
    totalAvailableBalance = exchangeAvailable;
    availableBalanceSource = 'exchange';
  } else if (!isNaN(initialMargin) && !isNaN(totalWalletBalance)) {
    totalAvailableBalance = totalWalletBalance - initialMargin;
    availableBalanceSource = 'derived';
  } else {
    totalAvailableBalance = 0;
    availableBalanceSource = 'unknown';
  }

  const balances: AccountBalances = {
    totalWalletBalance,
    totalAvailableBalance,
    balanceByAsset: result,
    availableBalanceSource,
  };

  // Занятая маржа читается, а не выводится: свободные средства биржа уже уменьшила на нереализованный
  // итог, поэтому разность кошелька со свободными завышает занятое на прибыль и занижает на убыток.
  if (!isNaN(initialMargin)) {
    balances.totalInitialMargin = initialMargin;
  }

  const marginBalance = raw.totalMarginBalance !== undefined ? parseFloat(raw.totalMarginBalance) : NaN;

  if (!isNaN(marginBalance)) {
    balances.totalMarginBalance = marginBalance;
  }

  return balances;
}

export interface BinanceFundingRateHistoryRaw {
  symbol: string;
  fundingRate: string;
  fundingTime: number;
  markPrice: string;
}

export function normalizeBinanceFundingRateHistory(
  rawList: BinanceFundingRateHistoryRaw[],
): FundingRateHistory[] {
  return rawList.map((raw) => ({
    symbol: raw.symbol,
    fundingRate: parseFloat(raw.fundingRate),
    fundingTime: raw.fundingTime,
    markPrice: raw.markPrice !== '' ? parseFloat(raw.markPrice) : null,
  }));
}

export interface BinanceFundingInfoRaw {
  symbol: string;
  adjustedFundingRateCap: string;
  adjustedFundingRateFloor: string;
  fundingIntervalHours: number;
}

export function normalizeBinanceFundingInfo(rawList: BinanceFundingInfoRaw[]): FundingInfo[] {
  return rawList.map((raw) => ({
    symbol: raw.symbol,
    fundingIntervalHours: raw.fundingIntervalHours,
    adjustedFundingRateCap: parseFloat(raw.adjustedFundingRateCap),
    adjustedFundingRateFloor: parseFloat(raw.adjustedFundingRateFloor),
  }));
}

export interface BinanceOrderBookRaw {
  lastUpdateId: number;
  E: number;
  T: number;
  bids: string[][];
  asks: string[][];
}

export interface BinancePublicTradeRaw {
  id: number | string;
  price: string;
  qty: string;
  quoteQty: string;
  time: number;
  isBuyerMaker: boolean;
}

export interface BinanceMarkPriceRaw {
  symbol: string;
  markPrice: string;
  indexPrice: string;
  lastFundingRate: string;
  nextFundingTime: number;
  time: number;
}

export interface BinanceMarkPriceWebSocketRaw {
  e: 'markPriceUpdate';
  E: number;
  s: string;
  p: string;
  ap: string;
  i: string;
  P: string;
  r: string;
  T: number;
}

export interface BinanceAggTradeWebSocketRaw {
  e: 'aggTrade';
  E: number;
  s: string;
  a: number;
  p: string;
  q: string;
  f: number;
  l: number;
  T: number;
  m: boolean;
}

export interface BinanceOpenInterestRaw {
  symbol: string;
  openInterest: string;
  time: number;
}

export interface BinanceCommissionRateRaw {
  symbol: string;
  makerCommissionRate: string;
  takerCommissionRate: string;
}

export interface BinanceIncomeRaw {
  symbol: string;
  incomeType: string;
  income: string;
  asset: string;
  time: number;
  info: string;
  tranId: number | string;
  tradeId: string;
}

export interface BinanceUserTradeRaw {
  id: number | string;
  orderId: number | string;
  symbol: string;
  side: string;
  positionSide: string;
  price: string;
  qty: string;
  quoteQty: string;
  /** ВАЛОВОЙ итог: комиссия в него НЕ входит, она списывается отдельной строкой.
   *  Проверено на живом счёте 08.08.2026 — сумма по сделкам сошлась с начислением
   *  REALIZED_PNL до восьмого знака, а комиссия пришла отдельным начислением. */
  realizedPnl: string;
  commission: string;
  commissionAsset: string;
  time: number;
}

export function normalizeBinanceAccountTrade(raw: BinanceUserTradeRaw): AccountTrade {
  const side = BINANCE_ORDER_SIDE[raw.side];
  const quantity = Number(raw.qty);
  const price = Number(raw.price);

  if (!Object.hasOwn(BINANCE_ORDER_SIDE, raw.side) || !Number.isFinite(quantity) || quantity <= 0
    || !Number.isFinite(price) || price <= 0 || !Number.isFinite(raw.time) || raw.time < 0) {
    throw new Error('Binance account trade contains invalid execution data');
  }

  return {
    id: String(raw.id),
    symbol: raw.symbol,
    side,
    positionSide: normalizeBinanceOrderPositionSide(raw.positionSide),
    quantity,
    price,
    timestamp: raw.time,
  };
}

function isBinanceClosingTrade(raw: BinanceUserTradeRaw): boolean {
  return parseFloat(raw.realizedPnl) !== 0
    || (raw.positionSide === 'LONG' && raw.side === 'SELL')
    || (raw.positionSide === 'SHORT' && raw.side === 'BUY');
}

export function buildBinanceClosedPnlList(rawList: BinanceUserTradeRaw[]): ClosedPnl[] {
  const groupBySymbolOrderId = new Map<string, BinanceClosingGroup>();
  const openingPoolBySymbolPositionSideDirection = new Map<string, BinanceOpeningPool>();
  const closingOrderKeySet = new Set(rawList.filter(isBinanceClosingTrade).map((raw) => `${raw.symbol}:${raw.orderId}`));

  const chronologicalList = [...rawList].sort((left, right) => {
    const timeDifference = left.time - right.time;

    if (timeDifference !== 0) {
      return timeDifference;
    }

    const leftIdText = String(left.id);
    const rightIdText = String(right.id);

    if (!/^\d+$/.test(leftIdText) || !/^\d+$/.test(rightIdText)) {
      return 0;
    }

    const leftId = BigInt(leftIdText);
    const rightId = BigInt(rightIdText);

    if (leftId < rightId) {
      return -1;
    }

    if (leftId > rightId) {
      return 1;
    }

    return 0;
  });

  for (const raw of chronologicalList) {
    const quantity = parseFloat(raw.qty);
    const commission = parseFloat(raw.commission);
    const isCommissionKnown = BINANCE_USD_COMMISSION_ASSET_LIST.some((asset) => asset === raw.commissionAsset) && Number.isFinite(commission);
    const knownCommission = isCommissionKnown ? commission : 0;
    const openingDirection = raw.side === 'BUY' ? PositionSideEnum.Long : PositionSideEnum.Short;
    const closingDirection = raw.side === 'BUY' ? PositionSideEnum.Short : PositionSideEnum.Long;
    const openingKey = `${raw.symbol}:${raw.positionSide}:${openingDirection}`;
    const closingKey = `${raw.symbol}:${raw.positionSide}:${closingDirection}`;
    const closingPool = openingPoolBySymbolPositionSideDirection.get(closingKey);
    const orderKey = `${raw.symbol}:${raw.orderId}`;
    const isClosing = isBinanceClosingTrade(raw)
      || closingOrderKeySet.has(orderKey)
      || (closingPool !== undefined && closingPool.quantity > 0);

    if (!isClosing) {
      const openingPool = openingPoolBySymbolPositionSideDirection.get(openingKey) ?? { commission: 0, quantity: 0, isTradingFeeComplete: true };

      if (openingPool.quantity === 0) {
        openingPool.commission = 0;
        openingPool.isTradingFeeComplete = true;
      }

      openingPool.isTradingFeeComplete = openingPool.isTradingFeeComplete && isCommissionKnown;
      openingPool.commission += knownCommission;
      openingPool.quantity += quantity;
      openingPoolBySymbolPositionSideDirection.set(openingKey, openingPool);

      continue;
    }

    const quantityTolerance = closingPool === undefined
      ? 0
      : Number.EPSILON * Math.max(closingPool.quantity, quantity) * 8;
    const isTradingFeeComplete = closingPool !== undefined
      && closingPool.quantity + quantityTolerance >= quantity
      && closingPool.isTradingFeeComplete
      && isCommissionKnown;
    const openingShare = closingPool !== undefined && closingPool.quantity > 0
      ? closingPool.commission * Math.min(quantity / closingPool.quantity, 1)
      : 0;

    if (closingPool !== undefined) {
      closingPool.commission -= openingShare;
      closingPool.quantity = Math.max(closingPool.quantity - quantity, 0);
    }

    const group = groupBySymbolOrderId.get(orderKey);

    if (group === undefined) {
      groupBySymbolOrderId.set(orderKey, {
        fillList: [raw],
        openingCommission: openingShare,
        closingCommission: knownCommission,
        isTradingFeeComplete,
      });
    } else {
      group.fillList.push(raw);
      group.openingCommission += openingShare;
      group.closingCommission += knownCommission;
      group.isTradingFeeComplete = group.isTradingFeeComplete && isTradingFeeComplete;
    }
  }

  const closedPnlList: ClosedPnl[] = [];

  for (const group of groupBySymbolOrderId.values()) {
    const { fillList } = group;
    const quantity = fillList.reduce((sum, raw) => sum + parseFloat(raw.qty), 0);

    if (quantity <= 0) {
      continue;
    }

    const grossPnl = fillList.reduce((sum, raw) => sum + parseFloat(raw.realizedPnl), 0);
    const commission = group.closingCommission + group.openingCommission;
    const exitPrice = fillList.reduce((sum, raw) => sum + parseFloat(raw.price) * parseFloat(raw.qty), 0) / quantity;
    const side = BINANCE_ORDER_SIDE[fillList[0].side] ?? OrderSideEnum.Buy;
    // Закрывающая покупка закрывает шорт, закрывающая продажа — лонг.
    const entryPrice = side === OrderSideEnum.Buy
      ? exitPrice + grossPnl / quantity
      : exitPrice - grossPnl / quantity;

    closedPnlList.push({
      symbol: fillList[0].symbol,
      orderId: String(fillList[0].orderId),
      positionSide: normalizeBinanceOrderPositionSide(fillList[0].positionSide),
      isTradingFeeComplete: group.isTradingFeeComplete,
      side,
      quantity,
      entryPrice,
      exitPrice,
      closedPnl: grossPnl - commission,
      timestamp: fillList.reduce((latest, raw) => Math.max(latest, raw.time), 0),
    });
  }

  return closedPnlList;
}

export interface BinanceDepthWebSocketRaw {
  e: string;
  E: number;
  s: string;
  U?: number;
  u: number;
  b: OrderBookRawLevel[];
  a: OrderBookRawLevel[];
}

/**
 * Кадр стакана из потока. Мы подписываемся на «частичную глубину» — биржа присылает готовый
 * срез верхних уровней, а не поправку к предыдущему, поэтому вид кадра всегда «снимок».
 * Форма ответа общая с соседней биржей: склейку делает потребитель, а не слой связи.
 */
export function normalizeBinanceOrderBookUpdate(
  raw: BinanceDepthWebSocketRaw,
  symbol: string,
  receivedTimestamp: number,
): OrderBookUpdate {
  return {
    symbol,
    updateType: 'snapshot',
    bidList: Array.isArray(raw.b) ? raw.b : [],
    askList: Array.isArray(raw.a) ? raw.a : [],
    updateId: Number(raw.u),
    eventTimestamp: Number(raw.E),
    receivedTimestamp,
  };
}

export function normalizeBinanceOrderBook(raw: BinanceOrderBookRaw, symbol: string): OrderBook {
  return {
    symbol,
    askList: raw.asks.map(parseOrderBookLevel),
    bidList: raw.bids.map(parseOrderBookLevel),
    timestamp: raw.T ?? raw.E ?? Date.now(),
    updateId: raw.lastUpdateId,
    eventTimestamp: raw.E,
  };
}

export function normalizeBinancePublicTrades(rawList: BinancePublicTradeRaw[], symbol: string): PublicTrade[] {
  return rawList.map((raw) => ({
    id: String(raw.id),
    symbol,
    price: parseFloat(raw.price),
    quantity: parseFloat(raw.qty),
    quoteQuantity: parseFloat(raw.quoteQty),
    timestamp: raw.time,
    isBuyerMaker: raw.isBuyerMaker,
  }));
}

export function normalizeBinanceAggTradeFromStream(raw: BinanceAggTradeWebSocketRaw): PublicTrade {
  const price = parseFloat(raw.p);
  const quantity = parseFloat(raw.q);

  return {
    id: String(raw.a),
    symbol: raw.s,
    price,
    quantity,
    quoteQuantity: price * quantity,
    timestamp: raw.T,
    isBuyerMaker: raw.m,
    side: raw.m ? OrderSideEnum.Sell : OrderSideEnum.Buy,
  };
}

export function normalizeBinanceMarkPriceList(rawList: BinanceMarkPriceRaw[]): MarkPrice[] {
  return rawList.map((raw) => ({
    symbol: raw.symbol,
    markPrice: parseFloat(raw.markPrice),
    indexPrice: raw.indexPrice !== undefined ? parseFloat(raw.indexPrice) : undefined,
    lastFundingRate: parseFloat(raw.lastFundingRate),
    nextFundingTime: raw.nextFundingTime,
    timestamp: raw.time,
  }));
}

export function normalizeBinanceMarkPriceWebSocketList(
  rawList: BinanceMarkPriceWebSocketRaw[],
): MarkPriceUpdate[] {
  return rawList.map((raw) => ({
    symbol: raw.s,
    markPrice: parseFloat(raw.p),
    indexPrice: raw.i !== '' ? parseFloat(raw.i) : 0,
    timestamp: raw.E,
  }));
}

export function normalizeBinanceOpenInterest(raw: BinanceOpenInterestRaw): OpenInterest {
  return {
    symbol: raw.symbol,
    openInterest: parseFloat(raw.openInterest),
    timestamp: raw.time,
  };
}

export function normalizeBinanceCommissionRate(raw: BinanceCommissionRateRaw): FeeRate[] {
  return [{
    symbol: raw.symbol,
    makerRate: parseFloat(raw.makerCommissionRate),
    takerRate: parseFloat(raw.takerCommissionRate),
  }];
}

export function normalizeBinanceIncomeList(rawList: BinanceIncomeRaw[]): Income[] {
  return rawList.map((raw) => ({
    symbol: raw.symbol,
    incomeType: raw.incomeType,
    kind: resolveBinanceIncomeKind(raw.incomeType),
    income: parseFloat(raw.income),
    asset: raw.asset,
    timestamp: raw.time,
    info: { tranId: raw.tranId, tradeId: raw.tradeId, info: raw.info },
  }));
}

export interface BinanceLeverageBracketItemRaw {
  bracket: number;
  initialLeverage: number;
  notionalCap: number;
  notionalFloor: number;
  maintMarginRatio: number;
  cum: number;
}

export interface BinanceLeverageBracketRaw {
  symbol: string;
  brackets: BinanceLeverageBracketItemRaw[];
}

export function normalizeBinanceLeverageBracketList(
  rawList: BinanceLeverageBracketRaw[],
): LeverageTierListBySymbol {
  const tierListBySymbol: LeverageTierListBySymbol = new Map();

  for (const raw of rawList) {
    const tierList: LeverageTier[] = [...raw.brackets]
      .sort((a, b) => a.notionalCap - b.notionalCap)
      .map((item) => ({
        maxLeverage: item.initialLeverage,
        maxNotional: item.notionalCap,
        maxBaseAmount: null,
        initialMarginRate: 1 / item.initialLeverage,
        maintenanceMarginRate: item.maintMarginRatio,
      }));

    tierListBySymbol.set(raw.symbol, tierList);
  }

  return tierListBySymbol;
}
