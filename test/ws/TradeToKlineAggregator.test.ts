import type { BybitPublicTradeDataRaw } from '../../src/normalizers/bybitNormalizer';
import type { Kline } from '../../src/types/common';
import { TradeToKlineAggregator } from '../../src/ws/TradeToKlineAggregator';
import { createMockLogger } from '../fixtures/mockLogger';

function createTrade(symbol: string, price: string, volume: string, timestamp: number): BybitPublicTradeDataRaw {
  return { s: symbol, p: price, v: volume, T: timestamp };
}

describe('TradeToKlineAggregator', () => {
  const mockLogger = createMockLogger();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('processTrade', () => {
    it('skips first incomplete second for each symbol', () => {
      const aggregator = new TradeToKlineAggregator(mockLogger);
      const handler = jest.fn();
      aggregator.setHandler(handler);

      aggregator.processTrade(createTrade('BTCUSDT', '50000', '0.1', 1700000000500));

      expect(handler).not.toHaveBeenCalled();
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.objectContaining({ symbol: 'BTCUSDT', skippedOpenTimestamp: 1700000000000 }),
        'Skipped incomplete kline for trade aggregation',
      );
    });

    it('initializes kline with first trade after skip', () => {
      const aggregator = new TradeToKlineAggregator(mockLogger);
      const handler = jest.fn();
      aggregator.setHandler(handler);

      aggregator.processTrade(createTrade('BTCUSDT', '50000', '0.1', 1700000000500));
      aggregator.processTrade(createTrade('BTCUSDT', '50100', '0.2', 1700000001200));

      expect(handler).not.toHaveBeenCalled();
    });

    it('aggregates high/low/close/volume within the same second', () => {
      const aggregator = new TradeToKlineAggregator(mockLogger);
      const emittedKlineList: Kline[] = [];
      aggregator.setHandler((_symbol, kline) => emittedKlineList.push(kline));

      aggregator.processTrade(createTrade('BTCUSDT', '50000', '0.1', 1700000000500));
      aggregator.processTrade(createTrade('BTCUSDT', '50100', '0.2', 1700000001200));
      aggregator.processTrade(createTrade('BTCUSDT', '49900', '0.3', 1700000001500));
      aggregator.processTrade(createTrade('BTCUSDT', '50050', '0.15', 1700000001800));

      aggregator.processTrade(createTrade('BTCUSDT', '50200', '0.1', 1700000002100));

      expect(emittedKlineList).toHaveLength(1);
      const kline = emittedKlineList[0];

      expect(kline.openPrice).toBe(50100);
      expect(kline.highPrice).toBe(50100);
      expect(kline.lowPrice).toBe(49900);
      expect(kline.closePrice).toBe(50050);
      expect(kline.volume).toBeCloseTo(0.65);
      expect(kline.isClosed).toBe(true);
    });

    it('emits kline when transitioning to a new second', () => {
      const aggregator = new TradeToKlineAggregator(mockLogger);
      const emittedSymbolList: string[] = [];
      aggregator.setHandler((symbol) => emittedSymbolList.push(symbol));

      aggregator.processTrade(createTrade('BTCUSDT', '50000', '0.1', 1700000000500));
      aggregator.processTrade(createTrade('BTCUSDT', '50100', '0.2', 1700000001200));
      aggregator.processTrade(createTrade('BTCUSDT', '50200', '0.1', 1700000002100));

      expect(emittedSymbolList).toEqual(['BTCUSDT']);
    });

    it('ignores trades with timestamp in the past', () => {
      const aggregator = new TradeToKlineAggregator(mockLogger);
      const handler = jest.fn();
      aggregator.setHandler(handler);

      aggregator.processTrade(createTrade('BTCUSDT', '50000', '0.1', 1700000000500));
      aggregator.processTrade(createTrade('BTCUSDT', '50100', '0.2', 1700000001200));
      aggregator.processTrade(createTrade('BTCUSDT', '49800', '0.1', 1700000000800));

      expect(handler).not.toHaveBeenCalled();
    });

    it('does not emit kline with volume=0 when changing second', () => {
      const aggregator = new TradeToKlineAggregator(mockLogger);
      const handler = jest.fn();
      aggregator.setHandler(handler);

      aggregator.processTrade(createTrade('BTCUSDT', '50000', '0.1', 1700000000500));
      aggregator.processTrade(createTrade('BTCUSDT', '50100', '0.2', 1700000002200));

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('forceEmitPendingKlineList', () => {
    it('emits all accumulated klines', () => {
      const aggregator = new TradeToKlineAggregator(mockLogger);
      const emittedSymbolList: string[] = [];
      aggregator.setHandler((symbol) => emittedSymbolList.push(symbol));

      aggregator.processTrade(createTrade('BTCUSDT', '50000', '0.1', 1700000000500));
      aggregator.processTrade(createTrade('BTCUSDT', '50100', '0.2', 1700000001200));
      aggregator.processTrade(createTrade('ETHUSDT', '3000', '1', 1700000000500));
      aggregator.processTrade(createTrade('ETHUSDT', '3010', '2', 1700000001200));

      aggregator.forceEmitPendingKlineList();

      expect(emittedSymbolList).toHaveLength(2);
      expect(emittedSymbolList).toContain('BTCUSDT');
      expect(emittedSymbolList).toContain('ETHUSDT');
    });

    it('clears Map after emit', () => {
      const aggregator = new TradeToKlineAggregator(mockLogger);
      const handler = jest.fn();
      aggregator.setHandler(handler);

      aggregator.processTrade(createTrade('BTCUSDT', '50000', '0.1', 1700000000500));
      aggregator.processTrade(createTrade('BTCUSDT', '50100', '0.2', 1700000001200));

      aggregator.forceEmitPendingKlineList();
      handler.mockClear();

      aggregator.forceEmitPendingKlineList();

      expect(handler).not.toHaveBeenCalled();
    });

    it('does not call handler if handler is not set', () => {
      const aggregator = new TradeToKlineAggregator(mockLogger);

      aggregator.processTrade(createTrade('BTCUSDT', '50000', '0.1', 1700000000500));
      aggregator.processTrade(createTrade('BTCUSDT', '50100', '0.2', 1700000001200));

      expect(() => aggregator.forceEmitPendingKlineList()).not.toThrow();
    });
  });

  describe('clearSymbol', () => {
    it('removes symbol so next trade goes through first-second skip again', () => {
      const aggregator = new TradeToKlineAggregator(mockLogger);
      const handler = jest.fn();
      aggregator.setHandler(handler);

      aggregator.processTrade(createTrade('BTCUSDT', '50000', '0.1', 1700000000500));
      aggregator.processTrade(createTrade('BTCUSDT', '50100', '0.2', 1700000001200));

      aggregator.clearSymbol('BTCUSDT');

      aggregator.processTrade(createTrade('BTCUSDT', '50200', '0.3', 1700000003500));

      expect(mockLogger.debug).toHaveBeenCalledTimes(2);
    });
  });

  describe('setHandler', () => {
    it('sets handler for kline emissions', () => {
      const aggregator = new TradeToKlineAggregator(mockLogger);
      const handler = jest.fn();

      aggregator.setHandler(handler);
      aggregator.processTrade(createTrade('BTCUSDT', '50000', '0.1', 1700000000500));
      aggregator.processTrade(createTrade('BTCUSDT', '50100', '0.2', 1700000001200));
      aggregator.forceEmitPendingKlineList();

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith('BTCUSDT', expect.objectContaining({
        openPrice: 50100,
        isClosed: true,
      }));
    });
  });
});
