import type { OkxProbeContext, OkxProbeReportEntry } from './probe.types';
import type { RunProbeArgs } from './probeRunner.types';
import { printClaimHeader } from './probeOutput';
import { printNote } from '../live-support/liveOutput';
import { describeError } from '../live-support/liveError';

function rejectAfterTimeout(timeoutMs: number): Promise<never> {
  return new Promise((_resolve, reject) => {
    const timerId = setTimeout(() => reject(new Error(`проба не уложилась в ${timeoutMs / 1000} с`)), timeoutMs);
    timerId.unref?.();
  });
}

function runCleanupList(context: OkxProbeContext): void {
  for (const cleanup of context.cleanupList.splice(0)) {
    try {
      cleanup();
    } catch (error) {
      printNote(`уборка после пробы не удалась: ${describeError(error)}`);
    }
  }
}

export async function runProbe(args: RunProbeArgs): Promise<OkxProbeReportEntry> {
  const { probe, context, index } = args;

  printClaimHeader(index, probe.claim);

  if (probe.isOrdersRequired && !context.settings.isOrderAllowed) {
    printNote('пропущена: проба ставит заявку, для неё нужен ключ --allow-orders');

    return {
      claim: probe.claim,
      outcome: { status: 'skipped', fact: 'нужен ключ --allow-orders — по умолчанию скрипт только читает', expectation: '' },
    };
  }

  try {
    const outcome = await Promise.race([probe.run(context), rejectAfterTimeout(probe.timeoutMs)]);

    return { claim: probe.claim, outcome };
  } catch (error) {
    printNote(`проба сорвалась: ${describeError(error)}`);

    return { claim: probe.claim, outcome: { status: 'failed', fact: describeError(error), expectation: '' } };
  } finally {
    runCleanupList(context);
  }
}
