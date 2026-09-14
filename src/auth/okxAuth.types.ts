export interface BuildOkxAuthHeadersArgs {
  apiKey: string;
  secret: string;
  passphrase: string;
  method: 'GET' | 'POST';
  requestPath: string;
  body?: string;
  timestamp: string;
}

export interface BuildOkxWebSocketLoginArgsArgs {
  apiKey: string;
  secret: string;
  passphrase: string;
  timestampSeconds: string;
}

export interface OkxWebSocketLoginArgs {
  apiKey: string;
  passphrase: string;
  timestamp: string;
  sign: string;
}
