export function serializeQueryParams(params: Record<string, unknown>): string {
  const entryList = Object.entries(params).map(([key, value]): [string, string] => [key, String(value)]);

  return new URLSearchParams(entryList).toString();
}
