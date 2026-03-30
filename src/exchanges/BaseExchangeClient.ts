import type {
  ExchangeClient,
  ExchangeArgs,
  FetchAllKlinesOptions,
  FetchPageWithLimitArgs,
  ModifyOrderArgs,
  CreateOrderWebSocketArgs,
  SubscribeKlinesArgs,
} from '../types/exchange';
import type {
  ExchangeLogger,
  Kline,
  KlineInterval,
  TradeSymbol,
  TradeSymbolBySymbol,
  TickerBySymbol,
  AccountBalances,
  Position,
  Order,
  FundingRateHistory,
  FundingInfo,
  WebSocketConnectionInfo,
  OrderBook,
  PublicTrade,
  MarkPrice,
  OpenInterest,
  FeeRate,
  Income,
  ClosedPnl,
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
  protected abstract fetchAndNormalizeBalances(): Promise<AccountBalances>;

  async loadTradeSymbols(): Promise<TradeSymbolBySymbol> {
    const normalized = await this.fetchAndNormalizeTradeSymbols();
    this.tradeSymbols.clear();

    for (const [symbol, tradeSymbol] of normalized) {
      this.tradeSymbols.set(symbol, tradeSymbol);
    }

    this.logger.info(
      { symbolCount: this.tradeSymbols.size },
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

  async fetchBalances(): Promise<AccountBalances> {
    this.logger.debug(`[${this.exchangeLabel}] Fetching balance`);

    return this.fetchAndNormalizeBalances();
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
      return Math.floor(amount);
    }

    return amountToPrecision(tradeSymbol, amount);
  }

  priceToPrecision(symbol: string, price: number): number {
    const tradeSymbol = this.getTradeSymbolOrWarn(symbol, 'priceToPrecision');

    if (!tradeSymbol) {
      return parseFloat(price.toFixed(8));
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

  async cancelOrder(_symbol: string, _orderId: string): Promise<Order> {
    throw new Error(`Not supported for ${this.marketLabel} market`);
  }

  async getOrder(_symbol: string, _orderId: string): Promise<Order> {
    throw new Error(`Not supported for ${this.marketLabel} market`);
  }

  async fetchOpenOrders(_symbol?: string): Promise<Order[]> {
    throw new Error(`Not supported for ${this.marketLabel} market`);
  }

  async fetchOrderBook(_symbol: string, _limit?: number): Promise<OrderBook> {
    throw new Error(`Not supported for ${this.marketLabel} market`);
  }

  async fetchTrades(_symbol: string, _limit?: number): Promise<PublicTrade[]> {
    throw new Error(`Not supported for ${this.marketLabel} market`);
  }

  async modifyOrder(_args: ModifyOrderArgs): Promise<Order> {
    throw new Error(`Not supported for ${this.marketLabel} market`);
  }

  async cancelAllOrders(_symbol: string): Promise<void> {
    throw new Error(`Not supported for ${this.marketLabel} market`);
  }

  async createBatchOrders(_orderList: CreateOrderWebSocketArgs[]): Promise<Order[]> {
    throw new Error(`Not supported for ${this.marketLabel} market`);
  }

  async cancelBatchOrders(_symbol: string, _orderIdList: string[]): Promise<void> {
    throw new Error(`Not supported for ${this.marketLabel} market`);
  }

  async fetchMarkPrice(_symbol?: string): Promise<MarkPrice[]> {
    throw new Error(`Not supported for ${this.marketLabel} market`);
  }

  async fetchOpenInterest(_symbol: string): Promise<OpenInterest> {
    throw new Error(`Not supported for ${this.marketLabel} market`);
  }

  async fetchFeeRate(_symbol?: string): Promise<FeeRate[]> {
    throw new Error(`Not supported for ${this.marketLabel} market`);
  }

  async fetchIncome(_options?: FetchPageWithLimitArgs): Promise<Income[]> {
    throw new Error(`Not supported for ${this.marketLabel} market`);
  }

  async fetchClosedPnl(_symbol?: string, _options?: FetchPageWithLimitArgs): Promise<ClosedPnl[]> {
    throw new Error(`Not supported for ${this.marketLabel} market`);
  }

  async setPositionMode(_mode: PositionModeEnum): Promise<void> {
    throw new Error(`Not supported for ${this.marketLabel} market`);
  }
}

export { BaseExchangeClient };
