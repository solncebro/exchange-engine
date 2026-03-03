import { resolveUnifiedBinanceInterval } from '../../src/ws/binanceWebSocketUtils';

describe('resolveUnifiedBinanceInterval', () => {
  it('returns "1m" as-is', () => {
    expect(resolveUnifiedBinanceInterval('1m')).toBe('1m');
  });

  it('returns "1h" as-is', () => {
    expect(resolveUnifiedBinanceInterval('1h')).toBe('1h');
  });

  it('returns "1d" as-is', () => {
    expect(resolveUnifiedBinanceInterval('1d')).toBe('1d');
  });

  it('passes through unknown interval as-is', () => {
    expect(resolveUnifiedBinanceInterval('99x')).toBe('99x');
  });
});
