import type { ExchangeLogger } from '../types/common';

export interface BinanceSpotUserDataStreamArgs {
  label: string;
  url: string;
  apiKey: string;
  secret: string;
  logger: ExchangeLogger;
  onNotify?: (message: string) => void | Promise<void>;
  onMessage: (event: Record<string, unknown>) => void;
}

export interface BinanceSpotUserDataSubscribeResult {
  subscriptionId?: number;
}

export interface BinanceSpotUserDataStreamMessage {
  id?: string;
  status?: number;
  result?: BinanceSpotUserDataSubscribeResult;
  error?: { code?: number; msg?: string };
  event?: Record<string, unknown>;
  e?: string;
  [key: string]: unknown;
}
