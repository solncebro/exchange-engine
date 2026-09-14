import { hmacSha256Base64 } from '../utils/crypto';
import type { BuildOkxAuthHeadersArgs, BuildOkxWebSocketLoginArgsArgs, OkxWebSocketLoginArgs } from './okxAuth.types';

export function buildOkxAuthHeaders(args: BuildOkxAuthHeadersArgs): Record<string, string> {
  const { apiKey, secret, passphrase, method, requestPath, body = '', timestamp } = args;
  const signPayload = `${timestamp}${method}${requestPath}${body}`;
  const sign = hmacSha256Base64(signPayload, secret);

  return {
    'OK-ACCESS-KEY': apiKey,
    'OK-ACCESS-SIGN': sign,
    'OK-ACCESS-TIMESTAMP': timestamp,
    'OK-ACCESS-PASSPHRASE': passphrase,
  };
}

export function buildOkxRestTimestamp(nowMs: number): string {
  return new Date(nowMs).toISOString();
}

const OKX_WEBSOCKET_LOGIN_METHOD = 'GET';
const OKX_WEBSOCKET_LOGIN_PATH = '/users/self/verify';

export function buildOkxWebSocketLoginArgs(args: BuildOkxWebSocketLoginArgsArgs): OkxWebSocketLoginArgs {
  const { apiKey, secret, passphrase, timestampSeconds } = args;
  const signPayload = `${timestampSeconds}${OKX_WEBSOCKET_LOGIN_METHOD}${OKX_WEBSOCKET_LOGIN_PATH}`;
  const sign = hmacSha256Base64(signPayload, secret);

  return {
    apiKey,
    passphrase,
    timestamp: timestampSeconds,
    sign,
  };
}
