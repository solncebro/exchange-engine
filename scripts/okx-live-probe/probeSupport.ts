import { countDecimalPlaces } from '../../src/precision/precision';
import { toErrorCode } from '../live-support/liveError';

/**
 * Отказы, которые говорят о ключах, отметке времени или частоте запросов, а НЕ о существе пробы.
 * Отдельно отсутствует 50113 («Invalid Signature»): именно такой отказ и был бы расхождением в
 * пробе про запятую в подписанной строке, поэтому за неудачу самой пробы он не считается.
 */
const CREDENTIAL_FAILURE_CODE_LIST: readonly string[] = [
  '50011',
  '50101',
  '50102',
  '50103',
  '50104',
  '50105',
  '50106',
  '50107',
  '50111',
  '50112',
  '50114',
];

export function toFieldMap(source: object): Record<string, unknown> {
  const fieldMap: Record<string, unknown> = {};

  for (const [name, value] of Object.entries(source)) {
    fieldMap[name] = value;
  }

  return fieldMap;
}

export function readTextField(source: object, name: string): string {
  const value = toFieldMap(source)[name];

  return typeof value === 'string' ? value : '';
}

export function isCredentialOrRateLimitFailure(error: unknown): boolean {
  return CREDENTIAL_FAILURE_CODE_LIST.includes(toErrorCode(error));
}

export function snapPriceToTick(price: number, tickSize: string): string {
  const tick = Number(tickSize);

  if (!Number.isFinite(tick) || tick <= 0) {
    return String(price);
  }

  return (Math.floor(price / tick) * tick).toFixed(countDecimalPlaces(tickSize));
}
