import {
  normalizeBybitBalances,
  normalizeBybitOrder,
  normalizeBybitOrderBook,
  normalizeBybitOrderBookUpdate,
  normalizeBybitPosition,
} from '../../src/normalizers/bybitNormalizer';
import type {
  BybitOrderBookRaw,
  BybitOrderResponseRaw,
  BybitPositionRaw,
  BybitWalletBalanceRaw,
} from '../../src/normalizers/bybitNormalizer';

describe('normalizeBybitOrder — field completeness', () => {
  const sample: Record<string, unknown> = {
    orderId: '1700000000000000001',
    orderLinkId: 'client-1',
    symbol: 'BTCUSDT',
    side: 'Buy',
    orderType: 'Market',
    timeInForce: 'IOC',
    qty: '0.010',
    price: '0',
    avgPrice: '65000',
    triggerPrice: '0',
    cumExecQty: '0.010',
    cumExecValue: '650',
    orderStatus: 'Filled',
    reduceOnly: false,
    createdTime: '1700000000000',
    updatedTime: '1700000000050',
  };

  const MODELED_KEYS = new Set<string>([
    'orderId',
    'orderLinkId',
    'symbol',
    'side',
    'orderType',
    'timeInForce',
    'qty',
    'price',
    'avgPrice',
    'triggerPrice',
    'cumExecQty',
    'cumExecValue',
    'orderStatus',
    'reduceOnly',
    'createdTime',
    'updatedTime',
  ]);
  const INTENTIONALLY_IGNORED_KEYS = new Set<string>([]);

  it('every declared field is modeled or explicitly ignored', () => {
    const unaccounted = Object.keys(sample).filter(
      (key) => !MODELED_KEYS.has(key) && !INTENTIONALLY_IGNORED_KEYS.has(key)
    );
    expect(unaccounted).toEqual([]);
  });

  it('extracts the business-critical fields', () => {
    const order = normalizeBybitOrder(sample as unknown as BybitOrderResponseRaw);

    expect(order.id).toBe('1700000000000000001');
    expect(order.symbol).toBe('BTCUSDT');
    expect(order.amount).toBeCloseTo(0.01);
    expect(order.filledAmount).toBeCloseTo(0.01);
    expect(order.filledQuoteAmount).toBeCloseTo(650);
    expect(order.avgPrice).toBeCloseTo(65000);
    expect(order.status).toBe('closed');
  });
});

describe('normalizeBybitPosition — field completeness', () => {
  const sample: Record<string, unknown> = {
    symbol: 'BTCUSDT',
    side: 'Buy',
    size: '0.5',
    avgPrice: '64000',
    markPrice: '64100',
    unrealisedPnl: '50',
    leverage: '10',
    tradeMode: 1,
    liqPrice: '58000',
    positionIdx: 1,
  };

  const MODELED_KEYS = new Set<string>([
    'symbol',
    'side',
    'size',
    'avgPrice',
    'markPrice',
    'unrealisedPnl',
    'leverage',
    'tradeMode',
    'liqPrice',
    'positionIdx',
  ]);
  const INTENTIONALLY_IGNORED_KEYS = new Set<string>([]);

  it('every declared field is modeled or explicitly ignored', () => {
    const unaccounted = Object.keys(sample).filter(
      (key) => !MODELED_KEYS.has(key) && !INTENTIONALLY_IGNORED_KEYS.has(key)
    );
    expect(unaccounted).toEqual([]);
  });

  it('extracts the business-critical fields', () => {
    const position = normalizeBybitPosition(sample as unknown as BybitPositionRaw);

    expect(position.symbol).toBe('BTCUSDT');
    expect(position.contracts).toBeCloseTo(0.5);
    expect(position.entryPrice).toBeCloseTo(64000);
    expect(position.markPrice).toBeCloseTo(64100);
    expect(position.leverage).toBeCloseTo(10);
    expect(position.positionIdx).toBe(1);
    expect(position.info).toBeDefined();
  });
});

describe('normalizeBybitBalances — coin field completeness', () => {
  const coinSample: Record<string, unknown> = {
    coin: 'USDT',
    walletBalance: '1000',
    totalOrderIM: '50',
    totalPositionIM: '100',
    free: '850',
    locked: '0',
    frozenAmount: '0',
    availableToWithdraw: '850',
  };

  const MODELED_COIN_KEYS = new Set<string>([
    'coin',
    'walletBalance',
    'totalOrderIM',
    'totalPositionIM',
    'frozenAmount',
    'locked',
    'availableToWithdraw',
  ]);
  const INTENTIONALLY_IGNORED_COIN_KEYS = new Set<string>(['free']);

  it('every declared coin field is modeled or explicitly ignored', () => {
    const unaccounted = Object.keys(coinSample).filter(
      (key) => !MODELED_COIN_KEYS.has(key) && !INTENTIONALLY_IGNORED_COIN_KEYS.has(key)
    );
    expect(unaccounted).toEqual([]);
  });

  it('extracts balance fields (free computed from walletBalance − margins)', () => {
    const raw: BybitWalletBalanceRaw = {
      list: [
        {
          accountType: 'UNIFIED',
          totalWalletBalance: '1000',
          totalAvailableBalance: '850',
          totalMarginBalance: '1000',
          totalInitialMargin: '150',
          coin: [coinSample as never],
        },
      ],
    };

    const balances = normalizeBybitBalances(raw);
    const usdt = balances.balanceByAsset.get('USDT')!;

    expect(usdt.walletBalance).toBeCloseTo(1000);
    expect(usdt.free).toBeCloseTo(850);
    expect(balances.totalWalletBalance).toBeCloseTo(1000);
    expect(balances.totalAvailableBalance).toBeCloseTo(850);
    expect(balances.accountType).toBe('UNIFIED');
  });
});

describe('normalizeBybitOrderBook — field completeness (real Bybit V5 frame shape)', () => {
  const sample: Record<string, unknown> = {
    s: 'BTCUSDT',
    b: [['64000.00', '1.5'], ['63999.50', '2.0']],
    a: [['64001.00', '0.8'], ['64001.50', '3.1']],
    u: 12345,
    seq: 9876543,
    ts: 1700000000123,
  };

  const MODELED_KEYS = new Set<string>(['a', 'b', 'u', 'ts']);
  const INTENTIONALLY_IGNORED_KEYS = new Set<string>(['s', 'seq']);

  it('every wire field is modeled or explicitly ignored', () => {
    const unaccounted = Object.keys(sample).filter(
      (key) => !MODELED_KEYS.has(key) && !INTENTIONALLY_IGNORED_KEYS.has(key)
    );
    expect(unaccounted).toEqual([]);
  });

  it('parses ask/bid levels, timestamp and update id', () => {
    const book = normalizeBybitOrderBook(sample as unknown as BybitOrderBookRaw, 'BTCUSDT');

    expect(book.symbol).toBe('BTCUSDT');
    expect(book.askList[0]).toEqual({ price: 64001.0, quantity: 0.8 });
    expect(book.bidList[0]).toEqual({ price: 64000.0, quantity: 1.5 });
    expect(book.updateId).toBe(12345);
    expect(book.timestamp).toBe(1700000000123);
  });

  it('orderbook update takes the exchange event time from the envelope, not data.ts', () => {
    const update = normalizeBybitOrderBookUpdate(
      sample as unknown as BybitOrderBookRaw,
      'BTCUSDT',
      'delta',
      1700000000200,
      1700000000150
    );

    expect(update.eventTimestamp).toBe(1700000000150);
    expect(update.receivedTimestamp).toBe(1700000000200);
    expect(update.updateType).toBe('delta');
  });
});
