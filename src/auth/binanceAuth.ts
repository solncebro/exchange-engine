import { hmacSha256 } from '../utils/crypto';
import { serializeQueryParams } from '../utils/serializeQueryParams';

export function buildBinanceSignature(queryString: string, secret: string): string {
  return hmacSha256(queryString, secret);
}

export interface BuildBinanceSignedParamsArgs {
  params: Record<string, string | number | boolean>;
  secret: string;
  recvWindow?: number;
}

interface TimestampedParamsResult {
  signedParams: Record<string, string | number>;
  secret: string;
}

function buildTimestampedParams(
  args: BuildBinanceSignedParamsArgs,
): TimestampedParamsResult {
  const { params, secret, recvWindow = 5000 } = args;
  const timestamp = Date.now();
  const signedParams: Record<string, string | number> = {
    ...params,
    timestamp,
    recvWindow,
  };

  return { signedParams, secret };
}

export function buildBinanceSignedParams(args: BuildBinanceSignedParamsArgs): Record<string, string | number> {
  const { signedParams, secret } = buildTimestampedParams(args);

  const queryString = serializeQueryParams(signedParams);

  signedParams.signature = buildBinanceSignature(queryString, secret);

  return signedParams;
}

export function buildBinanceAuthHeaders(apiKey: string): Record<string, string> {
  return {
    'X-MBX-APIKEY': apiKey,
  };
}

export function buildBinanceWebSocketSignedParams(
  args: BuildBinanceSignedParamsArgs,
): Record<string, string | number> {
  const { signedParams, secret } = buildTimestampedParams(args);

  const sortedEntryList = Object.entries(signedParams).sort(([a], [b]) => a.localeCompare(b));
  const queryString = sortedEntryList.map(([key, value]) => `${key}=${value}`).join('&');

  signedParams.signature = buildBinanceSignature(queryString, secret);

  return signedParams;
}
