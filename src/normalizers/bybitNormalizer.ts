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
  OrderBook,
  PublicTrade,
  MarkPrice,
  OpenInterest,
  FeeRate,
  FundingRateHistory,
  ClosedPnl,
  Income,
} from '../types/common';
import { TradeSymbolTypeEnum, PositionSideEnum, MarginModeEnum, TimeInForceEnum, OrderSideEnum } from '../types/common';
import { BYBIT_POSITION_SIDE, BYBIT_ORDER_STATUS, BYBIT_ORDER_SIDE, BYBIT_ORDER_TYPE, BYBIT_TIME_IN_FORCE } from '../constants/mappings';
import { parseOrderBookLevel } from './normalizerUtils';
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
  prevPrice24h: string;
  highPrice24h: string;
  lowPrice24h: string;
  price24hPcnt: string;
  volume24h: string;
  turnover24h: string;
  markPrice?: string;
  indexPrice?: string;
  fundingRate?: string;
  nextFundingTime?: string;
  time?: number;
}

export interface BybitWebSocketKlineRaw {
  start: number;
  end?: number;
  interval?: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  turnover: string;
  confirm: boolean;
  timestamp: number;
}

export interface BybitPublicTradeDataRaw {
  T: number;
  s: string;
  p: string;
  v: string;
}

export interface BybitWebSocketMessageRaw<T> {
  topic: string;
  type: string;
  ts: number;
  data: T[];
}

export type BybitKlineMessageRaw = BybitWebSocketMessageRaw<BybitWebSocketKlineRaw>;
export type BybitTradeMessageRaw = BybitWebSocketMessageRaw<BybitPublicTradeDataRaw>;

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
  orderLinkId: string;
  symbol: string;
  side: string;
  orderType: string;
  timeInForce: string;
  qty: string;
  price: string;
  avgPrice: string;
  triggerPrice: string;
  cumExecQty: string;
  cumExecValue: string;
  orderStatus: string;
  reduceOnly: boolean;
  createdTime: string;
  updatedTime: string;
}

interface BybitCoinRaw {
  coin: string;
  availableToWithdraw?: string;
  walletBalance?: string;
  totalOrderIM?: string;
  totalPositionIM?: string;
  free?: string;
  locked?: string;
  frozenAmount?: string;
}

interface BybitAccountRaw {
  accountType: string;
  totalWalletBalance?: string;
  totalAvailableBalance?: string;
  totalMarginBalance?: string;
  totalInitialMargin?: string;
  coin: BybitCoinRaw[];
}

export interface BybitWalletBalanceRaw {
  list: BybitAccountRaw[];
}

export interface BybitOrderBookRaw {
  a: string[][];
  b: string[][];
  ts: number;
  u: number;
}

export interface BybitPublicTradeRaw {
  execId: string;
  symbol: string;
  price: string;
  size: string;
  side: string;
  time: string;
  isBlockTrade: boolean;
}

export interface BybitOpenInterestRaw {
  openInterest: string;
  timestamp: string;
}

export interface BybitFeeRateRaw {
  symbol: string;
  makerFeeRate: string;
  takerFeeRate: string;
}

export interface BybitFundingRateHistoryRaw {
  symbol: string;
  fundingRate: string;
  fundingRateTimestamp: string;
}

export interface BybitClosedPnlRaw {
  symbol: string;
  orderId: string;
  side: string;
  qty: string;
  avgEntryPrice: string;
  avgExitPrice: string;
  closedPnl: string;
  createdTime: string;
}

export interface BybitTransactionLogRaw {
  symbol: string;
  type: string;
  qty: string;
  cashFlow: string;
  currency: string;
  transactionTime: string;
  tradeId: string;
  orderId: string;
}

const LINEAR_CONTRACT_TYPES = new Set(['LinearPerpetual', 'LinearFutures']);

export function normalizeBybitTradeSymbols(rawList: BybitInstrumentInfoRaw[]): TradeSymbolBySymbol {
  const result = new Map<string, TradeSymbol>();

  for (const raw of rawList) {
    const isLinear = LINEAR_CONTRACT_TYPES.has(raw.contractType ?? '');
    const isSpot = raw.contractType === undefined || raw.contractType === '';

    let tradeSymbolType: TradeSymbolTypeEnum = TradeSymbolTypeEnum.Future;

    if (isLinear) {
      tradeSymbolType = TradeSymbolTypeEnum.Swap;
    } else if (isSpot) {
      tradeSymbolType = TradeSymbolTypeEnum.Spot;
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
      contractType: raw.contractType ?? '',
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
      lastPrice: parseFloat(raw.lastPrice),
      openPrice: parseFloat(raw.prevPrice24h ?? '0'),
      highPrice: parseFloat(raw.highPrice24h ?? '0'),
      lowPrice: parseFloat(raw.lowPrice24h ?? '0'),
      priceChangePercent: parseFloat(raw.price24hPcnt) * 100,
      volume: parseFloat(raw.volume24h ?? '0'),
      quoteVolume: parseFloat(raw.turnover24h ?? '0'),
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
    isClosed: raw.confirm,
  };
}

export function normalizeBybitPosition(raw: BybitPositionRaw): Position {
  const side = BYBIT_POSITION_SIDE[raw.side] ?? PositionSideEnum.Both;
  const marginMode: MarginModeEnum = raw.tradeMode === 0 ? MarginModeEnum.Cross : MarginModeEnum.Isolated;
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
    clientOrderId: raw.orderLinkId ?? '',
    symbol: raw.symbol,
    side: BYBIT_ORDER_SIDE[raw.side],
    type: BYBIT_ORDER_TYPE[raw.orderType] ?? raw.orderType.toLowerCase() as never,
    timeInForce: BYBIT_TIME_IN_FORCE[raw.timeInForce] ?? TimeInForceEnum.Gtc,
    price: parseFloat(raw.price),
    avgPrice: parseFloat(raw.avgPrice ?? '0'),
    stopPrice: parseFloat(raw.triggerPrice ?? '0'),
    amount: parseFloat(raw.qty),
    filledAmount: parseFloat(raw.cumExecQty ?? '0'),
    filledQuoteAmount: parseFloat(raw.cumExecValue ?? '0'),
    status,
    reduceOnly: raw.reduceOnly ?? false,
    timestamp: parseFloat(raw.createdTime),
    updatedTimestamp: parseFloat(raw.updatedTime ?? raw.createdTime),
  };
}

export function buildBybitOrderFromCreateResponse(args: CreateOrderWebSocketArgs, orderId: string): Order {
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
    amount: args.amount,
    filledAmount: 0,
    filledQuoteAmount: 0,
    status: 'open',
    reduceOnly: args.reduceOnly ?? false,
    timestamp: Date.now(),
    updatedTimestamp: Date.now(),
  };
}

export function normalizeBybitBalances(raw: BybitWalletBalanceRaw): AccountBalances {
  const balanceByAsset = new Map<string, Balance>();

  for (const account of raw.list) {
    for (const coin of account.coin) {
      const walletBalance = parseFloat(coin.walletBalance ?? '0');
      const totalOrderIM = coin.totalOrderIM ? parseFloat(coin.totalOrderIM) : 0;
      const totalPositionIM = coin.totalPositionIM ? parseFloat(coin.totalPositionIM) : 0;
      const free = walletBalance - totalPositionIM - totalOrderIM;
      const frozen = parseFloat(coin.frozenAmount ?? coin.locked ?? '0');
      const locked = isNaN(frozen) ? walletBalance - free : frozen;

      if (free + locked === 0) {
        continue;
      }

      const existing = balanceByAsset.get(coin.coin);

      if (existing !== undefined) {
        const balance: Balance = {
          asset: coin.coin,
          free: existing.free + free,
          locked: existing.locked + locked,
          total: existing.total + free + locked,
        };

        balanceByAsset.set(coin.coin, balance);

        continue;
      }

      const balance: Balance = {
        asset: coin.coin,
        free,
        locked,
        total: free + locked,
      };

      balanceByAsset.set(coin.coin, balance);
    }
  }

  const primaryAccount = raw.list[0];
  const rawTotalWallet = primaryAccount?.totalWalletBalance ?? '';
  const rawTotalAvailable = primaryAccount?.totalAvailableBalance ?? '';
  const rawTotalMargin = primaryAccount?.totalMarginBalance ?? '';
  const rawTotalInitialMargin = primaryAccount?.totalInitialMargin ?? '';

  let totalWalletBalance = parseFloat(rawTotalWallet);

  if (isNaN(totalWalletBalance)) {
    totalWalletBalance = 0;

    for (const balance of balanceByAsset.values()) {
      totalWalletBalance += balance.total;
    }
  }

  let totalAvailableBalance = parseFloat(rawTotalAvailable);

  if (isNaN(totalAvailableBalance)) {
    const marginBalance = parseFloat(rawTotalMargin);
    const initialMargin = parseFloat(rawTotalInitialMargin);

    if (!isNaN(marginBalance) && !isNaN(initialMargin)) {
      totalAvailableBalance = marginBalance - initialMargin;
    } else if (!isNaN(initialMargin)) {
      totalAvailableBalance = totalWalletBalance - initialMargin;
    } else {
      totalAvailableBalance = 0;

      for (const balance of balanceByAsset.values()) {
        totalAvailableBalance += balance.free;
      }
    }
  }

  return { totalWalletBalance, totalAvailableBalance, balanceByAsset };
}

export function normalizeBybitOrderBook(raw: BybitOrderBookRaw, symbol: string): OrderBook {
  return {
    symbol,
    askList: raw.a.map(parseOrderBookLevel),
    bidList: raw.b.map(parseOrderBookLevel),
    timestamp: raw.ts,
  };
}

export function normalizeBybitPublicTradeList(rawList: BybitPublicTradeRaw[]): PublicTrade[] {
  return rawList.map((raw) => ({
    id: raw.execId,
    symbol: raw.symbol,
    price: parseFloat(raw.price),
    quantity: parseFloat(raw.size),
    quoteQuantity: parseFloat(raw.price) * parseFloat(raw.size),
    timestamp: parseFloat(raw.time),
    isBuyerMaker: raw.side === 'Sell',
  }));
}

export function normalizeBybitMarkPriceList(rawList: BybitTickerRaw[]): MarkPrice[] {
  return rawList.map((raw) => ({
    symbol: raw.symbol,
    markPrice: parseFloat(raw.markPrice ?? '0'),
    indexPrice: parseFloat(raw.indexPrice ?? '0'),
    lastFundingRate: parseFloat(raw.fundingRate ?? '0'),
    nextFundingTime: parseFloat(raw.nextFundingTime ?? '0'),
    timestamp: raw.time ?? Date.now(),
  }));
}

export function normalizeBybitOpenInterest(raw: BybitOpenInterestRaw): OpenInterest {
  return {
    symbol: '',
    openInterest: parseFloat(raw.openInterest),
    timestamp: parseFloat(raw.timestamp),
  };
}

export function normalizeBybitFeeRateList(rawList: BybitFeeRateRaw[]): FeeRate[] {
  return rawList.map((raw) => ({
    symbol: raw.symbol,
    makerRate: parseFloat(raw.makerFeeRate),
    takerRate: parseFloat(raw.takerFeeRate),
  }));
}

export function normalizeBybitFundingRateHistoryList(rawList: BybitFundingRateHistoryRaw[]): FundingRateHistory[] {
  return rawList.map((raw) => ({
    symbol: raw.symbol,
    fundingRate: parseFloat(raw.fundingRate),
    fundingTime: parseFloat(raw.fundingRateTimestamp),
    markPrice: null,
  }));
}

export function normalizeBybitClosedPnlList(rawList: BybitClosedPnlRaw[]): ClosedPnl[] {
  return rawList.map((raw) => ({
    symbol: raw.symbol,
    orderId: raw.orderId,
    side: BYBIT_ORDER_SIDE[raw.side] ?? OrderSideEnum.Buy,
    quantity: parseFloat(raw.qty),
    entryPrice: parseFloat(raw.avgEntryPrice),
    exitPrice: parseFloat(raw.avgExitPrice),
    closedPnl: parseFloat(raw.closedPnl),
    timestamp: parseFloat(raw.createdTime),
  }));
}

export function normalizeBybitIncomeList(rawList: BybitTransactionLogRaw[]): Income[] {
  return rawList.map((raw) => ({
    symbol: raw.symbol,
    incomeType: raw.type,
    income: parseFloat(raw.cashFlow),
    asset: raw.currency,
    timestamp: parseFloat(raw.transactionTime),
    info: { tradeId: raw.tradeId, orderId: raw.orderId },
  }));
}
