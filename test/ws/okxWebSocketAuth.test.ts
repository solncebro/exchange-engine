import type { WebSocketOpenContext } from '@solncebro/websocket-engine';

import { authenticateOkxWebSocket } from '../../src/ws/okxWebSocketAuth';
import type { OkxWebSocketMessage } from '../../src/ws/okxWebSocketUtils.types';
import { hmacSha256Base64 } from '../../src/utils/crypto';
import { createMockLogger } from '../fixtures/mockLogger';

describe('authenticateOkxWebSocket', () => {
  const apiKey = 'testApiKey';
  const secret = 'testSecret';
  const passphrase = 'testPassphrase';
  const label = 'TestStream';

  let logger: ReturnType<typeof createMockLogger>;

  function createMockContext(response: OkxWebSocketMessage): WebSocketOpenContext<OkxWebSocketMessage> {
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
    jest.spyOn(Date, 'now').mockReturnValue(1700000000000);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('sends correct login payload with HMAC signature', async () => {
    const context = createMockContext({ event: 'login', code: '0', msg: '' });

    await authenticateOkxWebSocket({ context, apiKey, secret, passphrase, label, logger });

    const sendPayload = (context.send as jest.Mock).mock.calls[0][0];
    const expectedSign = hmacSha256Base64('1700000000GET/users/self/verify', secret);

    expect(sendPayload).toEqual({
      op: 'login',
      args: [{ apiKey, passphrase, timestamp: '1700000000', sign: expectedSign }],
    });
  });

  it('resolves on login success (code: "0")', async () => {
    const context = createMockContext({ event: 'login', code: '0', msg: '' });

    await expect(
      authenticateOkxWebSocket({ context, apiKey, secret, passphrase, label, logger }),
    ).resolves.toBeUndefined();

    expect(logger.error).not.toHaveBeenCalled();
  });

  it('rejects on event "error"', async () => {
    const context = createMockContext({ event: 'error', code: '60009', msg: 'Login failed.' });

    await expect(
      authenticateOkxWebSocket({ context, apiKey, secret, passphrase, label, logger }),
    ).rejects.toThrow(`[${label}] Login failed: Login failed. (code: 60009)`);

    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining(`[${label}] Login response`));
  });

  it('rejects on login failure with non-zero code', async () => {
    const context = createMockContext({ event: 'login', code: '60009', msg: 'Login failed.' });

    await expect(
      authenticateOkxWebSocket({ context, apiKey, secret, passphrase, label, logger }),
    ).rejects.toThrow(`[${label}] Login failed: Login failed. (code: 60009)`);

    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining(`[${label}] Login response`));
  });

  it('does not match unrelated frames', async () => {
    const context = createMockContext({ event: 'subscribe' });

    await expect(
      authenticateOkxWebSocket({ context, apiKey, secret, passphrase, label, logger }),
    ).rejects.toThrow('No matching message');
  });
});
