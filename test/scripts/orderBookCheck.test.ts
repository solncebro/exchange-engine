import axios from 'axios';
import type { AxiosResponse } from 'axios';
import { orderBookCheck } from '../../scripts/exchange-live-check/orderBookCheck';
import type { LiveCheckContext } from '../../scripts/exchange-live-check/liveCheck.types';
import { BINANCE_DEMO_FUTURES_BASE_URL } from '../../src/constants/binance';
import { BYBIT_DEMO_BASE_URL } from '../../src/constants/bybit';
import { OKX_BASE_URL } from '../../src/constants/okx';
import { ExchangeNameEnum } from '../../src/types/common';
import type { OrderBook, OrderBookLevel, TradeSymbol } from '../../src/types/common';
import type { ExchangeClient } from '../../src/types/exchange';

const SYMBOL = 'BTCUSDT';
const OKX_CONTRACT_SIZE = 0.01;
const RAW_BID_LIST = [
  ['79605.30', '652.4241'],
  ['79605.20', '0.0030'],
  ['79604.00', '1.5000'],
  ['79600.10', '24.3038'],
  ['79590.00', '0.9783'],
];
const RAW_ASK_LIST = [
  ['79623.70', '29.5798'],
  ['79624.00', '0.3109'],
  ['79630.50', '2.5123'],
  ['79650.00', '1216.5215'],
  ['79681.30', '62.7356'],
];

function toLevelList(rawLevelList: string[][], quantityFactor: number): OrderBookLevel[] {
  return rawLevelList.map(([price, quantity]) => ({ price: Number(price), quantity: Number(quantity) * quantityFactor }));
}

function makeOrderBook(bidList: OrderBookLevel[], askList: OrderBookLevel[]): OrderBook {
  return { symbol: SYMBOL, bidList, askList, timestamp: 1793885600460 };
}

function createContext(exchangeName: ExchangeNameEnum, orderBook: OrderBook): LiveCheckContext {
  const contractSize = exchangeName === ExchangeNameEnum.Okx ? OKX_CONTRACT_SIZE : 1;
  const tradeSymbolBySymbol = new Map([[SYMBOL, { symbol: SYMBOL, baseAsset: 'BTC', quoteAsset: 'USDT', contractSize } as TradeSymbol]]);
  const client: Pick<ExchangeClient, 'tradeSymbols' | 'loadTradeSymbols' | 'fetchOrderBook' | 'getMinOrderQty'> = {
    tradeSymbols: tradeSymbolBySymbol,
    loadTradeSymbols: async () => tradeSymbolBySymbol,
    fetchOrderBook: async () => orderBook,
    getMinOrderQty: () => 0.0001,
  };

  return {
    exchangeName,
    exchange: { futures: client },
    settings: { futuresSymbol: SYMBOL, orderBookDepth: 20 },
    readFuturesTickers: async () => new Map(),
  } as LiveCheckContext;
}

function mockRawResponses(responseByUrl: Map<string, unknown>): jest.SpyInstance {
  return jest.spyOn(axios, 'get').mockImplementation(async (url: string) => {
    if (!responseByUrl.has(url)) {
      throw new Error(`unexpected url ${url}`);
    }

    return { data: responseByUrl.get(url) } as AxiosResponse;
  });
}

function mockBinanceRawBook(): jest.SpyInstance {
  return mockRawResponses(new Map([[`${BINANCE_DEMO_FUTURES_BASE_URL}/fapi/v1/depth`, { bids: RAW_BID_LIST, asks: RAW_ASK_LIST }]]));
}

function mockOkxRawBookInContracts(): jest.SpyInstance {
  const toContractList = (rawLevelList: string[][]): string[][] =>
    rawLevelList.map(([price, quantity]) => [price, (Number(quantity) / OKX_CONTRACT_SIZE).toFixed(2), '0', '1']);

  return mockRawResponses(new Map<string, unknown>([
    [`${OKX_BASE_URL}/api/v5/public/instruments`, { code: '0', msg: '', data: [{ instId: 'BTC-USDT-SWAP', ctVal: String(OKX_CONTRACT_SIZE) }] }],
    [`${OKX_BASE_URL}/api/v5/market/books`, { code: '0', msg: '', data: [{ bids: toContractList(RAW_BID_LIST), asks: toContractList(RAW_ASK_LIST), ts: '1' }] }],
  ]));
}

describe('orderBookCheck', () => {
  const abortSignal = new AbortController().signal;

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('confirms a large honest top level that the former 50 000 000 notional ceiling rejected', async () => {
    mockBinanceRawBook();
    const context = createContext(ExchangeNameEnum.Binance, makeOrderBook(toLevelList(RAW_BID_LIST, 1), toLevelList(RAW_ASK_LIST, 1)));

    const outcome = await orderBookCheck.run(context, abortSignal);

    expect(79605.3 * 652.4241).toBeGreaterThan(50_000_000);
    expect(outcome.status).toBe('confirmed');
    expect(outcome.fact).toContain('общих цен 10 из 10, количество совпало точно на 10, медиана отношения количеств 1');
  });

  it.each([10, 100, 0.01])('flags quantities scaled by %p against the raw exchange book', async (quantityFactor) => {
    mockBinanceRawBook();
    const context = createContext(
      ExchangeNameEnum.Binance,
      makeOrderBook(toLevelList(RAW_BID_LIST, quantityFactor), toLevelList(RAW_ASK_LIST, quantityFactor)),
    );

    const outcome = await orderBookCheck.run(context, abortSignal);

    expect(outcome.status).toBe('diverged');
    expect(outcome.fact).toContain(`отношение количества у библиотеки к сырому количеству биржи в монетах — ${quantityFactor} `);
  });

  it('flags swapped price and quantity even when the swapped book still looks ordered', async () => {
    mockBinanceRawBook();
    const swapLevelList = (levelList: OrderBookLevel[]): OrderBookLevel[] =>
      levelList.map((level) => ({ price: level.quantity, quantity: level.price }));
    const context = createContext(
      ExchangeNameEnum.Binance,
      makeOrderBook(swapLevelList(toLevelList(RAW_BID_LIST.slice(1, 2), 1)), swapLevelList(toLevelList(RAW_ASK_LIST.slice(0, 1), 1))),
    );

    const outcome = await orderBookCheck.run(context, abortSignal);

    expect(outcome.status).toBe('diverged');
    expect(outcome.fact).toContain('общих цен 0 из 2');
    expect(outcome.fact).toContain('нарушений 1: ни одна цена стакана библиотеки не нашлась в сыром стакане биржи');
  });

  it('confirms OKX quantities converted from contracts to coins', async () => {
    const spy = mockOkxRawBookInContracts();
    const context = createContext(ExchangeNameEnum.Okx, makeOrderBook(toLevelList(RAW_BID_LIST, 1), toLevelList(RAW_ASK_LIST, 1)));

    const outcome = await orderBookCheck.run(context, abortSignal);

    expect(outcome.status).toBe('confirmed');
    expect(outcome.fact).toContain('единица количества 0.01 монеты');
    expect(spy).toHaveBeenCalledWith(`${OKX_BASE_URL}/api/v5/market/books`, expect.objectContaining({ params: { instId: 'BTC-USDT-SWAP', sz: 400 } }));
  });

  it('flags OKX quantities left in contracts', async () => {
    mockOkxRawBookInContracts();
    const context = createContext(
      ExchangeNameEnum.Okx,
      makeOrderBook(toLevelList(RAW_BID_LIST, 1 / OKX_CONTRACT_SIZE), toLevelList(RAW_ASK_LIST, 1 / OKX_CONTRACT_SIZE)),
    );

    const outcome = await orderBookCheck.run(context, abortSignal);

    expect(outcome.status).toBe('diverged');
    expect(outcome.fact).toContain('похоже, количество отдано в контрактах или с лишними нулями');
  });

  it('tolerates levels that changed between the two reads as long as most of them still match', async () => {
    mockRawResponses(new Map([[`${BYBIT_DEMO_BASE_URL}/v5/market/orderbook`, { retCode: 0, retMsg: 'OK', result: { b: RAW_BID_LIST, a: RAW_ASK_LIST } }]]));
    const movedBidList = toLevelList(RAW_BID_LIST, 1).map((level, index) => (index < 2 ? { price: level.price, quantity: level.quantity * 1000 } : level));
    const movedAskList = toLevelList(RAW_ASK_LIST, 1).map((level, index) => (index < 2 ? { price: level.price, quantity: level.quantity / 1000 } : level));
    const context = createContext(ExchangeNameEnum.Bybit, makeOrderBook(movedBidList, movedAskList));

    const outcome = await orderBookCheck.run(context, abortSignal);

    expect(outcome.status).toBe('confirmed');
    expect(outcome.fact).toContain('количество совпало точно на 6');
  });

  it('fails loudly when Bybit refuses the raw book', async () => {
    mockRawResponses(new Map([[`${BYBIT_DEMO_BASE_URL}/v5/market/orderbook`, { retCode: 10001, retMsg: 'params error', result: { b: [], a: [] } }]]));
    const context = createContext(ExchangeNameEnum.Bybit, makeOrderBook(toLevelList(RAW_BID_LIST, 1), toLevelList(RAW_ASK_LIST, 1)));

    await expect(orderBookCheck.run(context, abortSignal)).rejects.toThrow('Bybit не отдал сырой стакан BTCUSDT: 10001 params error');
  });
});
