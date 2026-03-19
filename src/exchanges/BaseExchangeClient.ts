import type {
  ExchangeClient,
  ExchangeArgs,
  FetchAllKlinesOptions,
  FetchPageWithLimitArgs,
  SubscribeKlinesArgs,
} from '../types/exchange';
import type {
  ExchangeLogger,
  Kline,
  KlineInterval,
  TradeSymbol,
  TradeSymbolBySymbol,
  TickerBySymbol,
  BalanceByAsset,
  Position,
  Order,
  FundingRateHistory,
  FundingInfo,
  WebSocketConnectionInfo,
} from '../types/common';
import { MarginModeEnum, PositionModeEnum } from '../types/common';
import type { PublicStreamLike } from '../types/stream';
import { loadKlinesInChunks } from '../utils/klineLoader';
import { amountToPrecision, priceToPrecision } from '../precision/precision';

abstract class BaseExchangeClient implements ExchangeClient {
  readonly apiKey: string;
  readonly tradeSymbols: TradeSymbolBySymbol = new Map();

  protected readonly logger: ExchangeLogger;
  protected readonly onNotify?: (message: string) => void | Promise<void>;

  protected abstract readonly exchangeLabel: string;
  protected abstract readonly marketLabel: string;
  protected abstract readonly klineLimit: number;

  constructor(args: ExchangeArgs) {
    this.apiKey = args.config.apiKey;
    this.logger = args.logger;
    this.onNotify = args.onNotify;
  }

  protected abstract getPublicStream(): PublicStreamLike;
  protected abstract fetchAndNormalizeTradeSymbols(): Promise<TradeSymbolBySymbol>;
  protected abstract fetchAndNormalizeTickers(): Promise<TickerBySymbol>;
  protected abstract fetchAndNormalizeKlines(
    symbol: string,
    interval: KlineInterval,
    options?: FetchPageWithLimitArgs,
  ): Promise<Kline[]>;
  protected abstract fetchAndNormalizeBalance(): Promise<BalanceByAsset>;

  async loadTradeSymbols(): Promise<TradeSymbolBySymbol> {
    const normalized = await this.fetchAndNormalizeTradeSymbols();
    this.tradeSymbols.clear();

    for (const [symbol, tradeSymbol] of normalized) {
      this.tradeSymbols.set(symbol, tradeSymbol);
    }

    const symbolList = [...this.tradeSymbols.keys()];
    this.logger.info(
      { symbolCount: this.tradeSymbols.size, symbolList },
      `[${this.exchangeLabel}] Fetched ${this.tradeSymbols.size} ${this.marketLabel} trade symbols`,
    );

    return this.tradeSymbols;
  }

  async fetchTickers(): Promise<TickerBySymbol> {
    this.logger.debug(`[${this.exchangeLabel}] Fetching ${this.marketLabel} tickers`);

    return this.fetchAndNormalizeTickers();
  }

  async fetchKlines(
    symbol: string,
    interval: KlineInterval,
    options?: FetchPageWithLimitArgs,
  ): Promise<Kline[]> {
    this.logger.debug(`[${this.exchangeLabel}] Fetching klines for ${symbol} ${interval}`);
    const resolvedOptions: FetchPageWithLimitArgs = {
      ...options,
      limit: options?.limit ?? this.klineLimit,
    };

    return this.fetchAndNormalizeKlines(symbol, interval, resolvedOptions);
  }

  async fetchAllKlines(
    symbolList: string[],
    interval: KlineInterval,
    options?: FetchAllKlinesOptions,
  ): Promise<Map<string, Kline[]>> {
    return loadKlinesInChunks({
      fetchKlines: (symbol) => this.fetchKlines(symbol, interval),
      symbolList,
      logger: this.logger,
      chunkSize: options?.chunkSize,
      pauseBetweenChunksMs: options?.pauseBetweenChunksMs,
      trimLastKline: options?.trimLastKline,
      onChunkLoaded: options?.onChunkLoaded,
    });
  }

  async fetchBalance(): Promise<BalanceByAsset> {
    this.logger.debug(`[${this.exchangeLabel}] Fetching balance`);

    return this.fetchAndNormalizeBalance();
  }

  async *watchTickers(): AsyncGenerator<TickerBySymbol> {
    this.getPublicStream().subscribeAllTickers(() => {});

    yield await this.fetchTickers();
  }

  subscribeKlines(args: SubscribeKlinesArgs): void {
    this.getPublicStream().subscribeKlines(args.symbol, args.interval, args.handler);
  }

  unsubscribeKlines(args: SubscribeKlinesArgs): void {
    this.getPublicStream().unsubscribeKlines(args.symbol, args.interval, args.handler);
  }

  amountToPrecision(symbol: string, amount: number): number {
    const tradeSymbol = this.getTradeSymbolOrWarn(symbol, 'amountToPrecision');

    if (!tradeSymbol) {
      return amount;
    }

    return amountToPrecision(tradeSymbol, amount);
  }

  priceToPrecision(symbol: string, price: number): number {
    const tradeSymbol = this.getTradeSymbolOrWarn(symbol, 'priceToPrecision');

    if (!tradeSymbol) {
      return price;
    }

    return priceToPrecision(tradeSymbol, price);
  }

  getMinOrderQty(symbol: string): number {
    const tradeSymbol = this.getTradeSymbolOrWarn(symbol, 'getMinOrderQty');

    if (!tradeSymbol) {
      return 0;
    }

    return parseFloat(tradeSymbol.filter.minQty);
  }

  getMinNotional(symbol: string): number {
    const tradeSymbol = this.getTradeSymbolOrWarn(symbol, 'getMinNotional');

    if (!tradeSymbol) {
      return 0;
    }

    return parseFloat(tradeSymbol.filter.minNotional);
  }

  private getTradeSymbolOrWarn(symbol: string, methodName: string): TradeSymbol | null {
    const tradeSymbol = this.tradeSymbols.get(symbol);

    if (!tradeSymbol) {
      this.logger.warn(
        { symbol, loadedSymbolCount: this.tradeSymbols.size, availableSymbolList: [...this.tradeSymbols.keys()] },
        `[${this.exchangeLabel}] TradeSymbol ${symbol} not found for ${methodName}`,
      );

      return null;
    }

    return tradeSymbol;
  }

  abstract getWebSocketConnectionInfoList(): WebSocketConnectionInfo[];
  abstract isTradeWebSocketConnected(): boolean;
  abstract connectTradeWebSocket(): Promise<void>;

  abstract createOrderWebSocket(...args: Parameters<ExchangeClient['createOrderWebSocket']>): ReturnType<ExchangeClient['createOrderWebSocket']>;
  abstract close(): Promise<void>;

  async fetchOrderHistory(_symbol: string, _options?: FetchPageWithLimitArgs): Promise<Order[]> {
    throw new Error(`Not supported for ${this.marketLabel} market`);
  }

  async fetchFundingRateHistory(_symbol: string, _options?: FetchPageWithLimitArgs): Promise<FundingRateHistory[]> {
    throw new Error(`Not supported for ${this.marketLabel} market`);
  }

  async fetchFundingInfo(_symbol?: string): Promise<FundingInfo[]> {
    throw new Error(`Not supported for ${this.marketLabel} market`);
  }

  async fetchPositionMode(): Promise<PositionModeEnum> {
    throw new Error(`Not supported for ${this.marketLabel} market`);
  }

  async fetchPosition(_symbol: string): Promise<Position> {
    throw new Error(`Not supported for ${this.marketLabel} market`);
  }

  async setLeverage(_leverage: number, _symbol: string): Promise<void> {
    throw new Error(`Not supported for ${this.marketLabel} market`);
  }

  async setMarginMode(_marginMode: MarginModeEnum, _symbol: string): Promise<void> {
    throw new Error(`Not supported for ${this.marketLabel} market`);
  }
}

export { BaseExchangeClient };
