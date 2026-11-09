import type { ExchangeCheckReport, LiveCheck, LiveCheckContext, NumberedLiveCheck } from './liveCheck.types';

export interface UnsettledOrderProbe {
  title: string;
  settlement: Promise<void>;
}

export interface ExchangeRunState {
  context: LiveCheckContext | null;
  currentAbortController: AbortController | null;
  unsettledOrderProbe: UnsettledOrderProbe | null;
  isTotalDeadlineReached: boolean;
  isCleanupRequired: boolean;
}

export interface RunCheckArgs {
  check: LiveCheck;
  context: LiveCheckContext;
  checkNumber: number;
  hasCredentials: boolean;
  runState: ExchangeRunState;
}

export interface HandleTotalDeadlineArgs {
  runState: ExchangeRunState;
  reportList: ExchangeCheckReport[];
  numberedCheckList: NumberedLiveCheck[];
}
