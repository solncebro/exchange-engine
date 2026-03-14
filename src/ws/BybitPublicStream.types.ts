import type { BybitBaseWebSocketMessage } from './bybitWebSocketUtils.types';

export interface BybitWebSocketMessage extends BybitBaseWebSocketMessage {
  topic?: string;
  ret_code?: number;
}
