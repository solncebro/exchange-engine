import type { LiveCheck, LiveCheckContext } from './liveCheck.types';

export interface RunCheckArgs {
  check: LiveCheck;
  context: LiveCheckContext;
  index: number;
  hasCredentials: boolean;
}
