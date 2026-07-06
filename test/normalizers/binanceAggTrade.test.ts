import { normalizeBinanceAggTradeFromStream } from '../../src/normalizers/binanceNormalizer';
import { OrderSideEnum } from '../../src/types/common';

describe('normalizeBinanceAggTradeFromStream', () => {
  it('maps a Binance aggTrade payload to a PublicTrade', () => {
    const trade = normalizeBinanceAggTradeFromStream({
      e: 'aggTrade',
      E: 123456789,
      s: 'BTCUSDT',
      a: 5933014,
      p: '50000.5',
      q: '0.25',
      f: 100,
      l: 105,
      T: 123456785,
      m: true,
    });

    expect(trade.id).toBe('5933014');
    expect(trade.symbol).toBe('BTCUSDT');
    expect(trade.price).toBeCloseTo(50000.5);
    expect(trade.quantity).toBeCloseTo(0.25);
    expect(trade.quoteQuantity).toBeCloseTo(12500.125);
    expect(trade.timestamp).toBe(123456785);
    expect(trade.isBuyerMaker).toBe(true);
    expect(trade.side).toBe(OrderSideEnum.Sell);
  });

  it('maps a buyer-taker aggTrade to the buy side', () => {
    const trade = normalizeBinanceAggTradeFromStream({
      e: 'aggTrade',
      E: 1,
      s: 'ETHUSDT',
      a: 7,
      p: '3000',
      q: '2',
      f: 1,
      l: 1,
      T: 2,
      m: false,
    });

    expect(trade.side).toBe(OrderSideEnum.Buy);
    expect(trade.isBuyerMaker).toBe(false);
    expect(trade.quoteQuantity).toBeCloseTo(6000);
  });
});
