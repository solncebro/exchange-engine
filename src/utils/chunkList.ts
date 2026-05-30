export function chunkList<T>(list: T[], chunkSize: number): T[][] {
  if (!Number.isInteger(chunkSize) || chunkSize <= 0) {
    throw new Error('chunkSize must be a positive integer');
  }

  const result: T[][] = [];

  for (let chunkStart = 0; chunkStart < list.length; chunkStart += chunkSize) {
    result.push(list.slice(chunkStart, chunkStart + chunkSize));
  }

  return result;
}
