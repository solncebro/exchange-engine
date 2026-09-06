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
} from '../types/common';
import { TradeSymbolTypeEnum, PositionSideEnum, MarginModeEnum, TimeInForceEnum, OrderSideEnum } from '../types/common';
import type { OrderRateLimit } from '../types/exchange';
import { BINANCE_POSITION_SIDE, BINANCE_POSITION_IDX, BINANCE_ORDER_SIDE, BINANCE_ORDER_TYPE, BINANCE_ORDER_STATUS, BINANCE_ALGO_STATUS, BINANCE_TIME_IN_FORCE } from '../constants/mappings';
import { parseOrderBookLevel } from './normalizerUtils';
import { isConditionalOrderType } from '../constants/orderTypes';

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

export interface BinanceTicker24hrRaw {
  symbol: string;
  lastPrice: string;
  openPrice: string;
  highPrice: string;
  lowPrice: string;
  priceChangePercent: string;
  volume: string;
  quoteVolume: string;
  time: number;
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

export interface BinancePositionRiskRaw {
  symbol: string;
  positionSide: string;
  positionAmt: string;
  entryPrice: string;
  markPrice: string;
  unRealizedProfit: string;
  leverage?: string;
  marginType: string;
  liquidationPrice: string;
  notional: string;
  isolatedMargin: string;
  [key: string]: unknown;
}

export interface BinanceOrderResponseRaw {
  orderId: number;
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
  algoId: number;
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
      settle: isPerp ? 'USDT' : '',
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
      timestamp: raw.time,
    };

    result.set(raw.symbol, ticker);
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

export function normalizeBinancePosition(raw: BinancePositionRiskRaw): Position {
  const side = BINANCE_POSITION_SIDE[raw.positionSide] ?? PositionSideEnum.Both;
  const direction = resolveBinanceDirection(raw);
  const marginMode: MarginModeEnum = raw.marginType === 'ISOLATED' ? MarginModeEnum.Isolated : MarginModeEnum.Cross;
  const liquidationPriceRaw = parseFloat(raw.liquidationPrice);
  const rawContracts = parseFloat(raw.positionAmt);
  const safeContracts = Number.isFinite(rawContracts) ? Math.abs(rawContracts) : 0;
  const rawLeverage = parseFloat(raw.leverage ?? '');
  const safeLeverage = Number.isFinite(rawLeverage) ? rawLeverage : 0;

  return {
    symbol: raw.symbol,
    side,
    direction,
    contracts: safeContracts,
    entryPrice: parseFloat(raw.entryPrice),
    markPrice: parseFloat(raw.markPrice),
    unrealizedPnl: parseFloat(raw.unRealizedProfit),
    leverage: safeLeverage,
    marginMode,
    liquidationPrice: isNaN(liquidationPriceRaw) ? 0 : liquidationPriceRaw,
    // Какая из двух сторон — сведения, которые уже есть в ответе, поэтому заполняются ЗДЕСЬ,
    // на всех путях чтения сразу: раньше три метода дописывали это вручную, а четвёртый
    // забывал, и читатель в двустороннем режиме не понимал, какую позицию ему дали.
    // Односторонний режим помечается нулём — тем же числом, что и у соседней биржи.
    positionIdx: BINANCE_POSITION_IDX[raw.positionSide] ?? 0,
    info: raw,
  };
}

export function normalizeBinanceOrder(raw: BinanceOrderResponseRaw): Order {
  const type = BINANCE_ORDER_TYPE[raw.type] ?? raw.type.toLowerCase() as never;

  return {
    id: String(raw.orderId),
    clientOrderId: raw.clientOrderId ?? '',
    symbol: raw.symbol,
    side: BINANCE_ORDER_SIDE[raw.side] ?? OrderSideEnum.Buy,
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

  return typeof candidate.orderId === 'number' && typeof candidate.type === 'string';
}

export function isBinanceAlgoOrderRaw(value: unknown): value is BinanceAlgoOrderRaw {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<BinanceAlgoOrderRaw>;

  return typeof candidate.algoId === 'number' && typeof candidate.orderType === 'string';
}

export function normalizeBinanceAlgoOrder(raw: BinanceAlgoOrderRaw): Order {
  const triggeredOrderId =
    raw.actualOrderId !== undefined && raw.actualOrderId !== '' ? raw.actualOrderId : undefined;

  return {
    id: String(raw.algoId),
    clientOrderId: raw.clientAlgoId ?? '',
    symbol: raw.symbol,
    side: BINANCE_ORDER_SIDE[raw.side] ?? OrderSideEnum.Buy,
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
  id: number;
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
  tranId: number;
  tradeId: string;
}

export interface BinanceUserTradeRaw {
  id: number;
  orderId: number;
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

/**
 * Итог закрытия из собственных сделок счёта. Готовой ручки у Binance нет, а у Bybit есть, и
 * потребитель обязан получать одно и то же — включая СМЫСЛ полей:
 *
 * - `closedPnl` — итог ЧИСТЫЙ, после комиссии (у Bybit он приходит таким же — сверено
 *   арифметикой на примере из их документации). Binance отдаёт валовой, поэтому комиссия
 *   вычитается здесь.
 * - `entryPrice` — у Binance его в сделках нет вовсе, поэтому он выводится из тождества
 *   «валовой итог = (вход − выход) × объём» для шорта и наоборот для лонга. Так сохраняется
 *   свойство, на которое опираются потребители: валовой минус чистый равен комиссии.
 *
 * Заполнения, ничего не закрывшие (открытие позиции), пропускаются — у них нулевой итог.
 */
interface BinanceClosingGroup {
  fillList: BinanceUserTradeRaw[];
  /** Доля комиссии ОТКРЫТИЯ, приходящаяся на закрытый этой заявкой объём. */
  openingCommission: number;
}

export function buildBinanceClosedPnlList(rawList: BinanceUserTradeRaw[]): ClosedPnl[] {
  const groupByOrderId = new Map<string, BinanceClosingGroup>();
  // Комиссию за вход биржа берёт в момент открытия, когда закрывать ещё нечего. Копим её и
  // раздаём закрывающим заявкам пропорционально закрытому объёму — иначе итог сделки
  // окажется завышен ровно на комиссию входа (замерено на живом счёте: 7.03$ за неделю).
  let openingCommissionPool = 0;
  let openQuantityPool = 0;

  const chronologicalList = [...rawList].sort((left, right) => left.time - right.time || left.id - right.id);

  for (const raw of chronologicalList) {
    const quantity = parseFloat(raw.qty);

    if (parseFloat(raw.realizedPnl) === 0) {
      openingCommissionPool += parseFloat(raw.commission);
      openQuantityPool += quantity;

      continue;
    }

    const openingShare = openQuantityPool > 0
      ? openingCommissionPool * Math.min(quantity / openQuantityPool, 1)
      : 0;
    openingCommissionPool -= openingShare;
    openQuantityPool = Math.max(openQuantityPool - quantity, 0);

    const orderId = String(raw.orderId);
    const group = groupByOrderId.get(orderId);

    if (group === undefined) {
      groupByOrderId.set(orderId, { fillList: [raw], openingCommission: openingShare });
    } else {
      group.fillList.push(raw);
      group.openingCommission += openingShare;
    }
  }

  const closedPnlList: ClosedPnl[] = [];

  for (const [orderId, group] of groupByOrderId) {
    const { fillList } = group;
    const quantity = fillList.reduce((sum, raw) => sum + parseFloat(raw.qty), 0);

    if (quantity <= 0) {
      continue;
    }

    const grossPnl = fillList.reduce((sum, raw) => sum + parseFloat(raw.realizedPnl), 0);
    const commission = fillList.reduce((sum, raw) => sum + parseFloat(raw.commission), 0) + group.openingCommission;
    const exitPrice = fillList.reduce((sum, raw) => sum + parseFloat(raw.price) * parseFloat(raw.qty), 0) / quantity;
    const side = BINANCE_ORDER_SIDE[fillList[0].side] ?? OrderSideEnum.Buy;
    // Закрывающая покупка закрывает шорт, закрывающая продажа — лонг.
    const entryPrice = side === OrderSideEnum.Buy
      ? exitPrice + grossPnl / quantity
      : exitPrice - grossPnl / quantity;

    closedPnlList.push({
      symbol: fillList[0].symbol,
      orderId,
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
    income: parseFloat(raw.income),
    asset: raw.asset,
    timestamp: raw.time,
    info: { tranId: raw.tranId, tradeId: raw.tradeId, info: raw.info },
  }));
}
