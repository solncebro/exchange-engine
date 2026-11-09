import { describeError, toErrorCode } from '../live-support/liveError';
import { printNote, redactText, SHORT_STATUS_BY_STATUS } from '../live-support/liveOutput';
import type { LiveCheckContext, LiveCheckOutcome, LiveCheckReportEntry } from './liveCheck.types';
import type { ExchangeRunState, RunCheckArgs } from './checkRunner.types';

const IP_BOUND_KEY_ERROR_CODE = '10010';
const PROBE_CLEANUP_GRACE_MS = 90_000;

function describeCheckFailure(error: unknown): string {
  if (toErrorCode(error) === IP_BOUND_KEY_ERROR_CODE) {
    return `не удалось: ключ привязан к списку адресов биржи, а адрес этой машины в нём не числится (${describeError(error)})`;
  }

  return describeError(error);
}

function describeRateLimitHold(context: LiveCheckContext): string {
  const { bannedUntilMs } = context.exchange.futures.getRateLimitState();

  if (bannedUntilMs === null) {
    return '';
  }

  return `; биржа держит этот адрес закрытым до ${new Date(bannedUntilMs).toISOString()} — ждали её, а не ответа`;
}

async function waitForSettlement(settlement: Promise<void>, timeoutMs: number): Promise<boolean> {
  let timerId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<boolean>((resolve) => {
    timerId = setTimeout(() => resolve(false), timeoutMs);
  });

  try {
    return await Promise.race([settlement.then(() => true), timeout]);
  } finally {
    clearTimeout(timerId);
  }
}

function rememberUnsettledOrderProbe(runState: ExchangeRunState, title: string, settlement: Promise<void>): void {
  runState.unsettledOrderProbe = { title, settlement };

  settlement.then(() => {
    if (runState.unsettledOrderProbe?.settlement !== settlement) {
      return;
    }

    runState.unsettledOrderProbe = null;
    printNote(`сорванная по сроку проба «${redactText(title)}» завершила уборку — пробы с заявками снова разрешены`);
  });
}

async function runWithDeadline(context: LiveCheckContext, args: RunCheckArgs): Promise<LiveCheckOutcome> {
  const { check, runState } = args;
  const abortController = new AbortController();
  const runPromise = check.run(context, abortController.signal);
  const settlement = runPromise.then(
    () => undefined,
    () => undefined,
  );

  let timerId: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<null>((resolve) => {
    timerId = setTimeout(() => resolve(null), check.timeoutMs);
  });

  runState.currentAbortController = abortController;

  try {
    const outcome = await Promise.race([runPromise, deadline]);

    if (outcome !== null) {
      return outcome;
    }
  } finally {
    clearTimeout(timerId);
  }

  const deadlineText = `проверка не уложилась в ${check.timeoutMs / 1000} с${describeRateLimitHold(context)}`;

  abortController.abort(new Error(deadlineText));
  printNote(`${deadlineText} — пробе подан сигнал остановки, ждём её уборку до ${PROBE_CLEANUP_GRACE_MS / 1000} с`);

  const isSettled = await waitForSettlement(settlement, PROBE_CLEANUP_GRACE_MS);

  runState.currentAbortController = null;

  if (isSettled) {
    throw new Error(`${deadlineText}; проба остановлена и свою уборку завершила`);
  }

  if (check.isOrdersRequired) {
    rememberUnsettledOrderProbe(runState, check.title, settlement);

    throw new Error(
      `${deadlineText}; проба остановлена, но уборку за ${PROBE_CLEANUP_GRACE_MS / 1000} с не завершила — ` +
      'пробы с заявками не запускаются, пока она не закончит',
    );
  }

  throw new Error(`${deadlineText}; проба остановлена, но не завершилась за ${PROBE_CLEANUP_GRACE_MS / 1000} с (заявок она не ставит)`);
}

export async function runCheck(args: RunCheckArgs): Promise<LiveCheckReportEntry> {
  const { check, context, checkNumber, hasCredentials, runState } = args;

  console.log('');
  console.log(`── ${context.exchangeName}, обещание ${checkNumber}. ${redactText(check.title)}`);

  if (check.isCredentialsRequired && !hasCredentials) {
    printNote('пропущено: обещание проверяется только по ключам счёта');

    return { title: check.title, outcome: { status: 'skipped', fact: 'ключи счёта не заданы' } };
  }

  if (check.isOrdersRequired && !context.settings.isOrderAllowed) {
    printNote('пропущено: обещание ставит заявку, для неё нужен ключ --allow-orders');

    return { title: check.title, outcome: { status: 'skipped', fact: 'нужен ключ --allow-orders — по умолчанию скрипт только читает' } };
  }

  if (check.isOrdersRequired && runState.unsettledOrderProbe !== null) {
    const fact =
      `не запускалась: проба «${runState.unsettledOrderProbe.title}» сорвана по сроку и до сих пор не завершила уборку — ` +
      'ставить заявки поверх незавершённой уборки нельзя';

    printNote(redactText(fact));

    return { title: check.title, outcome: { status: 'incomplete', fact } };
  }

  const startedAtMs = Date.now();

  try {
    const outcome = await runWithDeadline(context, args);

    printNote(`${SHORT_STATUS_BY_STATUS[outcome.status]} ${outcome.fact} [ждали ${Math.round((Date.now() - startedAtMs) / 1000)} с]`);

    return { title: check.title, outcome };
  } catch (error) {
    const fact = describeCheckFailure(error);

    printNote(`проверка сорвалась: ${fact} [ждали ${Math.round((Date.now() - startedAtMs) / 1000)} с]`);

    return { title: check.title, outcome: { status: 'failed', fact } };
  } finally {
    runState.currentAbortController = null;
  }
}
