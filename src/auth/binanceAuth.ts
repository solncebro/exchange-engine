import { hmacSha256 } from '../utils/crypto';

export function buildBinanceSignature(queryString: string, secret: string): string {
  return hmacSha256(queryString, secret);
}

export interface BuildBinanceSignedParamsArgs {
  params: Record<string, string | number | boolean>;
  secret: string;
  recvWindow?: number;
}

export function buildBinanceSignedParams(args: BuildBinanceSignedParamsArgs): Record<string, string | number> {
  const { params, secret, recvWindow = 5000 } = args;
  const timestamp = Date.now();
  const signedParams: Record<string, string | number> = {
    ...params,
    timestamp,
    recvWindow,
  };

  const queryString = new URLSearchParams(
    Object.entries(signedParams).map(([key, value]) => [key, String(value)]) as [string, string][]
  ).toString();

  const signature = buildBinanceSignature(queryString, secret);

  signedParams.signature = signature;

  return signedParams;
}

export function buildBinanceAuthHeaders(apiKey: string): Record<string, string> {
  return {
    'X-MBX-APIKEY': apiKey,
  };
}
