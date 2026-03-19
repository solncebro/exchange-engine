import type { ExchangeLogger, Kline } from '../types/common';
import type { KlineHandler } from '../types/exchange';
import type { BybitPublicTradeDataRaw } from '../normalizers/bybitNormalizer';
import type { AggregatedKline } from './TradeToKlineAggregator.types';

class TradeToKlineAggregator {
  private readonly logger: ExchangeLogger;
  private readonly klineBySymbol: Map<string, AggregatedKline> = new Map();
  private readonly initializedSymbolSet: Set<string> = new Set();
  private handler: KlineHandler | null = null;

  constructor(logger: ExchangeLogger) {
    this.logger = logger;
  }

  setHandler(handler: KlineHandler): void {
    this.handler = handler;
  }

  processTrade(tradeData: BybitPublicTradeDataRaw): void {
    const { s: symbol, p: priceString, v: volumeString, T: timestamp } = tradeData;
    const openTimestamp = Math.floor(timestamp / 1000) * 1000;
    const isSymbolInitialized = this.initializedSymbolSet.has(symbol);

    if (!isSymbolInitialized) {
      const nextSecondTimestamp = openTimestamp + 1000;

      this.logger.debug(
        { symbol, skippedOpenTimestamp: openTimestamp, nextValidOpenTimestamp: nextSecondTimestamp },
        'Skipped incomplete kline for trade aggregation'
      );

      this.initializedSymbolSet.add(symbol);
      this.klineBySymbol.set(symbol, {
        symbol,
        openPrice: 0,
        highPrice: 0,
        lowPrice: 0,
        closePrice: 0,
        volume: 0,
        openTimestamp: nextSecondTimestamp,
        closeTimestamp: nextSecondTimestamp + 999,
        quoteAssetVolume: 0,
        numberOfTrades: 0,
        takerBuyBaseAssetVolume: 0,
        takerBuyQuoteAssetVolume: 0,
      });

      return;
    }

    const price = Number(priceString);
    const volume = Number(volumeString);
    const existingKline = this.klineBySymbol.get(symbol);

    if (!existingKline) {
      return;
    }

    if (existingKline.openTimestamp !== openTimestamp) {
      if (openTimestamp < existingKline.openTimestamp) {
        return;
      }

      if (existingKline.volume > 0) {
        this.emitKline(existingKline);
      }

      this.klineBySymbol.set(symbol, {
        symbol,
        openPrice: price,
        highPrice: price,
        lowPrice: price,
        closePrice: price,
        volume,
        openTimestamp,
        closeTimestamp: openTimestamp + 999,
        quoteAssetVolume: 0,
        numberOfTrades: 0,
        takerBuyBaseAssetVolume: 0,
        takerBuyQuoteAssetVolume: 0,
      });

      return;
    }

    if (existingKline.volume === 0) {
      existingKline.openPrice = price;
      existingKline.highPrice = price;
      existingKline.lowPrice = price;
      existingKline.closePrice = price;
      existingKline.volume = volume;

      return;
    }

    existingKline.highPrice = Math.max(existingKline.highPrice, price);
    existingKline.lowPrice = Math.min(existingKline.lowPrice, price);
    existingKline.closePrice = price;
    existingKline.volume += volume;
  }

  private emitKline(aggregatedKline: AggregatedKline): void {
    if (!this.handler) {
      return;
    }

    const kline: Kline = {
      openTimestamp: aggregatedKline.openTimestamp,
      openPrice: aggregatedKline.openPrice,
      highPrice: aggregatedKline.highPrice,
      lowPrice: aggregatedKline.lowPrice,
      closePrice: aggregatedKline.closePrice,
      volume: aggregatedKline.volume,
      closeTimestamp: aggregatedKline.closeTimestamp,
      quoteAssetVolume: 0,
      numberOfTrades: 0,
      takerBuyBaseAssetVolume: 0,
      takerBuyQuoteAssetVolume: 0,
      isClosed: true,
    };

    this.handler(aggregatedKline.symbol, kline);
  }

  forceEmitPendingKlineList(): void {
    for (const kline of this.klineBySymbol.values()) {
      this.emitKline(kline);
    }

    this.klineBySymbol.clear();
  }

  clearSymbol(symbol: string): void {
    this.klineBySymbol.delete(symbol);
    this.initializedSymbolSet.delete(symbol);
  }
}

export { TradeToKlineAggregator };
