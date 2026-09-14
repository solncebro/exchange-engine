import path from 'node:path';
import { OKX_PENDING_ALGO_ORD_TYPE_FILTER } from '../src/constants/okx';
import { sleep } from '../src/utils/sleep';
import { accountBalanceFieldsProbe } from './okx-live-probe/accountBalanceFields';
import { businessAlgoOrdersChannelProbe } from './okx-live-probe/businessAlgoOrdersChannel';
import { candleFrameRowOrderProbe } from './okx-live-probe/candleFrameRowOrder';
import { coinLevelMarginFieldsProbe } from './okx-live-probe/coinLevelMarginFields';
import { fundingBillSubTypeProbe } from './okx-live-probe/fundingBillSubType';
import { historyCandlesAfterBoundaryProbe } from './okx-live-probe/historyCandlesAfterBoundary';
import { pendingOrderPageOrderProbe } from './okx-live-probe/pendingOrderPageOrder';
import type { OkxProbe, OkxProbeContext, OkxProbeReportEntry } from './okx-live-probe/probe.types';
import { createProbeContext, parseCommandLineSettings, readOkxEnvironment } from './okx-live-probe/probeContext';
import { printSummaryTable } from './okx-live-probe/probeOutput';
import { printBanner, printNote } from './live-support/liveOutput';
import { runProbe } from './okx-live-probe/probeRunner';
import { describeError } from './live-support/liveError';
import { announceEnvFile } from './live-support/liveEnvFile';
import { signedCommaRequestPathProbe } from './okx-live-probe/signedCommaRequestPath';
import { tradeChannelInstIdProbe } from './okx-live-probe/tradeChannelInstId';
import { tradeFeeGroupIdProbe } from './okx-live-probe/tradeFeeGroupId';

/** Собственный `.env` библиотеки: ключи OKX живут здесь, а не в соседнем проекте. */
const ENV_FILE_PATH = path.resolve(__dirname, '..', '.env');
const FLUSH_DELAY_MS = 100;

const PROBE_LIST: OkxProbe[] = [
  tradeChannelInstIdProbe,
  tradeFeeGroupIdProbe,
  historyCandlesAfterBoundaryProbe,
  accountBalanceFieldsProbe,
  businessAlgoOrdersChannelProbe,
  fundingBillSubTypeProbe,
  candleFrameRowOrderProbe,
  pendingOrderPageOrderProbe,
  signedCommaRequestPathProbe,
  coinLevelMarginFieldsProbe,
];

function buildSkippedReport(reasonText: string): OkxProbeReportEntry[] {
  return PROBE_LIST.map((probe) => ({
    claim: probe.claim,
    outcome: { status: 'skipped' as const, fact: reasonText, expectation: '' },
  }));
}

function selectProbeList(claimFilter: string): OkxProbe[] {
  if (claimFilter === '') {
    return PROBE_LIST;
  }

  const needle = claimFilter.toLowerCase();

  return PROBE_LIST.filter((probe) => probe.claim.toLowerCase().includes(needle));
}

async function cancelLeftoverProbeOrders(context: OkxProbeContext): Promise<void> {
  printBanner('Уборка: снятие всего, что проба могла оставить на бирже');

  try {
    const pendingOrderList = await context.httpClient.fetchPendingOrders({ instType: 'SWAP', instId: context.settings.instId });
    const ownOrderList = pendingOrderList.filter((order) => order.clOrdId.startsWith(context.settings.clientOrderIdPrefix));

    for (const order of ownOrderList) {
      const result = await context.httpClient.cancelOrder({ instId: context.settings.instId, ordId: order.ordId });

      context.showEvidence('снята оставшаяся заявка (дословно)', result);
    }

    const pendingAlgoOrderList = await context.httpClient.fetchPendingAlgoOrders({
      ordType: OKX_PENDING_ALGO_ORD_TYPE_FILTER,
      instType: 'SWAP',
      instId: context.settings.instId,
    });
    const ownAlgoOrderList = pendingAlgoOrderList.filter((order) => order.algoClOrdId.startsWith(context.settings.clientOrderIdPrefix));

    if (ownAlgoOrderList.length > 0) {
      const result = await context.httpClient.cancelAlgoOrders(
        ownAlgoOrderList.map((order) => ({ instId: context.settings.instId, algoId: order.algoId })),
      );

      context.showEvidence('снятие оставшихся условных заявок (дословно)', result);
    }

    printNote(`оставленных пробой заявок: обычных ${ownOrderList.length}, условных ${ownAlgoOrderList.length}`);
  } catch (error) {
    printNote(`уборка не удалась — проверьте счёт руками: ${describeError(error)}`);
  }
}

async function main(): Promise<void> {
  // Первое действие пробы: свой `.env` кладётся в окружение ДО чтения ключей и до того, как
  // вооружается замена ключей звёздочками, — иначе значение из файла могло бы уйти в печать.
  announceEnvFile(ENV_FILE_PATH);

  const commandLine = parseCommandLineSettings(process.argv.slice(2));
  const { credentials, missingNameList } = readOkxEnvironment();

  printBanner('Живая проба OKX: десять утверждений, которые доказываются только ответом биржи');
  printNote('режим: демо-счёт (заголовок x-simulated-trading: 1) — боевые адреса скрипт не трогает');
  printNote(`инструмент: ${commandLine.instId}`);
  printNote(`постановка заявок: ${commandLine.isOrderAllowed ? 'РАЗРЕШЕНА ключом --allow-orders' : 'запрещена, только чтение'}`);

  if (missingNameList.length > 0) {
    printBanner('Ключи не заданы — ни одна проба не выполнена');
    printNote(`не найдены переменные окружения: ${missingNameList.join(', ')}`);
    printNote('образец имён — .env.example рядом с package.json; ключи кладутся в .env этой библиотеки');
    printNote('запуск с ключами: yarn okx:probe — файл .env скрипт читает сам');
    printSummaryTable(buildSkippedReport('ключи не заданы — проба не выполнена'));

    return;
  }

  const context = createProbeContext({ credentials, commandLine });
  const probeList = selectProbeList(commandLine.claimFilter);

  if (probeList.length === 0) {
    printNote(`по отбору --only=${commandLine.claimFilter} не нашлось ни одной пробы`);

    return;
  }

  const reportEntryList: OkxProbeReportEntry[] = [];

  for (const [index, probe] of probeList.entries()) {
    reportEntryList.push(await runProbe({ probe, context, index: index + 1 }));
  }

  if (commandLine.isOrderAllowed) {
    await cancelLeftoverProbeOrders(context);
  }

  printSummaryTable(reportEntryList);
}

main()
  .then(async () => {
    await sleep(FLUSH_DELAY_MS);
    process.exit(0);
  })
  .catch(async (error: unknown) => {
    printNote(`скрипт остановился с ошибкой: ${describeError(error)}`);
    await sleep(FLUSH_DELAY_MS);
    process.exit(1);
  });
