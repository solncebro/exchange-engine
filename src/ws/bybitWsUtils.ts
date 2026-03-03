import type { WebSocketOpenContext } from '@solncebro/websocket-engine';
import { hmacSha256 } from '../utils/crypto';

interface BybitBaseWsMessage {
  op?: string;
  data?: unknown;
  success?: boolean;
  ret_msg?: string;
  [key: string]: unknown;
}

const BYBIT_PING_INTERVAL = 20000;

function isBybitPongResponse(message: BybitBaseWsMessage): boolean {
  return message.op === 'pong' || message.ret_msg === 'pong';
}

const BYBIT_HEARTBEAT_CONFIG = {
  buildPayload: () => ({ op: 'ping' }),
  isResponse: isBybitPongResponse,
};

interface AuthenticateBybitWsArgs {
  context: WebSocketOpenContext<BybitBaseWsMessage>;
  apiKey: string;
  secret: string;
  label: string;
  logger: { info(message: string, ...args: unknown[]): void };
}

async function authenticateBybitWs(args: AuthenticateBybitWsArgs): Promise<void> {
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
  authenticateBybitWs,
};
export type { BybitBaseWsMessage, AuthenticateBybitWsArgs };
