import type { Kline } from '../../src/types/common';
import { loadKlinesInChunks } from '../../src/utils/klineLoader';
import { createMockLogger } from '../fixtures/mockLogger';

function createMockKline(symbol: string): Kline {
  return {
    openTimestamp: 1700000000000,
    open: 100,
    high: 110,
    low: 90,
    close: 105,
    volume: 1000,
    closeTimestamp: 1700003600000,
    quoteVolume: 105000,
    trades: 500,
  };
}

describe('loadKlinesInChunks', () => {
  it('returns empty Map for empty symbolList', async () => {
    const fetchKlines = jest.fn();
    const logger = createMockLogger();

    const result = await loadKlinesInChunks({ fetchKlines, symbolList: [], logger });

    expect(result).toBeInstanceOf(Map);
    expect(result.size).toBe(0);
    expect(fetchKlines).not.toHaveBeenCalled();
  });

  it('calls fetchKlines once for single symbol', async () => {
    const kline = createMockKline('BTCUSDT');
    const fetchKlines = jest.fn().mockResolvedValue([kline]);
    const logger = createMockLogger();

    const result = await loadKlinesInChunks({ fetchKlines, symbolList: ['BTCUSDT'], logger });

    expect(fetchKlines).toHaveBeenCalledTimes(1);
    expect(fetchKlines).toHaveBeenCalledWith('BTCUSDT');
    expect(result.get('BTCUSDT')).toEqual([kline]);
  });

  it('logs progress after each chunk', async () => {
    const fetchKlines = jest.fn().mockResolvedValue([createMockKline('X')]);
    const logger = createMockLogger();

    await loadKlinesInChunks({ fetchKlines, symbolList: ['A'], logger });

    expect(logger.info).toHaveBeenCalledTimes(1);
  });

  it('processes symbols in chunks', async () => {
    const fetchKlines = jest.fn().mockResolvedValue([createMockKline('X')]);
    const logger = createMockLogger();
    const symbolList = ['A', 'B', 'C', 'D', 'E'];

    await loadKlinesInChunks({ fetchKlines, symbolList, logger, chunkSize: 2 });

    expect(fetchKlines).toHaveBeenCalledTimes(5);
    expect(logger.info).toHaveBeenCalledTimes(3);
    expect(logger.info).toHaveBeenCalledWith('Loaded klines for 2/5 symbols');
    expect(logger.info).toHaveBeenCalledWith('Loaded klines for 4/5 symbols');
    expect(logger.info).toHaveBeenCalledWith('Loaded klines for 5/5 symbols');
  });

  it('propagates fetchKlines rejection', async () => {
    const fetchKlines = jest.fn().mockRejectedValue(new Error('Network error'));
    const logger = createMockLogger();

    await expect(
      loadKlinesInChunks({ fetchKlines, symbolList: ['BTCUSDT'], logger }),
    ).rejects.toThrow('Network error');
  });

  it('preserves order of results in Map', async () => {
    const fetchKlines = jest.fn().mockImplementation((symbol: string) =>
      Promise.resolve([createMockKline(symbol)]),
    );
    const logger = createMockLogger();
    const symbolList = ['AAA', 'BBB', 'CCC'];

    const result = await loadKlinesInChunks({ fetchKlines, symbolList, logger, chunkSize: 3 });

    expect([...result.keys()]).toEqual(['AAA', 'BBB', 'CCC']);
  });

  it('uses default chunkSize of 200', async () => {
    const symbols = Array.from({ length: 201 }, (_, i) => `SYM${i}`);
    const fetchKlines = jest.fn().mockResolvedValue([]);
    const logger = createMockLogger();

    await loadKlinesInChunks({ fetchKlines, symbolList: symbols, logger });

    expect(logger.info).toHaveBeenCalledTimes(2);
    expect(logger.info).toHaveBeenCalledWith('Loaded klines for 200/201 symbols');
    expect(logger.info).toHaveBeenCalledWith('Loaded klines for 201/201 symbols');
  });
});
