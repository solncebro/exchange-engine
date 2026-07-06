import { isBybitPongResponse } from '../../src/ws/bybitWebSocketUtils';

describe('isBybitPongResponse', () => {
  it('returns true when op is "pong"', () => {
    expect(isBybitPongResponse({ op: 'pong' })).toBe(true);
  });

  it('returns true when ret_msg is "pong"', () => {
    expect(isBybitPongResponse({ ret_msg: 'pong' })).toBe(true);
  });

  it('returns false for regular message', () => {
    expect(isBybitPongResponse({ op: 'subscribe', data: [] })).toBe(false);
  });

  it('returns false for empty message', () => {
    expect(isBybitPongResponse({})).toBe(false);
  });
});
