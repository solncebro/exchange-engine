import { hmacSha256 } from '../utils/crypto';

export interface BuildBybitAuthHeadersArgs {
  apiKey: string;
  secret: string;
  timestamp: number;
  recvWindow?: number;
  payload: string;
}

export function buildBybitAuthHeaders(args: BuildBybitAuthHeadersArgs): Record<string, string> {
  const { apiKey, secret, timestamp, recvWindow = 5000, payload } = args;
  const signPayload = `${timestamp}${apiKey}${recvWindow}${payload}`;
  const signature = hmacSha256(signPayload, secret);

  return {
    'X-BAPI-API-KEY': apiKey,
    'X-BAPI-TIMESTAMP': String(timestamp),
    'X-BAPI-SIGN': signature,
    'X-BAPI-RECV-WINDOW': String(recvWindow),
  };
}

