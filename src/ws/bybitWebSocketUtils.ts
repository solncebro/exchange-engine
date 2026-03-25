import { hmacSha256 } from '../utils/crypto';
import type {
    AuthenticateBybitWebSocketArgs,
    BybitBaseWebSocketMessage,
} from './bybitWebSocketUtils.types';

const BYBIT_PING_INTERVAL = 20000;

function isBybitPongResponse(message: BybitBaseWebSocketMessage): boolean {
  return message.op === 'pong' || message.ret_msg === 'pong';
}

const BYBIT_HEARTBEAT_CONFIG = {
  buildPayload: () => ({ op: 'ping' }),
  isResponse: isBybitPongResponse,
};

async function authenticateBybitWebSocket(args: AuthenticateBybitWebSocketArgs): Promise<void> {
  const { context, apiKey, secret, label, logger } = args;
  const expires = Date.now() + 10000;
  const payload = `GET/realtime${expires}`;
  const signature = hmacSha256(payload, secret);

  context.send({
    op: 'auth',
    args: [apiKey, expires, signature],
  });

  await context.waitForMessage((message) => {
    if (message.op === 'auth') {
      const record = message as Record<string, unknown>;
      const retCode = record.ret_code ?? record.retCode;

      if (message.success || retCode === 0) {
        return true;
      }

      const errorMessage = message.ret_msg ?? record.retMsg ?? 'unknown error';
      const errorDetails = retCode !== undefined ? ` (code: ${retCode})` : '';

      logger.error(`[${label}] Auth response: ${JSON.stringify(message)}`);
      throw new Error(`[${label}] Auth failed: ${errorMessage}${errorDetails}`);
    }

    return false;
  }, 10000);
}

export type { AuthenticateBybitWebSocketArgs, BybitBaseWebSocketMessage } from './bybitWebSocketUtils.types';
export {
    authenticateBybitWebSocket, BYBIT_HEARTBEAT_CONFIG,
    BYBIT_PING_INTERVAL, isBybitPongResponse
};

