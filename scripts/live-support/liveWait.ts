import { sleep } from '../../src/utils/sleep';
import type { WaitForConditionArgs } from './liveWait.types';

const POLL_INTERVAL_MS = 250;

export async function waitForCondition(args: WaitForConditionArgs): Promise<boolean> {
  const deadline = Date.now() + args.timeoutMs;

  while (Date.now() < deadline) {
    if (args.isReady()) {
      return true;
    }

    await sleep(POLL_INTERVAL_MS);
  }

  return args.isReady();
}
