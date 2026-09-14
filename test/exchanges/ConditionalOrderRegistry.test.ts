import { ConditionalOrderRegistry } from '../../src/exchanges/ConditionalOrderRegistry';

describe('ConditionalOrderRegistry', () => {
  const baseNowMs = 1700000000000;

  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(baseNowMs);
  });

  it('records and looks up an entry', () => {
    const registry = new ConditionalOrderRegistry({ maxSize: 2, ttlMs: 1000 });

    registry.record('BTCUSDT', '1', 'plain');

    expect(registry.lookup('BTCUSDT', '1')).toBe('plain');
  });

  it('evicts the oldest entry when maxSize is exceeded', () => {
    const registry = new ConditionalOrderRegistry({ maxSize: 2, ttlMs: 100000 });

    registry.record('BTCUSDT', '1', 'plain');
    registry.record('BTCUSDT', '2', 'conditional');
    registry.record('BTCUSDT', '3', 'plain');

    expect(registry.lookup('BTCUSDT', '1')).toBeNull();
    expect(registry.lookup('BTCUSDT', '2')).toBe('conditional');
    expect(registry.lookup('BTCUSDT', '3')).toBe('plain');
  });

  it('moves a re-recorded key to the end, protecting it from eviction', () => {
    const registry = new ConditionalOrderRegistry({ maxSize: 2, ttlMs: 100000 });

    registry.record('BTCUSDT', '1', 'plain');
    registry.record('BTCUSDT', '2', 'conditional');
    registry.record('BTCUSDT', '1', 'plain');
    registry.record('BTCUSDT', '3', 'plain');

    expect(registry.lookup('BTCUSDT', '2')).toBeNull();
    expect(registry.lookup('BTCUSDT', '1')).toBe('plain');
    expect(registry.lookup('BTCUSDT', '3')).toBe('plain');
  });

  it('expires an entry once ttlMs has passed', () => {
    const registry = new ConditionalOrderRegistry({ maxSize: 10, ttlMs: 1000 });

    registry.record('BTCUSDT', '1', 'plain');

    jest.spyOn(Date, 'now').mockReturnValue(baseNowMs + 1001);

    expect(registry.lookup('BTCUSDT', '1')).toBeNull();
  });

  it('returns null ageMs for an unknown entry', () => {
    const registry = new ConditionalOrderRegistry({ maxSize: 10, ttlMs: 1000 });

    expect(registry.ageMs('BTCUSDT', '1')).toBeNull();
  });

  it('reports size', () => {
    const registry = new ConditionalOrderRegistry({ maxSize: 10, ttlMs: 1000 });

    registry.record('BTCUSDT', '1', 'plain');
    registry.record('BTCUSDT', '2', 'conditional');

    expect(registry.size()).toBe(2);
  });
});
