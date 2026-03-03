import type {
  Ticker,
  TickerBySymbol,
  Kline,
  Market,
  MarketBySymbol,
  Position,
  PositionSide,
  MarginMode,
  Order,
  Balance,
  BalanceByAsset,
} from '../types/common';

interface BinanceRawFilter {
  filterType: string;
  tickSize?: string;
  stepSize?: string;
  minQty?: string;
  maxQty?: string;
  minNotional?: string;
  notional?: string;
}

interface BinanceRawSymbol {
  symbol: string;
  status: string;
  baseAsset: string;
  quoteAsset: string;
  contractType?: string;
  marginAsset?: string;
  filters: BinanceRawFilter[];
}

export interface BinanceRawExchangeInfo {
  symbols: BinanceRawSymbol[];
}

export interface BinanceRawTicker24hr {
  symbol: string;
  lastPrice: string;
  priceChangePercent: string;
  time: number;
}

export interface BinanceRawWsKline {
  t: number;
  o: string;
  h: string;
  l: string;
  c: string;
  v: string;
  T: number;
  q: string;
  n: number;
}

export interface BinanceRawPositionRisk {
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

export interface BinanceRawOrderResponse {
  orderId: number;
  symbol: string;
  side: string;
  type: string;
  origQty: string;
  price: string;
  status: string;
  updateTime: number;
}

interface BinanceRawBalance {
  asset: string;
  free: string;
  locked: string;
}

export interface BinanceRawAccount {
  balances: BinanceRawBalance[];
}

function extractFilter(filterList: BinanceRawFilter[], filterType: string): BinanceRawFilter | undefined {
  return filterList.find((filter) => filter.filterType === filterType);
}

export function normalizeBinanceMarkets(raw: BinanceRawExchangeInfo): MarketBySymbol {
  const result = new Map<string, Market>();

  for (const symbol of raw.symbols) {
    const priceFilter = extractFilter(symbol.filters, 'PRICE_FILTER');
    const lotSizeFilter = extractFilter(symbol.filters, 'LOT_SIZE');
    const minNotionalFilter =
      extractFilter(symbol.filters, 'MIN_NOTIONAL') ??
      extractFilter(symbol.filters, 'NOTIONAL');

    const isPerp = symbol.contractType === 'PERPETUAL';
    const isSpot = symbol.contractType === undefined || symbol.contractType === '';
    const market: Market = {
      symbol: symbol.symbol,
      baseAsset: symbol.baseAsset,
      quoteAsset: symbol.quoteAsset,
      settle: isPerp ? 'USDT' : '',
      active: symbol.status === 'TRADING',
      type: isPerp ? 'swap' : isSpot ? 'spot' : 'future',
      linear: isPerp,
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

    result.set(symbol.symbol, market);
  }

  return result;
}

export function normalizeBinanceTickers(rawList: BinanceRawTicker24hr[]): TickerBySymbol {
  const result = new Map<string, Ticker>();

  for (const raw of rawList) {
    const ticker: Ticker = {
      symbol: raw.symbol,
      close: parseFloat(raw.lastPrice),
      percentage: parseFloat(raw.priceChangePercent),
      timestamp: raw.time,
    };

    result.set(raw.symbol, ticker);
  }

  return result;
}

export function normalizeBinanceKlines(rawList: unknown[][]): Kline[] {
  return rawList.map((row) => ({
    openTimestamp: row[0] as number,
    open: parseFloat(row[1] as string),
    high: parseFloat(row[2] as string),
    low: parseFloat(row[3] as string),
    close: parseFloat(row[4] as string),
    volume: parseFloat(row[5] as string),
    closeTimestamp: row[6] as number,
    quoteVolume: parseFloat(row[7] as string),
    trades: row[8] as number,
  }));
}

export function normalizeBinanceKlineWsMessage(raw: BinanceRawWsKline): Kline {
  return {
    openTimestamp: raw.t,
    open: parseFloat(raw.o),
    high: parseFloat(raw.h),
    low: parseFloat(raw.l),
    close: parseFloat(raw.c),
    volume: parseFloat(raw.v),
    closeTimestamp: raw.T,
    quoteVolume: parseFloat(raw.q),
    trades: raw.n,
  };
}

export function normalizeBinancePosition(raw: BinanceRawPositionRisk): Position {
  const sideMap: Record<string, PositionSide> = {
    LONG: 'long',
    SHORT: 'short',
    BOTH: 'both',
  };

  const side: PositionSide = sideMap[raw.positionSide] ?? 'both';
  const marginMode: MarginMode = raw.marginType === 'ISOLATED' ? 'isolated' : 'cross';
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

export function normalizeBinanceOrder(raw: BinanceRawOrderResponse): Order {
  return {
    id: String(raw.orderId),
    symbol: raw.symbol,
    side: raw.side.toLowerCase() as Order['side'],
    type: raw.type.toLowerCase() as Order['type'],
    amount: parseFloat(raw.origQty),
    price: parseFloat(raw.price),
    status: raw.status.toLowerCase(),
    timestamp: raw.updateTime,
  };
}

export function normalizeBinanceBalance(raw: BinanceRawAccount): BalanceByAsset {
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
