describe('export contract', () => {
  it('exports runtime values', () => {
    const api = require('../src/index');

    expect(api.Exchange).toBeDefined();
    expect(api.ExchangeNameEnum).toBeDefined();
    expect(api.OrderSideEnum).toBeDefined();
    expect(api.OrderTypeEnum).toBeDefined();
    expect(api.MarginModeEnum).toBeDefined();
    expect(api.PositionSideEnum).toBeDefined();
    expect(api.TradeSymbolTypeEnum).toBeDefined();
    expect(api.TimeInForceEnum).toBeDefined();
    expect(api.PositionModeEnum).toBeDefined();
    expect(api.WorkingTypeEnum).toBeDefined();
    expect(api.MarketTypeEnum).toBeDefined();
    expect(api.WebSocketConnectionTypeEnum).toBeDefined();
    expect(api.MARKET_TYPE_LIST).toEqual(['futures', 'spot']);
    expect(api.normalizeBybitKlineWebSocketMessage).toBeInstanceOf(Function);
    expect(api.normalizeBinanceKlineWebSocketMessage).toBeInstanceOf(Function);
  });
});
