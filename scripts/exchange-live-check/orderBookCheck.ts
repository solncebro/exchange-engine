import axios from 'axios';
import { BINANCE_DEMO_FUTURES_BASE_URL } from '../../src/constants/binance';
import { BYBIT_DEMO_BASE_URL } from '../../src/constants/bybit';
import { OKX_BASE_URL, OKX_DEMO_TRADING_HEADER_NAME, OKX_DEMO_TRADING_HEADER_VALUE } from '../../src/constants/okx';
import type { OkxApiResponse } from '../../src/http/OkxHttpClient.types';
import type { BinanceOrderBookRaw } from '../../src/normalizers/binanceNormalizer';
import type { OkxInstrumentRaw, OkxOrderBookRaw } from '../../src/normalizers/okxNormalizer';
import { ExchangeNameEnum } from '../../src/types/common';
import type { OrderBookLevel } from '../../src/types/common';
import { formatNumber, joinViolationSample } from './checkSupport';
import type { LiveCheck, LiveCheckContext, LiveCheckOutcome } from './liveCheck.types';
import type { BybitOrderBookEnvelopeRaw, RawOrderBookInCoins } from './orderBookCheck.types';

const TIMEOUT_MS = 60_000;
const RAW_REQUEST_TIMEOUT_MS = 10_000;
const RAW_DEPTH_BY_EXCHANGE: Record<ExchangeNameEnum, number> = {
  [ExchangeNameEnum.Binance]: 500,
  [ExchangeNameEnum.Bybit]: 500,
  [ExchangeNameEnum.Okx]: 400,
};
const MIN_TYPICAL_QUANTITY_RATIO = 0.5;
const MAX_TYPICAL_QUANTITY_RATIO = 2;
const EXACT_MATCH_RELATIVE_TOLERANCE = 1e-9;
const BYBIT_SUCCESS_CODE = 0;
const OKX_SUCCESS_CODE = '0';

function convertRawLevelList(rawLevelList: string[][], coinsPerRawUnit: number): OrderBookLevel[] {
  return rawLevelList.map(([price, quantity]) => ({ price: Number(price), quantity: Number(quantity) * coinsPerRawUnit }));
}

async function readRawOrderBook(context: LiveCheckContext, symbol: string): Promise<RawOrderBookInCoins> {
  const depth = RAW_DEPTH_BY_EXCHANGE[context.exchangeName];

  if (context.exchangeName === ExchangeNameEnum.Binance) {
    const response = await axios.get<BinanceOrderBookRaw>(`${BINANCE_DEMO_FUTURES_BASE_URL}/fapi/v1/depth`, {
      params: { symbol, limit: depth },
      timeout: RAW_REQUEST_TIMEOUT_MS,
    });

    return { bidList: convertRawLevelList(response.data.bids, 1), askList: convertRawLevelList(response.data.asks, 1), coinsPerRawUnit: 1 };
  }

  if (context.exchangeName === ExchangeNameEnum.Bybit) {
    const response = await axios.get<BybitOrderBookEnvelopeRaw>(`${BYBIT_DEMO_BASE_URL}/v5/market/orderbook`, {
      params: { category: 'linear', symbol, limit: depth },
      timeout: RAW_REQUEST_TIMEOUT_MS,
    });

    if (response.data.retCode !== BYBIT_SUCCESS_CODE) {
      throw new Error(`Bybit не отдал сырой стакан ${symbol}: ${response.data.retCode} ${response.data.retMsg}`);
    }

    return { bidList: convertRawLevelList(response.data.result.b, 1), askList: convertRawLevelList(response.data.result.a, 1), coinsPerRawUnit: 1 };
  }

  const tradeSymbol = context.exchange.futures.tradeSymbols.get(symbol);

  if (tradeSymbol === undefined) {
    throw new Error(`${symbol} нет среди загруженных инструментов — обозначение OKX не из чего составить`);
  }

  const instId = `${tradeSymbol.baseAsset}-${tradeSymbol.quoteAsset}-SWAP`;
  const headers = { [OKX_DEMO_TRADING_HEADER_NAME]: OKX_DEMO_TRADING_HEADER_VALUE };
  const [instrumentResponse, orderBookResponse] = await Promise.all([
    axios.get<OkxApiResponse<OkxInstrumentRaw>>(`${OKX_BASE_URL}/api/v5/public/instruments`, {
      params: { instType: 'SWAP', instId },
      headers,
      timeout: RAW_REQUEST_TIMEOUT_MS,
    }),
    axios.get<OkxApiResponse<OkxOrderBookRaw>>(`${OKX_BASE_URL}/api/v5/market/books`, {
      params: { instId, sz: depth },
      headers,
      timeout: RAW_REQUEST_TIMEOUT_MS,
    }),
  ]);
  const instrumentList = instrumentResponse.data.code === OKX_SUCCESS_CODE ? instrumentResponse.data.data : [];
  const orderBookRawList = orderBookResponse.data.code === OKX_SUCCESS_CODE ? orderBookResponse.data.data : [];

  if (instrumentList.length === 0 || orderBookRawList.length === 0) {
    throw new Error(`OKX не отдал инструмент или сырой стакан ${instId}: '${instrumentResponse.data.msg}' / '${orderBookResponse.data.msg}'`);
  }

  const coinsPerRawUnit = Number(instrumentList[0].ctVal);

  return {
    bidList: convertRawLevelList(orderBookRawList[0].bids, coinsPerRawUnit),
    askList: convertRawLevelList(orderBookRawList[0].asks, coinsPerRawUnit),
    coinsPerRawUnit,
  };
}

function collectQuantityRatioList(levelList: OrderBookLevel[], rawLevelList: OrderBookLevel[]): number[] {
  const rawQuantityByPrice = new Map(rawLevelList.map((level) => [level.price, level.quantity]));
  const ratioList: number[] = [];

  for (const level of levelList) {
    const rawQuantity = rawQuantityByPrice.get(level.price);

    if (rawQuantity !== undefined && rawQuantity > 0) {
      ratioList.push(level.quantity / rawQuantity);
    }
  }

  return ratioList;
}

function collectSideViolations(levelList: OrderBookLevel[], sideLabel: string, isDescending: boolean): string[] {
  const violationList: string[] = [];

  if (levelList.length === 0) {
    violationList.push(`${sideLabel}: сторона пуста`);

    return violationList;
  }

  for (const [index, level] of levelList.entries()) {
    if (!Number.isFinite(level.price) || level.price <= 0) {
      violationList.push(`${sideLabel} ${index}: цена ${formatNumber(level.price)}`);
    }

    if (!Number.isFinite(level.quantity) || level.quantity <= 0) {
      violationList.push(`${sideLabel} ${index}: количество ${formatNumber(level.quantity)}`);
    }

    const previous = index === 0 ? null : levelList[index - 1];

    if (previous !== null) {
      const isOrdered = isDescending ? level.price < previous.price : level.price > previous.price;

      if (!isOrdered) {
        violationList.push(`${sideLabel} ${index}: цена ${formatNumber(level.price)} нарушает порядок после ${formatNumber(previous.price)}`);
      }
    }
  }

  return violationList;
}

async function checkOrderBookContract(context: LiveCheckContext): Promise<LiveCheckOutcome> {
  const client = context.exchange.futures;
  const symbol = context.settings.futuresSymbol;

  await client.loadTradeSymbols();

  const orderBook = await client.fetchOrderBook(symbol, context.settings.orderBookDepth);
  const rawOrderBook = await readRawOrderBook(context, symbol);
  const violationList = [
    ...collectSideViolations(orderBook.bidList, 'покупка', true),
    ...collectSideViolations(orderBook.askList, 'продажа', false),
  ];

  if (orderBook.bidList.length === 0 || orderBook.askList.length === 0) {
    return { status: 'diverged', fact: `${symbol}: ${joinViolationSample(violationList)}` };
  }

  const topBid = orderBook.bidList[0];
  const topAsk = orderBook.askList[0];

  if (topBid.price >= topAsk.price) {
    violationList.push(`лучшая покупка ${formatNumber(topBid.price)} не ниже лучшей продажи ${formatNumber(topAsk.price)}`);
  }

  const quantityRatioList = [
    ...collectQuantityRatioList(orderBook.bidList, rawOrderBook.bidList),
    ...collectQuantityRatioList(orderBook.askList, rawOrderBook.askList),
  ].sort((left, right) => left - right);
  const isRatioListEmpty = quantityRatioList.length === 0;
  const typicalRatio = isRatioListEmpty ? Number.NaN : quantityRatioList[Math.floor((quantityRatioList.length - 1) / 2)];
  const exactMatchCount = quantityRatioList.filter((ratio) => Math.abs(ratio - 1) <= EXACT_MATCH_RELATIVE_TOLERANCE).length;

  if (isRatioListEmpty) {
    violationList.push('ни одна цена стакана библиотеки не нашлась в сыром стакане биржи, прочитанном следом, — цены искажены или перепутаны с количествами');
  } else if (typicalRatio < MIN_TYPICAL_QUANTITY_RATIO || typicalRatio > MAX_TYPICAL_QUANTITY_RATIO) {
    violationList.push(
      `отношение количества у библиотеки к сырому количеству биржи в монетах — ${formatNumber(typicalRatio)} (медиана по общим ценам, ждали около 1): похоже, количество отдано в контрактах или с лишними нулями`,
    );
  }

  const tickerBySymbol = await context.readFuturesTickers();
  const ticker = tickerBySymbol.get(symbol);
  const tradeSymbol = client.tradeSymbols.get(symbol);
  const tickerSizeText = ticker?.bid1Size === undefined ? 'биржа его не отдаёт' : formatNumber(ticker.bid1Size);
  const contractSizeText = tradeSymbol === undefined ? 'неизвестен' : formatNumber(tradeSymbol.contractSize);
  const typicalRatioText = isRatioListEmpty ? 'не считается' : formatNumber(typicalRatio);
  const summaryText =
    `${symbol}: уровней ${orderBook.bidList.length}/${orderBook.askList.length}, лучшая пара ` +
    `${formatNumber(topBid.price)} × ${formatNumber(topBid.quantity)} против ${formatNumber(topAsk.price)} × ${formatNumber(topAsk.quantity)}; ` +
    `сырой стакан биржи (прочитан следом, до ${RAW_DEPTH_BY_EXCHANGE[context.exchangeName]} уровней, единица количества ${formatNumber(rawOrderBook.coinsPerRawUnit)} монеты): ` +
    `общих цен ${quantityRatioList.length} из ${orderBook.bidList.length + orderBook.askList.length}, количество совпало точно на ${exactMatchCount}, ` +
    `медиана отношения количеств ${typicalRatioText}; размер лучшей покупки в тикере — ${tickerSizeText}; размер контракта ${contractSizeText}, ` +
    `наименьший объём ${formatNumber(client.getMinOrderQty(symbol))}`;

  if (violationList.length > 0) {
    return { status: 'diverged', fact: `${summaryText}; нарушений ${violationList.length}: ${joinViolationSample(violationList)}` };
  }

  return { status: 'confirmed', fact: summaryText };
}

export const orderBookCheck: LiveCheck = {
  title: 'Стакан (контракты): стороны отсортированы, спред положителен, количества в монетах',
  timeoutMs: TIMEOUT_MS,
  isCredentialsRequired: false,
  isOrdersRequired: false,
  run: checkOrderBookContract,
};
