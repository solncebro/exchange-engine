import type { ExchangeLogger } from '../types/common';

export interface OutboundCommandQueueArgs {
  label: string;
  logger: ExchangeLogger;
  maxCommandsPerSecond: number;
  send: (data: unknown) => void;
  onSendFailure: (error: unknown) => void;
}

export interface OutboundCommandQueueSnapshot {
  pendingCommandCount: number;
  sentCommandCount: number;
  clearedCommandCount: number;
  maxCommandsPerSecond: number;
}
