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
  PublicTrade,
  MarkPrice,
  MarkPriceUpdate,
  OpenInterest,
  FeeRate,
  Income,
  PriceLimitRisk,
} from '../types/common';
import { TradeSymbolTypeEnum, PositionSideEnum, MarginModeEnum, TimeInForceEnum } from '../types/common';
import { BINANCE_POSITION_SIDE, BINANCE_ORDER_SIDE, BINANCE_ORDER_TYPE, BINANCE_ORDER_STATUS, BINANCE_TIME_IN_FORCE } from '../constants/mappings';
import { parseOrderBookLevel } from './normalizerUtils';

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

export interface BinanceExchangeInfoRaw {
  symbols: BinanceSymbolRaw[];
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
  leverage: string;
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

export function normalizeBinanceTradeSymbols(raw: BinanceExchangeInfoRaw): TradeSymbolBySymbol {
  const result = new Map<string, TradeSymbol>();

  for (const symbol of raw.symbols) {
    const priceFilter = extractFilter(symbol.filters, 'PRICE_FILTER');
    const lotSizeFilter = extractFilter(symbol.filters, 'LOT_SIZE');
    const marketLotSizeFilter = extractFilter(symbol.filters, 'MARKET_LOT_SIZE');
    const minNotionalFilter = extractFilter(symbol.filters, 'MIN_NOTIONAL');
    const notionalFilter = extractFilter(symbol.filters, 'NOTIONAL');

    const rawContractType = symbol.contractType ?? '';
    const isPerp = rawContractType === 'PERPETUAL' || rawContractType === 'TRADIFI_PERPETUAL';
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

export function normalizeBinancePosition(raw: BinancePositionRiskRaw): Position {
  const side = BINANCE_POSITION_SIDE[raw.positionSide] ?? PositionSideEnum.Both;
  const marginMode: MarginModeEnum = raw.marginType === 'ISOLATED' ? MarginModeEnum.Isolated : MarginModeEnum.Cross;
  const liquidationPriceRaw = parseFloat(raw.liquidationPrice);

  return {
    symbol: raw.symbol,
    side,
    contracts: parseFloat(raw.positionAmt),
    entryPrice: parseFloat(raw.entryPrice),
    markPrice: parseFloat(raw.markPrice),
    unrealizedPnl: parseFloat(raw.unRealizedProfit),
    leverage: parseFloat(raw.leverage),
    marginMode,
    liquidationPrice: isNaN(liquidationPriceRaw) ? 0 : liquidationPriceRaw,
    info: raw,
  };
}

export function normalizeBinanceOrder(raw: BinanceOrderResponseRaw): Order {
  return {
    id: String(raw.orderId),
    clientOrderId: raw.clientOrderId ?? '',
    symbol: raw.symbol,
    side: BINANCE_ORDER_SIDE[raw.side],
    type: BINANCE_ORDER_TYPE[raw.type] ?? raw.type.toLowerCase() as never,
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

export function normalizeBinanceBalances(raw: BinanceAccountRaw): AccountBalances {
  const result = new Map<string, Balance>();

  for (const entry of raw.balances) {
    const free = parseFloat(entry.free);
    const locked = parseFloat(entry.locked);

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
  const totalAvailableBalance = parseFloat(raw.availableBalance);

  return { totalWalletBalance, totalAvailableBalance, balanceByAsset: result };
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

export function normalizeBinanceMarkPriceList(rawList: BinanceMarkPriceRaw[]): MarkPrice[] {
  return rawList.map((raw) => ({
    symbol: raw.symbol,
    markPrice: parseFloat(raw.markPrice),
    indexPrice: parseFloat(raw.indexPrice),
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
