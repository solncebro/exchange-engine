import {
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

interface BybitRawLotSizeFilter {
  qtyStep?: string;
  minOrderQty?: string;
  maxOrderQty?: string;
}

interface BybitRawPriceFilter {
  tickSize?: string;
}

export interface BybitRawInstrumentInfo {
  symbol: string;
  status: string;
  baseCoin: string;
  quoteCoin: string;
  settleCoin?: string;
  contractType?: string;
  contractSize?: string;
  lotSizeFilter?: BybitRawLotSizeFilter;
  priceFilter?: BybitRawPriceFilter;
}

export interface BybitRawTicker {
  symbol: string;
  lastPrice: string;
  price24hPcnt: string;
  time?: number;
}

export interface BybitRawWsKline {
  start: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  turnover: string;
  confirm: boolean;
  timestamp: number;
}

export interface BybitRawPosition {
  symbol: string;
  side: string;
  size: string;
  avgPrice: string;
  markPrice: string;
  unrealisedPnl: string;
  leverage: string;
  tradeMode: number;
  liqPrice: string;
  positionIdx: number;
}

export interface BybitRawOrderResponse {
  orderId: string;
  symbol: string;
  side: string;
  orderType: string;
  qty: string;
  price: string;
  orderStatus: string;
  createdTime: string;
}

interface BybitRawCoin {
  coin: string;
  availableToWithdraw?: string;
  walletBalance?: string;
  free?: string;
  locked?: string;
  frozenAmount?: string;
}

export interface BybitRawWalletBalance {
  list: BybitRawCoin[];
}

const LINEAR_CONTRACT_TYPES = new Set(['LinearPerpetual', 'LinearFutures']);

export function normalizeBybitMarkets(rawList: BybitRawInstrumentInfo[]): MarketBySymbol {
  const result = new Map<string, Market>();

  for (const raw of rawList) {
    const isLinear = LINEAR_CONTRACT_TYPES.has(raw.contractType ?? '');
    const isSpot = raw.contractType === undefined || raw.contractType === '';
    const market: Market = {
      symbol: raw.symbol,
      baseAsset: raw.baseCoin,
      quoteAsset: raw.quoteCoin,
      settle: isLinear ? (raw.settleCoin ?? 'USDT') : '',
      active: raw.status === 'Trading',
      type: isLinear ? 'swap' : isSpot ? 'spot' : 'future',
      linear: isLinear,
      contractSize: parseFloat(raw.contractSize ?? '1'),
      filter: {
        tickSize: raw.priceFilter?.tickSize ?? '0',
        stepSize: raw.lotSizeFilter?.qtyStep ?? '0',
        minQty: raw.lotSizeFilter?.minOrderQty ?? '0',
        maxQty: raw.lotSizeFilter?.maxOrderQty ?? '0',
      },
    };

    result.set(raw.symbol, market);
  }

  return result;
}

export function normalizeBybitTickers(rawList: BybitRawTicker[]): TickerBySymbol {
  const result = new Map<string, Ticker>();

  for (const raw of rawList) {
    const ticker: Ticker = {
      symbol: raw.symbol,
      close: parseFloat(raw.lastPrice),
      percentage: parseFloat(raw.price24hPcnt) * 100,
      timestamp: raw.time ?? Date.now(),
    };

    result.set(raw.symbol, ticker);
  }

  return result;
}

export function normalizeBybitKlines(rawList: string[][]): Kline[] {
  return rawList.map((row) => ({
    openTime: parseFloat(row[0]),
    open: parseFloat(row[1]),
    high: parseFloat(row[2]),
    low: parseFloat(row[3]),
    close: parseFloat(row[4]),
    volume: parseFloat(row[5]),
    closeTime: 0,
    quoteVolume: parseFloat(row[6]),
    trades: 0,
  }));
}

export function normalizeBybitKlineWsMessage(raw: BybitRawWsKline): Kline {
  return {
    openTime: raw.start,
    open: parseFloat(raw.open),
    high: parseFloat(raw.high),
    low: parseFloat(raw.low),
    close: parseFloat(raw.close),
    volume: parseFloat(raw.volume),
    closeTime: raw.timestamp,
    quoteVolume: parseFloat(raw.turnover),
    trades: 0,
  };
}

export function normalizeBybitPosition(raw: BybitRawPosition): Position {
  const sideMap: Record<string, PositionSide> = {
    Buy: 'long',
    Sell: 'short',
  };

  const side: PositionSide = sideMap[raw.side] ?? 'both';
  const marginMode: MarginMode = raw.tradeMode === 0 ? 'cross' : 'isolated';
  const liquidationPriceRaw = parseFloat(raw.liqPrice);

  return {
    symbol: raw.symbol,
    side,
    contracts: parseFloat(raw.size),
    entryPrice: parseFloat(raw.avgPrice),
    markPrice: parseFloat(raw.markPrice),
    unrealizedPnl: parseFloat(raw.unrealisedPnl),
    leverage: parseFloat(raw.leverage),
    marginMode,
    liquidationPrice: isNaN(liquidationPriceRaw) ? 0 : liquidationPriceRaw,
    info: raw as unknown as Record<string, unknown>,
  };
}

const BYBIT_ORDER_STATUS_MAP: Record<string, string> = {
  New: 'open',
  PartiallyFilled: 'open',
  Untriggered: 'open',
  Filled: 'closed',
  Cancelled: 'canceled',
  PartiallyFilledCanceled: 'canceled',
  Rejected: 'rejected',
  Deactivated: 'canceled',
};

export function normalizeBybitOrder(raw: BybitRawOrderResponse): Order {
  const status = BYBIT_ORDER_STATUS_MAP[raw.orderStatus] ?? raw.orderStatus.toLowerCase();

  return {
    id: raw.orderId,
    symbol: raw.symbol,
    side: raw.side.toLowerCase() as Order['side'],
    type: raw.orderType.toLowerCase() as Order['type'],
    amount: parseFloat(raw.qty),
    price: parseFloat(raw.price),
    status,
    timestamp: parseFloat(raw.createdTime),
  };
}

export function normalizeBybitBalance(raw: BybitRawWalletBalance): BalanceByAsset {
  const result = new Map<string, Balance>();

  for (const coin of raw.list) {
    const free = parseFloat(coin.availableToWithdraw ?? coin.free ?? '0');
    const walletBalance = parseFloat(coin.walletBalance ?? '0');
    const frozen = parseFloat(coin.frozenAmount ?? coin.locked ?? '0');
    const locked = isNaN(frozen) ? walletBalance - free : frozen;

    if (free + locked === 0) {
      continue;
    }

    const existing = result.get(coin.coin);

    if (existing !== undefined) {
      const balance: Balance = {
        asset: coin.coin,
        free: existing.free + free,
        locked: existing.locked + locked,
        total: existing.total + free + locked,
      };

      result.set(coin.coin, balance);

      continue;
    }

    const balance: Balance = {
      asset: coin.coin,
      free,
      locked,
      total: free + locked,
    };

    result.set(coin.coin, balance);
  }

  return result;
}
