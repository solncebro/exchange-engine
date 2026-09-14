import type { WebSocketOpenContext } from '@solncebro/websocket-engine';

import type { ExchangeLogger } from '../types/common';
import type { OkxWebSocketMessage } from './okxWebSocketUtils.types';

export interface AuthenticateOkxWebSocketArgs {
  context: WebSocketOpenContext<OkxWebSocketMessage>;
  apiKey: string;
  secret: string;
  passphrase: string;
  label: string;
  logger: ExchangeLogger;
}
