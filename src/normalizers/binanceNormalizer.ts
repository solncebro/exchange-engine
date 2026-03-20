import type {
  Ticker,
  TickerBySymbol,
  Kline,
  TradeSymbol,
  TradeSymbolBySymbol,
  Position,
  Order,
  Balance,
  BalanceByAsset,
  FundingRateHistory,
  FundingInfo,
} from '../types/common';
import { TradeSymbolTypeEnum, PositionSideEnum, MarginModeEnum, TimeInForceEnum } from '../types/common';
import { BINANCE_POSITION_SIDE, BINANCE_ORDER_SIDE, BINANCE_ORDER_TYPE, BINANCE_ORDER_STATUS, BINANCE_TIME_IN_FORCE } from '../constants/mappings';

interface BinanceFilterRaw {
  filterType: string;
  tickSize?: string;
  stepSize?: string;
  minQty?: string;
  maxQty?: string;
  minNotional?: string;
  notional?: string;
}

interface BinanceSymbolRaw {
  symbol: string;
  status: string;
  baseAsset: string;
  quoteAsset: string;
  contractType?: string;
  marginAsset?: string;
  filters: BinanceFilterRaw[];
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
  assets: BinanceFuturesAssetRaw[];
}

function extractFilter(filterList: BinanceFilterRaw[], filterType: string): BinanceFilterRaw | undefined {
  return filterList.find((filter) => filter.filterType === filterType);
}

export function normalizeBinanceTradeSymbols(raw: BinanceExchangeInfoRaw): TradeSymbolBySymbol {
  const result = new Map<string, TradeSymbol>();

  for (const symbol of raw.symbols) {
    const priceFilter = extractFilter(symbol.filters, 'PRICE_FILTER');
    const lotSizeFilter = extractFilter(symbol.filters, 'LOT_SIZE');
    const minNotionalFilter =
      extractFilter(symbol.filters, 'MIN_NOTIONAL') ??
      extractFilter(symbol.filters, 'NOTIONAL');

    const isPerp = symbol.contractType === 'PERPETUAL';
    const isSpot = symbol.contractType === undefined || symbol.contractType === '';

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
      filter: {
        tickSize: priceFilter?.tickSize ?? '0',
        stepSize: lotSizeFilter?.stepSize ?? '0',
        minQty: lotSizeFilter?.minQty ?? '0',
        maxQty: lotSizeFilter?.maxQty ?? '0',
        minNotional: minNotionalFilter?.notional
          ?? minNotionalFilter?.minNotional
          ?? '0',
      },
    };

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

export function normalizeBinanceBalance(raw: BinanceAccountRaw): BalanceByAsset {
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

  return result;
}

export function normalizeBinanceFuturesBalance(raw: BinanceFuturesAccountRaw): BalanceByAsset {
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

  return result;
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
