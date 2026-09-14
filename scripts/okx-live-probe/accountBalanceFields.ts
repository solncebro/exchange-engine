import type { OkxProbe, OkxProbeContext, OkxProbeOutcome } from './probe.types';
import { readTextField } from './probeSupport';

const CLAIM = 'В режиме счёта владельца ответ /api/v5/account/balance заполняет availEq, adjEq, imr, ordFroz и upl';
const EXPECTATION = 'Все пять сводных полей приходят непустыми строками при текущем acctLv счёта';
const PROBE_TIMEOUT_MS = 30000;
const REQUIRED_FIELD_NAME_LIST = ['availEq', 'adjEq', 'imr', 'ordFroz', 'upl'];

async function runAccountBalanceFieldsProbe(context: OkxProbeContext): Promise<OkxProbeOutcome> {
  const accountConfigList = await context.httpClient.fetchAccountConfig();
  const balanceList = await context.httpClient.fetchBalance();

  context.showEvidence('ответ /api/v5/account/config (дословно)', accountConfigList);
  context.showEvidence('ответ /api/v5/account/balance (дословно)', balanceList);

  const accountLevel = accountConfigList[0]?.acctLv ?? '';
  const balance = balanceList[0];

  if (balance === undefined) {
    return { status: 'failed', fact: 'биржа вернула пустой ответ по балансу', expectation: EXPECTATION };
  }

  const emptyFieldNameList = REQUIRED_FIELD_NAME_LIST.filter((name) => readTextField(balance, name) === '');
  const valueByName: Record<string, string> = {};

  for (const name of REQUIRED_FIELD_NAME_LIST) {
    valueByName[name] = readTextField(balance, name);
  }

  context.showEvidence(`сводные поля при acctLv = ${accountLevel}`, valueByName);

  if (emptyFieldNameList.length === 0) {
    return {
      status: 'confirmed',
      fact: `при acctLv = ${accountLevel} заполнены все пять полей: ${JSON.stringify(valueByName)}`,
      expectation: EXPECTATION,
    };
  }

  return {
    status: 'diverged',
    fact: `при acctLv = ${accountLevel} пусты: ${emptyFieldNameList.join(', ')}`,
    expectation: EXPECTATION,
  };
}

export const accountBalanceFieldsProbe: OkxProbe = {
  claim: CLAIM,
  timeoutMs: PROBE_TIMEOUT_MS,
  isOrdersRequired: false,
  run: runAccountBalanceFieldsProbe,
};
