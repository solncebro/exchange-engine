import {
  normalizeBybitTradeSymbols,
  normalizeBybitTickers,
  normalizeBybitKlines,
  normalizeBybitKlineWebSocketMessage,
  normalizeBybitPosition,
  normalizeBybitOrder,
  buildBybitOrderFromCreateResponse,
  normalizeBybitBalance,
} from '../../src/normalizers/bybitNormalizer';
import { TradeSymbolTypeEnum, PositionSideEnum, MarginModeEnum, OrderSideEnum, OrderTypeEnum } from '../../src/types/common';
import {
  BYBIT_RAW_INSTRUMENT_LIST,
  BYBIT_RAW_TICKER_LIST,
  BYBIT_RAW_KLINE_LIST,
  BYBIT_RAW_WEBSOCKET_KLINE,
  BYBIT_RAW_POSITION,
  BYBIT_RAW_ORDER_RESPONSE,
  BYBIT_RAW_WALLET_BALANCE,
} from '../fixtures/bybitRaw';

describe('normalizeBybitTradeSymbols', () => {
  it('returns a Map', () => {
    const result = normalizeBybitTradeSymbols(BYBIT_RAW_INSTRUMENT_LIST);

    expect(result).toBeInstanceOf(Map);
  });

  it('contains correct number of symbols', () => {
    const result = normalizeBybitTradeSymbols(BYBIT_RAW_INSTRUMENT_LIST);

    expect(result.size).toBe(2);
  });

  it('marks LinearPerpetual as swap/linear', () => {
    const result = normalizeBybitTradeSymbols(BYBIT_RAW_INSTRUMENT_LIST);
    const btc = result.get('BTCUSDT')!;

    expect(btc.type).toBe(TradeSymbolTypeEnum.Swap);
    expect(btc.isLinear).toBe(true);
  });

  it('uses settleCoin from raw data', () => {
    const result = normalizeBybitTradeSymbols(BYBIT_RAW_INSTRUMENT_LIST);

    expect(result.get('BTCUSDT')!.settle).toBe('USDT');
  });

  it('falls back settleCoin to USDT when missing', () => {
    const rawList = [{ ...BYBIT_RAW_INSTRUMENT_LIST[0], settleCoin: undefined }];
    const result = normalizeBybitTradeSymbols(rawList);

    expect(result.get('BTCUSDT')!.settle).toBe('USDT');
  });

  it('marks spot symbol correctly', () => {
    const result = normalizeBybitTradeSymbols(BYBIT_RAW_INSTRUMENT_LIST);
    const eth = result.get('ETHBTC')!;

    expect(eth.type).toBe(TradeSymbolTypeEnum.Spot);
    expect(eth.isLinear).toBe(false);
    expect(eth.settle).toBe('');
  });

  it('sets isActive=true for Trading status', () => {
    const result = normalizeBybitTradeSymbols(BYBIT_RAW_INSTRUMENT_LIST);

    expect(result.get('BTCUSDT')!.isActive).toBe(true);
  });

  it('sets isActive=false for non-Trading status', () => {
    const rawList = [{ ...BYBIT_RAW_INSTRUMENT_LIST[0], status: 'Closed' }];
    const result = normalizeBybitTradeSymbols(rawList);

    expect(result.get('BTCUSDT')!.isActive).toBe(false);
  });

  it('parses contractSize', () => {
    const result = normalizeBybitTradeSymbols(BYBIT_RAW_INSTRUMENT_LIST);

    expect(result.get('BTCUSDT')!.contractSize).toBe(0.01);
  });

  it('defaults contractSize to 1 when missing', () => {
    const result = normalizeBybitTradeSymbols(BYBIT_RAW_INSTRUMENT_LIST);

    expect(result.get('ETHBTC')!.contractSize).toBe(1);
  });

  it('extracts qtyStep as stepSize for linear', () => {
    const result = normalizeBybitTradeSymbols(BYBIT_RAW_INSTRUMENT_LIST);

    expect(result.get('BTCUSDT')!.filter.stepSize).toBe('0.001');
  });

  it('falls back to basePrecision for spot stepSize', () => {
    const result = normalizeBybitTradeSymbols(BYBIT_RAW_INSTRUMENT_LIST);

    expect(result.get('ETHBTC')!.filter.stepSize).toBe('0.01');
  });

  it('extracts minNotionalValue for linear', () => {
    const result = normalizeBybitTradeSymbols(BYBIT_RAW_INSTRUMENT_LIST);

    expect(result.get('BTCUSDT')!.filter.minNotional).toBe('5');
  });

  it('falls back to minOrderAmt for spot', () => {
    const result = normalizeBybitTradeSymbols(BYBIT_RAW_INSTRUMENT_LIST);

    expect(result.get('ETHBTC')!.filter.minNotional).toBe('0.0001');
  });
});

describe('normalizeBybitTickers', () => {
  it('returns a Map', () => {
    const result = normalizeBybitTickers(BYBIT_RAW_TICKER_LIST);

    expect(result).toBeInstanceOf(Map);
  });

  it('multiplies price24hPcnt by 100', () => {
    const result = normalizeBybitTickers(BYBIT_RAW_TICKER_LIST);

    expect(result.get('BTCUSDT')!.priceChangePercent).toBeCloseTo(2.35);
    expect(result.get('ETHUSDT')!.priceChangePercent).toBeCloseTo(-1.2);
  });

  it('parses lastPrice', () => {
    const result = normalizeBybitTickers(BYBIT_RAW_TICKER_LIST);

    expect(result.get('BTCUSDT')!.lastPrice).toBe(65432.1);
  });

  it('parses openPrice from prevPrice24h', () => {
    const result = normalizeBybitTickers(BYBIT_RAW_TICKER_LIST);

    expect(result.get('BTCUSDT')!.openPrice).toBe(63900);
  });

  it('parses highPrice and lowPrice', () => {
    const result = normalizeBybitTickers(BYBIT_RAW_TICKER_LIST);

    expect(result.get('BTCUSDT')!.highPrice).toBe(66000);
    expect(result.get('BTCUSDT')!.lowPrice).toBe(63500);
  });

  it('parses volume and quoteVolume', () => {
    const result = normalizeBybitTickers(BYBIT_RAW_TICKER_LIST);

    expect(result.get('BTCUSDT')!.volume).toBe(12345.67);
    expect(result.get('BTCUSDT')!.quoteVolume).toBe(805000000);
  });

  it('preserves timestamp when present', () => {
    const result = normalizeBybitTickers(BYBIT_RAW_TICKER_LIST);

    expect(result.get('BTCUSDT')!.timestamp).toBe(1700000000000);
  });

  it('falls back to Date.now() when time is missing', () => {
    jest.spyOn(Date, 'now').mockReturnValue(9999999999999);
    const result = normalizeBybitTickers(BYBIT_RAW_TICKER_LIST);

    expect(result.get('ETHUSDT')!.timestamp).toBe(9999999999999);
  });
});

describe('normalizeBybitKlines', () => {
  it('returns array of Kline objects', () => {
    const result = normalizeBybitKlines(BYBIT_RAW_KLINE_LIST);

    expect(result).toHaveLength(2);
  });

  it('parses kline fields from string arrays', () => {
    const [kline] = normalizeBybitKlines(BYBIT_RAW_KLINE_LIST);

    expect(kline.openTimestamp).toBe(1700000000000);
    expect(kline.openPrice).toBe(65000);
    expect(kline.highPrice).toBe(66000);
    expect(kline.lowPrice).toBe(64000);
    expect(kline.closePrice).toBe(65500);
    expect(kline.volume).toBe(1234.56);
    expect(kline.quoteAssetVolume).toBe(80500000);
    expect(kline.takerBuyBaseAssetVolume).toBe(0);
    expect(kline.takerBuyQuoteAssetVolume).toBe(0);
  });

  it('sets closeTimestamp to 0', () => {
    const [kline] = normalizeBybitKlines(BYBIT_RAW_KLINE_LIST);

    expect(kline.closeTimestamp).toBe(0);
  });

  it('sets numberOfTrades to 0', () => {
    const [kline] = normalizeBybitKlines(BYBIT_RAW_KLINE_LIST);

    expect(kline.numberOfTrades).toBe(0);
  });
});

describe('normalizeBybitKlineWebSocketMessage', () => {
  it('maps WebSocket kline fields to Kline', () => {
    const result = normalizeBybitKlineWebSocketMessage(BYBIT_RAW_WEBSOCKET_KLINE);

    expect(result.openTimestamp).toBe(1700000000000);
    expect(result.openPrice).toBe(65000);
    expect(result.highPrice).toBe(66000);
    expect(result.lowPrice).toBe(64000);
    expect(result.closePrice).toBe(65500);
    expect(result.volume).toBe(1234.56);
    expect(result.closeTimestamp).toBe(1700003600000);
    expect(result.quoteAssetVolume).toBe(80500000);
    expect(result.numberOfTrades).toBe(0);
    expect(result.takerBuyBaseAssetVolume).toBe(0);
    expect(result.takerBuyQuoteAssetVolume).toBe(0);
  });
});

describe('normalizeBybitPosition', () => {
  it('maps Buy to long', () => {
    const result = normalizeBybitPosition(BYBIT_RAW_POSITION);

    expect(result.side).toBe(PositionSideEnum.Long);
  });

  it('maps Sell to short', () => {
    const raw = { ...BYBIT_RAW_POSITION, side: 'Sell' };
    const result = normalizeBybitPosition(raw);

    expect(result.side).toBe(PositionSideEnum.Short);
  });

  it('falls back to both for unknown side', () => {
    const raw = { ...BYBIT_RAW_POSITION, side: 'None' };
    const result = normalizeBybitPosition(raw);

    expect(result.side).toBe(PositionSideEnum.Both);
  });

  it('maps tradeMode 0 to cross', () => {
    const raw = { ...BYBIT_RAW_POSITION, tradeMode: 0 };
    const result = normalizeBybitPosition(raw);

    expect(result.marginMode).toBe(MarginModeEnum.Cross);
  });

  it('maps tradeMode 1 to isolated', () => {
    const result = normalizeBybitPosition(BYBIT_RAW_POSITION);

    expect(result.marginMode).toBe(MarginModeEnum.Isolated);
  });

  it('parses numeric fields', () => {
    const result = normalizeBybitPosition(BYBIT_RAW_POSITION);

    expect(result.contracts).toBe(0.1);
    expect(result.entryPrice).toBe(65000);
    expect(result.markPrice).toBe(65500);
    expect(result.unrealizedPnl).toBe(50);
    expect(result.leverage).toBe(10);
    expect(result.liquidationPrice).toBe(60000);
  });

  it('returns 0 for NaN liquidationPrice', () => {
    const raw = { ...BYBIT_RAW_POSITION, liqPrice: '' };
    const result = normalizeBybitPosition(raw);

    expect(result.liquidationPrice).toBe(0);
  });

  it('preserves raw data in info', () => {
    const result = normalizeBybitPosition(BYBIT_RAW_POSITION);

    expect(result.info).toBe(BYBIT_RAW_POSITION);
  });
});

describe('normalizeBybitOrder', () => {
  it('preserves orderId as string', () => {
    const result = normalizeBybitOrder(BYBIT_RAW_ORDER_RESPONSE);

    expect(result.id).toBe('abc-123-def');
  });

  it('preserves orderLinkId as clientOrderId', () => {
    const result = normalizeBybitOrder(BYBIT_RAW_ORDER_RESPONSE);

    expect(result.clientOrderId).toBe('myBybitOrder123');
  });

  it('lowercases side', () => {
    const result = normalizeBybitOrder(BYBIT_RAW_ORDER_RESPONSE);

    expect(result.side).toBe('buy');
  });

  it('lowercases orderType', () => {
    const result = normalizeBybitOrder(BYBIT_RAW_ORDER_RESPONSE);

    expect(result.type).toBe('limit');
  });

  it('parses timeInForce', () => {
    const result = normalizeBybitOrder(BYBIT_RAW_ORDER_RESPONSE);

    expect(result.timeInForce).toBe('GTC');
  });

  it('parses avgPrice', () => {
    const result = normalizeBybitOrder(BYBIT_RAW_ORDER_RESPONSE);

    expect(result.avgPrice).toBe(64950);
  });

  it('parses filledAmount and filledQuoteAmount', () => {
    const result = normalizeBybitOrder(BYBIT_RAW_ORDER_RESPONSE);

    expect(result.filledAmount).toBe(0.1);
    expect(result.filledQuoteAmount).toBe(6495);
  });

  it('maps Filled status to closed', () => {
    const result = normalizeBybitOrder(BYBIT_RAW_ORDER_RESPONSE);

    expect(result.status).toBe('closed');
  });

  it('maps New status to open', () => {
    const raw = { ...BYBIT_RAW_ORDER_RESPONSE, orderStatus: 'New' };
    const result = normalizeBybitOrder(raw);

    expect(result.status).toBe('open');
  });

  it('maps Cancelled status to canceled', () => {
    const raw = { ...BYBIT_RAW_ORDER_RESPONSE, orderStatus: 'Cancelled' };
    const result = normalizeBybitOrder(raw);

    expect(result.status).toBe('canceled');
  });

  it('maps Rejected status to rejected', () => {
    const raw = { ...BYBIT_RAW_ORDER_RESPONSE, orderStatus: 'Rejected' };
    const result = normalizeBybitOrder(raw);

    expect(result.status).toBe('rejected');
  });

  it('falls back to lowercase for unknown status', () => {
    const raw = { ...BYBIT_RAW_ORDER_RESPONSE, orderStatus: 'CustomStatus' };
    const result = normalizeBybitOrder(raw);

    expect(result.status).toBe('customstatus');
  });

  it('preserves reduceOnly', () => {
    const result = normalizeBybitOrder(BYBIT_RAW_ORDER_RESPONSE);

    expect(result.reduceOnly).toBe(false);
  });

  it('parses qty and price', () => {
    const result = normalizeBybitOrder(BYBIT_RAW_ORDER_RESPONSE);

    expect(result.amount).toBe(0.1);
    expect(result.price).toBe(65000);
  });

  it('parses createdTime as timestamp', () => {
    const result = normalizeBybitOrder(BYBIT_RAW_ORDER_RESPONSE);

    expect(result.timestamp).toBe(1700000000000);
  });

  it('parses updatedTime as updatedTimestamp', () => {
    const result = normalizeBybitOrder(BYBIT_RAW_ORDER_RESPONSE);

    expect(result.updatedTimestamp).toBe(1700000010000);
  });
});

describe('buildBybitOrderFromCreateResponse', () => {
  it('builds order with status open', () => {
    jest.spyOn(Date, 'now').mockReturnValue(1700000000000);

    const result = buildBybitOrderFromCreateResponse(
      { symbol: 'BTCUSDT', type: OrderTypeEnum.Limit, side: OrderSideEnum.Buy, amount: 0.1, price: 65000 },
      'order-123',
    );

    expect(result.id).toBe('order-123');
    expect(result.clientOrderId).toBe('');
    expect(result.symbol).toBe('BTCUSDT');
    expect(result.side).toBe(OrderSideEnum.Buy);
    expect(result.type).toBe(OrderTypeEnum.Limit);
    expect(result.timeInForce).toBe('GTC');
    expect(result.amount).toBe(0.1);
    expect(result.price).toBe(65000);
    expect(result.avgPrice).toBe(0);
    expect(result.filledAmount).toBe(0);
    expect(result.filledQuoteAmount).toBe(0);
    expect(result.status).toBe('open');
    expect(result.reduceOnly).toBe(false);
    expect(result.timestamp).toBe(1700000000000);
    expect(result.updatedTimestamp).toBe(1700000000000);
  });
});

describe('normalizeBybitBalance', () => {
  it('returns a Map', () => {
    const result = normalizeBybitBalance(BYBIT_RAW_WALLET_BALANCE);

    expect(result).toBeInstanceOf(Map);
  });

  it('skips zero balances', () => {
    const result = normalizeBybitBalance(BYBIT_RAW_WALLET_BALANCE);

    expect(result.has('DOGE')).toBe(false);
  });

  it('includes non-zero balances', () => {
    const result = normalizeBybitBalance(BYBIT_RAW_WALLET_BALANCE);

    expect(result.has('USDT')).toBe(true);
    expect(result.has('BTC')).toBe(true);
  });

  it('accumulates duplicate coins', () => {
    const result = normalizeBybitBalance(BYBIT_RAW_WALLET_BALANCE);
    const usdt = result.get('USDT')!;

    expect(usdt.free).toBe(1500.5);
    expect(usdt.locked).toBe(300);
    expect(usdt.total).toBe(1800.5);
  });

  it('parses single coin correctly', () => {
    const result = normalizeBybitBalance(BYBIT_RAW_WALLET_BALANCE);
    const btc = result.get('BTC')!;

    expect(btc.free).toBe(0.5);
    expect(btc.locked).toBe(0.1);
    expect(btc.total).toBe(0.6);
  });

  it('uses free field as fallback for availableToWithdraw', () => {
    const raw = { list: [{ coin: 'SOL', free: '10', walletBalance: '15', locked: '5' }] };
    const result = normalizeBybitBalance(raw);
    const sol = result.get('SOL')!;

    expect(sol.free).toBe(10);
    expect(sol.locked).toBe(5);
  });
});
