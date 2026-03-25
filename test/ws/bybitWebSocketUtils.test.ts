import type { WebSocketOpenContext } from '@solncebro/websocket-engine';

import { authenticateBybitWebSocket, isBybitPongResponse } from '../../src/ws/bybitWebSocketUtils';
import type { BybitBaseWebSocketMessage } from '../../src/ws/bybitWebSocketUtils.types';
import { hmacSha256 } from '../../src/utils/crypto';
import { createMockLogger } from '../fixtures/mockLogger';

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

describe('authenticateBybitWebSocket', () => {
  const apiKey = 'testApiKey';
  const secret = 'testSecret';
  const label = 'TestStream';

  let logger: ReturnType<typeof createMockLogger>;

  function createMockContext(response: BybitBaseWebSocketMessage): WebSocketOpenContext<BybitBaseWebSocketMessage> {
    return {
      send: jest.fn(),
      waitForMessage: jest.fn().mockImplementation(async (predicate) => {
        if (predicate(response)) return response;
        throw new Error('No matching message');
      }),
    };
  }

  beforeEach(() => {
    logger = createMockLogger();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('resolves on Private WS success response (success: true)', async () => {
    const context = createMockContext({ op: 'auth', success: true, ret_msg: '' });

    await authenticateBybitWebSocket({ context, apiKey, secret, label, logger });

    expect(logger.info).not.toHaveBeenCalled();
  });

  it('resolves on Trade WS success response (retCode: 0)', async () => {
    const context = createMockContext({ op: 'auth', retCode: 0, retMsg: 'OK' });

    await authenticateBybitWebSocket({ context, apiKey, secret, label, logger });

    expect(logger.info).not.toHaveBeenCalled();
  });

  it('rejects with ret_msg when success is false', async () => {
    const context = createMockContext({ op: 'auth', success: false, ret_msg: 'Invalid API key' });

    await expect(
      authenticateBybitWebSocket({ context, apiKey, secret, label, logger }),
    ).rejects.toThrow(`[${label}] Auth failed: Invalid API key`);

    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining(`[${label}] Auth response`));
  });

  it('rejects with retCode when retCode is non-zero', async () => {
    const context = createMockContext({ op: 'auth', retCode: 10003, retMsg: 'Invalid key' });

    await expect(
      authenticateBybitWebSocket({ context, apiKey, secret, label, logger }),
    ).rejects.toThrow(`[${label}] Auth failed: Invalid key (code: 10003)`);
  });

  it('rejects with "unknown error" when no error details provided', async () => {
    const context = createMockContext({ op: 'auth', success: false });

    await expect(
      authenticateBybitWebSocket({ context, apiKey, secret, label, logger }),
    ).rejects.toThrow(`[${label}] Auth failed: unknown error`);
  });

  it('does not match non-auth messages', async () => {
    const context = createMockContext({ op: 'subscribe', success: true });

    await expect(
      authenticateBybitWebSocket({ context, apiKey, secret, label, logger }),
    ).rejects.toThrow('No matching message');
  });

  it('sends correct auth payload with HMAC signature', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(1700000000000);
    const context = createMockContext({ op: 'auth', success: true });

    await authenticateBybitWebSocket({ context, apiKey, secret, label, logger });

    const sendPayload = (context.send as jest.Mock).mock.calls[0][0];
    const expectedExpires = 1700000010000;
    const expectedSignature = hmacSha256(`GET/realtime${expectedExpires}`, secret);

    expect(sendPayload).toEqual({
      op: 'auth',
      args: [apiKey, expectedExpires, expectedSignature],
    });
  });

  it('logs full JSON response on auth failure', async () => {
    const response = { op: 'auth', retCode: 500, retMsg: 'Server error', extra: 'data' };
    const context = createMockContext(response);

    await expect(
      authenticateBybitWebSocket({ context, apiKey, secret, label, logger }),
    ).rejects.toThrow();

    expect(logger.error).toHaveBeenCalledWith(`[${label}] Auth response: ${JSON.stringify(response)}`);
  });
});
