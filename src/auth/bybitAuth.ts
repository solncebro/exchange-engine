import crypto from 'crypto';

export interface BuildBybitAuthHeadersArgs {
  apiKey: string;
  secret: string;
  timestamp: number;
  recvWindow?: number;
  payload: string; // For GET: queryString, for POST: JSON.stringify(body)
}

export function buildBybitAuthHeaders(args: BuildBybitAuthHeadersArgs): Record<string, string> {
  const { apiKey, secret, timestamp, recvWindow = 5000, payload } = args;
  const signPayload = `${timestamp}${apiKey}${recvWindow}${payload}`;
  const signature = crypto.createHmac('sha256', secret).update(signPayload).digest('hex');

  return {
    'X-BAPI-API-KEY': apiKey,
    'X-BAPI-TIMESTAMP': String(timestamp),
    'X-BAPI-SIGN': signature,
    'X-BAPI-RECV-WINDOW': String(recvWindow),
  };
}

export function getCurrentTimestamp(): number {
  return Date.now();
}
