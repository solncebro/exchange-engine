import { normalizeBybitTickers } from '../../src/normalizers/bybitNormalizer';
import type { BybitTickerRaw } from '../../src/normalizers/bybitNormalizer';

const TICKER_SNAPSHOT: Record<string, string> = {
  symbol: 'BTCUSDT',
  tickDirection: 'ZeroMinusTick',
  price24hPcnt: '0.038676',
  lastPrice: '63153.60',
  prevPrice24h: '60802.00',
  highPrice24h: '64250.00',
  lowPrice24h: '60711.10',
  prevPrice1h: '63117.20',
  markPrice: '63153.60',
  indexPrice: '63175.82',
  openInterest: '53662.761',
  openInterestValue: '3388996543.09',
  turnover24h: '6751345847.5277',
  volume24h: '108607.3270',
  fundingIntervalHour: '8',
  fundingCap: '0.005',
  nextFundingTime: '1780876800000',
  fundingRate: '0.00000588',
  bid1Price: '63153.60',
  bid1Size: '3.970',
  ask1Price: '63153.70',
  ask1Size: '0.307',
  preOpenPrice: '',
  preQty: '',
  curPreListingPhase: '',
};

const MODELED_KEYS = new Set<string>([
  'symbol',
  'lastPrice',
  'prevPrice24h',
  'highPrice24h',
  'lowPrice24h',
  'price24hPcnt',
  'volume24h',
  'turnover24h',
  'markPrice',
  'indexPrice',
  'bid1Price',
  'bid1Size',
  'ask1Price',
  'ask1Size',
  'fundingRate',
  'nextFundingTime',
  'time',
]);

const INTENTIONALLY_IGNORED_KEYS = new Set<string>([
  'tickDirection',
  'prevPrice1h',
  'openInterest',
  'openInterestValue',
  'fundingIntervalHour',
  'fundingCap',
  'preOpenPrice',
  'preQty',
  'curPreListingPhase',
]);

describe('Bybit ticker field completeness (guard against silent drops)', () => {
  it('every field in a real ticker snapshot is either modeled or explicitly ignored', () => {
    const unaccounted = Object.keys(TICKER_SNAPSHOT).filter(
      (key) => !MODELED_KEYS.has(key) && !INTENTIONALLY_IGNORED_KEYS.has(key)
    );

    expect(unaccounted).toEqual([]);
  });

  it('normalizer captures bid1/ask1 + mark + index (regression: these were silently dropped)', () => {
    const tickerBySymbol = normalizeBybitTickers([
      TICKER_SNAPSHOT as unknown as BybitTickerRaw,
    ]);
    const ticker = tickerBySymbol.get('BTCUSDT');

    expect(ticker).toBeDefined();
    expect(ticker?.bid1Price).toBeCloseTo(63153.6);
    expect(ticker?.bid1Size).toBeCloseTo(3.97);
    expect(ticker?.ask1Price).toBeCloseTo(63153.7);
    expect(ticker?.ask1Size).toBeCloseTo(0.307);
    expect(ticker?.markPrice).toBeCloseTo(63153.6);
    expect(ticker?.indexPrice).toBeCloseTo(63175.82);
  });
});
