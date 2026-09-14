import type { ExchangeLogger } from '../types/common';

export interface BaseTradeStreamArgs {
  url: string;
  label: string;
  apiKey: string;
  secret: string;
  logger: ExchangeLogger;
  onNotify?: (message: string) => void | Promise<void>;
}

export enum PendingRequestKind {
  SingleOrder = 'single-order',
  CreateBatch = 'create-batch',
  ModifyBatch = 'modify-batch',
  CancelBatch = 'cancel-batch',
  ConditionalOrder = 'conditional-order',
  ConditionalCancel = 'conditional-cancel',
  SingleCancel = 'single-cancel',
  SingleAmend = 'single-amend',
}

export interface PendingRequest {
  kind: PendingRequestKind;
  resolve: (data: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}
