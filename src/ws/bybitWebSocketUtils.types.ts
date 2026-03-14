import type { WebSocketOpenContext } from '@solncebro/websocket-engine';

import type { ExchangeLogger } from '../types/common';

export interface BybitBaseWebSocketMessage {
  op?: string;
  data?: unknown;
  success?: boolean;
  ret_msg?: string;
  [key: string]: unknown;
}

export interface AuthenticateBybitWebSocketArgs {
  context: WebSocketOpenContext<BybitBaseWebSocketMessage>;
  apiKey: string;
  secret: string;
  label: string;
  logger: ExchangeLogger;
}
