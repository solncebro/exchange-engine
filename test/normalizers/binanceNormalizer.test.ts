import {
  normalizeBinanceMarkets,
  normalizeBinanceTickers,
  normalizeBinanceKlines,
  normalizeBinanceKlineWsMessage,
  normalizeBinancePosition,
  normalizeBinanceOrder,
  normalizeBinanceBalance,
} from '../../src/normalizers/binanceNormalizer';
import {
  BINANCE_RAW_EXCHANGE_INFO,
  BINANCE_RAW_TICKER_LIST,
  BINANCE_RAW_KLINE_LIST,
  BINANCE_RAW_WS_KLINE,
  BINANCE_RAW_POSITION_RISK,
  BINANCE_RAW_ORDER_RESPONSE,
  BINANCE_RAW_ACCOUNT,
} from '../fixtures/binanceRaw';

describe('normalizeBinanceMarkets', () => {
  it('returns a Map', () => {
    const result = normalizeBinanceMarkets(BINANCE_RAW_EXCHANGE_INFO);

    expect(result).toBeInstanceOf(Map);
  });

  it('contains correct number of symbols', () => {
    const result = normalizeBinanceMarkets(BINANCE_RAW_EXCHANGE_INFO);

    expect(result.size).toBe(2);
  });

  it('marks PERPETUAL contract as swap/linear', () => {
    const result = normalizeBinanceMarkets(BINANCE_RAW_EXCHANGE_INFO);
    const btc = result.get('BTCUSDT')!;

    expect(btc.type).toBe('swap');
    expect(btc.linear).toBe(true);
    expect(btc.settle).toBe('USDT');
  });

  it('marks spot symbol correctly', () => {
    const result = normalizeBinanceMarkets(BINANCE_RAW_EXCHANGE_INFO);
    const eth = result.get('ETHBTC')!;

    expect(eth.type).toBe('spot');
    expect(eth.linear).toBe(false);
    expect(eth.settle).toBe('');
  });

  it('extracts PRICE_FILTER tickSize', () => {
    const result = normalizeBinanceMarkets(BINANCE_RAW_EXCHANGE_INFO);

    expect(result.get('BTCUSDT')!.filter.tickSize).toBe('0.10');
  });

  it('extracts LOT_SIZE filter fields', () => {
    const result = normalizeBinanceMarkets(BINANCE_RAW_EXCHANGE_INFO);
    const filter = result.get('BTCUSDT')!.filter;

    expect(filter.stepSize).toBe('0.001');
    expect(filter.minQty).toBe('0.001');
    expect(filter.maxQty).toBe('1000');
  });

  it('extracts MIN_NOTIONAL from notional field', () => {
    const result = normalizeBinanceMarkets(BINANCE_RAW_EXCHANGE_INFO);

    expect(result.get('BTCUSDT')!.filter.minNotional).toBe('5');
  });

  it('extracts NOTIONAL from minNotional field as fallback', () => {
    const result = normalizeBinanceMarkets(BINANCE_RAW_EXCHANGE_INFO);

    expect(result.get('ETHBTC')!.filter.minNotional).toBe('0.0001');
  });

  it('sets active=true for TRADING status', () => {
    const result = normalizeBinanceMarkets(BINANCE_RAW_EXCHANGE_INFO);

    expect(result.get('BTCUSDT')!.active).toBe(true);
  });

  it('sets active=false for non-TRADING status', () => {
    const info = { symbols: [{ ...BINANCE_RAW_EXCHANGE_INFO.symbols[0], status: 'BREAK' }] };
    const result = normalizeBinanceMarkets(info);

    expect(result.get('BTCUSDT')!.active).toBe(false);
  });
});

describe('normalizeBinanceTickers', () => {
  it('returns a Map', () => {
    const result = normalizeBinanceTickers(BINANCE_RAW_TICKER_LIST);

    expect(result).toBeInstanceOf(Map);
  });

  it('contains correct number of tickers', () => {
    const result = normalizeBinanceTickers(BINANCE_RAW_TICKER_LIST);

    expect(result.size).toBe(2);
  });

  it('parses lastPrice as number', () => {
    const result = normalizeBinanceTickers(BINANCE_RAW_TICKER_LIST);

    expect(result.get('BTCUSDT')!.close).toBe(65432.1);
  });

  it('parses priceChangePercent as number', () => {
    const result = normalizeBinanceTickers(BINANCE_RAW_TICKER_LIST);

    expect(result.get('BTCUSDT')!.percentage).toBe(2.35);
    expect(result.get('ETHUSDT')!.percentage).toBe(-1.2);
  });

  it('preserves timestamp', () => {
    const result = normalizeBinanceTickers(BINANCE_RAW_TICKER_LIST);

    expect(result.get('BTCUSDT')!.timestamp).toBe(1700000000000);
  });
});

describe('normalizeBinanceKlines', () => {
  it('returns array of Kline objects', () => {
    const result = normalizeBinanceKlines(BINANCE_RAW_KLINE_LIST);

    expect(result).toHaveLength(2);
  });

  it('parses kline fields correctly', () => {
    const [kline] = normalizeBinanceKlines(BINANCE_RAW_KLINE_LIST);

    expect(kline.openTimestamp).toBe(1700000000000);
    expect(kline.open).toBe(65000);
    expect(kline.high).toBe(66000);
    expect(kline.low).toBe(64000);
    expect(kline.close).toBe(65500);
    expect(kline.volume).toBe(1234.56);
    expect(kline.closeTimestamp).toBe(1700003600000);
    expect(kline.quoteVolume).toBe(80500000);
    expect(kline.trades).toBe(5000);
  });
});

describe('normalizeBinanceKlineWsMessage', () => {
  it('maps short names to Kline fields', () => {
    const result = normalizeBinanceKlineWsMessage(BINANCE_RAW_WS_KLINE);

    expect(result.openTimestamp).toBe(1700000000000);
    expect(result.open).toBe(65000);
    expect(result.high).toBe(66000);
    expect(result.low).toBe(64000);
    expect(result.close).toBe(65500);
    expect(result.volume).toBe(1234.56);
    expect(result.closeTimestamp).toBe(1700003600000);
    expect(result.quoteVolume).toBe(80500000);
    expect(result.trades).toBe(5000);
  });
});

describe('normalizeBinancePosition', () => {
  it('maps LONG to long', () => {
    const result = normalizeBinancePosition(BINANCE_RAW_POSITION_RISK);

    expect(result.side).toBe('long');
  });

  it('maps SHORT to short', () => {
    const raw = { ...BINANCE_RAW_POSITION_RISK, positionSide: 'SHORT' };
    const result = normalizeBinancePosition(raw);

    expect(result.side).toBe('short');
  });

  it('maps BOTH to both', () => {
    const raw = { ...BINANCE_RAW_POSITION_RISK, positionSide: 'BOTH' };
    const result = normalizeBinancePosition(raw);

    expect(result.side).toBe('both');
  });

  it('falls back to both for unknown side', () => {
    const raw = { ...BINANCE_RAW_POSITION_RISK, positionSide: 'UNKNOWN' };
    const result = normalizeBinancePosition(raw);

    expect(result.side).toBe('both');
  });

  it('maps ISOLATED marginType', () => {
    const result = normalizeBinancePosition(BINANCE_RAW_POSITION_RISK);

    expect(result.marginMode).toBe('isolated');
  });

  it('maps CROSSED marginType to cross', () => {
    const raw = { ...BINANCE_RAW_POSITION_RISK, marginType: 'CROSSED' };
    const result = normalizeBinancePosition(raw);

    expect(result.marginMode).toBe('cross');
  });

  it('parses numeric fields', () => {
    const result = normalizeBinancePosition(BINANCE_RAW_POSITION_RISK);

    expect(result.contracts).toBe(0.1);
    expect(result.entryPrice).toBe(65000);
    expect(result.markPrice).toBe(65500);
    expect(result.unrealizedPnl).toBe(50);
    expect(result.leverage).toBe(10);
    expect(result.liquidationPrice).toBe(60000);
  });

  it('returns 0 for NaN liquidationPrice', () => {
    const raw = { ...BINANCE_RAW_POSITION_RISK, liquidationPrice: '' };
    const result = normalizeBinancePosition(raw);

    expect(result.liquidationPrice).toBe(0);
  });

  it('preserves raw data in info', () => {
    const result = normalizeBinancePosition(BINANCE_RAW_POSITION_RISK);

    expect(result.info).toBe(BINANCE_RAW_POSITION_RISK);
  });
});

describe('normalizeBinanceOrder', () => {
  it('converts orderId number to string', () => {
    const result = normalizeBinanceOrder(BINANCE_RAW_ORDER_RESPONSE);

    expect(result.id).toBe('123456789');
  });

  it('lowercases side', () => {
    const result = normalizeBinanceOrder(BINANCE_RAW_ORDER_RESPONSE);

    expect(result.side).toBe('buy');
  });

  it('lowercases type', () => {
    const result = normalizeBinanceOrder(BINANCE_RAW_ORDER_RESPONSE);

    expect(result.type).toBe('limit');
  });

  it('parses origQty and price', () => {
    const result = normalizeBinanceOrder(BINANCE_RAW_ORDER_RESPONSE);

    expect(result.amount).toBe(0.1);
    expect(result.price).toBe(65000);
  });

  it('lowercases status', () => {
    const result = normalizeBinanceOrder(BINANCE_RAW_ORDER_RESPONSE);

    expect(result.status).toBe('filled');
  });

  it('preserves updateTime as timestamp', () => {
    const result = normalizeBinanceOrder(BINANCE_RAW_ORDER_RESPONSE);

    expect(result.timestamp).toBe(1700000000000);
  });
});

describe('normalizeBinanceBalance', () => {
  it('returns a Map', () => {
    const result = normalizeBinanceBalance(BINANCE_RAW_ACCOUNT);

    expect(result).toBeInstanceOf(Map);
  });

  it('skips zero balances', () => {
    const result = normalizeBinanceBalance(BINANCE_RAW_ACCOUNT);

    expect(result.has('DOGE')).toBe(false);
  });

  it('includes non-zero balances', () => {
    const result = normalizeBinanceBalance(BINANCE_RAW_ACCOUNT);

    expect(result.size).toBe(2);
    expect(result.has('USDT')).toBe(true);
    expect(result.has('BTC')).toBe(true);
  });

  it('parses free and locked correctly', () => {
    const result = normalizeBinanceBalance(BINANCE_RAW_ACCOUNT);
    const usdt = result.get('USDT')!;

    expect(usdt.free).toBe(1000.5);
    expect(usdt.locked).toBe(200);
    expect(usdt.total).toBe(1200.5);
  });
});
