import { ReliableWebSocket, WebSocketStatus } from '@solncebro/websocket-engine';

import type { ExchangeLogger, KlineInterval, MarkPriceHandler, PublicTradeHandler, TickerBySymbol, TradeSymbolBySymbol, WebSocketConnectionInfo } from '../types/common';
import { WebSocketConnectionTypeEnum } from '../types/common';
import type { KlineHandler } from '../types/exchange';
import {
  normalizeBinanceAggTradeFromStream,
  normalizeBinanceKlineWebSocketMessage,
  normalizeBinanceMarkPriceWebSocketList,
  normalizeBinanceTickers,
} from '../normalizers/binanceNormalizer';
import type {
  BinanceAggTradeWebSocketRaw,
  BinanceMarkPriceWebSocketRaw,
  BinanceTicker24hrRaw,
  BinanceWebSocketKlineRaw,
} from '../normalizers/binanceNormalizer';
import { resolveUnifiedBinanceInterval } from './binanceWebSocketUtils';
import type { BinanceCombinedMessage, BinanceFuturesPublicStreamArgs, FuturesConnection } from './BinanceFuturesPublicStream.types';
import { parseWebSocketMessage } from './parseWebSocketMessage';
import { chunkList } from '../utils/chunkList';

const DEFAULT_PAUSE_BETWEEN_CONNECTIONS_MS = 1100;
const DEFAULT_STALE_THRESHOLD_MS = 60000;
const DEFAULT_STALE_CHECK_INTERVAL_MS = 5000;
const DEFAULT_RECREATE_DEDUP_WINDOW_MS = 2000;
const POST_RECREATE_GRACE_PERIOD_MS = 60000;
const DEFAULT_SUBSCRIBE_BATCH_SIZE = 50;
const DEFAULT_PAUSE_BETWEEN_SUBSCRIBE_BATCHES_MS = 200;
const DEFAULT_MAX_STREAMS_PER_CONNECTION = 900;
const TRADIFI_CONTRACT_TYPE = 'TRADIFI_PERPETUAL';
const NON_KLINE_GROUP_KEY = 'tickers-markprices';
const AGGTRADE_GROUP_KEY = 'aggTrades';
const BINANCE_PING_REQUEST_ID = 1_000_000;

const buildIntervalGroupKey = (interval: string): string =>
  `interval-${interval}`;

const extractSymbolFromStream = (stream: string): string | undefined => {
  const continuousMatch = stream.match(/^(.+)_perpetual@continuousKline_/);

  if (continuousMatch) {
    return continuousMatch[1].toUpperCase();
  }

  const klineMatch = stream.match(/^(.+)@kline_/);

  if (klineMatch) {
    return klineMatch[1].toUpperCase();
  }

  const aggTradeMatch = stream.match(/^(.+)@aggTrade$/);

  if (aggTradeMatch) {
    return aggTradeMatch[1].toUpperCase();
  }

  return undefined;
};

const pause = (durationMs: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, durationMs));

function buildStreamName(symbol: string, interval: string, tradeSymbols: TradeSymbolBySymbol): string {
  const tradeSymbol = tradeSymbols.get(symbol.toUpperCase());
  const isTradifi = tradeSymbol?.contractType === TRADIFI_CONTRACT_TYPE;

  return isTradifi
    ? `${symbol.toLowerCase()}@kline_${interval}`
    : `${symbol.toLowerCase()}_perpetual@continuousKline_${interval}`;
}

function buildAggTradeStreamName(symbol: string): string {
  return `${symbol.toLowerCase()}@aggTrade`;
}

function toAggTradeRaw(record: Record<string, unknown>): BinanceAggTradeWebSocketRaw | null {
  if (record['e'] !== 'aggTrade' || record['s'] === undefined) {
    return null;
  }

  return {
    e: 'aggTrade',
    E: Number(record['E']),
    s: String(record['s']),
    a: Number(record['a']),
    p: String(record['p']),
    q: String(record['q']),
    f: Number(record['f']),
    l: Number(record['l']),
    T: Number(record['T']),
    m: record['m'] === true,
  };
}

class BinanceFuturesPublicStream {
  private readonly webSocketUrl: string;
  private readonly logger: ExchangeLogger;
  private readonly label: string;
  private readonly onNotify?: (message: string) => void | Promise<void>;
  private readonly pauseBetweenConnectionsMs: number;
  private readonly staleThresholdMs: number;
  private readonly staleCheckIntervalMs: number;
  private readonly subscribeBatchSize: number;
  private readonly pauseBetweenSubscribeBatchesMs: number;
  private readonly maxStreamsPerConnection: number;
  private tradeSymbols: TradeSymbolBySymbol = new Map();
  private readonly tickerHandlerSet: Set<(tickers: TickerBySymbol) => void> = new Set();
  private readonly markPriceHandlerSet: Set<MarkPriceHandler> = new Set();
  private readonly klineHandlerByKey: Map<string, Set<KlineHandler>> = new Map();
  private readonly publicTradeHandlerBySymbol: Map<string, Set<PublicTradeHandler>> = new Map();
  private readonly connectionList: FuturesConnection[] = [];
  private isConnectScheduled = false;
  private subscriptionIdCounter = 1;
  private staleCheckTimerId?: NodeJS.Timeout;
  private connectionsReadyPromise?: Promise<void>;

  constructor(args: BinanceFuturesPublicStreamArgs) {
    this.webSocketUrl = args.webSocketUrl;
    this.logger = args.logger;
    this.onNotify = args.onNotify;
    this.label = args.label;
    this.pauseBetweenConnectionsMs =
      args.pauseBetweenConnectionsMs ?? DEFAULT_PAUSE_BETWEEN_CONNECTIONS_MS;
    this.staleThresholdMs = args.staleThresholdMs ?? DEFAULT_STALE_THRESHOLD_MS;
    this.staleCheckIntervalMs =
      args.staleCheckIntervalMs ?? DEFAULT_STALE_CHECK_INTERVAL_MS;
    this.subscribeBatchSize = args.subscribeBatchSize ?? DEFAULT_SUBSCRIBE_BATCH_SIZE;
    this.pauseBetweenSubscribeBatchesMs =
      args.pauseBetweenSubscribeBatchesMs ?? DEFAULT_PAUSE_BETWEEN_SUBSCRIBE_BATCHES_MS;
    this.maxStreamsPerConnection = args.maxStreamsPerConnection ?? DEFAULT_MAX_STREAMS_PER_CONNECTION;
  }

  setTradeSymbols(tradeSymbols: TradeSymbolBySymbol): void {
    this.tradeSymbols = tradeSymbols;
  }

  // Binance uses aggregate streams (!miniTicker@arr / !markPrice@arr@1s), so the symbol
  // list is accepted for interface parity with Bybit but not used here.
  subscribeAllTickers(handler: (tickers: TickerBySymbol) => void, _symbolList: string[]): void {
    this.tickerHandlerSet.add(handler);

    if (this.connectionList.length > 0) {
      this.addNonKlineStream('!miniTicker@arr');
    } else {
      this.scheduleConnect();
    }
  }

  unsubscribeAllTickers(handler: (tickers: TickerBySymbol) => void): void {
    this.tickerHandlerSet.delete(handler);

    if (this.tickerHandlerSet.size === 0) {
      this.removeStreamFromConnection('!miniTicker@arr');
    }
  }

  subscribeMarkPrices(handler: MarkPriceHandler, _symbolList: string[]): void {
    this.markPriceHandlerSet.add(handler);

    if (this.connectionList.length > 0) {
      this.addNonKlineStream('!markPrice@arr@1s');
    } else {
      this.scheduleConnect();
    }
  }

  unsubscribeMarkPrices(handler: MarkPriceHandler): void {
    this.markPriceHandlerSet.delete(handler);

    if (this.markPriceHandlerSet.size === 0) {
      this.removeStreamFromConnection('!markPrice@arr@1s');
    }
  }

  subscribeKlines(symbol: string, interval: KlineInterval, handler: KlineHandler): void {
    const key = `${symbol}_${interval}`;

    const handlerSet = this.klineHandlerByKey.get(key) ?? new Set<KlineHandler>();
    handlerSet.add(handler);
    this.klineHandlerByKey.set(key, handlerSet);

    if (this.connectionList.length > 0) {
      const stream = buildStreamName(symbol, interval, this.tradeSymbols);
      this.addStreamToIntervalGroup(interval, stream);
    } else {
      this.scheduleConnect();
    }
  }

  unsubscribeKlines(symbol: string, interval: KlineInterval, handler: KlineHandler): void {
    const key = `${symbol}_${interval}`;
    const handlerSet = this.klineHandlerByKey.get(key);

    if (!handlerSet) {
      return;
    }

    handlerSet.delete(handler);

    if (handlerSet.size === 0) {
      this.klineHandlerByKey.delete(key);

      const stream = buildStreamName(symbol, interval, this.tradeSymbols);
      this.removeStreamFromConnection(stream);
    }
  }

  subscribePublicTrades(symbol: string, handler: PublicTradeHandler): void {
    const upperSymbol = symbol.toUpperCase();
    const handlerSet = this.publicTradeHandlerBySymbol.get(upperSymbol) ?? new Set<PublicTradeHandler>();

    handlerSet.add(handler);
    this.publicTradeHandlerBySymbol.set(upperSymbol, handlerSet);

    if (this.connectionList.length > 0) {
      this.addAggTradeStream(buildAggTradeStreamName(symbol));
    } else {
      this.scheduleConnect();
    }
  }

  unsubscribePublicTrades(symbol: string, handler: PublicTradeHandler): void {
    const upperSymbol = symbol.toUpperCase();
    const handlerSet = this.publicTradeHandlerBySymbol.get(upperSymbol);

    if (!handlerSet) {
      return;
    }

    handlerSet.delete(handler);

    if (handlerSet.size === 0) {
      this.publicTradeHandlerBySymbol.delete(upperSymbol);
      this.removeStreamFromConnection(buildAggTradeStreamName(symbol));
    }
  }

  resubscribePublicTrades(symbol: string): void {
    this.resubscribeStreamByName(buildAggTradeStreamName(symbol));
  }

  resubscribeStream(symbol: string, interval: string): void {
    this.resubscribeStreamByName(buildStreamName(symbol, interval, this.tradeSymbols));
  }

  private resubscribeStreamByName(stream: string): void {
    for (let index = 0; index < this.connectionList.length; index++) {
      const connection = this.connectionList[index];

      if (!connection.streamList.includes(stream)) {
        continue;
      }

      if (connection.webSocket.getStatus() !== WebSocketStatus.CONNECTED) {
        this.recreateConnection(index, `manual resubscribe of ${stream} (ws disconnected)`);

        return;
      }

      try {
        connection.webSocket.sendToConnectedSocket({
          method: 'UNSUBSCRIBE',
          params: [stream],
          id: this.subscriptionIdCounter++,
        });
        connection.webSocket.sendToConnectedSocket({
          method: 'SUBSCRIBE',
          params: [stream],
          id: this.subscriptionIdCounter++,
        });
        this.logger.info(`BinanceFuturesPublicStream: light resubscribe ${stream} on ${connection.label}`);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.logger.warn(`BinanceFuturesPublicStream: light resubscribe failed for ${stream} on ${connection.label}, falling back to recreate (${errorMessage})`);
        this.recreateConnection(index, `manual resubscribe of ${stream} (light failed)`);
      }

      return;
    }

    this.logger.warn(`BinanceFuturesPublicStream: stream ${stream} not found in any connection`);
  }

  getConnectionInfoList(): WebSocketConnectionInfo[] {
    return this.connectionList.map((connection) => ({
      label: connection.label,
      url: connection.url,
      isConnected: connection.webSocket.getStatus() === WebSocketStatus.CONNECTED,
      type: WebSocketConnectionTypeEnum.Public,
      subscriptionList: this.buildSubscriptionList(connection),
      messageCount: connection.messageCount,
      lastMessageTimestamp: connection.lastMessageTimestamp,
    }));
  }

  close(): void {
    if (this.staleCheckTimerId) {
      clearInterval(this.staleCheckTimerId);
      this.staleCheckTimerId = undefined;
    }

    for (const connection of this.connectionList) {
      connection.webSocket.close();
    }

    this.connectionList.length = 0;
  }

  async awaitConnectionsReady(): Promise<void> {
    if (this.connectionsReadyPromise) {
      await this.connectionsReadyPromise;
    }

    await Promise.all(this.connectionList.map((connection) => connection.readyPromise));
  }

  private scheduleConnect(): void {
    if (this.isConnectScheduled || this.connectionList.length > 0) {
      return;
    }

    this.isConnectScheduled = true;
    this.connectionsReadyPromise = new Promise<void>((resolve) => {
      queueMicrotask(() => {
        this.isConnectScheduled = false;
        this.createConnections()
          .catch((error) => {
            this.logger.error(
              `BinanceFuturesPublicStream: createConnections failed: ${error instanceof Error ? error.message : String(error)}`,
            );
          })
          .finally(() => {
            resolve();
          });
      });
    });
  }

  private buildStreamListByInterval(): Map<KlineInterval, string[]> {
    const streamListByInterval = new Map<KlineInterval, string[]>();

    for (const key of this.klineHandlerByKey.keys()) {
      const separatorIndex = key.lastIndexOf('_');
      const symbol = key.slice(0, separatorIndex);
      const interval = key.slice(separatorIndex + 1) as KlineInterval;
      const stream = buildStreamName(symbol, interval, this.tradeSymbols);
      const streamList = streamListByInterval.get(interval) ?? [];

      streamList.push(stream);
      streamListByInterval.set(interval, streamList);
    }

    return streamListByInterval;
  }

  private buildNonKlineStreamList(): string[] {
    const tickerStreamList = this.tickerHandlerSet.size > 0 ? ['!miniTicker@arr'] : [];
    const markPriceStreamList = this.markPriceHandlerSet.size > 0 ? ['!markPrice@arr@1s'] : [];

    return [...tickerStreamList, ...markPriceStreamList];
  }

  private buildAggTradeStreamList(): string[] {
    return [...this.publicTradeHandlerBySymbol.keys()].map((symbol) =>
      buildAggTradeStreamName(symbol),
    );
  }

  private async createConnections(): Promise<void> {
    const streamListByInterval = this.buildStreamListByInterval();
    const nonKlineStreamList = this.buildNonKlineStreamList();
    const aggTradeStreamList = this.buildAggTradeStreamList();
    let totalStreamCount = nonKlineStreamList.length + aggTradeStreamList.length;

    for (const [, streamList] of streamListByInterval) {
      totalStreamCount += streamList.length;
    }

    if (totalStreamCount === 0) {
      return;
    }

    let isFirstConnection = true;

    if (nonKlineStreamList.length > 0) {
      this.createConnection({
        streamList: nonKlineStreamList,
        groupKey: NON_KLINE_GROUP_KEY,
      });
      isFirstConnection = false;
    }

    if (aggTradeStreamList.length > 0) {
      if (!isFirstConnection && this.pauseBetweenConnectionsMs > 0) {
        await pause(this.pauseBetweenConnectionsMs);
      }

      this.createConnection({
        streamList: aggTradeStreamList,
        groupKey: AGGTRADE_GROUP_KEY,
      });
      isFirstConnection = false;
    }

    for (const [interval, streamList] of streamListByInterval) {
      const groupKey = buildIntervalGroupKey(interval);

      for (const streamChunk of chunkList(streamList, this.maxStreamsPerConnection)) {
        if (!isFirstConnection && this.pauseBetweenConnectionsMs > 0) {
          await pause(this.pauseBetweenConnectionsMs);
        }

        this.createConnection({ streamList: streamChunk, groupKey });
        isFirstConnection = false;
      }
    }

    this.logger.info(
      `BinanceFuturesPublicStream: created ${this.connectionList.length} connection(s) for ${totalStreamCount} streams (${streamListByInterval.size} interval-groups)`
    );

    this.startStaleWatcher();
  }

  private createConnection(args: { streamList: string[]; groupKey: string }): void {
    const { streamList, groupKey } = args;

    if (streamList.length === 0) {
      return;
    }

    const connectionIndex = this.connectionList.length;
    const connectionLabel = `${this.label} ${groupKey}`;
    const url = this.webSocketUrl;

    let resolveReady: () => void = () => {
      // placeholder; replaced synchronously inside Promise constructor below
    };
    const readyPromise = new Promise<void>((resolve) => {
      resolveReady = resolve;
    });

    const webSocket = this.buildReliableWebSocket({ connectionIndex, connectionLabel, url });

    this.connectionList.push({
      webSocket,
      label: connectionLabel,
      streamList: [...streamList],
      url,
      messageCount: 0,
      lastMessageTimestamp: Date.now(),
      groupKey,
      recreateCount: 0,
      lastRecreateTimestamp: 0,
      readyPromise,
      resolveReady,
    });

    this.logger.info(
      `BinanceFuturesPublicStream: created connection ${groupKey} → ${url} (${streamList.length} streams)`,
    );
  }

  private buildReliableWebSocket(args: {
    connectionIndex: number;
    connectionLabel: string;
    url: string;
  }): ReliableWebSocket<BinanceCombinedMessage> {
    const { connectionIndex, connectionLabel, url } = args;

    return new ReliableWebSocket<BinanceCombinedMessage>({
      label: connectionLabel,
      url,
      logger: this.logger,
      parseMessage: (rawData) => parseWebSocketMessage<BinanceCombinedMessage>(rawData),
      onMessage: (message) => {
        const connection = this.connectionList[connectionIndex];

        if (connection) {
          connection.messageCount++;
          connection.lastMessageTimestamp = Date.now();
        }

        this.handleMessage(message);
      },
      onOpen: async (context) => {
        const connection = this.connectionList[connectionIndex];

        if (!connection) {
          return;
        }

        try {
          if (connection.streamList.length > 0) {
            await this.sendSubscribeBatches(context, connection, connection.streamList);
          }
        } finally {
          if (connection.resolveReady) {
            connection.resolveReady();
            connection.resolveReady = undefined;
          }
        }
      },
      onNotify: this.onNotify,
      heartbeat: {
        buildPayload: () => ({
          method: 'LIST_SUBSCRIPTIONS',
          id: BINANCE_PING_REQUEST_ID,
        }),
        isResponse: (message) => {
          const record = message as Record<string, unknown>;

          return (
            record['id'] === BINANCE_PING_REQUEST_ID &&
            Array.isArray(record['result'])
          );
        },
      },
      configuration: {
        pingInterval: 30000,
      },
    });
  }

  private async sendSubscribeBatches(
    context: { send: (message: unknown) => void },
    connection: FuturesConnection,
    streamList: string[],
  ): Promise<void> {
    let batchCount = 0;
    let sentCount = 0;

    while (sentCount < streamList.length) {
      const batch = streamList.slice(sentCount, sentCount + this.subscribeBatchSize);
      sentCount += batch.length;
      batchCount++;

      try {
        context.send({
          method: 'SUBSCRIBE',
          params: batch,
          id: this.subscriptionIdCounter++,
        });
      } catch (error) {
        this.logger.warn(
          `BinanceFuturesPublicStream: ${connection.label} SUBSCRIBE batch ${batchCount} failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      const hasMoreStreams = sentCount < streamList.length;

      if (hasMoreStreams && this.pauseBetweenSubscribeBatchesMs > 0) {
        await pause(this.pauseBetweenSubscribeBatchesMs);
      }
    }

    this.logger.info(
      `BinanceFuturesPublicStream: ${connection.label} sent ${batchCount} SUBSCRIBE batch(es) for ${sentCount} streams`,
    );
  }

  private startStaleWatcher(): void {
    if (this.staleCheckTimerId) {
      return;
    }

    this.staleCheckTimerId = setInterval(() => {
      this.checkStaleConnections().catch((error) => {
        this.logger.warn(
          `BinanceFuturesPublicStream: checkStaleConnections failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    }, this.staleCheckIntervalMs);
  }

  private async checkStaleConnections(): Promise<void> {
    const nowTimestamp = Date.now();
    const staleIndexList: number[] = [];

    for (let index = 0; index < this.connectionList.length; index++) {
      const connection = this.connectionList[index];

      if (!connection || connection.streamList.length === 0) {
        continue;
      }

      const ageMs = nowTimestamp - connection.lastMessageTimestamp;

      if (ageMs <= this.staleThresholdMs) {
        continue;
      }

      const sinceRecreateMs = nowTimestamp - connection.lastRecreateTimestamp;

      if (
        connection.lastRecreateTimestamp > 0 &&
        sinceRecreateMs < POST_RECREATE_GRACE_PERIOD_MS
      ) {
        continue;
      }

      staleIndexList.push(index);
    }

    for (let i = 0; i < staleIndexList.length; i++) {
      const index = staleIndexList[i];
      const connection = this.connectionList[index];

      if (!connection) {
        continue;
      }

      const ageMs = Date.now() - connection.lastMessageTimestamp;

      if (ageMs <= this.staleThresholdMs) {
        continue;
      }

      this.recreateConnection(index, `stale ${Math.floor(ageMs / 1000)}s`);

      const isLast = i === staleIndexList.length - 1;

      if (!isLast && this.pauseBetweenConnectionsMs > 0) {
        await pause(this.pauseBetweenConnectionsMs);
      }
    }
  }

  private buildSymbolPreviewSuffix(connection: FuturesConnection): string {
    const symbolSet = new Set<string>();

    for (const stream of connection.streamList) {
      const symbol = extractSymbolFromStream(stream);

      if (symbol !== undefined) {
        symbolSet.add(symbol);
      }

      if (symbolSet.size >= 5) {
        break;
      }
    }

    if (symbolSet.size === 0) {
      return '';
    }

    const sortedSymbolList = [...symbolSet].sort();
    const totalUnique = this.calcUniqueSymbolCount(connection);
    const remaining = totalUnique - sortedSymbolList.length;
    const more = remaining > 0 ? `, +${remaining} more` : '';

    return `, symbols: ${sortedSymbolList.join(', ')}${more}`;
  }

  private recreateConnection(connectionIndex: number, reason: string): void {
    const connection = this.connectionList[connectionIndex];

    if (!connection) {
      return;
    }

    const nowTimestamp = Date.now();
    const recentRecreateAgeMs = nowTimestamp - connection.lastRecreateTimestamp;

    if (
      connection.lastRecreateTimestamp > 0 &&
      recentRecreateAgeMs < DEFAULT_RECREATE_DEDUP_WINDOW_MS
    ) {
      this.logger.info(
        `BinanceFuturesPublicStream: skip recreate ${connection.label} (recent recreate ${recentRecreateAgeMs}ms ago, reason: ${reason})`,
      );

      return;
    }

    const previousMessageCount = connection.messageCount;
    const recreateNumber = connection.recreateCount + 1;
    const streamCount = connection.streamList.length;
    const symbolSuffix = this.buildSymbolPreviewSuffix(connection);

    this.logger.warn(
      `BinanceFuturesPublicStream: recreating ${connection.label} (reason: ${reason}, prev messages: ${previousMessageCount}, recreate #${recreateNumber}, streams: ${streamCount}${symbolSuffix})`,
    );

    const notifyMessage = `[${connection.label}] WARN: recreating connection — reason: ${reason}, prev messages: ${previousMessageCount}, recreate #${recreateNumber}, streams: ${streamCount}${symbolSuffix}`;
    const notifyResult = this.onNotify?.(notifyMessage);

    if (notifyResult instanceof Promise) {
      notifyResult.catch((error) => {
        this.logger.warn(
          `BinanceFuturesPublicStream: onNotify failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    }

    try {
      connection.webSocket.close();
    } catch (error) {
      this.logger.warn(
        `BinanceFuturesPublicStream: failed to close ${connection.label}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    let resolveReady: () => void = () => {
      // placeholder; replaced synchronously inside Promise constructor below
    };
    const readyPromise = new Promise<void>((resolve) => {
      resolveReady = resolve;
    });

    const newWebSocket = this.buildReliableWebSocket({
      connectionIndex,
      connectionLabel: connection.label,
      url: connection.url,
    });

    this.connectionList[connectionIndex] = {
      ...connection,
      webSocket: newWebSocket,
      messageCount: 0,
      lastMessageTimestamp: nowTimestamp,
      recreateCount: recreateNumber,
      lastRecreateTimestamp: nowTimestamp,
      readyPromise,
      resolveReady,
    };
  }

  private calcUniqueSymbolCount(connection: FuturesConnection): number {
    const symbolSet = new Set<string>();

    for (const stream of connection.streamList) {
      const symbol = extractSymbolFromStream(stream);

      if (symbol !== undefined) {
        symbolSet.add(symbol);
      }
    }

    return symbolSet.size;
  }

  private addNonKlineStream(stream: string): void {
    const targetConnection = this.connectionList.find(
      (connection) => connection.groupKey === NON_KLINE_GROUP_KEY,
    );

    if (!targetConnection) {
      this.createConnection({
        streamList: [stream],
        groupKey: NON_KLINE_GROUP_KEY,
      });

      return;
    }

    if (targetConnection.streamList.includes(stream)) {
      return;
    }

    targetConnection.streamList.push(stream);
    this.sendDynamicSubscribe(targetConnection, stream);
  }

  private addAggTradeStream(stream: string): void {
    const targetConnection = this.connectionList.find(
      (connection) => connection.groupKey === AGGTRADE_GROUP_KEY,
    );

    if (!targetConnection) {
      this.createConnection({
        streamList: [stream],
        groupKey: AGGTRADE_GROUP_KEY,
      });

      return;
    }

    if (targetConnection.streamList.includes(stream)) {
      return;
    }

    targetConnection.streamList.push(stream);
    this.sendDynamicSubscribe(targetConnection, stream);
  }

  private addStreamToIntervalGroup(interval: KlineInterval, stream: string): void {
    const groupKey = buildIntervalGroupKey(interval);
    const groupConnectionList = this.connectionList.filter(
      (connection) => connection.groupKey === groupKey,
    );

    if (groupConnectionList.some((connection) => connection.streamList.includes(stream))) {
      return;
    }

    const targetConnection = groupConnectionList.find(
      (connection) => connection.streamList.length < this.maxStreamsPerConnection,
    );

    if (!targetConnection) {
      this.createConnection({
        streamList: [stream],
        groupKey,
      });

      return;
    }

    targetConnection.streamList.push(stream);
    this.sendDynamicSubscribe(targetConnection, stream);
  }

  private sendDynamicSubscribe(connection: FuturesConnection, stream: string): void {
    if (connection.resolveReady !== undefined) {
      return;
    }

    const message = {
      method: 'SUBSCRIBE',
      params: [stream],
      id: this.subscriptionIdCounter++,
    };

    try {
      connection.webSocket.sendToConnectedSocket(message);
    } catch {
      this.logger.warn(
        `BinanceFuturesPublicStream: ${connection.label} SUBSCRIBE failed for ${stream}, socket not connected`,
      );
    }
  }

  private removeStreamFromConnection(stream: string): void {
    for (const connection of this.connectionList) {
      const index = connection.streamList.indexOf(stream);

      if (index !== -1) {
        connection.streamList.splice(index, 1);

        try {
          connection.webSocket.sendToConnectedSocket({
            method: 'UNSUBSCRIBE',
            params: [stream],
            id: this.subscriptionIdCounter++,
          });
        } catch {
          this.logger.warn('BinanceFuturesPublicStream: failed to unsubscribe, socket not connected');
        }

        break;
      }
    }
  }

  private buildSubscriptionList(connection: FuturesConnection): string[] {
    const result: string[] = [];

    for (const stream of connection.streamList) {
      if (stream === '!markPrice@arr@1s') {
        result.push('MarkPrices');

        continue;
      }

      if (stream === '!miniTicker@arr') {
        result.push('Tickers');

        continue;
      }

      const continuousMatch = stream.match(/^(.+)_perpetual@continuousKline_(.+)$/);

      if (continuousMatch) {
        const symbol = continuousMatch[1].toUpperCase();
        const interval = resolveUnifiedBinanceInterval(continuousMatch[2]);
        result.push(`Klines ${symbol} ${interval}`);

        continue;
      }

      const klineMatch = stream.match(/^(.+)@kline_(.+)$/);

      if (klineMatch) {
        const symbol = klineMatch[1].toUpperCase();
        const interval = resolveUnifiedBinanceInterval(klineMatch[2]);
        result.push(`Klines ${symbol} ${interval}`);

        continue;
      }

      const aggTradeMatch = stream.match(/^(.+)@aggTrade$/);

      if (aggTradeMatch) {
        result.push(`Trades ${aggTradeMatch[1].toUpperCase()}`);
      }
    }

    return result;
  }

  private handleKlineStream(message: BinanceCombinedMessage, delimiter: string, isContinuous: boolean): void {
    const klineRaw = (message.data as Record<string, unknown>)['k'] as BinanceWebSocketKlineRaw;

    if (!klineRaw || !message.stream) {
      return;
    }

    const kline = normalizeBinanceKlineWebSocketMessage(klineRaw);
    const delimiterIndex = message.stream.indexOf(delimiter);
    const symbolPart = message.stream.slice(0, delimiterIndex);
    const symbolLower = isContinuous ? symbolPart.replace(/_perpetual$/, '') : symbolPart;
    const symbol = symbolLower.toUpperCase();
    const binanceInterval = message.stream.slice(delimiterIndex + delimiter.length);
    const unifiedInterval = resolveUnifiedBinanceInterval(binanceInterval);
    const key = `${symbol}_${unifiedInterval}`;
    const handlerSet = this.klineHandlerByKey.get(key);

    if (handlerSet) {
      for (const handler of handlerSet) {
        handler(symbol, kline);
      }
    }
  }

  private handleAggTradeMessage(record: Record<string, unknown>): void {
    const raw = toAggTradeRaw(record);

    if (raw === null) {
      return;
    }

    const trade = normalizeBinanceAggTradeFromStream(raw);
    const handlerSet = this.publicTradeHandlerBySymbol.get(trade.symbol);

    if (!handlerSet) {
      return;
    }

    for (const handler of handlerSet) {
      handler(trade.symbol, [trade]);
    }
  }

  private handleMessage(message: BinanceCombinedMessage): void {
    const messageRecord = message as Record<string, unknown>;

    if (
      messageRecord['result'] === null &&
      typeof messageRecord['id'] === 'number'
    ) {
      return;
    }

    if (messageRecord['error'] !== undefined) {
      this.logger.warn(
        `BinanceFuturesPublicStream: error response: ${JSON.stringify(message).slice(0, 300)}`,
      );

      return;
    }

    try {
      if (Array.isArray(message)) {
        this.handleRawArrayMessage(message as unknown as Record<string, unknown>[]);

        return;
      }

      if (message.data !== undefined) {
        this.handleCombinedMessage(message);

        return;
      }

      this.handleRawObjectMessage(messageRecord);
    } catch (error) {
      this.logger.error(`BinanceFuturesPublicStream: error handling message: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private handleCombinedMessage(message: BinanceCombinedMessage): void {
    if (message.data === undefined) {
      return;
    }

    if (message.stream === '!markPrice@arr@1s' && Array.isArray(message.data)) {
      const markPriceList = normalizeBinanceMarkPriceWebSocketList(
        message.data as BinanceMarkPriceWebSocketRaw[],
      );

      for (const handler of this.markPriceHandlerSet) {
        handler(markPriceList);
      }

      return;
    }

    if (Array.isArray(message.data)) {
      const tickerBySymbol = normalizeBinanceTickers(message.data as BinanceTicker24hrRaw[]);

      for (const handler of this.tickerHandlerSet) {
        handler(tickerBySymbol);
      }

      return;
    }

    if (message.stream && message.stream.includes('@aggTrade')) {
      this.handleAggTradeMessage(message.data as Record<string, unknown>);

      return;
    }

    if (message.stream && message.stream.includes('@continuousKline_')) {
      this.handleKlineStream(message, '@continuousKline_', true);
    } else if (message.stream && message.stream.includes('@kline_')) {
      this.handleKlineStream(message, '@kline_', false);
    }
  }

  private handleRawArrayMessage(items: Record<string, unknown>[]): void {
    if (items.length === 0) {
      return;
    }

    const firstEvent = items[0]['e'];

    if (firstEvent === 'markPriceUpdate') {
      const markPriceList = normalizeBinanceMarkPriceWebSocketList(
        items as unknown as BinanceMarkPriceWebSocketRaw[],
      );

      for (const handler of this.markPriceHandlerSet) {
        handler(markPriceList);
      }

      return;
    }

    if (firstEvent === '24hrMiniTicker') {
      const tickerBySymbol = normalizeBinanceTickers(
        items as unknown as BinanceTicker24hrRaw[],
      );

      for (const handler of this.tickerHandlerSet) {
        handler(tickerBySymbol);
      }
    }
  }

  private handleRawObjectMessage(messageRecord: Record<string, unknown>): void {
    const eventType = messageRecord['e'];

    if (eventType === 'aggTrade') {
      this.handleAggTradeMessage(messageRecord);

      return;
    }

    const isContinuousKline =
      eventType === 'continuous_kline' || eventType === 'continuousKline';
    const isKline = eventType === 'kline';

    if (!isContinuousKline && !isKline) {
      return;
    }

    const klineRaw = messageRecord['k'] as BinanceWebSocketKlineRaw | undefined;

    if (!klineRaw) {
      return;
    }

    const kline = normalizeBinanceKlineWebSocketMessage(klineRaw);
    const symbolFieldName = isContinuousKline ? 'ps' : 's';
    const symbol = String(messageRecord[symbolFieldName] ?? '').toUpperCase();

    if (symbol.length === 0) {
      return;
    }

    const binanceInterval = String(klineRaw['i'] ?? '');

    if (binanceInterval.length === 0) {
      return;
    }

    const unifiedInterval = resolveUnifiedBinanceInterval(binanceInterval);
    const key = `${symbol}_${unifiedInterval}`;
    const handlerSet = this.klineHandlerByKey.get(key);

    if (handlerSet) {
      for (const handler of handlerSet) {
        handler(symbol, kline);
      }
    }
  }
}

export { BinanceFuturesPublicStream };
