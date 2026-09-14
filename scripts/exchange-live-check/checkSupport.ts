const VIOLATION_SAMPLE_LIMIT = 4;
const MAX_REPRESENTABLE_DATE_MS = 8.64e15;

export function isPositiveFiniteNumber(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

export function isPositiveFiniteText(text: string): boolean {
  return text !== '' && isPositiveFiniteNumber(Number(text));
}

export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return String(value);
  }

  return String(Number(value.toPrecision(8)));
}

export function joinViolationSample(violationList: string[]): string {
  const sampleList = violationList.slice(0, VIOLATION_SAMPLE_LIMIT);
  const tailText = violationList.length > sampleList.length ? ` и ещё ${violationList.length - sampleList.length}` : '';

  return `${sampleList.join('; ')}${tailText}`;
}

export function formatTimestamp(value: number): string {
  if (!Number.isFinite(value) || Math.abs(value) > MAX_REPRESENTABLE_DATE_MS) {
    return `${String(value)} (временем не разбирается)`;
  }

  return new Date(value).toISOString();
}
