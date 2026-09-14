import { normalizeBinanceTickers } from '../../src/normalizers/binanceNormalizer';
import { BINANCE_RAW_TICKER_FUTURES, BINANCE_RAW_TICKER_SPOT } from '../fixtures/binanceRaw';

const MODELED_KEYS = new Set<string>([
  'symbol',
  'lastPrice',
  'openPrice',
  'highPrice',
  'lowPrice',
  'priceChangePercent',
  'volume',
  'quoteVolume',
  'closeTime',
]);

const INTENTIONALLY_IGNORED_KEYS = new Set<string>([
  'priceChange',
  'weightedAvgPrice',
  'lastQty',
  'prevClosePrice',
  'bidPrice',
  'bidQty',
  'askPrice',
  'askQty',
  'openTime',
  'firstId',
  'lastId',
  'count',
]);

describe('Binance ticker field completeness (guard against a made-up field)', () => {
  it.each([
    ['futures /fapi/v1/ticker/24hr', BINANCE_RAW_TICKER_FUTURES],
    ['spot /api/v3/ticker/24hr', BINANCE_RAW_TICKER_SPOT],
  ])('every field of a real %s snapshot is either modeled or explicitly ignored', (_label, snapshot) => {
    const unaccounted = Object.keys(snapshot).filter(
      (key) => !MODELED_KEYS.has(key) && !INTENTIONALLY_IGNORED_KEYS.has(key)
    );

    expect(unaccounted).toEqual([]);
  });

  it('every modeled field is present in the real snapshot — no invented field survives', () => {
    const missingOnTheWire = [...MODELED_KEYS].filter((key) => !(key in BINANCE_RAW_TICKER_FUTURES));

    expect(missingOnTheWire).toEqual([]);
  });

  it('reads the timestamp of both markets from closeTime', () => {
    const futuresTicker = normalizeBinanceTickers([BINANCE_RAW_TICKER_FUTURES]).get('BTCUSDT');
    const spotTicker = normalizeBinanceTickers([BINANCE_RAW_TICKER_SPOT]).get('ETHBTC');

    expect(futuresTicker?.timestamp).toBe(BINANCE_RAW_TICKER_FUTURES.closeTime);
    expect(spotTicker?.timestamp).toBe(BINANCE_RAW_TICKER_SPOT.closeTime);
  });
});
