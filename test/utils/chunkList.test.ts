import { chunkList } from '../../src/utils/chunkList';

describe('chunkList', () => {
  it('splits array into chunks of the given size', () => {
    expect(chunkList([1, 2, 3, 4, 5, 6, 7], 3)).toEqual([[1, 2, 3], [4, 5, 6], [7]]);
  });

  it('returns empty array for empty input', () => {
    expect(chunkList([], 3)).toEqual([]);
  });

  it('returns single chunk when input fits within chunkSize', () => {
    expect(chunkList([1, 2], 5)).toEqual([[1, 2]]);
  });

  it('returns single chunk when input length equals chunkSize', () => {
    expect(chunkList([1, 2, 3], 3)).toEqual([[1, 2, 3]]);
  });

  it('preserves order across chunks', () => {
    const result = chunkList(['a', 'b', 'c', 'd', 'e'], 2);
    expect(result).toEqual([['a', 'b'], ['c', 'd'], ['e']]);
  });

  it('throws on zero chunkSize', () => {
    expect(() => chunkList([1, 2], 0)).toThrow('chunkSize must be a positive integer');
  });

  it('throws on negative chunkSize', () => {
    expect(() => chunkList([1, 2], -1)).toThrow('chunkSize must be a positive integer');
  });

  it('throws on non-integer chunkSize', () => {
    expect(() => chunkList([1, 2], 1.5)).toThrow('chunkSize must be a positive integer');
  });
});
