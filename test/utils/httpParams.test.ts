import { applyTimeRangeOptions } from '../../src/utils/httpParams';

describe('applyTimeRangeOptions', () => {
  it('does not mutate params when options is undefined', () => {
    const params: Record<string, string | number | boolean> = { symbol: 'BTCUSDT' };
    applyTimeRangeOptions(params, undefined);

    expect(params).toEqual({ symbol: 'BTCUSDT' });
  });

  it('does not mutate params when options is empty object', () => {
    const params: Record<string, string | number | boolean> = { symbol: 'BTCUSDT' };
    applyTimeRangeOptions(params, {});

    expect(params).toEqual({ symbol: 'BTCUSDT' });
  });

  it('sets startTime when provided', () => {
    const params: Record<string, string | number | boolean> = {};
    applyTimeRangeOptions(params, { startTime: 1700000000000 });

    expect(params.startTime).toBe(1700000000000);
  });

  it('sets endTime when provided', () => {
    const params: Record<string, string | number | boolean> = {};
    applyTimeRangeOptions(params, { endTime: 1700003600000 });

    expect(params.endTime).toBe(1700003600000);
  });

  it('sets limit when provided', () => {
    const params: Record<string, string | number | boolean> = {};
    applyTimeRangeOptions(params, { limit: 500 });

    expect(params.limit).toBe(500);
  });

  it('sets all fields when all provided', () => {
    const params: Record<string, string | number | boolean> = {};
    applyTimeRangeOptions(params, { startTime: 100, endTime: 200, limit: 50 });

    expect(params).toEqual({ startTime: 100, endTime: 200, limit: 50 });
  });
});
