import type { OkxSymbolMap } from '../exchanges/okxSymbol';
import type { OkxOrderResultRaw } from '../normalizers/okxNormalizer';
import type { CreateOrderWebSocketArgs } from '../types/exchange';
import type { BaseTradeStreamArgs } from './BaseTradeStream.types';
import type { OkxWebSocketMessage } from './okxWebSocketUtils.types';

export interface OkxTradeStreamArgs extends BaseTradeStreamArgs {
  passphrase: string;
  symbolMap: OkxSymbolMap;
}

export interface OkxTradeResponseMessage extends OkxWebSocketMessage {
  id: string;
  op: string;
  code: string;
  msg: string;
  data?: OkxOrderResultRaw[];
}

export type OkxTradeAnyMessage = OkxWebSocketMessage | OkxTradeResponseMessage;

export interface OkxCancelOrderParams {
  instId: string;
  ordId?: string;
  clOrdId?: string;
}

export type OkxPendingBatchContext =
  | { kind: 'create'; originalArgsList: CreateOrderWebSocketArgs[]; sentAmountList: number[] }
  | { kind: 'modify'; originalOrderIdList: string[] }
  | { kind: 'cancel'; originalOrderIdList: string[] };
