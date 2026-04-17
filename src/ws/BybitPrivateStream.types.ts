import type { ExchangeLogger } from '../types/common';
import type { BybitBaseWebSocketMessage } from './bybitWebSocketUtils.types';

export interface BybitPrivateMessage extends BybitBaseWebSocketMessage {
  topic?: string;
}

export interface BybitPrivateStreamArgs {
  label: string;
  apiKey: string;
  secret: string;
  logger: ExchangeLogger;
  onNotify?: (message: string) => void | Promise<void>;
  onMessage: (event: Record<string, unknown>) => void;
  topicList?: string[];
}
