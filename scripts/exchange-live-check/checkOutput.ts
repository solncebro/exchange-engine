import { printBanner, redactText, SHORT_STATUS_BY_STATUS } from '../live-support/liveOutput';
import type { ExchangeCheckReport } from './liveCheck.types';

const TITLE_COLUMN_WIDTH = 62;
const STATUS_COLUMN_WIDTH = 9;

function padColumn(text: string, width: number): string {
  return text.length >= width ? `${text.slice(0, width - 1)} ` : text.padEnd(width, ' ');
}

export function printCheckMatrix(reportList: ExchangeCheckReport[], titleList: string[]): void {
  printBanner('ИТОГ: обещание × биржа');

  const headerText = reportList.map((report) => padColumn(report.exchangeName, STATUS_COLUMN_WIDTH)).join('');

  console.log(`   ${padColumn('обещание', TITLE_COLUMN_WIDTH)}${headerText}`);

  titleList.forEach((title, index) => {
    const cellText = reportList
      .map((report) => {
        const entry = report.entryList[index];

        return padColumn(entry === undefined ? '—' : SHORT_STATUS_BY_STATUS[entry.outcome.status], STATUS_COLUMN_WIDTH);
      })
      .join('');

    console.log(`${String(index + 1).padStart(2, ' ')} ${padColumn(redactText(title), TITLE_COLUMN_WIDTH)}${cellText}`);
  });
}

export function printExchangeFactList(report: ExchangeCheckReport): void {
  printBanner(`${report.exchangeName}: факт по каждому обещанию`);

  report.entryList.forEach((entry, index) => {
    console.log(`${String(index + 1).padStart(2, ' ')} [${SHORT_STATUS_BY_STATUS[entry.outcome.status]}] ${redactText(entry.title)}`);
    console.log(`         ${redactText(entry.outcome.fact)}`);
  });
}
