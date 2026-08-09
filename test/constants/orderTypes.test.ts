import { CONDITIONAL_ORDER_TYPE_SET, isConditionalOrderType } from '../../src/constants/orderTypes';
import { OrderTypeEnum } from '../../src/types/common';

describe('conditional order types', () => {
  it('treats every trigger-waiting order type as conditional', () => {
    const expectedList = [
      OrderTypeEnum.StopMarket,
      OrderTypeEnum.StopLimit,
      OrderTypeEnum.TakeProfitMarket,
      OrderTypeEnum.TakeProfitLimit,
      OrderTypeEnum.Stop,
      OrderTypeEnum.TakeProfit,
      OrderTypeEnum.TrailingStop,
    ];

    expect([...CONDITIONAL_ORDER_TYPE_SET].sort()).toEqual([...expectedList].sort());
    expectedList.forEach((type) => expect(isConditionalOrderType(type)).toBe(true));
  });

  it('treats plain book orders as not conditional', () => {
    expect(isConditionalOrderType(OrderTypeEnum.Market)).toBe(false);
    expect(isConditionalOrderType(OrderTypeEnum.Limit)).toBe(false);
  });

  it('covers every member of OrderTypeEnum, so a new type cannot be silently unclassified', () => {
    const allTypeList = Object.values(OrderTypeEnum);
    const plainList = allTypeList.filter((type) => !CONDITIONAL_ORDER_TYPE_SET.has(type));

    expect(plainList).toEqual([OrderTypeEnum.Market, OrderTypeEnum.Limit]);
    expect(CONDITIONAL_ORDER_TYPE_SET.size + plainList.length).toBe(allTypeList.length);
  });
});
