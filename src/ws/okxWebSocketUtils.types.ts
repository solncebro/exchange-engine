import type { RawOrderbookFrame } from '../types/common';

export interface OkxSubscriptionArg {
  channel: string;
  instType?: string;
  instId?: string;
}

export interface OkxWebSocketMessage {
  id?: string;
  event?: string;
  code?: string;
  msg?: string;
  arg?: OkxSubscriptionArg;
  action?: string;
  data?: unknown[];
  __rawOrderbook?: RawOrderbookFrame;
}
