import { printBanner, redactText, SHORT_STATUS_BY_STATUS } from '../live-support/liveOutput';
import type { ExchangeCheckReport, NumberedLiveCheck } from './liveCheck.types';

const TITLE_COLUMN_WIDTH = 62;
const STATUS_COLUMN_WIDTH = 9;

function padColumn(text: string, width: number): string {
  return text.length >= width ? `${text.slice(0, width - 1)} ` : text.padEnd(width, ' ');
}

export function printCheckMatrix(reportList: ExchangeCheckReport[], numberedCheckList: NumberedLiveCheck[]): void {
  printBanner('ИТОГ: обещание × биржа');

  const headerText = reportList.map((report) => padColumn(report.exchangeName, STATUS_COLUMN_WIDTH)).join('');

  console.log(`   ${padColumn('обещание', TITLE_COLUMN_WIDTH)}${headerText}`);

  numberedCheckList.forEach(({ check, checkNumber }, index) => {
    const cellText = reportList
      .map((report) => {
        const entry = report.entryList[index];

        return padColumn(entry === undefined ? '—' : SHORT_STATUS_BY_STATUS[entry.outcome.status], STATUS_COLUMN_WIDTH);
      })
      .join('');

    console.log(`${String(checkNumber).padStart(2, ' ')} ${padColumn(redactText(check.title), TITLE_COLUMN_WIDTH)}${cellText}`);
  });
}

export function printExchangeFactList(report: ExchangeCheckReport, numberedCheckList: NumberedLiveCheck[]): void {
  printBanner(`${report.exchangeName}: факт по каждому обещанию`);

  report.entryList.forEach((entry, index) => {
    const checkNumber = numberedCheckList[index]?.checkNumber ?? index + 1;

    console.log(`${String(checkNumber).padStart(2, ' ')} [${SHORT_STATUS_BY_STATUS[entry.outcome.status]}] ${redactText(entry.title)}`);
    console.log(`         ${redactText(entry.outcome.fact)}`);
  });
}
