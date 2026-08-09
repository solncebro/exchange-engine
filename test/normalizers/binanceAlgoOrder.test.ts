import { normalizeBinanceAlgoOrder, mergeBinanceTriggeredOrder } from '../../src/normalizers/binanceNormalizer';
import type { BinanceAlgoOrderRaw, BinanceOrderResponseRaw } from '../../src/normalizers/binanceNormalizer';
import { OrderSideEnum, OrderTypeEnum, TimeInForceEnum } from '../../src/types/common';

// Снято с живого ответа биржи 07.08.2026 по реально стоящему стопу.
const RAW_UNTRIGGERED: BinanceAlgoOrderRaw = {
  algoId: 3000002125564507,
  clientAlgoId: 'manual-stop-xaiusdt-15pct',
  algoType: 'CONDITIONAL',
  orderType: 'STOP_MARKET',
  symbol: 'XAIUSDT',
  side: 'BUY',
  positionSide: 'SHORT',
  timeInForce: 'GTE_GTC',
  quantity: '0',
  algoStatus: 'NEW',
  actualOrderId: '',
  actualPrice: '0.0000000',
  triggerPrice: '0.0091910',
  price: '0.0000000',
  icebergQuantity: null,
  tpOrderType: '',
  selfTradePreventionMode: 'EXPIRE_MAKER',
  workingType: 'CONTRACT_PRICE',
  priceMatch: 'NONE',
  closePosition: true,
  priceProtect: false,
  reduceOnly: true,
  createTime: 1786087695084,
  updateTime: 1786087695084,
  triggerTime: 0,
  goodTillDate: 0,
};

describe('normalizeBinanceAlgoOrder', () => {
  it('maps the algo identity onto the unified order shape', () => {
    const order = normalizeBinanceAlgoOrder(RAW_UNTRIGGERED);

    expect(order.id).toBe('3000002125564507');
    expect(order.clientOrderId).toBe('manual-stop-xaiusdt-15pct');
    expect(order.symbol).toBe('XAIUSDT');
    expect(order.side).toBe(OrderSideEnum.Buy);
    expect(order.type).toBe(OrderTypeEnum.StopMarket);
    expect(order.isConditional).toBe(true);
  });

  it('puts the trigger price where every consumer already looks for it', () => {
    // Бот отличает стопы признаком «цена срабатывания больше нуля» — раскладка обязана
    // его сохранить, иначе восстановление после перезапуска перестанет видеть стопы.
    const order = normalizeBinanceAlgoOrder(RAW_UNTRIGGERED);

    expect(order.stopPrice).toBeCloseTo(0.009191, 9);
    expect(order.stopPrice > 0).toBe(true);
  });

  it('understands GTE_GTC, which no request enum accepts', () => {
    expect(normalizeBinanceAlgoOrder(RAW_UNTRIGGERED).timeInForce).toBe(TimeInForceEnum.Gtc);
  });

  it('reports a close-all order honestly: zero amount plus the close-all flag', () => {
    const order = normalizeBinanceAlgoOrder(RAW_UNTRIGGERED);

    expect(order.amount).toBe(0);
    expect(order.closePosition).toBe(true);
  });

  it('leaves the triggered order id unset while the order has not fired', () => {
    expect(normalizeBinanceAlgoOrder(RAW_UNTRIGGERED).triggeredOrderId).toBeUndefined();
  });

  it('never reports a fill it cannot prove', () => {
    // Пока не подмешана порождённая заявка, исполнение считается нулевым: выдуманное
    // заполнение попало бы в журнал как закрытие, которого не было.
    const order = normalizeBinanceAlgoOrder(RAW_UNTRIGGERED);

    expect(order.filledAmount).toBe(0);
    expect(order.filledQuoteAmount).toBe(0);
  });

  it('keeps a live status non-terminal for a fired but still filling order', () => {
    expect(normalizeBinanceAlgoOrder({ ...RAW_UNTRIGGERED, algoStatus: 'TRIGGERING' }).status).toBe('open');
    expect(normalizeBinanceAlgoOrder({ ...RAW_UNTRIGGERED, algoStatus: 'TRIGGERED' }).status).toBe('open');
  });

  it('maps the terminal statuses', () => {
    expect(normalizeBinanceAlgoOrder({ ...RAW_UNTRIGGERED, algoStatus: 'FINISHED' }).status).toBe('closed');
    expect(normalizeBinanceAlgoOrder({ ...RAW_UNTRIGGERED, algoStatus: 'CANCELED' }).status).toBe('canceled');
    expect(normalizeBinanceAlgoOrder({ ...RAW_UNTRIGGERED, algoStatus: 'EXPIRED' }).status).toBe('canceled');
    expect(normalizeBinanceAlgoOrder({ ...RAW_UNTRIGGERED, algoStatus: 'REJECTED' }).status).toBe('rejected');
  });

  it('exposes the triggered order id once the order has fired', () => {
    const order = normalizeBinanceAlgoOrder({
      ...RAW_UNTRIGGERED,
      algoStatus: 'FINISHED',
      actualOrderId: '8389765001',
      actualPrice: '0.0092100',
    });

    expect(order.triggeredOrderId).toBe('8389765001');
    expect(order.avgPrice).toBeCloseTo(0.00921, 9);
  });

  it('survives missing and malformed numbers without producing not-a-number', () => {
    const order = normalizeBinanceAlgoOrder({
      ...RAW_UNTRIGGERED,
      triggerPrice: undefined as unknown as string,
      price: '',
      quantity: 'nonsense',
      actualPrice: undefined,
    });

    expect(Number.isNaN(order.stopPrice)).toBe(false);
    expect(Number.isNaN(order.price)).toBe(false);
    expect(Number.isNaN(order.amount)).toBe(false);
    expect(Number.isNaN(order.avgPrice)).toBe(false);
  });
});

describe('mergeBinanceTriggeredOrder', () => {
  const TRIGGERED_RAW: BinanceOrderResponseRaw = {
    orderId: 8389765001,
    clientOrderId: 'autoclose-123',
    symbol: 'XAIUSDT',
    side: 'BUY',
    type: 'MARKET',
    timeInForce: 'IOC',
    origQty: '377452',
    executedQty: '377452',
    price: '0',
    avgPrice: '0.0092050',
    stopPrice: '0',
    cumQuote: '3474.44',
    status: 'FILLED',
    reduceOnly: true,
    time: 1786090000000,
    updateTime: 1786090000100,
  };

  it('takes the fill from the triggered order and leaves the conditional identity alone', () => {
    const conditionalOrder = normalizeBinanceAlgoOrder({
      ...RAW_UNTRIGGERED,
      algoStatus: 'FINISHED',
      actualOrderId: '8389765001',
    });

    const merged = mergeBinanceTriggeredOrder(conditionalOrder, TRIGGERED_RAW);

    expect(merged.filledAmount).toBe(377452);
    expect(merged.avgPrice).toBeCloseTo(0.009205, 9);
    expect(merged.filledQuoteAmount).toBeCloseTo(3474.44, 9);
    expect(merged.status).toBe('closed');

    // Личность условной заявки не меняется — снаружи это по-прежнему она.
    expect(merged.id).toBe('3000002125564507');
    expect(merged.clientOrderId).toBe('manual-stop-xaiusdt-15pct');
    expect(merged.stopPrice).toBeCloseTo(0.009191, 9);
    expect(merged.isConditional).toBe(true);
  });

  it('reports a cancelled-in-book order as not filled', () => {
    // FINISHED значит «исполнена ИЛИ отменена» — отличить можно только по порождённой.
    const conditionalOrder = normalizeBinanceAlgoOrder({
      ...RAW_UNTRIGGERED,
      algoStatus: 'FINISHED',
      actualOrderId: '8389765001',
    });

    const merged = mergeBinanceTriggeredOrder(conditionalOrder, {
      ...TRIGGERED_RAW,
      executedQty: '0',
      cumQuote: '0',
      avgPrice: '0',
      status: 'CANCELED',
    });

    expect(merged.filledAmount).toBe(0);
    expect(merged.status).toBe('canceled');
  });
});
