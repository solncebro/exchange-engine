import type { OkxProbeCredentials } from './probe.types';

export interface OkxEnvironmentReadResult {
  credentials: OkxProbeCredentials;
  missingNameList: string[];
}

export interface ProbeCommandLineSettings {
  isOrderAllowed: boolean;
  isVerbose: boolean;
  instId: string;
  claimFilter: string;
}

export interface CreateProbeContextArgs {
  credentials: OkxProbeCredentials;
  commandLine: ProbeCommandLineSettings;
}
