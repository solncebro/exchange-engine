import type { ExchangeLogger } from '../types/common';
import type { BybitBaseWebSocketMessage } from './bybitWebSocketUtils.types';

export interface BybitPublicStreamArgs {
  url: string;
  logger: ExchangeLogger;
  onNotify?: (message: string) => void | Promise<void>;
  label: string;
}

export interface BybitWebSocketMessage extends BybitBaseWebSocketMessage {
  topic?: string;
  ret_code?: number;
}
