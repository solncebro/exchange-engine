describe('export contract', () => {
  it('exports runtime values', () => {
    const api = require('../src/index');

    expect(api.Exchange).toBeDefined();
    expect(api.ExchangeName).toBeDefined();
    expect(api.OrderSide).toBeDefined();
    expect(api.OrderType).toBeDefined();
    expect(api.MarginMode).toBeDefined();
    expect(api.PositionSide).toBeDefined();
    expect(api.MarketType).toBeDefined();
    expect(api.TimeInForce).toBeDefined();
  });
});
