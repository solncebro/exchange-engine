import { resolveUnifiedBinanceInterval } from '../../src/ws/binanceWsUtils';

describe('resolveUnifiedBinanceInterval', () => {
  it('maps "1m" to "1m"', () => {
    expect(resolveUnifiedBinanceInterval('1m')).toBe('1m');
  });

  it('maps "1h" to "1h"', () => {
    expect(resolveUnifiedBinanceInterval('1h')).toBe('1h');
  });

  it('maps "1d" to "1d"', () => {
    expect(resolveUnifiedBinanceInterval('1d')).toBe('1d');
  });

  it('falls back to "1m" for unknown interval', () => {
    expect(resolveUnifiedBinanceInterval('99x')).toBe('1m');
  });
});
