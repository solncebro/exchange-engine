import type { ReliableWebSocket } from '@solncebro/websocket-engine';

import type { BybitPublicTopicType, ExchangeLogger, PublicStreamConnectionPacking } from '../types/common';
import type { BybitBaseWebSocketMessage } from './bybitWebSocketUtils.types';

export interface BybitPublicStreamArgs {
  url: string;
  logger: ExchangeLogger;
  onNotify?: (message: string) => void | Promise<void>;
  label: string;
  connectionPacking?: PublicStreamConnectionPacking;
}

export interface BybitWebSocketMessage extends BybitBaseWebSocketMessage {
  topic?: string;
  ret_code?: number;
  ts?: number;
}

export interface BybitConnection {
  webSocket: ReliableWebSocket<BybitWebSocketMessage>;
  label: string;
  // Compact identifier `${type} #N` (or `#N` in legacy mode) — the tail of `label`
  // without the repeated stream prefix, for grouped UI listings.
  shortLabel: string;
  // The single topic type this connection carries, when separateByTopicType is on.
  // undefined for the legacy flat-packed (mixed) mode.
  topicType?: BybitPublicTopicType;
  topicList: string[];
  dynamicTopicList: string[];
  url: string;
  lastRecreateTimestamp: number;
  lastMessageTimestamp: number;
  messageCount: number;
  reconnectCount: number;
}
