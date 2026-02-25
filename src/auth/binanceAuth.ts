import crypto from 'crypto';

export function buildBinanceSignature(queryString: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(queryString).digest('hex');
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
    Object.entries(signedParams).map(([k, v]) => [k, String(v)]) as [string, string][]
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
