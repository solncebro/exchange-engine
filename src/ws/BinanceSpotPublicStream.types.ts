import type { ExchangeLogger } from '../types/common';

export interface BinanceSpotPublicStreamArgs {
  webSocketUrl: string;
  logger: ExchangeLogger;
  onNotify?: (message: string) => void | Promise<void>;
  label: string;
}

export interface BinanceSpotWebSocketEnvelope {
  stream?: string;
  data?: unknown;
  e?: string;
  [key: string]: unknown;
}
