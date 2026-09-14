import type { OkxHttpClient } from '../../src/http/OkxHttpClient';
import type { OkxInstrumentRaw } from '../../src/normalizers/okxNormalizer';
import type { ExchangeLogger } from '../../src/types/common';
import type { LiveLogRecord } from '../live-support/liveLogger.types';
import type { LiveRunStatus } from '../live-support/liveOutput.types';

export interface OkxProbeCredentials {
  apiKey: string;
  secret: string;
  passphrase: string;
}

export interface OkxProbeSettings {
  isOrderAllowed: boolean;
  instId: string;
  clientOrderIdPrefix: string;
  publicWebSocketUrl: string;
  businessWebSocketUrl: string;
  privateWebSocketUrl: string;
}

export interface OkxProbeContext {
  credentials: OkxProbeCredentials;
  settings: OkxProbeSettings;
  httpClient: OkxHttpClient;
  logger: ExchangeLogger;
  logRecordList: LiveLogRecord[];
  cleanupList: Array<() => void>;
  showEvidence: (label: string, payload: unknown) => void;
  getInstrument: () => Promise<OkxInstrumentRaw>;
  buildClientOrderId: () => string;
}

export interface OkxProbeOutcome {
  status: LiveRunStatus;
  fact: string;
  expectation: string;
}

export interface OkxProbe {
  claim: string;
  timeoutMs: number;
  isOrdersRequired: boolean;
  run: (context: OkxProbeContext) => Promise<OkxProbeOutcome>;
}

export interface OkxProbeReportEntry {
  claim: string;
  outcome: OkxProbeOutcome;
}
