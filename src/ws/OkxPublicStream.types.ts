import type { ReliableWebSocket } from '@solncebro/websocket-engine';

import type { ExchangeLogger, PublicStreamConnectionPacking } from '../types/common';
import type { OkxSymbolMap } from '../exchanges/okxSymbol';
import type { OkxWebSocketMessage } from './okxWebSocketUtils.types';
import type { OkxSilenceWatchdog } from './OkxSilenceWatchdog';
import type { OkxConnectionOperationBudget } from './OkxConnectionOperationBudget';

export interface OkxPublicStreamArgs {
  publicUrl: string;
  businessUrl: string;
  label: string;
  logger: ExchangeLogger;
  onNotify?: (message: string) => void | Promise<void>;
  isSwap: boolean;
  symbolMap: OkxSymbolMap;
  contractValueBySymbol: Map<string, string>;
  connectionPacking?: PublicStreamConnectionPacking;
  lazyOrderbookParse?: boolean;
  pauseBetweenConnectionsMs?: number;
}

export type OkxConnectionPoolType = 'public' | 'business' | 'orderbook';
export type OkxTopicMutationKind = 'subscribe' | 'unsubscribe';
export type OkxOrderbookResyncTrigger = 'sequenceGap' | 'missingSnapshot';

export interface OkxTopicBatchSendArgs {
  connection: OkxConnection;
  topicKeyList: string[];
  send: (data: unknown) => void;
}

export interface OkxConnection {
  id: number;
  webSocket: ReliableWebSocket<OkxWebSocketMessage>;
  poolType: OkxConnectionPoolType;
  label: string;
  shortLabel: string;
  url: string;
  topicList: string[];
  pendingSubscribeTopicList: string[];
  pendingUnsubscribeTopicList: string[];
  readyPromise: Promise<void>;
  lastRecreateTimestamp: number;
  lastMessageTimestamp: number;
  messageCount: number;
  reconnectCount: number;
  silenceWatchdog: OkxSilenceWatchdog;
  operationBudget: OkxConnectionOperationBudget;
}
