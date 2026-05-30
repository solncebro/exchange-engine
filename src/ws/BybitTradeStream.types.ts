import type { BybitBaseWebSocketMessage } from './bybitWebSocketUtils';

export interface BybitTradeResponseHeader {
  'X-Bapi-Limit'?: string;
  'X-Bapi-Limit-Status'?: string;
  'X-Bapi-Limit-Reset-Timestamp'?: string;
  Traceid?: string;
  Timenow?: string;
}

export interface BybitTradeMessage extends BybitBaseWebSocketMessage {
  reason?: string;
  reqId?: string;
  retCode?: number;
  retMsg?: string;
  header?: BybitTradeResponseHeader;
}

export interface BybitTradeOrderData {
  orderId: string;
  orderLinkId?: string;
}

export interface BybitBatchOrderItem {
  category?: string;
  symbol?: string;
  orderId?: string;
  orderLinkId?: string;
}

export interface BybitBatchOrderExtInfo {
  code: number;
  msg: string;
}

export interface BybitBatchTradeMessage extends BybitBaseWebSocketMessage {
  reqId?: string;
  retCode?: number;
  retMsg?: string;
  data?: { list?: BybitBatchOrderItem[] };
  retExtInfo?: { list?: BybitBatchOrderExtInfo[] };
  header?: BybitTradeResponseHeader;
}

export type BybitTradeAnyMessage = BybitTradeMessage | BybitBatchTradeMessage;
