import type { ExchangeLogger } from '../types/common';

export interface BinanceUserDataStreamArgs {
  label: string;
  listenKey: string;
  baseWebSocketUrl: string;
  logger: ExchangeLogger;
  onNotify?: (message: string) => void | Promise<void>;
  onMessage: (event: Record<string, unknown>) => void;
}
