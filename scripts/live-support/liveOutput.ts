import type { LiveRunStatus } from './liveOutput.types';

const REDACTED_TEXT = '«скрыто»';
const EVIDENCE_INDENT = '      ';
const MIN_REDACTED_SECRET_LENGTH = 4;

export const STATUS_LABEL_BY_STATUS: Record<LiveRunStatus, string> = {
  confirmed: 'ПОДТВЕРЖДЕНО',
  notApplicable: 'НЕ ПРИМЕНИМО',
  diverged: 'РАСХОДИТСЯ  ',
  incomplete: 'НЕПОЛНАЯ    ',
  failed: 'НЕ УДАЛОСЬ  ',
  skipped: 'НЕ ВЫПОЛНЕНА',
};

export const SHORT_STATUS_BY_STATUS: Record<LiveRunStatus, string> = {
  confirmed: 'подтв.',
  notApplicable: 'не прим.',
  diverged: 'расх.',
  incomplete: 'неполн.',
  failed: 'неудача',
  skipped: 'пропуск',
};

/**
 * Статусы, при которых прогон не считается провальным. «Подтв.» — обещание держится; «не прим.» —
 * биржа этой величины не отдаёт вовсе, чинить нечего; «пропуск» — обещание сознательно не
 * выполнялось (нет ключей счёта или нет ключа запуска --allow-orders), и обещать по нему нечего.
 * Всё остальное («расх.», «неполн.», «неудача») требует человека и поднимает код выхода до 1.
 */
export const SUCCESSFUL_STATUS_LIST: readonly LiveRunStatus[] = ['confirmed', 'notApplicable', 'skipped'];

const secretList: string[] = [];

export function armSecretRedactor(candidateList: string[]): void {
  for (const candidate of candidateList) {
    if (candidate.length >= MIN_REDACTED_SECRET_LENGTH && !secretList.includes(candidate)) {
      secretList.push(candidate);
    }
  }
}

export function redactText(text: string): string {
  let safeText = text;

  for (const secret of secretList) {
    safeText = safeText.split(secret).join(REDACTED_TEXT);
  }

  return safeText;
}

export function formatPayload(payload: unknown): string {
  if (typeof payload === 'string') {
    return payload;
  }

  try {
    return JSON.stringify(payload);
  } catch {
    return String(payload);
  }
}

export function printBanner(text: string): void {
  console.log('');
  console.log(`═══ ${redactText(text)}`);
}

export function printEvidence(label: string, payload: unknown): void {
  console.log(`  ${redactText(label)}:`);
  console.log(`${EVIDENCE_INDENT}${redactText(formatPayload(payload))}`);
}

export function printNote(text: string): void {
  console.log(`  ${redactText(text)}`);
}
