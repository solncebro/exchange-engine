import type { WebSocketOpenContext } from '@solncebro/websocket-engine';
import type { ExchangeLogger } from '../types/common';
import { hmacSha256 } from '../utils/crypto';

interface BybitBaseWebSocketMessage {
  op?: string;
  data?: unknown;
  success?: boolean;
  ret_msg?: string;
  [key: string]: unknown;
}

const BYBIT_PING_INTERVAL = 20000;

function isBybitPongResponse(message: BybitBaseWebSocketMessage): boolean {
  return message.op === 'pong' || message.ret_msg === 'pong';
}

const BYBIT_HEARTBEAT_CONFIG = {
  buildPayload: () => ({ op: 'ping' }),
  isResponse: isBybitPongResponse,
};

interface AuthenticateBybitWebSocketArgs {
  context: WebSocketOpenContext<BybitBaseWebSocketMessage>;
  apiKey: string;
  secret: string;
  label: string;
  logger: ExchangeLogger;
}

async function authenticateBybitWebSocket(args: AuthenticateBybitWebSocketArgs): Promise<void> {
  const { context, apiKey, secret, label, logger } = args;
  const timestamp = Date.now();
  const payload = `GET/realtime${timestamp}`;
  const signature = hmacSha256(payload, secret);

  context.send({
    op: 'auth',
    args: [apiKey, timestamp, signature],
  });

  await context.waitForMessage(
    (message) => message.op === 'auth' && message.success === true,
    10000,
  );

  logger.info(`${label} authenticated`);
}

export {
  isBybitPongResponse,
  BYBIT_HEARTBEAT_CONFIG,
  BYBIT_PING_INTERVAL,
  authenticateBybitWebSocket,
};
export type { BybitBaseWebSocketMessage, AuthenticateBybitWebSocketArgs };
