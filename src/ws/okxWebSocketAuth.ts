import { buildOkxWebSocketLoginArgs } from '../auth/okxAuth';
import { OKX_WEBSOCKET_LOGIN_TIMEOUT_MS } from '../constants/okx';
import type { ExchangeLogger } from '../types/common';
import type { AuthenticateOkxWebSocketArgs } from './okxWebSocketAuth.types';
import type { OkxWebSocketMessage } from './okxWebSocketUtils.types';

function rejectLogin(message: OkxWebSocketMessage, label: string, logger: ExchangeLogger): never {
  logger.error(`[${label}] Login response: ${JSON.stringify(message)}`);

  throw new Error(`[${label}] Login failed: ${message.msg ?? 'unknown error'} (code: ${message.code ?? 'UNKNOWN'})`);
}

async function authenticateOkxWebSocket(args: AuthenticateOkxWebSocketArgs): Promise<void> {
  const { context, apiKey, secret, passphrase, label, logger } = args;
  const timestampSeconds = String(Math.floor(Date.now() / 1000));
  const loginArgs = buildOkxWebSocketLoginArgs({ apiKey, secret, passphrase, timestampSeconds });

  context.send({ op: 'login', args: [loginArgs] });

  await context.waitForMessage((message) => {
    if (message.event === 'error') {
      rejectLogin(message, label, logger);
    }

    if (message.event === 'login') {
      if (message.code === '0') {
        return true;
      }

      rejectLogin(message, label, logger);
    }

    return false;
  }, OKX_WEBSOCKET_LOGIN_TIMEOUT_MS);
}

export { authenticateOkxWebSocket };
