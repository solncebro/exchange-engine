import path from 'node:path';
import {
  createCheckContext,
  EXCHANGE_NAME_LIST,
  parseCheckCommandLine,
  readExchangeCredentials,
} from './exchange-live-check/checkContext';
import type { CheckCommandLineSettings } from './exchange-live-check/checkContext.types';
import { printCheckMatrix, printExchangeFactList } from './exchange-live-check/checkOutput';
import { runCheck } from './exchange-live-check/checkRunner';
import type { ExchangeRunState, HandleTotalDeadlineArgs } from './exchange-live-check/checkRunner.types';
import { balanceCheck } from './exchange-live-check/balanceCheck';
import { directionalLeverageCheck } from './exchange-live-check/directionalLeverageCheck';
import { feeRateCheck } from './exchange-live-check/feeRateCheck';
import { fundingMarkPriceCheck } from './exchange-live-check/fundingMarkPriceCheck';
import { futuresTradeSymbolCheck, spotTradeSymbolCheck } from './exchange-live-check/instrumentChecks';
import { isolatedMarginCheck } from './exchange-live-check/isolatedMarginCheck';
import { klineCheck } from './exchange-live-check/klineCheck';
import { leverageTierCheck } from './exchange-live-check/leverageTierCheck';
import { runFinalCleanup } from './exchange-live-check/finalCleanup';
import type { ExchangeCheckReport, LiveCheck, LiveCheckContext, LiveCheckReportEntry, NumberedLiveCheck } from './exchange-live-check/liveCheck.types';
import { markPriceCheck } from './exchange-live-check/markPriceCheck';
import { orderBookCheck } from './exchange-live-check/orderBookCheck';
import { orderExecutionCheck } from './exchange-live-check/orderExecutionCheck';
import { orderRateLimitCheck } from './exchange-live-check/orderRateLimitCheck';
import { orderRoundTripCheck } from './exchange-live-check/orderRoundTripCheck';
import { positionModeCheck } from './exchange-live-check/positionModeCheck';
import { publicStreamCheck } from './exchange-live-check/publicStreamCheck';
import { futuresTickerCheck, spotTickerCheck } from './exchange-live-check/tickerChecks';
import { describeError } from './live-support/liveError';
import { announceEnvFile } from './live-support/liveEnvFile';
import { printBanner, printNote, SHORT_STATUS_BY_STATUS, SUCCESSFUL_STATUS_LIST } from './live-support/liveOutput';

/** Собственный `.env` библиотеки: ключи трёх бирж живут здесь, а не в соседнем проекте. */
const ENV_FILE_PATH = path.resolve(__dirname, '..', '.env');
const LINGERING_TIMER_WATCH_MS = 5_000;
/** Общий срок всего прогона: сорванный по нему прогон обязан показать таблицу, а не исчезнуть молча. */
const TOTAL_DEADLINE_MS = 35 * 60_000;
const DEADLINE_CLEANUP_LIMIT_MS = 120_000;

const CHECK_LIST: LiveCheck[] = [
  futuresTradeSymbolCheck,
  spotTradeSymbolCheck,
  futuresTickerCheck,
  spotTickerCheck,
  klineCheck,
  orderBookCheck,
  markPriceCheck,
  leverageTierCheck,
  balanceCheck,
  feeRateCheck,
  positionModeCheck,
  orderRateLimitCheck,
  publicStreamCheck,
  orderRoundTripCheck,
  orderExecutionCheck,
  isolatedMarginCheck,
  directionalLeverageCheck,
  fundingMarkPriceCheck,
];

function selectCheckList(titleFilter: string): NumberedLiveCheck[] {
  const numberedCheckList = CHECK_LIST.map((check, index) => ({ check, checkNumber: index + 1 }));

  if (titleFilter === '') {
    return numberedCheckList;
  }

  const needle = titleFilter.toLowerCase();

  return numberedCheckList.filter(({ check }) => check.title.toLowerCase().includes(needle));
}

function printRunSummary(reportList: ExchangeCheckReport[], numberedCheckList: NumberedLiveCheck[]): void {
  for (const report of reportList) {
    printExchangeFactList(report, numberedCheckList);
  }

  printCheckMatrix(reportList, numberedCheckList);
}

/**
 * Код выхода — единственное, что видно снаружи прогона: обвязка читает его, а не таблицу. Единицу
 * поднимает любой статус, требующий человека («расх.», «неполн.», «неудача»). Не поднимают её
 * «подтв.», «не прим.» (биржа такой величины не отдаёт вовсе — чинить нечего) и «пропуск»
 * (обещание сознательно не выполнялось: нет ключей счёта либо не задан ключ --allow-orders).
 */
function resolveExitCode(reportList: ExchangeCheckReport[]): number {
  const troubleList = reportList.flatMap((report) =>
    report.entryList
      .filter((entry) => !SUCCESSFUL_STATUS_LIST.includes(entry.outcome.status))
      .map((entry) => `${report.exchangeName}: ${SHORT_STATUS_BY_STATUS[entry.outcome.status]} — ${entry.title}`),
  );

  printBanner('Код выхода');

  if (troubleList.length === 0) {
    printNote('ни одного обещания не осталось за человеком — код выхода 0');

    return 0;
  }

  printNote(`требуют человека обещаний: ${troubleList.length} — код выхода 1`);

  for (const troubleText of troubleList) {
    printNote(`  ${troubleText}`);
  }

  return 1;
}

function buildSkippedEntryList(checkList: LiveCheck[], reasonText: string): LiveCheckReportEntry[] {
  return checkList.map((check) => ({ title: check.title, outcome: { status: 'skipped' as const, fact: reasonText } }));
}

async function runWithTimeLimit(task: Promise<void>, timeoutMs: number): Promise<boolean> {
  let timerId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<boolean>((resolve) => {
    timerId = setTimeout(() => resolve(false), timeoutMs);
  });

  try {
    return await Promise.race([task.then(() => true), timeout]);
  } finally {
    clearTimeout(timerId);
  }
}

async function runExchangeCheckList(
  report: ExchangeCheckReport,
  numberedCheckList: NumberedLiveCheck[],
  commandLine: CheckCommandLineSettings,
  runState: ExchangeRunState,
): Promise<void> {
  const { exchangeName } = report;

  printBanner(`${exchangeName}: живая проверка договора с биржей (демо-счёт)`);

  const { credentials, missingNameList } = readExchangeCredentials(exchangeName);
  const hasCredentials = missingNameList.length === 0;

  if (!hasCredentials) {
    printNote(`ключи счёта не заданы: ${missingNameList.join(', ')} — приватные обещания будут пропущены`);
  }

  let context: LiveCheckContext;

  try {
    context = createCheckContext({ exchangeName, credentials, commandLine });
  } catch (error) {
    const reasonText = `клиент не построился: ${describeError(error)}`;

    printNote(reasonText);
    report.entryList.push(...buildSkippedEntryList(numberedCheckList.map(({ check }) => check), reasonText));

    return;
  }

  runState.context = context;
  runState.unsettledOrderProbe = null;
  runState.isCleanupRequired = commandLine.isOrderAllowed && hasCredentials;

  for (const { check, checkNumber } of numberedCheckList) {
    if (runState.isTotalDeadlineReached) {
      return;
    }

    report.entryList.push(await runCheck({ check, context, checkNumber, hasCredentials, runState }));
  }

  if (runState.isTotalDeadlineReached) {
    return;
  }

  if (runState.isCleanupRequired) {
    await runFinalCleanup(context, 'сквозная уборка');
  }

  runState.context = null;

  // Закрытие соединений — последнее действие по бирже, и оно не должно уносить с собой прогон:
  // непойманный отказ здесь оставил бы владельца без таблицы по УЖЕ выполненным обещаниям,
  // причём и по остальным биржам тоже.
  try {
    await context.exchange.close();
  } catch (error) {
    printNote(`закрыть соединения не удалось: ${describeError(error)}`);
  }
}

async function handleTotalDeadline(args: HandleTotalDeadlineArgs): Promise<void> {
  const { runState, reportList, numberedCheckList } = args;
  const { context } = runState;

  runState.isTotalDeadlineReached = true;
  printBanner('Общий срок прогона вышел — останавливаю пробу, убираю своё и показываю то, что успели');
  printNote(`отведено ${TOTAL_DEADLINE_MS / 60_000} мин; обещания, до которых не дошло, в таблице пусты`);
  runState.currentAbortController?.abort(new Error('общий срок прогона вышел'));

  if (context !== null && runState.isCleanupRequired) {
    const isCleaned = await runWithTimeLimit(runFinalCleanup(context, 'уборка по общему сроку'), DEADLINE_CLEANUP_LIMIT_MS);

    if (!isCleaned) {
      printNote(`уборка по общему сроку не уложилась в ${DEADLINE_CLEANUP_LIMIT_MS / 1000} с — проверьте счёт руками (метка ${context.settings.clientOrderIdPrefix}, свой объём: ${context.ownPositionLedger.describe()})`);
    }
  }

  printRunSummary(reportList, numberedCheckList);
}

async function main(): Promise<void> {
  // Первое действие прогона: свой `.env` кладётся в окружение ДО того, как читается хоть один ключ
  // и до того, как вооружается замена ключей звёздочками, — иначе значение из файла успело бы
  // попасть в печать неприкрытым.
  announceEnvFile(ENV_FILE_PATH);

  const commandLine = parseCheckCommandLine(process.argv.slice(2));

  printBanner('Живая проверка договора с биржей: одни и те же обещания на Binance, Bybit и OKX');
  printNote('режим: только демо-счета (isDemoMode: true) — боевые адреса скрипт не трогает');
  printNote(`биржи: ${commandLine.exchangeNameList.join(', ')}`);
  printNote(`постановка заявок: ${commandLine.isOrderAllowed ? 'РАЗРЕШЕНА ключом --allow-orders (демо-счета всех трёх бирж)' : 'запрещена, только чтение'}`);
  printNote('границу с trade-engine смотрите в scripts/README.md — обёртку здесь не проверяем');

  if (commandLine.unknownExchangeText !== '') {
    printNote(`неизвестные биржи в --exchange: ${commandLine.unknownExchangeText}; известны ${EXCHANGE_NAME_LIST.join(', ')}`);
  }

  if (commandLine.exchangeNameList.length === 0) {
    printNote('по отбору --exchange не осталось ни одной биржи');

    return;
  }

  const numberedCheckList = selectCheckList(commandLine.titleFilter);

  if (numberedCheckList.length === 0) {
    printNote(`по отбору --only=${commandLine.titleFilter} не нашлось ни одного обещания`);

    return;
  }

  const reportList: ExchangeCheckReport[] = commandLine.exchangeNameList.map((exchangeName) => ({
    exchangeName,
    entryList: [],
  }));
  const runState: ExchangeRunState = {
    context: null,
    currentAbortController: null,
    unsettledOrderProbe: null,
    isTotalDeadlineReached: false,
    isCleanupRequired: false,
  };
  const deadlineId = setTimeout(() => {
    handleTotalDeadline({ runState, reportList, numberedCheckList }).finally(() => process.exit(1));
  }, TOTAL_DEADLINE_MS);

  for (const report of reportList) {
    if (runState.isTotalDeadlineReached) {
      break;
    }

    await runExchangeCheckList(report, numberedCheckList, commandLine, runState);
  }

  if (runState.isTotalDeadlineReached) {
    return;
  }

  clearTimeout(deadlineId);
  printRunSummary(reportList, numberedCheckList);

  const exitCode = resolveExitCode(reportList);

  process.exitCode = exitCode;

  const watchdogId = setTimeout(() => {
    printNote(`процесс не завершился сам за ${LINGERING_TIMER_WATCH_MS / 1000} с после close() — что-то держит таймеры или сокеты`);
    process.exit(exitCode);
  }, LINGERING_TIMER_WATCH_MS);

  watchdogId.unref?.();
}

main().catch((error: unknown) => {
  printNote(`скрипт остановился с ошибкой: ${describeError(error)}`);
  process.exit(1);
});
