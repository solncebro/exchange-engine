describe('export contract', () => {
  it('exports runtime values', () => {
    const api = require('../src/index');

    expect(api.Exchange).toBeDefined();
    expect(api.ExchangeError).toBeDefined();
    expect(api.ExchangeNameEnum).toBeDefined();
    expect(api.OrderSideEnum).toBeDefined();
    expect(api.OrderTypeEnum).toBeDefined();
    expect(api.MarginModeEnum).toBeDefined();
    expect(api.PositionSideEnum).toBeDefined();
    expect(api.TradeSymbolTypeEnum).toBeDefined();
    expect(api.TimeInForceEnum).toBeDefined();
    expect(api.PositionModeEnum).toBeDefined();
    expect(api.WorkingTypeEnum).toBeDefined();
    expect(api.TriggerByEnum).toBeDefined();
    expect(api.OrderFilterEnum).toBeDefined();
    expect(api.MarketUnitEnum).toBeDefined();
    expect(api.MarketTypeEnum).toBeDefined();
    expect(api.WebSocketConnectionTypeEnum).toBeDefined();
    expect(api.formatWebSocketConnectionsReport).toBeDefined();
    expect(api.parseBybitOrderbookRawFrame).toBeDefined();
    expect(api.parseOkxOrderbookRawFrame).toBeDefined();
    expect(api.MARKET_TYPE_LIST).toEqual(['futures', 'spot']);
  });

  it('names every exchange of ExchangeNameEnum', () => {
    const api = require('../src/index');

    expect(Object.values(api.ExchangeNameEnum)).toEqual(['binance', 'bybit', 'okx']);
  });

  it('exports public streams and kline normalizers from the ./public subpath', () => {
    const publicApi = require('../src/public');

    expect(publicApi.BinanceFuturesPublicStream).toBeDefined();
    expect(publicApi.BybitPublicStream).toBeDefined();
    expect(publicApi.OkxPublicStream).toBeDefined();

    expect(publicApi.normalizeBinanceKlineWebSocketMessage).toBeDefined();
    expect(publicApi.normalizeBinanceKlines).toBeDefined();
    expect(publicApi.normalizeBinanceTradeSymbols).toBeDefined();

    expect(publicApi.normalizeBybitKlineWebSocketMessage).toBeDefined();
    expect(publicApi.normalizeBybitKlines).toBeDefined();
    expect(publicApi.normalizeBybitTradeSymbols).toBeDefined();

    expect(publicApi.normalizeOkxKlineWebSocketMessage).toBeDefined();
    expect(publicApi.normalizeOkxKlines).toBeDefined();
    expect(publicApi.normalizeOkxTradeSymbols).toBeDefined();

    expect(publicApi.BINANCE_FUTURES_BASE_URL).toBeDefined();
    expect(publicApi.BYBIT_BASE_URL).toBeDefined();
    expect(publicApi.OKX_BASE_URL).toBeDefined();
    expect(publicApi.OKX_KLINE_INTERVAL).toBeDefined();
  });

  it('keeps the ./public subpath free of the trading surface', () => {
    const publicApi = require('../src/public');

    expect(publicApi.Exchange).toBeUndefined();
    expect(publicApi.OkxHttpClient).toBeUndefined();
    expect(publicApi.OkxTradeStream).toBeUndefined();
    expect(publicApi.OkxPrivateStream).toBeUndefined();
  });
});
