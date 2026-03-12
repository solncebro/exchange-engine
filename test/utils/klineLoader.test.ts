import type { Kline } from '../../src/types/common';
import { loadKlinesInChunks } from '../../src/utils/klineLoader';
import { createMockLogger } from '../fixtures/mockLogger';

function createMockKline(_symbol: string): Kline {
  return {
    openTimestamp: 1700000000000,
    openPrice: 100,
    highPrice: 110,
    lowPrice: 90,
    closePrice: 105,
    volume: 1000,
    closeTimestamp: 1700003600000,
    quoteAssetVolume: 105000,
    numberOfTrades: 500,
    takerBuyBaseAssetVolume: 400,
    takerBuyQuoteAssetVolume: 42000,
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

  it('warns and skips symbols with empty klines', async () => {
    const fetchKlines = jest.fn().mockResolvedValue([]);
    const logger = createMockLogger();

    const result = await loadKlinesInChunks({ fetchKlines, symbolList: ['BTCUSDT'], logger });

    expect(result.size).toBe(0);
    expect(logger.warn).toHaveBeenCalledWith('BTCUSDT has no klines');
  });

  it('trims last kline when trimLastKline is true', async () => {
    const kline1 = createMockKline('A');
    const kline2 = { ...createMockKline('A'), openTimestamp: 1700003600000 };
    const fetchKlines = jest.fn().mockResolvedValue([kline1, kline2]);
    const logger = createMockLogger();

    const result = await loadKlinesInChunks({ fetchKlines, symbolList: ['BTCUSDT'], logger, trimLastKline: true });

    expect(result.get('BTCUSDT')).toEqual([kline1]);
  });

  it('warns and skips when trimLastKline leaves empty list', async () => {
    const fetchKlines = jest.fn().mockResolvedValue([createMockKline('A')]);
    const logger = createMockLogger();

    const result = await loadKlinesInChunks({ fetchKlines, symbolList: ['BTCUSDT'], logger, trimLastKline: true });

    expect(result.size).toBe(0);
    expect(logger.warn).toHaveBeenCalledWith('BTCUSDT has no klines after trim');
  });

  it('calls onChunkLoaded callback for each chunk', async () => {
    const fetchKlines = jest.fn().mockResolvedValue([createMockKline('X')]);
    const logger = createMockLogger();
    const onChunkLoaded = jest.fn();

    await loadKlinesInChunks({ fetchKlines, symbolList: ['A', 'B', 'C'], logger, chunkSize: 2, onChunkLoaded });

    expect(onChunkLoaded).toHaveBeenCalledTimes(2);
    expect(onChunkLoaded.mock.calls[0][0]).toBeInstanceOf(Map);
    expect(onChunkLoaded.mock.calls[0][0].size).toBe(2);
    expect(onChunkLoaded.mock.calls[1][0].size).toBe(1);
  });

  it('pauses between chunks when pauseBetweenChunksMs is set', async () => {
    jest.useFakeTimers();
    const fetchKlines = jest.fn().mockResolvedValue([createMockKline('X')]);
    const logger = createMockLogger();

    const promise = loadKlinesInChunks({ fetchKlines, symbolList: ['A', 'B', 'C'], logger, chunkSize: 2, pauseBetweenChunksMs: 500 });

    await jest.advanceTimersByTimeAsync(500);
    await promise;

    expect(logger.info).toHaveBeenCalledWith('Pause for 500ms');
    jest.useRealTimers();
  });

  it('does not pause after last chunk', async () => {
    jest.useFakeTimers();
    const fetchKlines = jest.fn().mockResolvedValue([createMockKline('X')]);
    const logger = createMockLogger();

    const promise = loadKlinesInChunks({ fetchKlines, symbolList: ['A', 'B'], logger, chunkSize: 2, pauseBetweenChunksMs: 500 });

    await promise;

    expect(logger.info).not.toHaveBeenCalledWith(expect.stringContaining('Pause'));
    jest.useRealTimers();
  });
});
