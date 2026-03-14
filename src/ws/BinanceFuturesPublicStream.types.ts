import type { ReliableWebSocket } from '@solncebro/websocket-engine';

export interface BinanceCombinedMessage {
  stream?: string;
  data?: unknown;
}

export interface FuturesConnection {
  webSocket: ReliableWebSocket<BinanceCombinedMessage>;
  label: string;
  streamList: string[];
}
