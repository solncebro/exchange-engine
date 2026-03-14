export interface BinanceSpotWebSocketEnvelope {
  stream?: string;
  data?: unknown;
  e?: string;
  [key: string]: unknown;
}
