import type { ExchangeLogger, Kline } from '../types/common';

export const KLINE_CHUNK_SIZE = 200;

export interface LoadKlinesInChunksArgs {
  fetchKlines: (symbol: string) => Promise<Kline[]>;
  symbolList: string[];
  logger: ExchangeLogger;
  chunkSize?: number;
}

export async function loadKlinesInChunks(args: LoadKlinesInChunksArgs): Promise<Map<string, Kline[]>> {
  const { fetchKlines, symbolList, logger, chunkSize = KLINE_CHUNK_SIZE } = args;
  const klineListBySymbol = new Map<string, Kline[]>();

  for (let i = 0; i < symbolList.length; i += chunkSize) {
    const chunk = symbolList.slice(i, i + chunkSize);

    const chunkResultList = await Promise.all(
      chunk.map(async (symbol) => ({ symbol, klineList: await fetchKlines(symbol) })),
    );

    for (const { symbol, klineList } of chunkResultList) {
      klineListBySymbol.set(symbol, klineList);
    }

    logger.info(`Loaded klines for ${Math.min(i + chunkSize, symbolList.length)}/${symbolList.length} symbols`);
  }

  return klineListBySymbol;
}
