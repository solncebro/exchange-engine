import axios from 'axios';
import { BinanceFutures } from '../../src/exchanges/BinanceFutures';
import { BinanceSpot } from '../../src/exchanges/BinanceSpot';
import { BybitLinear } from '../../src/exchanges/BybitLinear';
import { BybitSpot } from '../../src/exchanges/BybitSpot';
import { OkxSwap } from '../../src/exchanges/OkxSwap';
import { OkxSpot } from '../../src/exchanges/OkxSpot';
import { createMockLogger } from '../fixtures/mockLogger';
import { createMockAxiosInstance } from '../fixtures/mockAxios';
import { OKX_RAW_INSTRUMENT_SPOT, OKX_RAW_INSTRUMENT_SWAP } from '../fixtures/okxRaw';
import {
  MarketUnitEnum,
  OrderFilterEnum,
  OrderSideEnum,
  OrderTypeEnum,
  PositionSideEnum,
  TimeInForceEnum,
  TriggerByEnum,
  WorkingTypeEnum,
} from '../../src/types/common';

jest.mock('axios');
jest.mock('../../src/ws/BinanceFuturesPublicStream');
jest.mock('../../src/ws/BinanceSpotPublicStream');
jest.mock('../../src/ws/BinanceTradeStream');
jest.mock('../../src/ws/BybitPublicStream');
jest.mock('../../src/ws/BybitTradeStream');
jest.mock('../../src/ws/OkxPublicStream');
jest.mock('../../src/ws/OkxTradeStream');
jest.mock('../../src/ws/OkxPrivateStream');

const mockedAxios = axios as jest.Mocked<typeof axios>;

function okxSuccess<T>(dataList: T[]): { data: { code: string; msg: string; data: T[] } } {
  return { data: { code: '0', msg: '', data: dataList } };
}

function createBinanceFutures(): BinanceFutures {
  mockedAxios.create.mockReturnValue(createMockAxiosInstance() as any);
  return new BinanceFutures({
    config: { apiKey: 'k', secret: 's' },
    logger: createMockLogger(),
  });
}

function createBinanceSpot(): BinanceSpot {
  mockedAxios.create.mockReturnValue(createMockAxiosInstance() as any);
  return new BinanceSpot({
    config: { apiKey: 'k', secret: 's' },
    logger: createMockLogger(),
  });
}

function createBybitLinear(): BybitLinear {
  mockedAxios.create.mockReturnValue(createMockAxiosInstance() as any);
  return new BybitLinear({
    config: { apiKey: 'k', secret: 's' },
    logger: createMockLogger(),
  });
}

function createBybitSpot(): BybitSpot {
  mockedAxios.create.mockReturnValue(createMockAxiosInstance() as any);
  return new BybitSpot({
    config: { apiKey: 'k', secret: 's' },
    logger: createMockLogger(),
  });
}

function callBinanceBuild(client: BinanceFutures | BinanceSpot, args: Record<string, unknown>): Record<string, unknown> {
  return (client as unknown as { buildBinanceOrderParams: (a: unknown) => Record<string, unknown> }).buildBinanceOrderParams(args as never);
}

function callBybitBuild(client: BybitLinear | BybitSpot, args: Record<string, unknown>): Record<string, unknown> {
  return (client as unknown as { buildBybitOrderParams: (a: unknown) => Record<string, unknown> }).buildBybitOrderParams(args as never);
}

// Сборщик OKX асинхронный: режим позиции счёта — часть запроса, и он читается с биржи.
async function createOkxSwap(posMode = 'net_mode'): Promise<OkxSwap> {
  const mockInstance = createMockAxiosInstance();
  mockedAxios.create.mockReturnValue(mockInstance as any);

  const client = new OkxSwap({ config: { apiKey: 'k', secret: 's', passphrase: 'p' }, logger: createMockLogger() });

  mockInstance.get.mockResolvedValueOnce(okxSuccess([OKX_RAW_INSTRUMENT_SWAP]));
  await client.loadTradeSymbols();
  mockInstance.get.mockResolvedValue(okxSuccess([{ uid: '1', acctLv: '2', posMode }]));

  return client;
}

async function createOkxSpot(): Promise<OkxSpot> {
  const mockInstance = createMockAxiosInstance();
  mockedAxios.create.mockReturnValue(mockInstance as any);

  const client = new OkxSpot({ config: { apiKey: 'k', secret: 's', passphrase: 'p' }, logger: createMockLogger() });

  mockInstance.get.mockResolvedValueOnce(okxSuccess([OKX_RAW_INSTRUMENT_SPOT]));
  await client.loadTradeSymbols();

  return client;
}

function callOkxBuild(client: OkxSwap | OkxSpot, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  return (client as unknown as { buildOkxOrderParams: (a: unknown) => Promise<Record<string, unknown>> }).buildOkxOrderParams(args as never);
}

function callOkxAlgoBuild(client: OkxSwap | OkxSpot, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  return (client as unknown as { buildOkxAlgoOrderParams: (a: unknown) => Promise<Record<string, unknown>> }).buildOkxAlgoOrderParams(args as never);
}

describe('buildBinanceOrderParams — futures', () => {
  it('open long Limit hedge: positionSide=LONG, no reduceOnly, no closePosition', () => {
    const client = createBinanceFutures();
    const params = callBinanceBuild(client, {
      symbol: 'BTCUSDT',
      side: OrderSideEnum.Buy,
      amount: 1,
      price: 100,
      type: OrderTypeEnum.Limit,
      positionSide: PositionSideEnum.Long,
    });
    expect(params.symbol).toBe('BTCUSDT');
    expect(params.side).toBe('BUY');
    expect(params.type).toBe('LIMIT');
    expect(params.positionSide).toBe('LONG');
    expect(params.reduceOnly).toBeUndefined();
    expect(params.closePosition).toBeUndefined();
    expect(params.timeInForce).toBe('GTC');
  });

  it('close long Sell hedge: positionSide=LONG, NO reduceOnly (Hedge prohibits)', () => {
    const client = createBinanceFutures();
    const params = callBinanceBuild(client, {
      symbol: 'BTCUSDT',
      side: OrderSideEnum.Sell,
      amount: 1,
      price: 0,
      type: OrderTypeEnum.Market,
      positionSide: PositionSideEnum.Long,
      reduceOnly: true,
    });
    expect(params.positionSide).toBe('LONG');
    expect(params.reduceOnly).toBeUndefined();
  });

  it('close long oneway: reduceOnly=true, no positionSide', () => {
    const client = createBinanceFutures();
    const params = callBinanceBuild(client, {
      symbol: 'BTCUSDT',
      side: OrderSideEnum.Sell,
      amount: 1,
      price: 0,
      type: OrderTypeEnum.Market,
      reduceOnly: true,
    });
    expect(params.reduceOnly).toBe(true);
    expect(params.positionSide).toBeUndefined();
  });

  // С 09.12.2025 условные заявки фьючерсов собираются ОТДЕЛЬНОЙ функцией под Algo-службу.
  // Общий сборщик обязан их отвергать: собранный им запрос биржа отобьёт кодом -4120,
  // а молчаливо кривой запрос хуже громкого отказа.
  it('refuses to build a futures stop order for the plain endpoint', () => {
    const client = createBinanceFutures();

    expect(() => callBinanceBuild(client, {
      symbol: 'BTCUSDT',
      side: OrderSideEnum.Sell,
      amount: 1,
      price: 0,
      type: OrderTypeEnum.StopMarket,
      stopPrice: 90,
      workingType: WorkingTypeEnum.MarkPrice,
      positionSide: PositionSideEnum.Long,
    })).toThrow(/must go to the conditional service/);
  });

  it('refuses to build a futures take-profit order for the plain endpoint', () => {
    const client = createBinanceFutures();

    expect(() => callBinanceBuild(client, {
      symbol: 'BTCUSDT',
      side: OrderSideEnum.Sell,
      amount: 1,
      price: 0,
      type: OrderTypeEnum.TakeProfitMarket,
      stopPrice: 110,
    })).toThrow(/must go to the conditional service/);
  });

  it('never leaks the spot-only trailing delta onto a futures request', () => {
    // Раньше уходил без всякого ограждения — параметра с таким именем у фьючерсов нет.
    const client = createBinanceFutures();
    const params = callBinanceBuild(client, {
      symbol: 'BTCUSDT',
      side: OrderSideEnum.Buy,
      amount: 1,
      price: 100,
      type: OrderTypeEnum.Limit,
      callbackRate: 0.5,
    });

    expect(params.trailingDelta).toBeUndefined();
  });
});

describe('buildBinanceOrderParams — spot', () => {
  it('Spot Buy Limit: no positionSide, no reduceOnly, no closePosition', () => {
    const client = createBinanceSpot();
    const params = callBinanceBuild(client, {
      symbol: 'BTCUSDT',
      side: OrderSideEnum.Buy,
      amount: 1,
      price: 100,
      type: OrderTypeEnum.Limit,
      positionSide: PositionSideEnum.Long,
      reduceOnly: true,
      closePosition: true,
      workingType: WorkingTypeEnum.MarkPrice,
    });
    expect(params.type).toBe('LIMIT');
    expect(params.positionSide).toBeUndefined();
    expect(params.reduceOnly).toBeUndefined();
    expect(params.closePosition).toBeUndefined();
    expect(params.workingType).toBeUndefined();
  });

  it('Spot StopMarket → STOP_LOSS', () => {
    const client = createBinanceSpot();
    const params = callBinanceBuild(client, {
      symbol: 'BTCUSDT',
      side: OrderSideEnum.Sell,
      amount: 1,
      price: 0,
      type: OrderTypeEnum.StopMarket,
      stopPrice: 90,
    });
    expect(params.type).toBe('STOP_LOSS');
    expect(params.stopPrice).toBe('90');
  });

  it('Spot StopLimit → STOP_LOSS_LIMIT (with timeInForce)', () => {
    const client = createBinanceSpot();
    const params = callBinanceBuild(client, {
      symbol: 'BTCUSDT',
      side: OrderSideEnum.Sell,
      amount: 1,
      price: 89,
      type: OrderTypeEnum.StopLimit,
      stopPrice: 90,
    });
    expect(params.type).toBe('STOP_LOSS_LIMIT');
    expect(params.price).toBe('89');
    expect(params.stopPrice).toBe('90');
    expect(params.timeInForce).toBe('GTC');
  });

  it('Spot TakeProfitMarket → TAKE_PROFIT', () => {
    const client = createBinanceSpot();
    const params = callBinanceBuild(client, {
      symbol: 'BTCUSDT',
      side: OrderSideEnum.Sell,
      amount: 1,
      price: 0,
      type: OrderTypeEnum.TakeProfitMarket,
      stopPrice: 110,
    });
    expect(params.type).toBe('TAKE_PROFIT');
  });

  it('Spot TakeProfitLimit → TAKE_PROFIT_LIMIT (with timeInForce)', () => {
    const client = createBinanceSpot();
    const params = callBinanceBuild(client, {
      symbol: 'BTCUSDT',
      side: OrderSideEnum.Sell,
      amount: 1,
      price: 111,
      type: OrderTypeEnum.TakeProfitLimit,
      stopPrice: 110,
    });
    expect(params.type).toBe('TAKE_PROFIT_LIMIT');
    expect(params.timeInForce).toBe('GTC');
  });

  it('Spot Market with quoteOrderQty → quoteOrderQty set, no quantity', () => {
    const client = createBinanceSpot();
    const params = callBinanceBuild(client, {
      symbol: 'BTCUSDT',
      side: OrderSideEnum.Buy,
      amount: 0,
      price: 0,
      type: OrderTypeEnum.Market,
      quoteOrderQty: 100,
    });
    expect(params.quoteOrderQty).toBe('100');
    expect(params.quantity).toBeUndefined();
  });

  it('Spot trailing offset is stated in percent and converted at the boundary (Binance spot counts it in its own hundredths)', () => {
    const client = createBinanceSpot();
    const params = callBinanceBuild(client, {
      symbol: 'BTCUSDT',
      side: OrderSideEnum.Sell,
      amount: 1,
      price: 0,
      type: OrderTypeEnum.StopMarket,
      callbackRate: 1,
    });
    expect(params.trailingDelta).toBe('100');
  });

  it('Spot trailing offset keeps sub-percent precision through the conversion', () => {
    const client = createBinanceSpot();
    const params = callBinanceBuild(client, {
      symbol: 'BTCUSDT',
      side: OrderSideEnum.Sell,
      amount: 1,
      price: 0,
      type: OrderTypeEnum.StopMarket,
      callbackRate: 0.15,
    });
    expect(params.trailingDelta).toBe('15');
  });

  it('Spot order without a trailing offset carries no trailing field at all', () => {
    const client = createBinanceSpot();
    const params = callBinanceBuild(client, {
      symbol: 'BTCUSDT',
      side: OrderSideEnum.Sell,
      amount: 1,
      price: 0,
      type: OrderTypeEnum.StopMarket,
    });
    expect(params.trailingDelta).toBeUndefined();
  });
});

describe('buildBybitOrderParams — linear (futures)', () => {
  it('Market order must NOT carry a price field even when orderParams.price is set (stray price on a market request is wire garbage)', () => {
    const client = createBybitLinear();
    const params = callBybitBuild(client, {
      symbol: 'BTCUSDT',
      side: OrderSideEnum.Buy,
      amount: 1,
      price: 100, // stale reference price from the original orderParams
      type: OrderTypeEnum.Market,
    });
    expect(params.orderType).toBe('Market');
    expect(params.price).toBeUndefined();
  });

  it('open long hedge: positionIdx=1, no reduceOnly', () => {
    const client = createBybitLinear();
    const params = callBybitBuild(client, {
      symbol: 'BTCUSDT',
      side: OrderSideEnum.Buy,
      amount: 1,
      price: 100,
      type: OrderTypeEnum.Limit,
      positionSide: PositionSideEnum.Long,
    });
    expect(params.category).toBe('linear');
    expect(params.side).toBe('Buy');
    expect(params.orderType).toBe('Limit');
    expect(params.positionIdx).toBe(1);
    expect(params.reduceOnly).toBeUndefined();
  });

  it('close long hedge: positionIdx=1, reduceOnly=true', () => {
    const client = createBybitLinear();
    const params = callBybitBuild(client, {
      symbol: 'BTCUSDT',
      side: OrderSideEnum.Sell,
      amount: 1,
      price: 0,
      type: OrderTypeEnum.Market,
      positionSide: PositionSideEnum.Long,
      reduceOnly: true,
    });
    expect(params.positionIdx).toBe(1);
    expect(params.reduceOnly).toBe(true);
  });

  it('close short hedge: positionIdx=2, reduceOnly=true', () => {
    const client = createBybitLinear();
    const params = callBybitBuild(client, {
      symbol: 'BTCUSDT',
      side: OrderSideEnum.Buy,
      amount: 1,
      price: 0,
      type: OrderTypeEnum.Market,
      positionSide: PositionSideEnum.Short,
      reduceOnly: true,
    });
    expect(params.positionIdx).toBe(2);
    expect(params.reduceOnly).toBe(true);
  });

  it('SL with triggerPrice + triggerDirection + triggerBy + closeOnTrigger', () => {
    const client = createBybitLinear();
    const params = callBybitBuild(client, {
      symbol: 'BTCUSDT',
      side: OrderSideEnum.Sell,
      amount: 1,
      price: 0,
      type: OrderTypeEnum.StopMarket,
      stopPrice: 90,
      triggerDirection: 2,
      triggerBy: TriggerByEnum.MarkPrice,
      reduceOnly: true,
      closeOnTrigger: true,
      positionSide: PositionSideEnum.Long,
    });
    expect(params.triggerPrice).toBe('90');
    expect(params.triggerDirection).toBe(2);
    expect(params.triggerBy).toBe(TriggerByEnum.MarkPrice);
    expect(params.closeOnTrigger).toBe(true);
    expect(params.positionIdx).toBe(1);
  });

  it('oneway open long: positionIdx undefined (no positionSide)', () => {
    const client = createBybitLinear();
    const params = callBybitBuild(client, {
      symbol: 'BTCUSDT',
      side: OrderSideEnum.Buy,
      amount: 1,
      price: 100,
      type: OrderTypeEnum.Limit,
    });
    expect(params.positionIdx).toBeUndefined();
  });

  it('closePosition on a stop: qty=0 with reduceOnly and closeOnTrigger (Bybit way to close the whole position)', () => {
    const client = createBybitLinear();
    const params = callBybitBuild(client, {
      symbol: 'BTCUSDT',
      side: OrderSideEnum.Buy,
      amount: 3,
      price: 0,
      type: OrderTypeEnum.StopMarket,
      stopPrice: 110,
      closePosition: true,
    });
    expect(params.qty).toBe('0');
    expect(params.reduceOnly).toBe(true);
    expect(params.closeOnTrigger).toBe(true);
  });

  it('closePosition wins over an explicit reduceOnly=false: a closing order can never grow the position', () => {
    const client = createBybitLinear();
    const params = callBybitBuild(client, {
      symbol: 'BTCUSDT',
      side: OrderSideEnum.Buy,
      amount: 3,
      price: 0,
      type: OrderTypeEnum.StopMarket,
      stopPrice: 110,
      closePosition: true,
      reduceOnly: false,
    });
    expect(params.qty).toBe('0');
    expect(params.reduceOnly).toBe(true);
    expect(params.closeOnTrigger).toBe(true);
  });

  it('workingType alone still selects the trigger price type (consumers may speak either dialect)', () => {
    const client = createBybitLinear();
    const params = callBybitBuild(client, {
      symbol: 'BTCUSDT',
      side: OrderSideEnum.Buy,
      amount: 1,
      price: 0,
      type: OrderTypeEnum.StopMarket,
      stopPrice: 110,
      workingType: WorkingTypeEnum.ContractPrice,
    });
    expect(params.triggerBy).toBe(TriggerByEnum.LastPrice);
  });

  it('workingType markPrice maps to the mark price trigger', () => {
    const client = createBybitLinear();
    const params = callBybitBuild(client, {
      symbol: 'BTCUSDT',
      side: OrderSideEnum.Buy,
      amount: 1,
      price: 0,
      type: OrderTypeEnum.StopMarket,
      stopPrice: 110,
      workingType: WorkingTypeEnum.MarkPrice,
    });
    expect(params.triggerBy).toBe(TriggerByEnum.MarkPrice);
  });

  it('explicit triggerBy outranks workingType', () => {
    const client = createBybitLinear();
    const params = callBybitBuild(client, {
      symbol: 'BTCUSDT',
      side: OrderSideEnum.Buy,
      amount: 1,
      price: 0,
      type: OrderTypeEnum.StopMarket,
      stopPrice: 110,
      triggerBy: TriggerByEnum.LastPrice,
      workingType: WorkingTypeEnum.MarkPrice,
    });
    expect(params.triggerBy).toBe(TriggerByEnum.LastPrice);
  });
});

describe('buildBybitOrderParams — spot', () => {
  it('Spot Buy Limit: no positionIdx, no reduceOnly, no triggerDirection', () => {
    const client = createBybitSpot();
    const params = callBybitBuild(client, {
      symbol: 'BTCUSDT',
      side: OrderSideEnum.Buy,
      amount: 1,
      price: 100,
      type: OrderTypeEnum.Limit,
      positionSide: PositionSideEnum.Long,
      reduceOnly: true,
      triggerDirection: 2,
      triggerBy: TriggerByEnum.MarkPrice,
      closeOnTrigger: true,
    });
    expect(params.category).toBe('spot');
    expect(params.positionIdx).toBeUndefined();
    expect(params.reduceOnly).toBeUndefined();
    expect(params.triggerDirection).toBeUndefined();
    expect(params.triggerBy).toBeUndefined();
    expect(params.closeOnTrigger).toBeUndefined();
  });

  it('Spot conditional StopMarket Sell: orderFilter=StopOrder + triggerPrice', () => {
    const client = createBybitSpot();
    const params = callBybitBuild(client, {
      symbol: 'BTCUSDT',
      side: OrderSideEnum.Sell,
      amount: 1,
      price: 0,
      type: OrderTypeEnum.StopMarket,
      stopPrice: 90,
      orderFilter: OrderFilterEnum.StopOrder,
    });
    expect(params.orderFilter).toBe('StopOrder');
    expect(params.triggerPrice).toBe('90');
    expect(params.orderType).toBe('Market');
  });

  it('Spot Market with quoteOrderQty: qty=quote amount, marketUnit not forced when explicit', () => {
    const client = createBybitSpot();
    const params = callBybitBuild(client, {
      symbol: 'BTCUSDT',
      side: OrderSideEnum.Buy,
      amount: 0,
      price: 0,
      type: OrderTypeEnum.Market,
      quoteOrderQty: 100,
      marketUnit: MarketUnitEnum.QuoteCoin,
    });
    expect(params.qty).toBe('100');
    expect(params.marketUnit).toBe('quoteCoin');
  });

  it('Spot StopLimit (Limit-like): orderType=Limit, triggerPrice', () => {
    const client = createBybitSpot();
    const params = callBybitBuild(client, {
      symbol: 'BTCUSDT',
      side: OrderSideEnum.Sell,
      amount: 1,
      price: 89,
      type: OrderTypeEnum.StopLimit,
      stopPrice: 90,
      orderFilter: OrderFilterEnum.StopOrder,
    });
    expect(params.orderType).toBe('Limit');
    expect(params.price).toBe('89');
    expect(params.triggerPrice).toBe('90');
    expect(params.orderFilter).toBe('StopOrder');
  });

  it('Spot Market with quoteOrderQty defaults marketUnit to quoteCoin: "buy for 100 dollars" must not become "buy 100 coins"', () => {
    const client = createBybitSpot();
    const params = callBybitBuild(client, {
      symbol: 'BTCUSDT',
      side: OrderSideEnum.Buy,
      amount: 0,
      price: 0,
      type: OrderTypeEnum.Market,
      quoteOrderQty: 100,
    });
    expect(params.qty).toBe('100');
    expect(params.marketUnit).toBe(MarketUnitEnum.QuoteCoin);
  });

  it('Spot Market sized in coins defaults marketUnit to baseCoin', () => {
    const client = createBybitSpot();
    const params = callBybitBuild(client, {
      symbol: 'BTCUSDT',
      side: OrderSideEnum.Buy,
      amount: 2,
      price: 0,
      type: OrderTypeEnum.Market,
    });
    expect(params.marketUnit).toBe(MarketUnitEnum.BaseCoin);
  });

  it('marketUnit stays absent on a limit order: the unit only exists for spot market orders', () => {
    const client = createBybitSpot();
    const params = callBybitBuild(client, {
      symbol: 'BTCUSDT',
      side: OrderSideEnum.Buy,
      amount: 2,
      price: 100,
      type: OrderTypeEnum.Limit,
    });
    expect(params.marketUnit).toBeUndefined();
  });
});

describe('buildOkxOrderParams — swap (futures)', () => {
  it('open long Limit hedge: posSide=long, no reduceOnly', async () => {
    const client = await createOkxSwap('long_short_mode');
    const params = await callOkxBuild(client, {
      symbol: 'BTCUSDT',
      side: OrderSideEnum.Buy,
      amount: 0.05,
      price: 50000,
      type: OrderTypeEnum.Limit,
      positionSide: PositionSideEnum.Long,
    });

    expect(params.instId).toBe('BTC-USDT-SWAP');
    expect(params.ordType).toBe('limit');
    expect(params.posSide).toBe('long');
    expect(params.reduceOnly).toBeUndefined();
    expect(params.px).toBe('50000');
  });

  it('close long oneway: reduceOnly=true, no posSide', async () => {
    const client = await createOkxSwap('net_mode');
    const params = await callOkxBuild(client, {
      symbol: 'BTCUSDT',
      side: OrderSideEnum.Sell,
      amount: 0.05,
      type: OrderTypeEnum.Market,
      reduceOnly: true,
    });

    expect(params.reduceOnly).toBe(true);
    expect(params.posSide).toBeUndefined();
  });

  it('Market order must NOT carry a price field even when one is set', async () => {
    const client = await createOkxSwap();
    const params = await callOkxBuild(client, {
      symbol: 'BTCUSDT',
      side: OrderSideEnum.Buy,
      amount: 0.05,
      price: 50000,
      type: OrderTypeEnum.Market,
    });

    expect(params.ordType).toBe('market');
    expect(params.px).toBeUndefined();
  });

  it('refuses to build a swap stop order for the plain endpoint', async () => {
    const client = await createOkxSwap();

    await expect(callOkxBuild(client, {
      symbol: 'BTCUSDT',
      side: OrderSideEnum.Sell,
      amount: 0.05,
      type: OrderTypeEnum.StopMarket,
      stopPrice: 60000,
    })).rejects.toMatchObject({ code: 'CONDITIONAL_ORDER_WRONG_ENDPOINT' });
  });

  it('states the size in contracts, not in coins', async () => {
    const client = await createOkxSwap();
    const params = await callOkxBuild(client, {
      symbol: 'BTCUSDT',
      side: OrderSideEnum.Buy,
      amount: 0.05,
      type: OrderTypeEnum.Market,
    });

    expect(params.sz).toBe('5');
  });

  it('trailing offset is stated in percent and converted to the OKX ratio', async () => {
    const client = await createOkxSwap();
    const params = await callOkxAlgoBuild(client, {
      symbol: 'BTCUSDT',
      side: OrderSideEnum.Sell,
      amount: 0.05,
      type: OrderTypeEnum.TrailingStop,
      callbackRate: 2,
    });

    expect(params.ordType).toBe('move_order_stop');
    expect(params.callbackRatio).toBe('0.02');
  });
});

describe('buildOkxOrderParams — spot', () => {
  it('Spot Buy Limit: cash mode, no posSide, no reduceOnly', async () => {
    const client = await createOkxSpot();
    const params = await callOkxBuild(client, {
      symbol: 'BTCUSDT',
      side: OrderSideEnum.Buy,
      amount: 1,
      price: 50000,
      type: OrderTypeEnum.Limit,
      positionSide: PositionSideEnum.Long,
      reduceOnly: true,
    });

    expect(params.tdMode).toBe('cash');
    expect(params.posSide).toBeUndefined();
    expect(params.reduceOnly).toBeUndefined();
  });

  it('Spot Market with quoteOrderQty → quote unit', async () => {
    const client = await createOkxSpot();
    const params = await callOkxBuild(client, {
      symbol: 'BTCUSDT',
      side: OrderSideEnum.Buy,
      amount: 0,
      type: OrderTypeEnum.Market,
      quoteOrderQty: 100,
    });

    expect(params.sz).toBe('100');
    expect(params.tgtCcy).toBe('quote_ccy');
  });

  it('Spot Market sized in coins states the base unit explicitly', async () => {
    const client = await createOkxSpot();
    const params = await callOkxBuild(client, {
      symbol: 'BTCUSDT',
      side: OrderSideEnum.Buy,
      amount: 2,
      type: OrderTypeEnum.Market,
    });

    expect(params.tgtCcy).toBe('base_ccy');
  });

  it('Spot StopMarket goes to the algo builder with the last-price trigger', async () => {
    const client = await createOkxSpot();
    const params = await callOkxAlgoBuild(client, {
      symbol: 'BTCUSDT',
      side: OrderSideEnum.Sell,
      amount: 1,
      type: OrderTypeEnum.StopMarket,
      stopPrice: 60000,
    });

    expect(params.slTriggerPx).toBe('60000');
    expect(params.slTriggerPxType).toBe('last');
  });
});

describe('buildBinanceOrderParams — timeInForce mapping', () => {
  it('futures PostOnly Limit maps timeInForce to GTX (not the raw enum value)', () => {
    const client = createBinanceFutures();
    const params = callBinanceBuild(client, {
      symbol: 'BTCUSDT',
      side: OrderSideEnum.Buy,
      amount: 1,
      price: 100,
      type: OrderTypeEnum.Limit,
      timeInForce: TimeInForceEnum.PostOnly,
    });

    expect(params.timeInForce).toBe('GTX');
    expect(params.type).toBe('LIMIT');
  });

  it('futures Ioc Limit maps timeInForce to IOC', () => {
    const client = createBinanceFutures();
    const params = callBinanceBuild(client, {
      symbol: 'BTCUSDT',
      side: OrderSideEnum.Buy,
      amount: 1,
      price: 100,
      type: OrderTypeEnum.Limit,
      timeInForce: TimeInForceEnum.Ioc,
    });

    expect(params.timeInForce).toBe('IOC');
  });

  it('spot PostOnly Limit becomes LIMIT_MAKER with no timeInForce', () => {
    const client = createBinanceSpot();
    const params = callBinanceBuild(client, {
      symbol: 'BTCUSDT',
      side: OrderSideEnum.Buy,
      amount: 1,
      price: 100,
      type: OrderTypeEnum.Limit,
      timeInForce: TimeInForceEnum.PostOnly,
    });

    expect(params.type).toBe('LIMIT_MAKER');
    expect(params.timeInForce).toBeUndefined();
  });
});

// Проверено по данным биржи 08.08.2026: единственный признак, разрешающий сумму в котируемой
// валюте, называется «разрешено для РЫНОЧНЫХ» — лимитного соответствия у него нет. Раньше
// обе биржи молча принимали такую сумму и на лимитной заявке: Binance отправлял заявку вовсе
// без объёма, Bybit — принимал сумму денег за количество монет.
describe('amount stated in quote currency belongs to market orders only', () => {
  it('Binance spot refuses it on a limit order instead of sending an order with no size', () => {
    const client = createBinanceSpot();

    expect(() => callBinanceBuild(client, {
      symbol: 'BTCUSDT',
      side: OrderSideEnum.Buy,
      amount: 0,
      price: 100,
      type: OrderTypeEnum.Limit,
      quoteOrderQty: 100,
    })).toThrow(/market/i);
  });

  it('Bybit spot refuses it on a limit order instead of buying that many coins', () => {
    const client = createBybitSpot();

    expect(() => callBybitBuild(client, {
      symbol: 'BTCUSDT',
      side: OrderSideEnum.Buy,
      amount: 0,
      price: 100,
      type: OrderTypeEnum.Limit,
      quoteOrderQty: 100,
    })).toThrow(/market/i);
  });

  it('OKX spot refuses it on a limit order too', async () => {
    const client = await createOkxSpot();

    await expect(callOkxBuild(client, {
      symbol: 'BTCUSDT',
      side: OrderSideEnum.Buy,
      amount: 0,
      price: 100,
      type: OrderTypeEnum.Limit,
      quoteOrderQty: 100,
    })).rejects.toThrow(/market/i);
  });

  it('all three still accept it on a market order', async () => {
    expect(callBinanceBuild(createBinanceSpot(), {
      symbol: 'BTCUSDT', side: OrderSideEnum.Buy, amount: 0, price: 0, type: OrderTypeEnum.Market, quoteOrderQty: 100,
    }).quoteOrderQty).toBe('100');

    expect(callBybitBuild(createBybitSpot(), {
      symbol: 'BTCUSDT', side: OrderSideEnum.Buy, amount: 0, price: 0, type: OrderTypeEnum.Market, quoteOrderQty: 100,
    }).qty).toBe('100');

    const okxParams = await callOkxBuild(await createOkxSpot(), {
      symbol: 'BTCUSDT', side: OrderSideEnum.Buy, amount: 0, price: 0, type: OrderTypeEnum.Market, quoteOrderQty: 100,
    });

    expect(okxParams.sz).toBe('100');
  });
});
