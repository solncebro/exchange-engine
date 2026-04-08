import type { ReliableWebSocket } from '@solncebro/websocket-engine';

import type { ExchangeLogger } from '../types/common';

export interface BinanceFuturesPublicStreamArgs {
  webSocketCombinedUrl: string;
  logger: ExchangeLogger;
  onNotify?: (message: string) => void | Promise<void>;
  label: string;
}

export interface BinanceCombinedMessage {
  stream?: string;
  data?: unknown;
}

export interface FuturesConnection {
  webSocket: ReliableWebSocket<BinanceCombinedMessage>;
  label: string;
  streamList: string[];
  dynamicStreamList: string[];
  url: string;
}
