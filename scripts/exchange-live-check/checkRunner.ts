import { describeError, toErrorCode } from '../live-support/liveError';
import { printNote, redactText, SHORT_STATUS_BY_STATUS } from '../live-support/liveOutput';
import type { LiveCheckContext, LiveCheckOutcome, LiveCheckReportEntry } from './liveCheck.types';
import type { RunCheckArgs } from './checkRunner.types';

const IP_BOUND_KEY_ERROR_CODE = '10010';

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

async function runWithDeadline(context: LiveCheckContext, args: RunCheckArgs): Promise<LiveCheckOutcome> {
  let timerId: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timerId = setTimeout(
      () => reject(new Error(`проверка не уложилась в ${args.check.timeoutMs / 1000} с${describeRateLimitHold(context)}`)),
      args.check.timeoutMs,
    );
  });

  try {
    return await Promise.race([args.check.run(context), deadline]);
  } finally {
    clearTimeout(timerId);
  }
}

export async function runCheck(args: RunCheckArgs): Promise<LiveCheckReportEntry> {
  const { check, context, index, hasCredentials } = args;

  console.log('');
  console.log(`── ${context.exchangeName}, обещание ${index}. ${redactText(check.title)}`);

  if (check.isCredentialsRequired && !hasCredentials) {
    printNote('пропущено: обещание проверяется только по ключам счёта');

    return { title: check.title, outcome: { status: 'skipped', fact: 'ключи счёта не заданы' } };
  }

  if (check.isOrdersRequired && !context.settings.isOrderAllowed) {
    printNote('пропущено: обещание ставит заявку, для неё нужен ключ --allow-orders');

    return { title: check.title, outcome: { status: 'skipped', fact: 'нужен ключ --allow-orders — по умолчанию скрипт только читает' } };
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
  }
}
