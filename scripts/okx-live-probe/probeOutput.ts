import type { OkxProbeReportEntry } from './probe.types';
import { redactText, printBanner, STATUS_LABEL_BY_STATUS } from '../live-support/liveOutput';

export function printClaimHeader(index: number, claim: string): void {
  console.log('');
  console.log(`── Проба ${index}. ${redactText(claim)}`);
}

export function printSummaryTable(entryList: OkxProbeReportEntry[]): void {
  printBanner('ИТОГ: утверждение → результат → факт');

  entryList.forEach((entry, index) => {
    const number = String(index + 1).padStart(2, ' ');

    console.log(`${number} [${STATUS_LABEL_BY_STATUS[entry.outcome.status]}] ${redactText(entry.claim)}`);
    console.log(`         факт: ${redactText(entry.outcome.fact)}`);
  });

  console.log('');
}
