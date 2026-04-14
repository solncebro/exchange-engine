import {
  normalizeBybitTradeSymbols,
  normalizeBybitTickers,
  normalizeBybitKlines,
  normalizeBybitKlineWebSocketMessage,
  normalizeBybitPosition,
  normalizeBybitOrder,
  buildBybitOrderFromCreateResponse,
  normalizeBybitBalances,
  normalizeBybitOrderBook,
  normalizeBybitPublicTradeList,
  normalizeBybitOpenInterest,
  normalizeBybitFeeRateList,
  normalizeBybitFundingRateHistoryList,
  normalizeBybitMarkPriceList,
  normalizeBybitClosedPnlList,
  normalizeBybitIncomeList,
} from '../../src/normalizers/bybitNormalizer';
import { TradeSymbolTypeEnum, PositionSideEnum, MarginModeEnum, OrderSideEnum, OrderTypeEnum } from '../../src/types/common';
import {
  BYBIT_RAW_INSTRUMENT_LIST,
  BYBIT_RAW_INSTRUMENT_FUTURES,
  BYBIT_RAW_INSTRUMENT_NO_FILTERS,
  BYBIT_RAW_TICKER_LIST,
  BYBIT_RAW_KLINE_LIST,
  BYBIT_RAW_WEBSOCKET_KLINE,
  BYBIT_RAW_POSITION,
  BYBIT_RAW_ORDER_RESPONSE,
  BYBIT_RAW_WALLET_BALANCE,
  BYBIT_RAW_ORDER_BOOK,
  BYBIT_RAW_PUBLIC_TRADE_LIST,
  BYBIT_RAW_MARK_PRICE_TICKER_LIST,
  BYBIT_RAW_OPEN_INTEREST,
  BYBIT_RAW_FEE_RATE_LIST,
  BYBIT_RAW_FUNDING_RATE_HISTORY_LIST,
  BYBIT_RAW_CLOSED_PNL_LIST,
  BYBIT_RAW_TRANSACTION_LOG_LIST,
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

  it('marks non-linear contract as Future type', () => {
    const result = normalizeBybitTradeSymbols([BYBIT_RAW_INSTRUMENT_FUTURES]);
    const btcusd = result.get('BTCUSD')!;

    expect(btcusd.type).toBe(TradeSymbolTypeEnum.Future);
    expect(btcusd.isLinear).toBe(false);
  });

  it('falls back tickSize to 0 when priceFilter is undefined', () => {
    const result = normalizeBybitTradeSymbols([BYBIT_RAW_INSTRUMENT_NO_FILTERS]);
    const xyz = result.get('XYZUSDT')!;

    expect(xyz.filter.tickSize).toBe('0');
  });

  it('falls back stepSize to 0 when lotSizeFilter is undefined', () => {
    const result = normalizeBybitTradeSymbols([BYBIT_RAW_INSTRUMENT_NO_FILTERS]);
    const xyz = result.get('XYZUSDT')!;

    expect(xyz.filter.stepSize).toBe('0');
  });

  it('falls back minNotional to 0 when both values are missing', () => {
    const result = normalizeBybitTradeSymbols([BYBIT_RAW_INSTRUMENT_NO_FILTERS]);
    const xyz = result.get('XYZUSDT')!;

    expect(xyz.filter.minNotional).toBe('0');
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

  it('reverses descending API response to ascending order', () => {
    const result = normalizeBybitKlines(BYBIT_RAW_KLINE_LIST);

    expect(result[0].openTimestamp).toBe(1700000000000);
    expect(result[1].openTimestamp).toBe(1700003600000);
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

  it('sets isClosed to true when confirm is true', () => {
    const result = normalizeBybitKlineWebSocketMessage({ ...BYBIT_RAW_WEBSOCKET_KLINE, confirm: true });

    expect(result.isClosed).toBe(true);
  });

  it('sets isClosed to false when confirm is false', () => {
    const result = normalizeBybitKlineWebSocketMessage({ ...BYBIT_RAW_WEBSOCKET_KLINE, confirm: false });

    expect(result.isClosed).toBe(false);
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

  it('defaults orderLinkId to empty string when missing', () => {
    const raw = { ...BYBIT_RAW_ORDER_RESPONSE };
    delete (raw as any).orderLinkId;
    const result = normalizeBybitOrder(raw);

    expect(result.clientOrderId).toBe('');
  });

  it('defaults avgPrice to 0 when missing', () => {
    const raw = { ...BYBIT_RAW_ORDER_RESPONSE };
    delete (raw as any).avgPrice;
    const result = normalizeBybitOrder(raw);

    expect(result.avgPrice).toBe(0);
  });

  it('defaults triggerPrice to 0 when missing', () => {
    const raw = { ...BYBIT_RAW_ORDER_RESPONSE };
    delete (raw as any).triggerPrice;
    const result = normalizeBybitOrder(raw);

    expect(result.stopPrice).toBe(0);
  });

  it('defaults cumExecQty to 0 when missing', () => {
    const raw = { ...BYBIT_RAW_ORDER_RESPONSE };
    delete (raw as any).cumExecQty;
    const result = normalizeBybitOrder(raw);

    expect(result.filledAmount).toBe(0);
  });

  it('defaults cumExecValue to 0 when missing', () => {
    const raw = { ...BYBIT_RAW_ORDER_RESPONSE };
    delete (raw as any).cumExecValue;
    const result = normalizeBybitOrder(raw);

    expect(result.filledQuoteAmount).toBe(0);
  });

  it('defaults reduceOnly to false when missing', () => {
    const raw = { ...BYBIT_RAW_ORDER_RESPONSE };
    delete (raw as any).reduceOnly;
    const result = normalizeBybitOrder(raw);

    expect(result.reduceOnly).toBe(false);
  });

  it('falls back to createdTime when updatedTime is missing', () => {
    const raw = { ...BYBIT_RAW_ORDER_RESPONSE };
    delete (raw as any).updatedTime;
    const result = normalizeBybitOrder(raw);

    expect(result.updatedTimestamp).toBe(Number(BYBIT_RAW_ORDER_RESPONSE.createdTime));
  });

  it('lowercases unknown order type as fallback', () => {
    const raw = { ...BYBIT_RAW_ORDER_RESPONSE, orderType: 'StopLimit' };
    const result = normalizeBybitOrder(raw);

    expect(result.type).toBe('stoplimit');
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

describe('normalizeBybitBalances', () => {
  it('returns AccountBalances with balanceByAsset Map', () => {
    const result = normalizeBybitBalances(BYBIT_RAW_WALLET_BALANCE);

    expect(result.balanceByAsset).toBeInstanceOf(Map);
  });

  it('skips zero balances', () => {
    const result = normalizeBybitBalances(BYBIT_RAW_WALLET_BALANCE);

    expect(result.balanceByAsset.has('DOGE')).toBe(false);
  });

  it('includes non-zero balances', () => {
    const result = normalizeBybitBalances(BYBIT_RAW_WALLET_BALANCE);

    expect(result.balanceByAsset.has('USDT')).toBe(true);
    expect(result.balanceByAsset.has('BTC')).toBe(true);
  });

  it('accumulates duplicate coins', () => {
    const result = normalizeBybitBalances(BYBIT_RAW_WALLET_BALANCE);
    const usdt = result.balanceByAsset.get('USDT')!;

    expect(usdt.free).toBe(1500.5);
    expect(usdt.locked).toBe(300);
    expect(usdt.total).toBe(1800.5);
  });

  it('parses single coin correctly', () => {
    const result = normalizeBybitBalances(BYBIT_RAW_WALLET_BALANCE);
    const btc = result.balanceByAsset.get('BTC')!;

    expect(btc.free).toBe(0.5);
    expect(btc.locked).toBe(0.1);
    expect(btc.total).toBe(0.6);
  });

  it('computes free as walletBalance minus totalPositionIM minus totalOrderIM', () => {
    const raw = { list: [{ accountType: 'UNIFIED', coin: [{ coin: 'SOL', walletBalance: '15', totalOrderIM: '3', totalPositionIM: '2', locked: '5' }] }] };
    const result = normalizeBybitBalances(raw);
    const sol = result.balanceByAsset.get('SOL')!;

    expect(sol.free).toBe(10);
    expect(sol.locked).toBe(5);
  });

  it('subtracts totalPositionIM from available balance', () => {
    const raw = { list: [{ accountType: 'UNIFIED', coin: [{ coin: 'ETH', walletBalance: '100', totalOrderIM: '0', totalPositionIM: '30', locked: '30' }] }] };
    const result = normalizeBybitBalances(raw);
    const eth = result.balanceByAsset.get('ETH')!;

    expect(eth.free).toBe(70);
    expect(eth.locked).toBe(30);
    expect(eth.total).toBe(100);
  });

  it('handles empty totalOrderIM and totalPositionIM for portfolio margin', () => {
    const raw = { list: [{ accountType: 'UNIFIED', coin: [{ coin: 'USDC', walletBalance: '500', totalOrderIM: '', totalPositionIM: '', locked: '0' }] }] };
    const result = normalizeBybitBalances(raw);
    const usdc = result.balanceByAsset.get('USDC')!;

    expect(usdc.free).toBe(500);
    expect(usdc.locked).toBe(0);
    expect(usdc.total).toBe(500);
  });

  it('handles empty availableToWithdraw from unified account', () => {
    const raw = { list: [{ accountType: 'UNIFIED', coin: [{ coin: 'USDT', availableToWithdraw: '', walletBalance: '6818.16', totalOrderIM: '0', locked: '0' }] }] };
    const result = normalizeBybitBalances(raw);
    const usdt = result.balanceByAsset.get('USDT')!;

    expect(usdt.free).toBe(6818.16);
    expect(usdt.locked).toBe(0);
    expect(usdt.total).toBe(6818.16);
  });

  it('defaults walletBalance to 0 when undefined', () => {
    const raw = { list: [{ accountType: 'UNIFIED', coin: [{ coin: 'UNKNOWN', walletBalance: undefined, totalOrderIM: '0', totalPositionIM: '0', locked: '0' }] }] };
    const result = normalizeBybitBalances(raw as any);

    expect(result.balanceByAsset.has('UNKNOWN')).toBe(false);
  });

  it('handles frozenAmount NaN by computing locked from walletBalance minus free', () => {
    const raw = { list: [{ accountType: 'UNIFIED', coin: [{ coin: 'AVAX', walletBalance: '100', totalOrderIM: '10', totalPositionIM: '5', frozenAmount: 'invalid', locked: undefined }] }] };
    const result = normalizeBybitBalances(raw as any);
    const avax = result.balanceByAsset.get('AVAX')!;

    expect(avax.free).toBe(85);
    expect(avax.locked).toBe(15);
    expect(avax.total).toBe(100);
  });

  it('parses totalWalletBalance and totalAvailableBalance from primary account', () => {
    const result = normalizeBybitBalances(BYBIT_RAW_WALLET_BALANCE);

    expect(result.totalWalletBalance).toBe(1801.1);
    expect(result.totalAvailableBalance).toBe(1501.1);
  });
});

describe('normalizeBybitOrderBook', () => {
  it('normalizes order book from raw data', () => {
    const result = normalizeBybitOrderBook(BYBIT_RAW_ORDER_BOOK, 'BTCUSDT');

    expect(result.symbol).toBe('BTCUSDT');
    expect(result.askList).toHaveLength(2);
    expect(result.bidList).toHaveLength(2);
    expect(result.timestamp).toBe(1700000000000);
  });

  it('parses price and quantity as numbers', () => {
    const result = normalizeBybitOrderBook(BYBIT_RAW_ORDER_BOOK, 'BTCUSDT');

    expect(result.askList[0].price).toBe(65001);
    expect(result.askList[0].quantity).toBe(0.8);
    expect(result.bidList[0].price).toBe(65000);
    expect(result.bidList[0].quantity).toBe(1.5);
  });

  it('returns empty arrays for empty order book', () => {
    const raw = { ...BYBIT_RAW_ORDER_BOOK, a: [], b: [] };
    const result = normalizeBybitOrderBook(raw, 'BTCUSDT');

    expect(result.askList).toHaveLength(0);
    expect(result.bidList).toHaveLength(0);
  });
});

describe('normalizeBybitPublicTradeList', () => {
  it('returns array of PublicTrade objects', () => {
    const result = normalizeBybitPublicTradeList(BYBIT_RAW_PUBLIC_TRADE_LIST);

    expect(result).toHaveLength(2);
    expect(result[0].symbol).toBe('BTCUSDT');
  });

  it('parses price and quantity as numbers', () => {
    const result = normalizeBybitPublicTradeList(BYBIT_RAW_PUBLIC_TRADE_LIST);

    expect(result[0].price).toBe(65000.5);
    expect(result[0].quantity).toBe(0.1);
  });

  it('computes quoteQuantity from price times size', () => {
    const result = normalizeBybitPublicTradeList(BYBIT_RAW_PUBLIC_TRADE_LIST);

    expect(result[0].quoteQuantity).toBeCloseTo(6500.05);
  });

  it('sets isBuyerMaker based on side', () => {
    const result = normalizeBybitPublicTradeList(BYBIT_RAW_PUBLIC_TRADE_LIST);

    expect(result[0].isBuyerMaker).toBe(false);
    expect(result[1].isBuyerMaker).toBe(true);
  });

  it('returns empty array for empty input', () => {
    const result = normalizeBybitPublicTradeList([]);

    expect(result).toHaveLength(0);
  });
});

describe('normalizeBybitOpenInterest', () => {
  it('normalizes open interest from raw data', () => {
    const result = normalizeBybitOpenInterest(BYBIT_RAW_OPEN_INTEREST);

    expect(result.openInterest).toBe(12345.678);
    expect(result.timestamp).toBe(1700000000000);
  });

  it('parses string fields as numbers', () => {
    const result = normalizeBybitOpenInterest(BYBIT_RAW_OPEN_INTEREST);

    expect(typeof result.openInterest).toBe('number');
    expect(typeof result.timestamp).toBe('number');
  });

  it('returns empty symbol', () => {
    const result = normalizeBybitOpenInterest(BYBIT_RAW_OPEN_INTEREST);

    expect(result.symbol).toBe('');
  });
});

describe('normalizeBybitFeeRateList', () => {
  it('returns array of FeeRate objects', () => {
    const result = normalizeBybitFeeRateList(BYBIT_RAW_FEE_RATE_LIST);

    expect(result).toHaveLength(2);
    expect(result[0].symbol).toBe('BTCUSDT');
  });

  it('parses fee rates as numbers', () => {
    const result = normalizeBybitFeeRateList(BYBIT_RAW_FEE_RATE_LIST);

    expect(result[0].makerRate).toBe(0.0001);
    expect(result[0].takerRate).toBe(0.0006);
  });

  it('returns empty array for empty input', () => {
    const result = normalizeBybitFeeRateList([]);

    expect(result).toHaveLength(0);
  });
});

describe('normalizeBybitFundingRateHistoryList', () => {
  it('returns array of FundingRateHistory objects', () => {
    const result = normalizeBybitFundingRateHistoryList(BYBIT_RAW_FUNDING_RATE_HISTORY_LIST);

    expect(result).toHaveLength(2);
    expect(result[0].symbol).toBe('BTCUSDT');
  });

  it('parses fundingRate as number', () => {
    const result = normalizeBybitFundingRateHistoryList(BYBIT_RAW_FUNDING_RATE_HISTORY_LIST);

    expect(result[0].fundingRate).toBe(0.0001);
    expect(result[1].fundingRate).toBe(0.00015);
  });

  it('parses fundingRateTimestamp as number', () => {
    const result = normalizeBybitFundingRateHistoryList(BYBIT_RAW_FUNDING_RATE_HISTORY_LIST);

    expect(result[0].fundingTime).toBe(1700000000000);
    expect(result[1].fundingTime).toBe(1700028800000);
  });

  it('sets markPrice to null', () => {
    const result = normalizeBybitFundingRateHistoryList(BYBIT_RAW_FUNDING_RATE_HISTORY_LIST);

    expect(result[0].markPrice).toBeNull();
  });
});

describe('normalizeBybitClosedPnlList', () => {
  it('returns array of ClosedPnl objects', () => {
    const result = normalizeBybitClosedPnlList(BYBIT_RAW_CLOSED_PNL_LIST);

    expect(result).toHaveLength(1);
    expect(result[0].symbol).toBe('BTCUSDT');
    expect(result[0].orderId).toBe('order-1');
  });

  it('parses numeric fields as numbers', () => {
    const result = normalizeBybitClosedPnlList(BYBIT_RAW_CLOSED_PNL_LIST);

    expect(result[0].quantity).toBe(0.1);
    expect(result[0].entryPrice).toBe(64000);
    expect(result[0].exitPrice).toBe(65000);
    expect(result[0].closedPnl).toBe(100);
    expect(result[0].timestamp).toBe(1700000000000);
  });

  it('maps Buy side to OrderSideEnum.Buy', () => {
    const result = normalizeBybitClosedPnlList(BYBIT_RAW_CLOSED_PNL_LIST);

    expect(result[0].side).toBe(OrderSideEnum.Buy);
  });

  it('returns empty array for empty input', () => {
    const result = normalizeBybitClosedPnlList([]);

    expect(result).toHaveLength(0);
  });
});

describe('normalizeBybitIncomeList', () => {
  it('returns array of Income objects', () => {
    const result = normalizeBybitIncomeList(BYBIT_RAW_TRANSACTION_LOG_LIST);

    expect(result).toHaveLength(2);
    expect(result[0].symbol).toBe('BTCUSDT');
  });

  it('parses cashFlow as income number', () => {
    const result = normalizeBybitIncomeList(BYBIT_RAW_TRANSACTION_LOG_LIST);

    expect(result[0].income).toBe(-6500);
    expect(result[1].income).toBe(0.5);
  });

  it('maps type to incomeType and currency to asset', () => {
    const result = normalizeBybitIncomeList(BYBIT_RAW_TRANSACTION_LOG_LIST);

    expect(result[0].incomeType).toBe('TRADE');
    expect(result[0].asset).toBe('USDT');
    expect(result[1].incomeType).toBe('FUNDING');
  });

  it('includes tradeId and orderId in info', () => {
    const result = normalizeBybitIncomeList(BYBIT_RAW_TRANSACTION_LOG_LIST);

    expect(result[0].info).toEqual({ tradeId: 'trade-1', orderId: 'order-1' });
  });

  it('returns empty array for empty input', () => {
    const result = normalizeBybitIncomeList([]);

    expect(result).toHaveLength(0);
  });
});

describe('normalizeBybitMarkPriceList', () => {
  it('returns array of MarkPrice objects', () => {
    const result = normalizeBybitMarkPriceList(BYBIT_RAW_MARK_PRICE_TICKER_LIST);

    expect(result).toHaveLength(2);
    expect(result[0].symbol).toBe('BTCUSDT');
    expect(result[1].symbol).toBe('ETHUSDT');
  });

  it('parses numeric fields as numbers', () => {
    const result = normalizeBybitMarkPriceList(BYBIT_RAW_MARK_PRICE_TICKER_LIST);

    expect(result[0].markPrice).toBe(65450.5);
    expect(result[0].indexPrice).toBe(65440.2);
    expect(result[0].lastFundingRate).toBe(0.0001);
    expect(result[0].nextFundingTime).toBe(1700028800000);
  });

  it('preserves timestamp from raw data', () => {
    const result = normalizeBybitMarkPriceList(BYBIT_RAW_MARK_PRICE_TICKER_LIST);

    expect(result[0].timestamp).toBe(1700000000000);
  });

  it('handles negative funding rate', () => {
    const result = normalizeBybitMarkPriceList(BYBIT_RAW_MARK_PRICE_TICKER_LIST);

    expect(result[1].lastFundingRate).toBe(-0.00005);
  });

  it('returns empty array for empty input', () => {
    const result = normalizeBybitMarkPriceList([]);

    expect(result).toHaveLength(0);
  });
});
