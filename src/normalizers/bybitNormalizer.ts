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
} from '../types/common';
import { TradeSymbolType, PositionSide, MarginMode } from '../types/common';
import { BYBIT_POSITION_SIDE, BYBIT_ORDER_STATUS, BYBIT_ORDER_SIDE, BYBIT_ORDER_TYPE } from '../constants/mappings';
import type { CreateOrderWebSocketArgs } from '../types/exchange';

interface BybitLotSizeFilterRaw {
  basePrecision?: string;
  qtyStep?: string;
  minOrderQty?: string;
  maxOrderQty?: string;
  minNotionalValue?: string;
  minOrderAmt?: string;
}

interface BybitPriceFilterRaw {
  tickSize?: string;
}

export interface BybitInstrumentInfoRaw {
  symbol: string;
  status: string;
  baseCoin: string;
  quoteCoin: string;
  settleCoin?: string;
  contractType?: string;
  contractSize?: string;
  lotSizeFilter?: BybitLotSizeFilterRaw;
  priceFilter?: BybitPriceFilterRaw;
}

export interface BybitTickerRaw {
  symbol: string;
  lastPrice: string;
  price24hPcnt: string;
  time?: number;
}

export interface BybitWebSocketKlineRaw {
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

export interface BybitPositionRaw {
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
  [key: string]: unknown;
}

export interface BybitOrderResponseRaw {
  orderId: string;
  symbol: string;
  side: string;
  orderType: string;
  qty: string;
  price: string;
  orderStatus: string;
  createdTime: string;
}

interface BybitCoinRaw {
  coin: string;
  availableToWithdraw?: string;
  walletBalance?: string;
  free?: string;
  locked?: string;
  frozenAmount?: string;
}

export interface BybitWalletBalanceRaw {
  list: BybitCoinRaw[];
}

const LINEAR_CONTRACT_TYPES = new Set(['LinearPerpetual', 'LinearFutures']);

export function normalizeBybitTradeSymbols(rawList: BybitInstrumentInfoRaw[]): TradeSymbolBySymbol {
  const result = new Map<string, TradeSymbol>();

  for (const raw of rawList) {
    const isLinear = LINEAR_CONTRACT_TYPES.has(raw.contractType ?? '');
    const isSpot = raw.contractType === undefined || raw.contractType === '';

    let tradeSymbolType: TradeSymbolType = TradeSymbolType.Future;

    if (isLinear) {
      tradeSymbolType = TradeSymbolType.Swap;
    } else if (isSpot) {
      tradeSymbolType = TradeSymbolType.Spot;
    }

    const tradeSymbol: TradeSymbol = {
      symbol: raw.symbol,
      baseAsset: raw.baseCoin,
      quoteAsset: raw.quoteCoin,
      settle: isLinear ? (raw.settleCoin ?? 'USDT') : '',
      isActive: raw.status === 'Trading',
      type: tradeSymbolType,
      isLinear,
      contractSize: parseFloat(raw.contractSize ?? '1'),
      filter: {
        tickSize: raw.priceFilter?.tickSize ?? '0',
        stepSize: raw.lotSizeFilter?.qtyStep ?? raw.lotSizeFilter?.basePrecision ?? '0',
        minQty: raw.lotSizeFilter?.minOrderQty ?? '0',
        maxQty: raw.lotSizeFilter?.maxOrderQty ?? '0',
        minNotional: raw.lotSizeFilter?.minNotionalValue
          ?? raw.lotSizeFilter?.minOrderAmt
          ?? '0',
      },
    };

    result.set(raw.symbol, tradeSymbol);
  }

  return result;
}

export function normalizeBybitTickers(rawList: BybitTickerRaw[]): TickerBySymbol {
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
    openTimestamp: parseFloat(row[0]),
    openPrice: parseFloat(row[1]),
    highPrice: parseFloat(row[2]),
    lowPrice: parseFloat(row[3]),
    closePrice: parseFloat(row[4]),
    volume: parseFloat(row[5]),
    closeTimestamp: 0,
    quoteAssetVolume: parseFloat(row[6]),
    numberOfTrades: 0,
    takerBuyBaseAssetVolume: 0,
    takerBuyQuoteAssetVolume: 0,
  }));
}

export function normalizeBybitKlineWebSocketMessage(raw: BybitWebSocketKlineRaw): Kline {
  return {
    openTimestamp: raw.start,
    openPrice: parseFloat(raw.open),
    highPrice: parseFloat(raw.high),
    lowPrice: parseFloat(raw.low),
    closePrice: parseFloat(raw.close),
    volume: parseFloat(raw.volume),
    closeTimestamp: raw.timestamp,
    quoteAssetVolume: parseFloat(raw.turnover),
    numberOfTrades: 0,
    takerBuyBaseAssetVolume: 0,
    takerBuyQuoteAssetVolume: 0,
  };
}

export function normalizeBybitPosition(raw: BybitPositionRaw): Position {
  const side = BYBIT_POSITION_SIDE[raw.side] ?? PositionSide.Both;
  const marginMode: MarginMode = raw.tradeMode === 0 ? MarginMode.Cross : MarginMode.Isolated;
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
    info: raw,
  };
}

export function normalizeBybitOrder(raw: BybitOrderResponseRaw): Order {
  const status = BYBIT_ORDER_STATUS[raw.orderStatus] ?? raw.orderStatus.toLowerCase();

  return {
    id: raw.orderId,
    symbol: raw.symbol,
    side: BYBIT_ORDER_SIDE[raw.side],
    type: BYBIT_ORDER_TYPE[raw.orderType],
    amount: parseFloat(raw.qty),
    price: parseFloat(raw.price),
    status,
    timestamp: parseFloat(raw.createdTime),
  };
}

export function buildBybitOrderFromCreateResponse(args: CreateOrderWebSocketArgs, orderId: string): Order {
  return {
    id: orderId,
    symbol: args.symbol,
    side: args.side,
    type: args.type,
    amount: args.amount,
    price: args.price,
    status: 'open',
    timestamp: Date.now(),
  };
}

export function normalizeBybitBalance(raw: BybitWalletBalanceRaw): BalanceByAsset {
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
