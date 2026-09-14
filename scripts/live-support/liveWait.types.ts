export interface WaitForConditionArgs {
  isReady: () => boolean;
  timeoutMs: number;
}
