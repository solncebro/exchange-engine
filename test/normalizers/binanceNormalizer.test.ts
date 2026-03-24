import {
  normalizeBinanceTradeSymbols,
  normalizeBinanceTickers,
  normalizeBinanceKlines,
  normalizeBinanceKlineWebSocketMessage,
  normalizeBinancePosition,
  normalizeBinanceOrder,
  normalizeBinanceBalances,
  normalizeBinanceFuturesBalances,
  normalizeBinanceFundingRateHistory,
  normalizeBinanceFundingInfo,
  normalizeBinanceOrderBook,
  normalizeBinancePublicTrades,
  normalizeBinanceMarkPriceList,
  normalizeBinanceOpenInterest,
  normalizeBinanceCommissionRate,
  normalizeBinanceIncomeList,
} from '../../src/normalizers/binanceNormalizer';
import { TradeSymbolTypeEnum, PositionSideEnum, MarginModeEnum } from '../../src/types/common';
import {
  BINANCE_RAW_EXCHANGE_INFO,
  BINANCE_RAW_TICKER_LIST,
  BINANCE_RAW_KLINE_LIST,
  BINANCE_RAW_WEBSOCKET_KLINE,
  BINANCE_RAW_POSITION_RISK,
  BINANCE_RAW_ORDER_RESPONSE,
  BINANCE_RAW_ACCOUNT,
  BINANCE_RAW_FUTURES_ACCOUNT,
  BINANCE_RAW_FUNDING_RATE_HISTORY_LIST,
  BINANCE_RAW_FUNDING_INFO_LIST,
  BINANCE_RAW_FUTURE_SYMBOL,
  BINANCE_RAW_SYMBOL_NO_FILTERS,
  BINANCE_RAW_ORDER_BOOK,
  BINANCE_RAW_PUBLIC_TRADE_LIST,
  BINANCE_RAW_MARK_PRICE_LIST,
  BINANCE_RAW_OPEN_INTEREST,
  BINANCE_RAW_COMMISSION_RATE,
  BINANCE_RAW_INCOME_LIST,
} from '../fixtures/binanceRaw';

describe('normalizeBinanceTradeSymbols', () => {
  it('returns a Map', () => {
    const result = normalizeBinanceTradeSymbols(BINANCE_RAW_EXCHANGE_INFO);

    expect(result).toBeInstanceOf(Map);
  });

  it('contains correct number of symbols', () => {
    const result = normalizeBinanceTradeSymbols(BINANCE_RAW_EXCHANGE_INFO);

    expect(result.size).toBe(2);
  });

  it('marks PERPETUAL contract as swap/linear', () => {
    const result = normalizeBinanceTradeSymbols(BINANCE_RAW_EXCHANGE_INFO);
    const btc = result.get('BTCUSDT')!;

    expect(btc.type).toBe(TradeSymbolTypeEnum.Swap);
    expect(btc.isLinear).toBe(true);
    expect(btc.settle).toBe('USDT');
  });

  it('marks spot symbol correctly', () => {
    const result = normalizeBinanceTradeSymbols(BINANCE_RAW_EXCHANGE_INFO);
    const eth = result.get('ETHBTC')!;

    expect(eth.type).toBe(TradeSymbolTypeEnum.Spot);
    expect(eth.isLinear).toBe(false);
    expect(eth.settle).toBe('');
  });

  it('extracts PRICE_FILTER tickSize', () => {
    const result = normalizeBinanceTradeSymbols(BINANCE_RAW_EXCHANGE_INFO);

    expect(result.get('BTCUSDT')!.filter.tickSize).toBe('0.10');
  });

  it('extracts LOT_SIZE filter fields', () => {
    const result = normalizeBinanceTradeSymbols(BINANCE_RAW_EXCHANGE_INFO);
    const filter = result.get('BTCUSDT')!.filter;

    expect(filter.stepSize).toBe('0.001');
    expect(filter.minQty).toBe('0.001');
    expect(filter.maxQty).toBe('1000');
  });

  it('extracts MIN_NOTIONAL from notional field', () => {
    const result = normalizeBinanceTradeSymbols(BINANCE_RAW_EXCHANGE_INFO);

    expect(result.get('BTCUSDT')!.filter.minNotional).toBe('5');
  });

  it('extracts NOTIONAL from minNotional field as fallback', () => {
    const result = normalizeBinanceTradeSymbols(BINANCE_RAW_EXCHANGE_INFO);

    expect(result.get('ETHBTC')!.filter.minNotional).toBe('0.0001');
  });

  it('sets isActive=true for TRADING status', () => {
    const result = normalizeBinanceTradeSymbols(BINANCE_RAW_EXCHANGE_INFO);

    expect(result.get('BTCUSDT')!.isActive).toBe(true);
  });

  it('sets isActive=false for non-TRADING status', () => {
    const info = { symbols: [{ ...BINANCE_RAW_EXCHANGE_INFO.symbols[0], status: 'BREAK' }] };
    const result = normalizeBinanceTradeSymbols(info);

    expect(result.get('BTCUSDT')!.isActive).toBe(false);
  });

  it('marks non-perpetual futures contract as Future type', () => {
    const info = { symbols: [BINANCE_RAW_FUTURE_SYMBOL] };
    const result = normalizeBinanceTradeSymbols(info);
    const symbol = result.get('BTCUSDT_250627')!;

    expect(symbol.type).toBe(TradeSymbolTypeEnum.Future);
    expect(symbol.isLinear).toBe(false);
  });

  it('falls back filter fields to 0 when no matching filters exist', () => {
    const info = { symbols: [BINANCE_RAW_SYMBOL_NO_FILTERS] };
    const result = normalizeBinanceTradeSymbols(info);
    const filter = result.get('XYZUSDT')!.filter;

    expect(filter.tickSize).toBe('0');
    expect(filter.stepSize).toBe('0');
    expect(filter.minQty).toBe('0');
    expect(filter.maxQty).toBe('0');
    expect(filter.minNotional).toBe('0');
  });
});

describe('normalizeBinanceTickers', () => {
  it('returns a Map', () => {
    const result = normalizeBinanceTickers(BINANCE_RAW_TICKER_LIST);

    expect(result).toBeInstanceOf(Map);
  });

  it('contains correct number of tickers', () => {
    const result = normalizeBinanceTickers(BINANCE_RAW_TICKER_LIST);

    expect(result.size).toBe(2);
  });

  it('parses lastPrice as number', () => {
    const result = normalizeBinanceTickers(BINANCE_RAW_TICKER_LIST);

    expect(result.get('BTCUSDT')!.lastPrice).toBe(65432.1);
  });

  it('parses openPrice as number', () => {
    const result = normalizeBinanceTickers(BINANCE_RAW_TICKER_LIST);

    expect(result.get('BTCUSDT')!.openPrice).toBe(63900);
  });

  it('parses highPrice and lowPrice', () => {
    const result = normalizeBinanceTickers(BINANCE_RAW_TICKER_LIST);

    expect(result.get('BTCUSDT')!.highPrice).toBe(66000);
    expect(result.get('BTCUSDT')!.lowPrice).toBe(63500);
  });

  it('parses priceChangePercent as number', () => {
    const result = normalizeBinanceTickers(BINANCE_RAW_TICKER_LIST);

    expect(result.get('BTCUSDT')!.priceChangePercent).toBe(2.35);
    expect(result.get('ETHUSDT')!.priceChangePercent).toBe(-1.2);
  });

  it('parses volume and quoteVolume', () => {
    const result = normalizeBinanceTickers(BINANCE_RAW_TICKER_LIST);

    expect(result.get('BTCUSDT')!.volume).toBe(12345.67);
    expect(result.get('BTCUSDT')!.quoteVolume).toBe(805000000);
  });

  it('preserves timestamp', () => {
    const result = normalizeBinanceTickers(BINANCE_RAW_TICKER_LIST);

    expect(result.get('BTCUSDT')!.timestamp).toBe(1700000000000);
  });
});

describe('normalizeBinanceKlines', () => {
  it('returns array of Kline objects', () => {
    const result = normalizeBinanceKlines(BINANCE_RAW_KLINE_LIST);

    expect(result).toHaveLength(2);
  });

  it('parses kline fields correctly', () => {
    const [kline] = normalizeBinanceKlines(BINANCE_RAW_KLINE_LIST);

    expect(kline.openTimestamp).toBe(1700000000000);
    expect(kline.openPrice).toBe(65000);
    expect(kline.highPrice).toBe(66000);
    expect(kline.lowPrice).toBe(64000);
    expect(kline.closePrice).toBe(65500);
    expect(kline.volume).toBe(1234.56);
    expect(kline.closeTimestamp).toBe(1700003600000);
    expect(kline.quoteAssetVolume).toBe(80500000);
    expect(kline.numberOfTrades).toBe(5000);
    expect(kline.takerBuyBaseAssetVolume).toBe(600);
    expect(kline.takerBuyQuoteAssetVolume).toBe(39000000);
  });
});

describe('normalizeBinanceKlineWebSocketMessage', () => {
  it('maps short names to Kline fields', () => {
    const result = normalizeBinanceKlineWebSocketMessage(BINANCE_RAW_WEBSOCKET_KLINE);

    expect(result.openTimestamp).toBe(1700000000000);
    expect(result.openPrice).toBe(65000);
    expect(result.highPrice).toBe(66000);
    expect(result.lowPrice).toBe(64000);
    expect(result.closePrice).toBe(65500);
    expect(result.volume).toBe(1234.56);
    expect(result.closeTimestamp).toBe(1700003600000);
    expect(result.quoteAssetVolume).toBe(80500000);
    expect(result.numberOfTrades).toBe(5000);
    expect(result.takerBuyBaseAssetVolume).toBe(600);
    expect(result.takerBuyQuoteAssetVolume).toBe(39000000);
  });

  it('sets isClosed to true when x is true', () => {
    const result = normalizeBinanceKlineWebSocketMessage({ ...BINANCE_RAW_WEBSOCKET_KLINE, x: true });

    expect(result.isClosed).toBe(true);
  });

  it('sets isClosed to false when x is false', () => {
    const result = normalizeBinanceKlineWebSocketMessage({ ...BINANCE_RAW_WEBSOCKET_KLINE, x: false });

    expect(result.isClosed).toBe(false);
  });
});

describe('normalizeBinancePosition', () => {
  it('maps LONG to long', () => {
    const result = normalizeBinancePosition(BINANCE_RAW_POSITION_RISK);

    expect(result.side).toBe(PositionSideEnum.Long);
  });

  it('maps SHORT to short', () => {
    const raw = { ...BINANCE_RAW_POSITION_RISK, positionSide: 'SHORT' };
    const result = normalizeBinancePosition(raw);

    expect(result.side).toBe(PositionSideEnum.Short);
  });

  it('maps BOTH to both', () => {
    const raw = { ...BINANCE_RAW_POSITION_RISK, positionSide: 'BOTH' };
    const result = normalizeBinancePosition(raw);

    expect(result.side).toBe(PositionSideEnum.Both);
  });

  it('falls back to both for unknown side', () => {
    const raw = { ...BINANCE_RAW_POSITION_RISK, positionSide: 'UNKNOWN' };
    const result = normalizeBinancePosition(raw);

    expect(result.side).toBe(PositionSideEnum.Both);
  });

  it('maps ISOLATED marginType', () => {
    const result = normalizeBinancePosition(BINANCE_RAW_POSITION_RISK);

    expect(result.marginMode).toBe(MarginModeEnum.Isolated);
  });

  it('maps CROSSED marginType to cross', () => {
    const raw = { ...BINANCE_RAW_POSITION_RISK, marginType: 'CROSSED' };
    const result = normalizeBinancePosition(raw);

    expect(result.marginMode).toBe(MarginModeEnum.Cross);
  });

  it('parses numeric fields', () => {
    const result = normalizeBinancePosition(BINANCE_RAW_POSITION_RISK);

    expect(result.contracts).toBe(0.1);
    expect(result.entryPrice).toBe(65000);
    expect(result.markPrice).toBe(65500);
    expect(result.unrealizedPnl).toBe(50);
    expect(result.leverage).toBe(10);
    expect(result.liquidationPrice).toBe(60000);
  });

  it('returns 0 for NaN liquidationPrice', () => {
    const raw = { ...BINANCE_RAW_POSITION_RISK, liquidationPrice: '' };
    const result = normalizeBinancePosition(raw);

    expect(result.liquidationPrice).toBe(0);
  });

  it('preserves raw data in info', () => {
    const result = normalizeBinancePosition(BINANCE_RAW_POSITION_RISK);

    expect(result.info).toBe(BINANCE_RAW_POSITION_RISK);
  });
});

describe('normalizeBinanceOrder', () => {
  it('converts orderId number to string', () => {
    const result = normalizeBinanceOrder(BINANCE_RAW_ORDER_RESPONSE);

    expect(result.id).toBe('123456789');
  });

  it('preserves clientOrderId', () => {
    const result = normalizeBinanceOrder(BINANCE_RAW_ORDER_RESPONSE);

    expect(result.clientOrderId).toBe('myOrder123');
  });

  it('lowercases side', () => {
    const result = normalizeBinanceOrder(BINANCE_RAW_ORDER_RESPONSE);

    expect(result.side).toBe('buy');
  });

  it('lowercases type', () => {
    const result = normalizeBinanceOrder(BINANCE_RAW_ORDER_RESPONSE);

    expect(result.type).toBe('limit');
  });

  it('parses timeInForce', () => {
    const result = normalizeBinanceOrder(BINANCE_RAW_ORDER_RESPONSE);

    expect(result.timeInForce).toBe('GTC');
  });

  it('parses origQty and price', () => {
    const result = normalizeBinanceOrder(BINANCE_RAW_ORDER_RESPONSE);

    expect(result.amount).toBe(0.1);
    expect(result.price).toBe(65000);
  });

  it('parses avgPrice', () => {
    const result = normalizeBinanceOrder(BINANCE_RAW_ORDER_RESPONSE);

    expect(result.avgPrice).toBe(64950);
  });

  it('parses filledAmount and filledQuoteAmount', () => {
    const result = normalizeBinanceOrder(BINANCE_RAW_ORDER_RESPONSE);

    expect(result.filledAmount).toBe(0.1);
    expect(result.filledQuoteAmount).toBe(6495);
  });

  it('maps FILLED status to closed', () => {
    const result = normalizeBinanceOrder(BINANCE_RAW_ORDER_RESPONSE);

    expect(result.status).toBe('closed');
  });

  it('maps NEW status to open', () => {
    const raw = { ...BINANCE_RAW_ORDER_RESPONSE, status: 'NEW' };
    const result = normalizeBinanceOrder(raw);

    expect(result.status).toBe('open');
  });

  it('maps PARTIALLY_FILLED status to open', () => {
    const raw = { ...BINANCE_RAW_ORDER_RESPONSE, status: 'PARTIALLY_FILLED' };
    const result = normalizeBinanceOrder(raw);

    expect(result.status).toBe('open');
  });

  it('maps CANCELED status to canceled', () => {
    const raw = { ...BINANCE_RAW_ORDER_RESPONSE, status: 'CANCELED' };
    const result = normalizeBinanceOrder(raw);

    expect(result.status).toBe('canceled');
  });

  it('maps REJECTED status to rejected', () => {
    const raw = { ...BINANCE_RAW_ORDER_RESPONSE, status: 'REJECTED' };
    const result = normalizeBinanceOrder(raw);

    expect(result.status).toBe('rejected');
  });

  it('maps EXPIRED status to canceled', () => {
    const raw = { ...BINANCE_RAW_ORDER_RESPONSE, status: 'EXPIRED' };
    const result = normalizeBinanceOrder(raw);

    expect(result.status).toBe('canceled');
  });

  it('falls back to lowercase for unknown status', () => {
    const raw = { ...BINANCE_RAW_ORDER_RESPONSE, status: 'SOME_NEW_STATUS' };
    const result = normalizeBinanceOrder(raw);

    expect(result.status).toBe('some_new_status');
  });

  it('preserves reduceOnly', () => {
    const result = normalizeBinanceOrder(BINANCE_RAW_ORDER_RESPONSE);

    expect(result.reduceOnly).toBe(false);
  });

  it('uses time as timestamp', () => {
    const result = normalizeBinanceOrder(BINANCE_RAW_ORDER_RESPONSE);

    expect(result.timestamp).toBe(1699999990000);
  });

  it('preserves updateTime as updatedTimestamp', () => {
    const result = normalizeBinanceOrder(BINANCE_RAW_ORDER_RESPONSE);

    expect(result.updatedTimestamp).toBe(1700000000000);
  });

  it('defaults clientOrderId to empty string when missing', () => {
    const raw = { ...BINANCE_RAW_ORDER_RESPONSE };
    delete (raw as any).clientOrderId;
    const result = normalizeBinanceOrder(raw as any);

    expect(result.clientOrderId).toBe('');
  });

  it('defaults avgPrice to 0 when missing', () => {
    const raw = { ...BINANCE_RAW_ORDER_RESPONSE };
    delete (raw as any).avgPrice;
    const result = normalizeBinanceOrder(raw as any);

    expect(result.avgPrice).toBe(0);
  });

  it('defaults stopPrice to 0 when missing', () => {
    const raw = { ...BINANCE_RAW_ORDER_RESPONSE };
    delete (raw as any).stopPrice;
    const result = normalizeBinanceOrder(raw as any);

    expect(result.stopPrice).toBe(0);
  });

  it('defaults executedQty to 0 when missing', () => {
    const raw = { ...BINANCE_RAW_ORDER_RESPONSE };
    delete (raw as any).executedQty;
    const result = normalizeBinanceOrder(raw as any);

    expect(result.filledAmount).toBe(0);
  });

  it('defaults cumQuote to 0 when missing', () => {
    const raw = { ...BINANCE_RAW_ORDER_RESPONSE };
    delete (raw as any).cumQuote;
    const result = normalizeBinanceOrder(raw as any);

    expect(result.filledQuoteAmount).toBe(0);
  });

  it('defaults reduceOnly to false when missing', () => {
    const raw = { ...BINANCE_RAW_ORDER_RESPONSE };
    delete (raw as any).reduceOnly;
    const result = normalizeBinanceOrder(raw as any);

    expect(result.reduceOnly).toBe(false);
  });

  it('falls back to updateTime when time is missing', () => {
    const raw = { ...BINANCE_RAW_ORDER_RESPONSE };
    delete (raw as any).time;
    const result = normalizeBinanceOrder(raw as any);

    expect(result.timestamp).toBe(1700000000000);
  });

  it('lowercases unknown order type as fallback', () => {
    const raw = { ...BINANCE_RAW_ORDER_RESPONSE, type: 'STOP_LOSS' };
    const result = normalizeBinanceOrder(raw);

    expect(result.type).toBe('stop_loss');
  });
});

describe('normalizeBinanceBalances', () => {
  it('returns AccountBalances with balanceByAsset Map', () => {
    const result = normalizeBinanceBalances(BINANCE_RAW_ACCOUNT);

    expect(result.balanceByAsset).toBeInstanceOf(Map);
  });

  it('skips zero balances', () => {
    const result = normalizeBinanceBalances(BINANCE_RAW_ACCOUNT);

    expect(result.balanceByAsset.has('DOGE')).toBe(false);
  });

  it('includes non-zero balances', () => {
    const result = normalizeBinanceBalances(BINANCE_RAW_ACCOUNT);

    expect(result.balanceByAsset.size).toBe(2);
    expect(result.balanceByAsset.has('USDT')).toBe(true);
    expect(result.balanceByAsset.has('BTC')).toBe(true);
  });

  it('parses free and locked correctly', () => {
    const result = normalizeBinanceBalances(BINANCE_RAW_ACCOUNT);
    const usdt = result.balanceByAsset.get('USDT')!;

    expect(usdt.free).toBe(1000.5);
    expect(usdt.locked).toBe(200);
    expect(usdt.total).toBe(1200.5);
  });

  it('computes totalWalletBalance and totalAvailableBalance from balances', () => {
    const result = normalizeBinanceBalances(BINANCE_RAW_ACCOUNT);

    expect(result.totalWalletBalance).toBe(1200.5 + 0.6);
    expect(result.totalAvailableBalance).toBe(1000.5 + 0.5);
  });
});

describe('normalizeBinanceFuturesBalances', () => {
  it('returns AccountBalances with balanceByAsset Map', () => {
    const result = normalizeBinanceFuturesBalances(BINANCE_RAW_FUTURES_ACCOUNT);

    expect(result.balanceByAsset).toBeInstanceOf(Map);
  });

  it('skips zero wallet balances', () => {
    const result = normalizeBinanceFuturesBalances(BINANCE_RAW_FUTURES_ACCOUNT);

    expect(result.balanceByAsset.has('DOGE')).toBe(false);
  });

  it('includes non-zero balances', () => {
    const result = normalizeBinanceFuturesBalances(BINANCE_RAW_FUTURES_ACCOUNT);

    expect(result.balanceByAsset.size).toBe(2);
    expect(result.balanceByAsset.has('USDT')).toBe(true);
    expect(result.balanceByAsset.has('BNB')).toBe(true);
  });

  it('maps availableBalance to free and walletBalance to total', () => {
    const result = normalizeBinanceFuturesBalances(BINANCE_RAW_FUTURES_ACCOUNT);
    const usdt = result.balanceByAsset.get('USDT')!;

    expect(usdt.free).toBe(1000.5);
    expect(usdt.locked).toBe(200);
    expect(usdt.total).toBe(1200.5);
  });

  it('calculates locked as walletBalance minus availableBalance', () => {
    const result = normalizeBinanceFuturesBalances(BINANCE_RAW_FUTURES_ACCOUNT);
    const bnb = result.balanceByAsset.get('BNB')!;

    expect(bnb.free).toBe(3.5);
    expect(bnb.locked).toBe(1.5);
    expect(bnb.total).toBe(5);
  });

  it('parses totalWalletBalance and totalAvailableBalance from raw', () => {
    const result = normalizeBinanceFuturesBalances(BINANCE_RAW_FUTURES_ACCOUNT);

    expect(result.totalWalletBalance).toBe(1205.5);
    expect(result.totalAvailableBalance).toBe(1000.5);
  });
});

describe('normalizeBinanceFundingRateHistory', () => {
  it('returns array of FundingRateHistory objects', () => {
    const result = normalizeBinanceFundingRateHistory(BINANCE_RAW_FUNDING_RATE_HISTORY_LIST);

    expect(result).toHaveLength(2);
  });

  it('parses fundingRate as number', () => {
    const [first] = normalizeBinanceFundingRateHistory(BINANCE_RAW_FUNDING_RATE_HISTORY_LIST);

    expect(first.fundingRate).toBe(0.0001);
  });

  it('parses negative fundingRate', () => {
    const [, second] = normalizeBinanceFundingRateHistory(BINANCE_RAW_FUNDING_RATE_HISTORY_LIST);

    expect(second.fundingRate).toBe(-0.00005);
  });

  it('preserves fundingTime', () => {
    const [first] = normalizeBinanceFundingRateHistory(BINANCE_RAW_FUNDING_RATE_HISTORY_LIST);

    expect(first.fundingTime).toBe(1700006400000);
  });

  it('parses markPrice when present', () => {
    const [first] = normalizeBinanceFundingRateHistory(BINANCE_RAW_FUNDING_RATE_HISTORY_LIST);

    expect(first.markPrice).toBe(65500);
  });

  it('returns null markPrice for empty string', () => {
    const [, second] = normalizeBinanceFundingRateHistory(BINANCE_RAW_FUNDING_RATE_HISTORY_LIST);

    expect(second.markPrice).toBeNull();
  });

  it('preserves symbol', () => {
    const [first] = normalizeBinanceFundingRateHistory(BINANCE_RAW_FUNDING_RATE_HISTORY_LIST);

    expect(first.symbol).toBe('BTCUSDT');
  });
});

describe('normalizeBinanceFundingInfo', () => {
  it('returns array of FundingInfo objects', () => {
    const result = normalizeBinanceFundingInfo(BINANCE_RAW_FUNDING_INFO_LIST);

    expect(result).toHaveLength(2);
  });

  it('preserves symbol', () => {
    const [first] = normalizeBinanceFundingInfo(BINANCE_RAW_FUNDING_INFO_LIST);

    expect(first.symbol).toBe('BTCUSDT');
  });

  it('preserves fundingIntervalHours as number', () => {
    const [first] = normalizeBinanceFundingInfo(BINANCE_RAW_FUNDING_INFO_LIST);

    expect(first.fundingIntervalHours).toBe(8);
  });

  it('parses adjustedFundingRateCap as number', () => {
    const [first] = normalizeBinanceFundingInfo(BINANCE_RAW_FUNDING_INFO_LIST);

    expect(first.adjustedFundingRateCap).toBe(0.02);
  });

  it('parses adjustedFundingRateFloor as number', () => {
    const [first] = normalizeBinanceFundingInfo(BINANCE_RAW_FUNDING_INFO_LIST);

    expect(first.adjustedFundingRateFloor).toBe(-0.02);
  });

  it('parses second entry correctly', () => {
    const [, second] = normalizeBinanceFundingInfo(BINANCE_RAW_FUNDING_INFO_LIST);

    expect(second.symbol).toBe('ETHUSDT');
    expect(second.fundingIntervalHours).toBe(4);
    expect(second.adjustedFundingRateCap).toBe(0.015);
    expect(second.adjustedFundingRateFloor).toBe(-0.015);
  });
});

describe('normalizeBinanceOrderBook', () => {
  it('normalizes order book from raw data', () => {
    const result = normalizeBinanceOrderBook(BINANCE_RAW_ORDER_BOOK, 'BTCUSDT');

    expect(result.symbol).toBe('BTCUSDT');
    expect(result.askList).toHaveLength(2);
    expect(result.bidList).toHaveLength(2);
    expect(result.timestamp).toBe(1700000000000);
  });

  it('parses price and quantity as numbers', () => {
    const result = normalizeBinanceOrderBook(BINANCE_RAW_ORDER_BOOK, 'BTCUSDT');

    expect(result.askList[0].price).toBe(65001);
    expect(result.askList[0].quantity).toBe(0.8);
    expect(result.bidList[0].price).toBe(65000);
    expect(result.bidList[0].quantity).toBe(1.5);
  });

  it('returns empty arrays for empty order book', () => {
    const raw = { ...BINANCE_RAW_ORDER_BOOK, asks: [], bids: [] };
    const result = normalizeBinanceOrderBook(raw, 'BTCUSDT');

    expect(result.askList).toHaveLength(0);
    expect(result.bidList).toHaveLength(0);
  });
});

describe('normalizeBinancePublicTrades', () => {
  it('returns array of PublicTrade objects', () => {
    const result = normalizeBinancePublicTrades(BINANCE_RAW_PUBLIC_TRADE_LIST, 'BTCUSDT');

    expect(result).toHaveLength(2);
    expect(result[0].symbol).toBe('BTCUSDT');
  });

  it('parses price and quantity as numbers', () => {
    const result = normalizeBinancePublicTrades(BINANCE_RAW_PUBLIC_TRADE_LIST, 'BTCUSDT');

    expect(result[0].price).toBe(65000.5);
    expect(result[0].quantity).toBe(0.1);
    expect(result[0].quoteQuantity).toBe(6500.05);
  });

  it('converts id to string', () => {
    const result = normalizeBinancePublicTrades(BINANCE_RAW_PUBLIC_TRADE_LIST, 'BTCUSDT');

    expect(result[0].id).toBe('12345');
  });

  it('preserves isBuyerMaker flag', () => {
    const result = normalizeBinancePublicTrades(BINANCE_RAW_PUBLIC_TRADE_LIST, 'BTCUSDT');

    expect(result[0].isBuyerMaker).toBe(false);
    expect(result[1].isBuyerMaker).toBe(true);
  });

  it('returns empty array for empty input', () => {
    const result = normalizeBinancePublicTrades([], 'BTCUSDT');

    expect(result).toHaveLength(0);
  });
});

describe('normalizeBinanceMarkPriceList', () => {
  it('returns array of MarkPrice objects', () => {
    const result = normalizeBinanceMarkPriceList(BINANCE_RAW_MARK_PRICE_LIST);

    expect(result).toHaveLength(2);
    expect(result[0].symbol).toBe('BTCUSDT');
  });

  it('parses numeric fields as numbers', () => {
    const result = normalizeBinanceMarkPriceList(BINANCE_RAW_MARK_PRICE_LIST);

    expect(result[0].markPrice).toBe(65000.5);
    expect(result[0].indexPrice).toBe(65001);
    expect(result[0].lastFundingRate).toBe(0.0001);
  });

  it('preserves nextFundingTime and timestamp', () => {
    const result = normalizeBinanceMarkPriceList(BINANCE_RAW_MARK_PRICE_LIST);

    expect(result[0].nextFundingTime).toBe(1700003600000);
    expect(result[0].timestamp).toBe(1700000000000);
  });

  it('returns empty array for empty input', () => {
    const result = normalizeBinanceMarkPriceList([]);

    expect(result).toHaveLength(0);
  });
});

describe('normalizeBinanceOpenInterest', () => {
  it('normalizes open interest from raw data', () => {
    const result = normalizeBinanceOpenInterest(BINANCE_RAW_OPEN_INTEREST);

    expect(result.symbol).toBe('BTCUSDT');
    expect(result.timestamp).toBe(1700000000000);
  });

  it('parses openInterest as number', () => {
    const result = normalizeBinanceOpenInterest(BINANCE_RAW_OPEN_INTEREST);

    expect(result.openInterest).toBe(12345.678);
  });
});

describe('normalizeBinanceCommissionRate', () => {
  it('returns array with one FeeRate entry', () => {
    const result = normalizeBinanceCommissionRate(BINANCE_RAW_COMMISSION_RATE);

    expect(result).toHaveLength(1);
    expect(result[0].symbol).toBe('BTCUSDT');
  });

  it('parses commission rates as numbers', () => {
    const result = normalizeBinanceCommissionRate(BINANCE_RAW_COMMISSION_RATE);

    expect(result[0].makerRate).toBe(0.0002);
    expect(result[0].takerRate).toBe(0.0004);
  });
});

describe('normalizeBinanceIncomeList', () => {
  it('returns array of Income objects', () => {
    const result = normalizeBinanceIncomeList(BINANCE_RAW_INCOME_LIST);

    expect(result).toHaveLength(2);
    expect(result[0].symbol).toBe('BTCUSDT');
  });

  it('parses income as number', () => {
    const result = normalizeBinanceIncomeList(BINANCE_RAW_INCOME_LIST);

    expect(result[0].income).toBe(15.5);
    expect(result[1].income).toBe(-0.05);
  });

  it('preserves incomeType and asset', () => {
    const result = normalizeBinanceIncomeList(BINANCE_RAW_INCOME_LIST);

    expect(result[0].incomeType).toBe('REALIZED_PNL');
    expect(result[0].asset).toBe('USDT');
    expect(result[1].incomeType).toBe('FUNDING_FEE');
  });

  it('includes tranId and tradeId in info', () => {
    const result = normalizeBinanceIncomeList(BINANCE_RAW_INCOME_LIST);

    expect(result[0].info).toEqual({ tranId: 123456, tradeId: '789', info: '' });
  });

  it('returns empty array for empty input', () => {
    const result = normalizeBinanceIncomeList([]);

    expect(result).toHaveLength(0);
  });
});
