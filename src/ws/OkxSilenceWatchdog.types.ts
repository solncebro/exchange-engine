export interface OkxSilenceWatchdogArgs {
  silentThresholdMs: number;
  onSilent: () => void;
}
