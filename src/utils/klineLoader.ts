import type { ExchangeLogger, Kline } from '../types/common';

export const KLINE_CHUNK_SIZE = 200;

export interface LoadKlinesInChunksArgs {
  fetchKlines: (symbol: string) => Promise<Kline[]>;
  symbolList: string[];
  logger: ExchangeLogger;
  chunkSize?: number;
  pauseBetweenChunksMs?: number;
  trimLastKline?: boolean;
  onChunkLoaded?: (chunkResult: Map<string, Kline[]>) => void;
}

export async function loadKlinesInChunks(args: LoadKlinesInChunksArgs): Promise<Map<string, Kline[]>> {
  const {
    fetchKlines,
    symbolList,
    logger,
    chunkSize = KLINE_CHUNK_SIZE,
    pauseBetweenChunksMs = 0,
    trimLastKline = false,
    onChunkLoaded,
  } = args;

  const klineListBySymbol = new Map<string, Kline[]>();

  for (let i = 0; i < symbolList.length; i += chunkSize) {
    const chunk = symbolList.slice(i, i + chunkSize);

    const chunkResultList = await Promise.all(
      chunk.map(async (symbol) => ({ symbol, klineList: await fetchKlines(symbol) })),
    );

    const chunkResult = new Map<string, Kline[]>();

    for (const { symbol, klineList } of chunkResultList) {
      if (klineList.length === 0) {
        logger.warn(`${symbol} has no klines`);
        continue;
      }

      const processedList = trimLastKline ? klineList.slice(0, -1) : klineList;

      if (processedList.length === 0) {
        logger.warn(`${symbol} has no klines after trim`);
        continue;
      }

      klineListBySymbol.set(symbol, processedList);
      chunkResult.set(symbol, processedList);
    }

    if (onChunkLoaded) {
      onChunkLoaded(chunkResult);
    }

    logger.info(`Loaded klines for ${Math.min(i + chunkSize, symbolList.length)}/${symbolList.length} symbols`);

    if (pauseBetweenChunksMs > 0 && i + chunkSize < symbolList.length) {
      logger.info(`Pause for ${pauseBetweenChunksMs}ms`);
      await new Promise((resolve) => setTimeout(resolve, pauseBetweenChunksMs));
    }
  }

  return klineListBySymbol;
}
