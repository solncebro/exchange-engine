import type { ReliableWebSocket } from '@solncebro/websocket-engine';

import type { ExchangeLogger } from '../types/common';
import type { OutboundCommandQueue } from './OutboundCommandQueue';

export interface BinanceFuturesPublicStreamArgs {
  webSocketUrl: string;
  /** Endpoint of the order-book connection. The market endpoint (`/market/ws`) confirms a depth
   *  SUBSCRIBE and then sends nothing — verified live 06.09.2026 for BTCUSDT and 1000000BOBUSDT — while
   *  the combined endpoint (`/stream`) streams the book wrapped as `{ stream, data }`, the shape the
   *  depth routing reads. Defaults to `webSocketUrl` for callers that pass nothing. */
  orderbookWebSocketUrl?: string;
  logger: ExchangeLogger;
  onNotify?: (message: string) => void | Promise<void>;
  label: string;
  pauseBetweenConnectionsMs?: number;
  staleThresholdMs?: number;
  staleCheckIntervalMs?: number;
  subscribeBatchSize?: number;
  pauseBetweenSubscribeBatchesMs?: number;
  maxStreamsPerConnection?: number;
  maxCommandsPerSecond?: number;
  cascadeRecreateStreamCount?: number;
  resubscribeCoalesceWindowMs?: number;
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
  commandQueue: OutboundCommandQueue;
  openSend?: (data: unknown) => void;
  policyViolationUntilTimestamp: number;
}
