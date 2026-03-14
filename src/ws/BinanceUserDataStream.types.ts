import type { ExchangeLogger } from '../types/common';

export interface BinanceUserDataStreamArgs {
  listenKey: string;
  baseWebSocketUrl: string;
  logger: ExchangeLogger;
  onNotify?: (message: string) => void | Promise<void>;
  onMessage: (event: Record<string, unknown>) => void;
}
