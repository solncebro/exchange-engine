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
  AccountBalances,
  OrderBook,
  OrderBookRawLevel,
  OrderBookUpdate,
  OrderBookUpdateType,
  PublicTrade,
  MarkPrice,
  OpenInterest,
  FeeRate,
  FundingRateHistory,
  ClosedPnl,
  Income,
  LeverageFilter,
  PriceLimitRisk,
  TradingFunding,
} from '../types/common';
import { TradeSymbolTypeEnum, PositionSideEnum, MarginModeEnum, TimeInForceEnum, OrderSideEnum, OrderTypeEnum } from '../types/common';
import { BYBIT_POSITION_SIDE, BYBIT_ORDER_STATUS, BYBIT_ORDER_SIDE, BYBIT_ORDER_TYPE, BYBIT_TIME_IN_FORCE } from '../constants/mappings';
import { BYBIT_FUNDING_INCOME_TYPE_SET } from '../constants/bybit';
import { parseOrderBookLevel } from './normalizerUtils';
import { buildPlacedOrderOutcome, buildRejectedOrderOutcome } from './batchOrderOutcome';
import type { CreateOrderItemResult, CreateOrderWebSocketArgs } from '../types/exchange';

interface BybitLotSizeFilterRaw {
  basePrecision?: string;
  qtyStep?: string;
  minOrderQty?: string;
  maxOrderQty?: string;
  minNotionalValue?: string;
  minOrderAmt?: string;
  postOnlyMaxOrderQty?: string;
  maxMktOrderQty?: string;
  // Spot field names (V5 spot instruments-info). Bybit docs: maxOrderQty/maxOrderAmt are
  // deprecated for spot — maxLimitOrderQty / maxMarketOrderQty are the live caps.
  maxLimitOrderQty?: string;
  maxMarketOrderQty?: string;
}

interface BybitPriceFilterRaw {
  tickSize?: string;
  minPrice?: string;
  maxPrice?: string;
}

interface BybitLeverageFilterRaw {
  minLeverage?: string;
  maxLeverage?: string;
  leverageStep?: string;
}

interface BybitRiskParametersRaw {
  priceLimitRatioX?: string;
  priceLimitRatioY?: string;
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
  leverageFilter?: BybitLeverageFilterRaw;
  launchTime?: string;
  deliveryTime?: string;
  deliveryFeeRate?: string;
  priceScale?: string;
  unifiedMarginTrade?: boolean;
  fundingInterval?: number;
  copyTrading?: string;
  upperFundingRate?: string;
  lowerFundingRate?: string;
  isPreListing?: boolean;
  preListingInfo?: unknown;
  riskParameters?: BybitRiskParametersRaw;
  displayName?: string;
  symbolType?: string;
  forbidUplWithdrawal?: boolean;
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
  bid1Price?: string;
  bid1Size?: string;
  ask1Price?: string;
  ask1Size?: string;
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
  S?: string;
  i?: string;
  BT?: boolean;
  L?: string;
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
  /** Только Market или Limit: «условность» Bybit держит в отдельном поле ниже. */
  orderType: string;
  /**
   * Чем именно является защитная заявка: Stop, TakeProfit, StopLoss, TrailingStop и прочие.
   * У обычной заявки пусто. Проверено на живой заявке 08.08.2026: у сработавшего стопа
   * orderType=Market, stopOrderType=Stop, у обычной лимитной оба поля обычные.
   */
  stopOrderType?: string;
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
  /** Долларовая оценка остатка монеты по курсу биржи. Именно из неё биржа складывает
   *  totalWalletBalance — проверено сложением на живом счёте 29.08.2026. */
  usdValue?: string;
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
  s?: string;
  seq?: number;
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
  /** Накопленная стоимость входа и выхода — точные суммы исполнений, по ним считается валовой итог. */
  cumEntryValue: string;
  cumExitValue: string;
  /** Комиссии открытия и закрытия позиции, положительное число = списано. */
  openFee: string;
  closeFee: string;
  /** Биржевой итог: за вычетом обеих комиссий И фандинга за жизнь позиции — наружу не отдаётся,
   *  см. normalizeBybitClosedPnlList. */
  closedPnl: string;
  createdTime: string;
}

export interface BybitTransactionLogRaw {
  symbol: string;
  type: string;
  qty: string;
  /** Реализованный итог сделки БЕЗ комиссии; у строки начисления фандинга — ноль. */
  cashFlow: string;
  /** Торговая комиссия: положительное число = списано. */
  fee?: string;
  /** Начисление фандинга: отрицательное = списано, положительное = получено (тот же знак, что у Binance). Заполнено только у строк FUNDING/SETTLEMENT. */
  funding?: string;
  currency: string;
  transactionTime: string;
  tradeId: string;
  orderId: string;
}

/** Виды защиты Bybit, означающие «взять прибыль», — остальные считаем стопом. */
const BYBIT_TAKE_PROFIT_ORDER_TYPE_SET = new Set(['TakeProfit', 'PartialTakeProfit']);

/** Виды защиты, которые ведут уровень за ценой. */
const BYBIT_TRAILING_STOP_ORDER_TYPE_SET = new Set(['TrailingStop']);

const LINEAR_CONTRACT_TYPES = new Set(['LinearPerpetual', 'LinearFutures']);

// Bybit lists tokenized TradFi perpetuals with the ordinary contractType 'LinearPerpetual';
// the only marker is symbolType: 'stock' (tokenized equities/ETFs) or 'commodity' (oil, metals).
// symbolType 'innovation' is regular crypto from Bybit's Innovation Zone — not TradFi.
const TRADIFI_SYMBOL_TYPES = new Set(['stock', 'commodity']);

function buildBybitLeverageFilter(raw: BybitInstrumentInfoRaw): LeverageFilter | undefined {
  const source = raw.leverageFilter;

  if (source === undefined) {
    return undefined;
  }

  if (source.minLeverage === undefined && source.maxLeverage === undefined && source.leverageStep === undefined) {
    return undefined;
  }

  return {
    minLeverage: source.minLeverage ?? '0',
    maxLeverage: source.maxLeverage ?? '0',
    leverageStep: source.leverageStep ?? '0',
  };
}

function buildBybitPriceLimitRisk(raw: BybitInstrumentInfoRaw): PriceLimitRisk | undefined {
  const source = raw.riskParameters;

  if (source === undefined) {
    return undefined;
  }

  if (source.priceLimitRatioX === undefined && source.priceLimitRatioY === undefined) {
    return undefined;
  }

  return {
    source: 'bybitRiskParameters',
    priceLimitRatioX: source.priceLimitRatioX ?? '0',
    priceLimitRatioY: source.priceLimitRatioY ?? '0',
  };
}

function buildBybitFunding(raw: BybitInstrumentInfoRaw): TradingFunding | undefined {
  const hasAny = raw.fundingInterval !== undefined
    || raw.upperFundingRate !== undefined
    || raw.lowerFundingRate !== undefined;

  if (!hasAny) {
    return undefined;
  }

  const funding: TradingFunding = {};

  if (raw.fundingInterval !== undefined) {
    funding.fundingIntervalMinutes = raw.fundingInterval;
  }

  if (raw.upperFundingRate !== undefined) {
    funding.upperFundingRate = raw.upperFundingRate;
  }

  if (raw.lowerFundingRate !== undefined) {
    funding.lowerFundingRate = raw.lowerFundingRate;
  }

  return funding;
}

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
      isActive: raw.status === 'Trading' || raw.status === 'PreLaunch',
      type: tradeSymbolType,
      isLinear,
      contractSize: parseFloat(raw.contractSize ?? '1'),
      contractType: raw.contractType ?? '',
      isTradifi: TRADIFI_SYMBOL_TYPES.has(raw.symbolType ?? ''),
      filter: {
        tickSize: raw.priceFilter?.tickSize ?? '0',
        stepSize: raw.lotSizeFilter?.qtyStep ?? raw.lotSizeFilter?.basePrecision ?? '0',
        minQty: raw.lotSizeFilter?.minOrderQty ?? '0',
        // Spot: maxOrderQty is deprecated by Bybit — maxLimitOrderQty is the live limit cap.
        maxQty: raw.lotSizeFilter?.maxLimitOrderQty ?? raw.lotSizeFilter?.maxOrderQty ?? '0',
        minNotional: raw.lotSizeFilter?.minNotionalValue
          ?? raw.lotSizeFilter?.minOrderAmt
          ?? '0',
        ...(raw.priceFilter?.minPrice !== undefined ? { minPrice: raw.priceFilter.minPrice } : {}),
        ...(raw.priceFilter?.maxPrice !== undefined ? { maxPrice: raw.priceFilter.maxPrice } : {}),
        // Market-order cap: linear names it maxMktOrderQty, spot names it maxMarketOrderQty.
        // Missing either → no marketMaxQty → the market-split guard would not engage, and an
        // over-cap spot market order would be rejected at the worst possible moment.
        ...(raw.lotSizeFilter?.maxMktOrderQty !== undefined
          ? { marketMaxQty: raw.lotSizeFilter.maxMktOrderQty }
          : raw.lotSizeFilter?.maxMarketOrderQty !== undefined
            ? { marketMaxQty: raw.lotSizeFilter.maxMarketOrderQty }
            : {}),
        ...(raw.lotSizeFilter?.postOnlyMaxOrderQty !== undefined ? { postOnlyMaxQty: raw.lotSizeFilter.postOnlyMaxOrderQty } : {}),
      },
    };

    const leverageFilter = buildBybitLeverageFilter(raw);

    if (leverageFilter !== undefined) {
      tradeSymbol.leverageFilter = leverageFilter;
    }

    const priceLimitRisk = buildBybitPriceLimitRisk(raw);

    if (priceLimitRisk !== undefined) {
      tradeSymbol.priceLimitRisk = priceLimitRisk;
    }

    const funding = buildBybitFunding(raw);

    if (funding !== undefined) {
      tradeSymbol.funding = funding;
    }

    if (raw.launchTime !== undefined && raw.launchTime !== '') {
      const launchTimestamp = parseFloat(raw.launchTime);

      if (!isNaN(launchTimestamp)) {
        tradeSymbol.launchTimestamp = launchTimestamp;
      }
    }

    tradeSymbol.info = raw as unknown as Record<string, unknown>;

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

    if (raw.markPrice !== undefined) {
      ticker.markPrice = parseFloat(raw.markPrice);
    }

    if (raw.indexPrice !== undefined) {
      ticker.indexPrice = parseFloat(raw.indexPrice);
    }

    if (raw.fundingRate !== undefined) {
      ticker.fundingRate = parseFloat(raw.fundingRate);
    }

    if (raw.nextFundingTime !== undefined) {
      ticker.nextFundingTime = parseFloat(raw.nextFundingTime);
    }

    if (raw.bid1Price !== undefined) {
      ticker.bid1Price = parseFloat(raw.bid1Price);
    }

    if (raw.bid1Size !== undefined) {
      ticker.bid1Size = parseFloat(raw.bid1Size);
    }

    if (raw.ask1Price !== undefined) {
      ticker.ask1Price = parseFloat(raw.ask1Price);
    }

    if (raw.ask1Size !== undefined) {
      ticker.ask1Size = parseFloat(raw.ask1Size);
    }

    result.set(raw.symbol, ticker);
  }

  return result;
}

/**
 * Клайны истории. Время закрытия Bybit не присылает — но оно однозначно выводится из начала
 * и длительности интервала, и раньше на его месте стоял ноль. Из-за нуля обходной приём
 * «если ноль, считай сам» разошёлся по трём приложениям сразу.
 *
 * Число сделок и объёмы покупателей Bybit не сообщает вовсе; они остаются нулями, и это
 * ЕДИНСТВЕННЫЕ поля клайна, которых у него нет.
 */
export function normalizeBybitKlines(rawList: string[][], intervalMs?: number): Kline[] {
  return rawList.map((row) => {
    const openTimestamp = parseFloat(row[0]);

    return {
      openTimestamp,
      openPrice: parseFloat(row[1]),
      highPrice: parseFloat(row[2]),
      lowPrice: parseFloat(row[3]),
      closePrice: parseFloat(row[4]),
      volume: parseFloat(row[5]),
      closeTimestamp: intervalMs !== undefined && intervalMs > 0 ? openTimestamp + intervalMs : 0,
      quoteAssetVolume: parseFloat(row[6]),
      numberOfTrades: 0,
      takerBuyBaseAssetVolume: 0,
      takerBuyQuoteAssetVolume: 0,
    };
  }).reverse();
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

function resolveBybitDirection(raw: BybitPositionRaw): 'long' | 'short' | null {
  if (raw.side === 'Buy') {
    return 'long';
  }

  if (raw.side === 'Sell') {
    return 'short';
  }

  if (raw.positionIdx === 1) {
    return 'long';
  }

  if (raw.positionIdx === 2) {
    return 'short';
  }

  return null;
}

export function normalizeBybitPosition(raw: BybitPositionRaw): Position {
  const side = BYBIT_POSITION_SIDE[raw.side] ?? PositionSideEnum.Both;
  const direction = resolveBybitDirection(raw);
  const marginMode: MarginModeEnum = raw.tradeMode === 0 ? MarginModeEnum.Cross : MarginModeEnum.Isolated;
  const liquidationPriceRaw = parseFloat(raw.liqPrice);
  const contractsRaw = parseFloat(raw.size);

  return {
    symbol: raw.symbol,
    side,
    direction,
    contracts: Number.isFinite(contractsRaw) ? contractsRaw : 0,
    entryPrice: parseFloat(raw.avgPrice),
    markPrice: parseFloat(raw.markPrice),
    unrealizedPnl: parseFloat(raw.unrealisedPnl),
    leverage: parseFloat(raw.leverage),
    marginMode,
    liquidationPrice: isNaN(liquidationPriceRaw) ? 0 : liquidationPriceRaw,
    positionIdx: raw.positionIdx,
    info: raw,
  };
}

/**
 * Тип прочитанной заявки Bybit. Обычная берётся из `orderType`, а защитная складывается из
 * двух полей: чем она является (`stopOrderType`) и чем исполнится при срабатывании
 * (`orderType`). Раньше читался только второй, и собственный стоп возвращался с биржи
 * обычной рыночной заявкой — правило «не трогать защитные» снимало его вместе с обычными.
 * Незнакомый вид защиты остаётся защитой: считать его обычной заявкой опаснее всего.
 */
function resolveBybitOrderType(raw: BybitOrderResponseRaw): OrderTypeEnum {
  const stopOrderType = raw.stopOrderType ?? '';

  if (stopOrderType === '') {
    return BYBIT_ORDER_TYPE[raw.orderType] ?? raw.orderType.toLowerCase() as never;
  }

  if (BYBIT_TRAILING_STOP_ORDER_TYPE_SET.has(stopOrderType)) {
    return OrderTypeEnum.TrailingStop;
  }

  const isLimitLike = raw.orderType === 'Limit';

  if (BYBIT_TAKE_PROFIT_ORDER_TYPE_SET.has(stopOrderType)) {
    return isLimitLike ? OrderTypeEnum.TakeProfitLimit : OrderTypeEnum.TakeProfitMarket;
  }

  return isLimitLike ? OrderTypeEnum.StopLimit : OrderTypeEnum.StopMarket;
}

export function normalizeBybitOrder(raw: BybitOrderResponseRaw): Order {
  const status = BYBIT_ORDER_STATUS[raw.orderStatus] ?? raw.orderStatus.toLowerCase();

  return {
    id: raw.orderId,
    clientOrderId: raw.orderLinkId ?? '',
    symbol: raw.symbol,
    side: BYBIT_ORDER_SIDE[raw.side] ?? OrderSideEnum.Buy,
    type: resolveBybitOrderType(raw),
    isConditional: (raw.stopOrderType ?? '') !== '',
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

/**
 * Исход одной заявки из пачки Bybit. Общая для обычного пути и для торгового канала: ответы
 * там одинаковы по смыслу, и вторая копия этого разбора рано или поздно разъехалась бы с
 * первой — а расходиться тут значит по-разному врать про поставленный стоп.
 */
export function buildBybitCreateOutcome(
  args: CreateOrderWebSocketArgs,
  item: { orderId?: string } | undefined,
  extInfo: { code?: number; msg?: string } | undefined,
): CreateOrderItemResult {
  const code = typeof extInfo?.code === 'number' ? extInfo.code : null;

  if (code !== null && code !== 0) {
    return buildRejectedOrderOutcome(code, extInfo?.msg ?? null);
  }

  return buildPlacedOrderOutcome(buildBybitOrderFromCreateResponse(args, String(item?.orderId ?? '')));
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

      const availableToWithdraw = coin.availableToWithdraw !== undefined && coin.availableToWithdraw !== ''
        ? parseFloat(coin.availableToWithdraw)
        : undefined;
      const usdValue = coin.usdValue !== undefined && coin.usdValue !== '' ? parseFloat(coin.usdValue) : undefined;

      const existing = balanceByAsset.get(coin.coin);

      if (existing !== undefined) {
        const balance: Balance = {
          asset: coin.coin,
          free: existing.free + free,
          locked: existing.locked + locked,
          total: existing.total + free + locked,
          walletBalance: (existing.walletBalance ?? 0) + walletBalance,
          totalOrderInitialMargin: (existing.totalOrderInitialMargin ?? 0) + totalOrderIM,
          totalPositionInitialMargin: (existing.totalPositionInitialMargin ?? 0) + totalPositionIM,
        };

        if (availableToWithdraw !== undefined) {
          balance.availableToWithdraw = (existing.availableToWithdraw ?? 0) + availableToWithdraw;
        }

        if (usdValue !== undefined || existing.usdValue !== undefined) {
          balance.usdValue = (existing.usdValue ?? 0) + (usdValue ?? 0);
        }

        balanceByAsset.set(coin.coin, balance);

        continue;
      }

      const balance: Balance = {
        asset: coin.coin,
        free,
        locked,
        total: free + locked,
        walletBalance,
        totalOrderInitialMargin: totalOrderIM,
        totalPositionInitialMargin: totalPositionIM,
      };

      if (availableToWithdraw !== undefined) {
        balance.availableToWithdraw = availableToWithdraw;
      }

      if (usdValue !== undefined) {
        balance.usdValue = usdValue;
      }

      balanceByAsset.set(coin.coin, balance);
    }
  }

  const primaryAccount = raw.list[0];
  const rawTotalWallet = primaryAccount?.totalWalletBalance ?? '';
  const rawTotalAvailable = primaryAccount?.totalAvailableBalance ?? '';
  const rawTotalMargin = primaryAccount?.totalMarginBalance ?? '';
  const rawTotalInitialMargin = primaryAccount?.totalInitialMargin ?? '';

  const walletUsd = sumBalanceUsdValue(balanceByAsset);
  const marginUsd = sumMarginUsdValue(balanceByAsset);

  let totalWalletBalance = parseFloat(rawTotalWallet);

  if (isNaN(totalWalletBalance)) {
    // Свод строится ТОЛЬКО из долларовых оценок. Складывать остатки монет (balance.total) нельзя:
    // так 0.0514 FRAX прибавляется к 3914.91 USDT как полдоллара, а один биткойн — как один доллар.
    totalWalletBalance = walletUsd ?? 0;
  }

  const exchangeAvailable = parseFloat(rawTotalAvailable);
  const marginBalance = parseFloat(rawTotalMargin);
  const initialMargin = parseFloat(rawTotalInitialMargin);

  let totalAvailableBalance: number;
  let availableBalanceSource: NonNullable<AccountBalances['availableBalanceSource']>;

  if (!isNaN(exchangeAvailable)) {
    totalAvailableBalance = exchangeAvailable;
    availableBalanceSource = 'exchange';
  } else if (!isNaN(marginBalance) && !isNaN(initialMargin)) {
    totalAvailableBalance = marginBalance - initialMargin;
    availableBalanceSource = 'derived';
  } else if (!isNaN(initialMargin)) {
    totalAvailableBalance = totalWalletBalance - initialMargin;
    availableBalanceSource = 'derived';
  } else if (marginUsd !== null) {
    // Живой счёт 29.08.2026 приходит именно так: ни свободных средств, ни маржинального баланса, ни
    // начальной маржи — только кошелёк и монеты. Свободное выводится вычитанием занятой маржи, и по
    // построению не может превысить кошелёк.
    totalAvailableBalance = totalWalletBalance - marginUsd;
    availableBalanceSource = 'derived';
  } else {
    // Курса монет нет — посчитать нечем. Ноль в безопасную сторону (по этому числу оператор считает
    // размер входа) и честная пометка: выдавать догадку за остаток счёта нельзя.
    totalAvailableBalance = 0;
    availableBalanceSource = 'unknown';
  }

  const result: AccountBalances = { totalWalletBalance, totalAvailableBalance, balanceByAsset, availableBalanceSource };

  if (primaryAccount?.accountType !== undefined) {
    result.accountType = primaryAccount.accountType;
  }

  const totalMarginBalance = parseFloat(rawTotalMargin);

  if (!isNaN(totalMarginBalance)) {
    result.totalMarginBalance = totalMarginBalance;
  }

  const totalInitialMargin = parseFloat(rawTotalInitialMargin);

  if (!isNaN(totalInitialMargin)) {
    result.totalInitialMargin = totalInitialMargin;
  } else if (marginUsd !== null) {
    result.totalInitialMargin = marginUsd;
  }

  return result;
}

/** Долларовая оценка всего счёта. null — если хоть у одной монеты с ненулевым остатком её нет:
 *  неполная сумма выглядела бы как настоящая. */
function sumBalanceUsdValue(balanceByAsset: BalanceByAsset): number | null {
  let sum = 0;

  for (const balance of balanceByAsset.values()) {
    if (balance.usdValue !== undefined) {
      sum += balance.usdValue;

      continue;
    }

    if (balance.total !== 0) {
      return null;
    }
  }

  return sum;
}

/** Занятая маржа счёта В ДОЛЛАРАХ: маржа монеты приходит в её собственных единицах, поэтому
 *  переводится курсом самой монеты (её долларовая оценка на её остаток). null — если у монеты с
 *  НЕНУЛЕВОЙ маржой курса нет. */
function sumMarginUsdValue(balanceByAsset: BalanceByAsset): number | null {
  let sum = 0;

  for (const balance of balanceByAsset.values()) {
    const margin = (balance.totalOrderInitialMargin ?? 0) + (balance.totalPositionInitialMargin ?? 0);

    if (margin === 0) continue;

    const walletBalance = balance.walletBalance ?? 0;

    if (balance.usdValue === undefined || walletBalance === 0) {
      return null;
    }

    sum += margin * (balance.usdValue / walletBalance);
  }

  return sum;
}

export function normalizeBybitOrderBook(raw: BybitOrderBookRaw, symbol: string): OrderBook {
  return {
    symbol,
    askList: raw.a.map(parseOrderBookLevel),
    bidList: raw.b.map(parseOrderBookLevel),
    timestamp: raw.ts,
    updateId: raw.u,
  };
}

function toOrderBookRawLevelList(rawList: string[][]): OrderBookRawLevel[] {
  const result: OrderBookRawLevel[] = [];

  for (const level of rawList) {
    result.push([level[0], level[1]]);
  }

  return result;
}

export function normalizeBybitOrderBookUpdate(
  raw: BybitOrderBookRaw,
  symbol: string,
  updateType: OrderBookUpdateType,
  receivedTimestamp: number,
  envelopeTimestamp?: number,
): OrderBookUpdate {
  // Bybit V5 orderbook frames carry the exchange event timestamp in the message ENVELOPE
  // (`ts`), NOT inside `data` — so `raw.ts` (the data object) is routinely undefined. Prefer
  // the envelope timestamp; fall back to `raw.ts` only if the envelope value is absent.
  const eventTimestamp =
    typeof envelopeTimestamp === 'number' && Number.isFinite(envelopeTimestamp)
      ? envelopeTimestamp
      : raw.ts;

  return {
    symbol,
    updateType,
    bidList: toOrderBookRawLevelList(raw.b),
    askList: toOrderBookRawLevelList(raw.a),
    updateId: raw.u,
    eventTimestamp,
    receivedTimestamp,
  };
}

export interface ParseBybitOrderbookRawFrameArgs {
  raw: string;
  symbol: string;
  receivedTimestamp: number;
}

interface BybitOrderbookFrameEnvelope {
  type?: string;
  ts?: number;
  data?: unknown;
}

export function parseBybitOrderbookRawFrame(args: ParseBybitOrderbookRawFrameArgs): OrderBookUpdate | undefined {
  const { raw, symbol, receivedTimestamp } = args;

  let envelope: BybitOrderbookFrameEnvelope;

  try {
    envelope = JSON.parse(raw) as BybitOrderbookFrameEnvelope;
  } catch {
    return undefined;
  }

  const data = envelope.data;

  if (data === undefined || data === null || Array.isArray(data)) {
    return undefined;
  }

  const updateType: OrderBookUpdateType = envelope.type === 'snapshot' ? 'snapshot' : 'delta';

  return normalizeBybitOrderBookUpdate(
    data as BybitOrderBookRaw,
    symbol,
    updateType,
    receivedTimestamp,
    envelope.ts,
  );
}

export function normalizeBybitPublicTradeList(rawList: BybitPublicTradeRaw[]): PublicTrade[] {
  return rawList.map((raw) => {
    const trade: PublicTrade = {
      id: raw.execId,
      symbol: raw.symbol,
      price: parseFloat(raw.price),
      quantity: parseFloat(raw.size),
      quoteQuantity: parseFloat(raw.price) * parseFloat(raw.size),
      timestamp: parseFloat(raw.time),
      isBuyerMaker: raw.side === 'Sell',
      isBlockTrade: raw.isBlockTrade,
    };

    const mappedSide = BYBIT_ORDER_SIDE[raw.side];

    if (mappedSide !== undefined) {
      trade.side = mappedSide;
    }

    return trade;
  });
}

export function normalizeBybitPublicTradeFromStream(rawList: BybitPublicTradeDataRaw[]): PublicTrade[] {
  return rawList.map((raw) => {
    const price = parseFloat(raw.p);
    const quantity = parseFloat(raw.v);
    const trade: PublicTrade = {
      id: raw.i ?? '',
      symbol: raw.s,
      price,
      quantity,
      quoteQuantity: price * quantity,
      timestamp: raw.T,
      isBuyerMaker: raw.S === 'Sell',
      isBlockTrade: raw.BT ?? false,
    };

    if (raw.S !== undefined) {
      const mappedSide = BYBIT_ORDER_SIDE[raw.S];

      if (mappedSide !== undefined) {
        trade.side = mappedSide;
      }
    }

    return trade;
  });
}

export function normalizeBybitMarkPriceList(rawList: BybitTickerRaw[]): MarkPrice[] {
  return rawList.map((raw) => ({
    symbol: raw.symbol,
    markPrice: parseFloat(raw.markPrice ?? '0'),
    indexPrice: raw.indexPrice !== undefined ? parseFloat(raw.indexPrice) : undefined,
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

/**
 * Валовой итог записи закрытия — по накопленным стоимостям входа и выхода (точные суммы
 * исполнений, без округления средних цен). Покупка закрывает шорт: заработано то, на сколько
 * выход дешевле входа; продажа закрывает лонг — наоборот.
 */
function bybitGrossPnl(raw: BybitClosedPnlRaw, side: OrderSideEnum): number {
  const entryValue = parseFloat(raw.cumEntryValue);
  const exitValue = parseFloat(raw.cumExitValue);

  return side === OrderSideEnum.Buy ? entryValue - exitValue : exitValue - entryValue;
}

/**
 * Итог закрытия — ЧИСТЫЙ после торговых комиссий, но БЕЗ фандинга: тот же смысл, что у
 * Binance, где итог собран из исполнений, а фандинг идёт отдельным потоком начислений.
 * Биржевое поле `closedPnl` для этого не годится — Bybit вычитает из него ещё и фандинг,
 * начисленный за жизнь позиции. Проверено на живом счёте 02.09.2026 по 7 закрытиям подряд:
 * `валовой − openFee − closeFee − closedPnl` совпало с суммой начислений фандинга между
 * закрытиями до шестого знака (FLOCKUSDT: 105.01403 − 0.91438047 − 2.30448937 − 3.44912156 =
 * 98.3460386; там, где фандинга не было, остаток ровно ноль). Потребитель, сложивший такой
 * итог с отдельно прочитанным фандингом, задвоил бы его, поэтому итог считается здесь из
 * полей самой записи: валовой минус обе комиссии. Тождество «валовой − closedPnl = комиссии»
 * держится на обеих биржах.
 */
export function normalizeBybitClosedPnlList(rawList: BybitClosedPnlRaw[]): ClosedPnl[] {
  return rawList.map((raw) => {
    const side = BYBIT_ORDER_SIDE[raw.side] ?? OrderSideEnum.Buy;

    return {
      symbol: raw.symbol,
      orderId: raw.orderId,
      side,
      quantity: parseFloat(raw.qty),
      entryPrice: parseFloat(raw.avgEntryPrice),
      exitPrice: parseFloat(raw.avgExitPrice),
      closedPnl: bybitGrossPnl(raw, side) - parseFloat(raw.openFee) - parseFloat(raw.closeFee),
      timestamp: parseFloat(raw.createdTime),
    };
  });
}

/**
 * Комиссия отдельным начислением. Bybit держит её полем записи, где положительное число
 * означает «списано»; Binance отдаёт её отдельной строкой со знаком минус. Наружу приводим
 * к знаку Binance, иначе одно и то же поле на двух биржах значило бы противоположное.
 */
export function buildBybitCommissionIncomeList(rawList: BybitTransactionLogRaw[]): Income[] {
  return rawList
    .filter((raw) => parseFloat(raw.fee ?? '0') !== 0)
    .map((raw) => ({
      symbol: raw.symbol,
      incomeType: 'COMMISSION',
      income: -parseFloat(raw.fee ?? '0'),
      asset: raw.currency,
      timestamp: parseFloat(raw.transactionTime),
      info: { tradeId: raw.tradeId, orderId: raw.orderId },
      quantity: parseFloat(raw.qty),
    }));
}

/**
 * Сумма записи журнала. У начисления фандинга (`FUNDING`/`SETTLEMENT`) денежный поток
 * нулевой, а само начисление лежит в поле `funding` (живой счёт 02.09.2026, FLOCKUSDT:
 * `cashFlow=0`, `funding=-2.3156522` — списано); брать `cashFlow` значило бы всегда отдавать
 * ноль и выдавать его за факт с биржи. Знак у обеих бирж один: отрицательное = списано.
 */
function bybitIncomeAmount(raw: BybitTransactionLogRaw): number {
  return BYBIT_FUNDING_INCOME_TYPE_SET.has(raw.type) ? parseFloat(raw.funding ?? '0') : parseFloat(raw.cashFlow);
}

export function normalizeBybitIncomeList(rawList: BybitTransactionLogRaw[]): Income[] {
  return rawList.map((raw) => ({
    symbol: raw.symbol,
    incomeType: raw.type,
    income: bybitIncomeAmount(raw),
    asset: raw.currency,
    timestamp: parseFloat(raw.transactionTime),
    info: { tradeId: raw.tradeId, orderId: raw.orderId },
    quantity: parseFloat(raw.qty),
  }));
}
