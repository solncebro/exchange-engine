import type { ExchangeLogger, Order } from '../types/common';

export interface BaseTradeStreamArgs {
  url: string;
  label: string;
  apiKey: string;
  secret: string;
  logger: ExchangeLogger;
  onNotify?: (message: string) => void | Promise<void>;
}

export interface PendingRequest {
  resolve: (order: Order) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}
