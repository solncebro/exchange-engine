import type { ReliableWebSocket } from '@solncebro/websocket-engine';

import type { ExchangeLogger } from '../types/common';

export interface BinanceFuturesPublicStreamArgs {
  webSocketUrl: string;
  logger: ExchangeLogger;
  onNotify?: (message: string) => void | Promise<void>;
  label: string;
  pauseBetweenConnectionsMs?: number;
  staleThresholdMs?: number;
  staleCheckIntervalMs?: number;
  subscribeBatchSize?: number;
  pauseBetweenSubscribeBatchesMs?: number;
}

export interface BinanceCombinedMessage {
  stream?: string;
  data?: unknown;
}

export interface FuturesConnection {
  webSocket: ReliableWebSocket<BinanceCombinedMessage>;
  label: string;
  streamList: string[];
  url: string;
  messageCount: number;
  lastMessageTimestamp: number;
  groupKey: string;
  recreateCount: number;
  lastRecreateTimestamp: number;
  readyPromise: Promise<void>;
  resolveReady?: () => void;
}
