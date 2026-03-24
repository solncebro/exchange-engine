import type { BybitBaseWebSocketMessage } from './bybitWebSocketUtils';

export interface BybitTradeMessage extends BybitBaseWebSocketMessage {
  reason?: string;
  reqId?: string;
  retCode?: number;
  retMsg?: string;
}

export interface BybitTradeOrderData {
  orderId: string;
  orderLinkId?: string;
}
