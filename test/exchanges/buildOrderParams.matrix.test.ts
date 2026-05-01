import axios from 'axios';
import { BinanceFutures } from '../../src/exchanges/BinanceFutures';
import { BinanceSpot } from '../../src/exchanges/BinanceSpot';
import { BybitLinear } from '../../src/exchanges/BybitLinear';
import { BybitSpot } from '../../src/exchanges/BybitSpot';
import { createMockLogger } from '../fixtures/mockLogger';
import { createMockAxiosInstance } from '../fixtures/mockAxios';
import {
  MarketUnitEnum,
  OrderFilterEnum,
  OrderSideEnum,
  OrderTypeEnum,
  PositionSideEnum,
  TriggerByEnum,
  WorkingTypeEnum,
} from '../../src/types/common';

jest.mock('axios');
jest.mock('../../src/ws/BinanceFuturesPublicStream');
jest.mock('../../src/ws/BinanceSpotPublicStream');
jest.mock('../../src/ws/BinanceTradeStream');
jest.mock('../../src/ws/BybitPublicStream');
jest.mock('../../src/ws/BybitTradeStream');

const mockedAxios = axios as jest.Mocked<typeof axios>;

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

  it('SL StopMarket hedge long → STOP_MARKET + workingType', () => {
    const client = createBinanceFutures();
    const params = callBinanceBuild(client, {
      symbol: 'BTCUSDT',
      side: OrderSideEnum.Sell,
      amount: 1,
      price: 0,
      type: OrderTypeEnum.StopMarket,
      stopPrice: 90,
      workingType: WorkingTypeEnum.MarkPrice,
      positionSide: PositionSideEnum.Long,
    });
    expect(params.type).toBe('STOP_MARKET');
    expect(params.stopPrice).toBe('90');
    expect(params.workingType).toBe('MARK_PRICE');
    expect(params.positionSide).toBe('LONG');
  });

  it('TP TakeProfitMarket → TAKE_PROFIT_MARKET on futures', () => {
    const client = createBinanceFutures();
    const params = callBinanceBuild(client, {
      symbol: 'BTCUSDT',
      side: OrderSideEnum.Sell,
      amount: 1,
      price: 0,
      type: OrderTypeEnum.TakeProfitMarket,
      stopPrice: 110,
    });
    expect(params.type).toBe('TAKE_PROFIT_MARKET');
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

  it('Spot trailingDelta passed through', () => {
    const client = createBinanceSpot();
    const params = callBinanceBuild(client, {
      symbol: 'BTCUSDT',
      side: OrderSideEnum.Sell,
      amount: 1,
      price: 0,
      type: OrderTypeEnum.StopMarket,
      trailingDelta: 50,
    });
    expect(params.trailingDelta).toBe('50');
  });
});

describe('buildBybitOrderParams — linear (futures)', () => {
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
});
