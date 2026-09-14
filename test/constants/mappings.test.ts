import {
  BINANCE_ALGO_STATUS,
  BINANCE_ORDER_STATUS,
  BINANCE_TIME_IN_FORCE,
  BINANCE_FUTURES_ORDER_TYPE_REVERSE,
  BINANCE_ALGO_ORDER_TYPE_REVERSE,
  BINANCE_SPOT_ORDER_TYPE_REVERSE,
  OKX_ORDER_STATUS,
  OKX_ALGO_STATUS,
  OKX_ORDER_TYPE_BY_TIME_IN_FORCE,
  OKX_ORD_TYPE_TO_TIME_IN_FORCE,
} from '../../src/constants/mappings';
import { CONDITIONAL_ORDER_TYPE_SET } from '../../src/constants/orderTypes';
import { OrderTypeEnum, TimeInForceEnum } from '../../src/types/common';

const UNIFIED_STATUS_LIST = ['open', 'closed', 'canceled', 'rejected'];

describe('BINANCE_ALGO_STATUS', () => {
  it('maps all seven algo statuses onto the unified vocabulary', () => {
    expect(Object.keys(BINANCE_ALGO_STATUS).sort()).toEqual(
      ['NEW', 'TRIGGERING', 'TRIGGERED', 'FINISHED', 'CANCELED', 'REJECTED', 'EXPIRED'].sort(),
    );

    Object.values(BINANCE_ALGO_STATUS).forEach((status) => {
      expect(UNIFIED_STATUS_LIST).toContain(status);
    });
  });

  it('keeps TRIGGERING and TRIGGERED non-terminal', () => {
    // Триггер сработал, но заявка ещё исполняется в стакане. Пометить её закрытой —
    // значит завершить сделку раньше времени и записать в журнал неверный выход.
    expect(BINANCE_ALGO_STATUS.TRIGGERING).toBe('open');
    expect(BINANCE_ALGO_STATUS.TRIGGERED).toBe('open');
    expect(BINANCE_ALGO_STATUS.NEW).toBe('open');
  });

  it('marks the terminal statuses', () => {
    // FINISHED = «исполнена ИЛИ отменена в стакане» — терминальна, но не равна «исполнена».
    expect(BINANCE_ALGO_STATUS.FINISHED).toBe('closed');
    expect(BINANCE_ALGO_STATUS.CANCELED).toBe('canceled');
    expect(BINANCE_ALGO_STATUS.EXPIRED).toBe('canceled');
    expect(BINANCE_ALGO_STATUS.REJECTED).toBe('rejected');
  });

  it('agrees with the plain order status vocabulary', () => {
    const plainValueList = new Set(Object.values(BINANCE_ORDER_STATUS));
    Object.values(BINANCE_ALGO_STATUS).forEach((status) => expect(plainValueList.has(status)).toBe(true));
  });
});

describe('BINANCE_TIME_IN_FORCE', () => {
  it('understands GTE_GTC returned by the algo service', () => {
    // Живой ответ биржи по условной заявке содержит GTE_GTC — значения нет ни в одном
    // перечне допустимых на вход. Без записи оно молча падало бы в запасное значение.
    expect(BINANCE_TIME_IN_FORCE.GTE_GTC).toBe(TimeInForceEnum.Gtc);
  });
});

describe('BINANCE_FUTURES_ORDER_TYPE_REVERSE', () => {
  it('cannot build a conditional order for the legacy futures order endpoint', () => {
    // Старый вход отбивает условные типы кодом -4120. Отсутствие строки в таблице —
    // структурная гарантия: собрать такой запрос нельзя даже по ошибке.
    CONDITIONAL_ORDER_TYPE_SET.forEach((type) => {
      expect(BINANCE_FUTURES_ORDER_TYPE_REVERSE[type]).toBeUndefined();
    });
  });

  it('routes every conditional type to the algo service instead', () => {
    CONDITIONAL_ORDER_TYPE_SET.forEach((type) => {
      expect(BINANCE_ALGO_ORDER_TYPE_REVERSE[type]).toBeDefined();
    });
  });

  it('still maps the plain futures order types', () => {
    expect(BINANCE_FUTURES_ORDER_TYPE_REVERSE[OrderTypeEnum.Market]).toBe('MARKET');
    expect(BINANCE_FUTURES_ORDER_TYPE_REVERSE[OrderTypeEnum.Limit]).toBe('LIMIT');
  });
});

describe('BINANCE_SPOT_ORDER_TYPE_REVERSE', () => {
  it('keeps every spot conditional type — spot was not migrated', () => {
    expect(BINANCE_SPOT_ORDER_TYPE_REVERSE[OrderTypeEnum.StopMarket]).toBe('STOP_LOSS');
    expect(BINANCE_SPOT_ORDER_TYPE_REVERSE[OrderTypeEnum.StopLimit]).toBe('STOP_LOSS_LIMIT');
    expect(BINANCE_SPOT_ORDER_TYPE_REVERSE[OrderTypeEnum.TakeProfitMarket]).toBe('TAKE_PROFIT');
    expect(BINANCE_SPOT_ORDER_TYPE_REVERSE[OrderTypeEnum.TakeProfitLimit]).toBe('TAKE_PROFIT_LIMIT');
  });
});

describe('OKX_ORD_TYPE_TO_TIME_IN_FORCE', () => {
  it('round-trips through OKX_ORDER_TYPE_BY_TIME_IN_FORCE for every ordType except market and optimal_limit_ioc', () => {
    Object.entries(OKX_ORD_TYPE_TO_TIME_IN_FORCE).forEach(([ordType, timeInForce]) => {
      if (ordType === 'market' || ordType === 'optimal_limit_ioc') {
        return;
      }

      expect(OKX_ORDER_TYPE_BY_TIME_IN_FORCE[timeInForce]).toBe(ordType);
    });
  });
});

describe('OKX_ORDER_STATUS / OKX_ALGO_STATUS', () => {
  it('map onto the unified status vocabulary only', () => {
    Object.values(OKX_ORDER_STATUS).forEach((status) => {
      expect(UNIFIED_STATUS_LIST).toContain(status);
    });

    Object.values(OKX_ALGO_STATUS).forEach((status) => {
      expect(UNIFIED_STATUS_LIST).toContain(status);
    });
  });
});
