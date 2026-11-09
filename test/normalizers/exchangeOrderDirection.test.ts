import { normalizeBinanceOrder, normalizeBinanceAlgoOrder } from '../../src/normalizers/binanceNormalizer';
import type { BinanceAlgoOrderRaw } from '../../src/normalizers/binanceNormalizer';
import { normalizeBybitOrder, buildBybitOrderFromCreateResponse, normalizeBybitClosedPnlList } from '../../src/normalizers/bybitNormalizer';
import { OrderSideEnum, OrderTypeEnum, PositionSideEnum } from '../../src/types/common';
import { BINANCE_RAW_ORDER_RESPONSE } from '../fixtures/binanceRaw';
import { BYBIT_RAW_ORDER_RESPONSE, BYBIT_RAW_CLOSED_PNL_LIST } from '../fixtures/bybitRaw';

const ALGO_ORDER: BinanceAlgoOrderRaw = {
  algoId: 1,
  clientAlgoId: 'test',
  algoType: 'CONDITIONAL',
  orderType: 'STOP_MARKET',
  symbol: 'BTCUSDT',
  side: 'SELL',
  quantity: '0',
  algoStatus: 'NEW',
  triggerPrice: '100',
  price: '0',
  createTime: 1,
  updateTime: 1,
};

describe('order position direction', () => {
  it.each([
    ['LONG', PositionSideEnum.Long],
    ['SHORT', PositionSideEnum.Short],
    ['BOTH', PositionSideEnum.Both],
    ['', undefined],
    ['unknown', undefined],
    ['__proto__', undefined],
    [undefined, undefined],
  ])('retains Binance positionSide %s for plain and conditional orders', (positionSide, expected) => {
    expect(normalizeBinanceOrder({ ...BINANCE_RAW_ORDER_RESPONSE, positionSide }).positionSide).toBe(expected);
    expect(normalizeBinanceAlgoOrder({ ...ALGO_ORDER, positionSide }).positionSide).toBe(expected);
  });

  it.each([
    [0, PositionSideEnum.Both],
    [1, PositionSideEnum.Long],
    [2, PositionSideEnum.Short],
    [3, undefined],
    [-1, undefined],
    [undefined, undefined],
  ])('retains Bybit positionIdx %s without assuming one-way mode', (positionIdx, expected) => {
    expect(normalizeBybitOrder({ ...BYBIT_RAW_ORDER_RESPONSE, positionIdx }).positionSide).toBe(expected);
  });

  it.each([true, false, undefined])('retains Binance closePosition %s', (closePosition) => {
    expect(normalizeBinanceOrder({ ...BINANCE_RAW_ORDER_RESPONSE, closePosition }).closePosition).toBe(closePosition);
  });

  it.each([PositionSideEnum.Long, PositionSideEnum.Short, PositionSideEnum.Both, undefined])(
    'retains requested Bybit position side %s in create acknowledgements',
    (positionSide) => {
      const order = buildBybitOrderFromCreateResponse({
        symbol: 'BTCUSDT',
        side: OrderSideEnum.Buy,
        type: OrderTypeEnum.Limit,
        amount: 1,
        positionSide,
      }, '1');

      expect(order.positionSide).toBe(positionSide);
    },
  );
});

describe('Bybit closing fee completeness', () => {
  it('marks both known fees as complete', () => {
    expect(normalizeBybitClosedPnlList(BYBIT_RAW_CLOSED_PNL_LIST)[0].isTradingFeeComplete).toBe(true);
  });

  it.each(['', 'unknown'])('marks an unreadable entry fee %s as incomplete', (openFee) => {
    const result = normalizeBybitClosedPnlList([{ ...BYBIT_RAW_CLOSED_PNL_LIST[0], openFee }]);

    expect(result[0].isTradingFeeComplete).toBe(false);
    expect(Number.isFinite(result[0].closedPnl)).toBe(true);
  });

  it.each(['', 'unknown'])('marks an unreadable exit fee %s as incomplete', (closeFee) => {
    const result = normalizeBybitClosedPnlList([{ ...BYBIT_RAW_CLOSED_PNL_LIST[0], closeFee }]);

    expect(result[0].isTradingFeeComplete).toBe(false);
    expect(Number.isFinite(result[0].closedPnl)).toBe(true);
  });
});
