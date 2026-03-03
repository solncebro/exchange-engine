describe('export contract', () => {
  it('exports runtime values', () => {
    const api = require('../src/index');

    expect(api.Exchange).toBeDefined();
    expect(api.BINANCE_KLINE_LIMIT_SPOT).toBe(1000);
    expect(api.BINANCE_KLINE_LIMIT_FUTURES).toBe(499);
    expect(api.KLINE_CHUNK_SIZE).toBe(200);
  });
});
