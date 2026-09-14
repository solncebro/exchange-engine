import { WebSocketStatus } from '@solncebro/websocket-engine';

import { OkxPrivateStream } from '../../src/ws/OkxPrivateStream';
import { WebSocketConnectionTypeEnum } from '../../src/types/common';
import type { OkxSubscriptionArg } from '../../src/ws/okxWebSocketUtils.types';
import {
  OKX_PING_INTERVAL,
  OKX_SERVICE_UPGRADE_NOTICE_CODE,
  OKX_SILENT_THRESHOLD_MS,
  OKX_STALE_CHECK_INTERVAL_MS,
  OKX_STALE_THRESHOLD_MS,
} from '../../src/constants/okx';
import { createMockLogger } from '../fixtures/mockLogger';

let capturedOnMessage: ((message: any) => void) | undefined;
let capturedOnOpen: ((context: any) => Promise<void>) | undefined;
let capturedOnClose: ((context: any) => void) | undefined;

const mockWebSocket = {
  close: jest.fn(),
  getStatus: jest.fn().mockReturnValue(WebSocketStatus.CONNECTED),
};

jest.mock('@solncebro/websocket-engine', () => {
  const actual = jest.requireActual('@solncebro/websocket-engine');

  return {
    ...actual,
    ReliableWebSocket: jest.fn().mockImplementation((args: any) => {
      capturedOnMessage = args.onMessage;
      capturedOnOpen = args.onOpen;
      capturedOnClose = args.onClose;

      return mockWebSocket;
    }),
  };
});

jest.mock('../../src/ws/okxWebSocketAuth', () => ({
  authenticateOkxWebSocket: jest.fn().mockResolvedValue(undefined),
}));

describe('OkxPrivateStream', () => {
  const mockLogger = createMockLogger();
  const url = 'wss://ws.okx.com:8443/ws/v5/private';
  const label = 'OkxPrivateStream';
  const apiKey = 'testKey';
  const secret = 'testSecret';
  const passphrase = 'testPassphrase';

  beforeEach(() => {
    jest.clearAllMocks();
    capturedOnMessage = undefined;
    capturedOnOpen = undefined;
    capturedOnClose = undefined;
  });

  function createStream(onMessage = jest.fn(), subscriptionArgList: OkxSubscriptionArg[] = [{ channel: 'orders', instType: 'SWAP' }]) {
    return {
      stream: new OkxPrivateStream({
        label,
        url,
        apiKey,
        secret,
        passphrase,
        logger: mockLogger,
        onMessage,
        subscriptionArgList,
      }),
      onMessage,
    };
  }

  describe('connect', () => {
    it('creates WebSocket with correct URL and label', () => {
      const { ReliableWebSocket } = require('@solncebro/websocket-engine');
      const { stream } = createStream();

      stream.connect();

      expect(ReliableWebSocket).toHaveBeenCalledWith(expect.objectContaining({ url, label }));
    });

    it('does not create a second WebSocket on repeated connect', () => {
      const { ReliableWebSocket } = require('@solncebro/websocket-engine');
      const { stream } = createStream();

      stream.connect();
      stream.connect();

      expect(ReliableWebSocket).toHaveBeenCalledTimes(1);
    });

    it('authenticates then subscribes on open', async () => {
      const { authenticateOkxWebSocket } = require('../../src/ws/okxWebSocketAuth');
      const { stream } = createStream(jest.fn(), [{ channel: 'orders', instType: 'SWAP' }]);
      stream.connect();

      const mockContext = { send: jest.fn(), waitForMessage: jest.fn() };
      await capturedOnOpen!(mockContext);

      expect(authenticateOkxWebSocket).toHaveBeenCalledWith(
        expect.objectContaining({ context: mockContext, apiKey, secret, passphrase, label }),
      );
      expect(mockContext.send).toHaveBeenCalledWith({ op: 'subscribe', args: [{ channel: 'orders', instType: 'SWAP' }] });
    });

    it('hands the liveness check to the engine as a bare-text ping with the OKX thresholds', () => {
      const { ReliableWebSocket } = require('@solncebro/websocket-engine');
      const { stream } = createStream();
      stream.connect();

      const args = (ReliableWebSocket as jest.Mock).mock.calls[0][0];

      expect(args.heartbeat.buildPayload()).toBe('ping');
      expect(args.heartbeat.isResponse({ event: 'pong' })).toBe(true);
      expect(args.heartbeat.isResponse({ event: 'error' })).toBe(false);
      expect(args.configuration).toEqual({
        pingInterval: OKX_PING_INTERVAL,
        staleThreshold: OKX_STALE_THRESHOLD_MS,
        staleCheckInterval: OKX_STALE_CHECK_INTERVAL_MS,
      });
    });

    it('does not send a subscribe frame when there are no subscription args', async () => {
      const { stream } = createStream(jest.fn(), []);
      stream.connect();

      const mockContext = { send: jest.fn(), waitForMessage: jest.fn() };
      await capturedOnOpen!(mockContext);

      expect(mockContext.send).not.toHaveBeenCalled();
    });

    it('authenticates and subscribes again after a reconnect (re-invoked onOpen)', async () => {
      const { authenticateOkxWebSocket } = require('../../src/ws/okxWebSocketAuth');
      const { stream } = createStream();
      stream.connect();

      const mockContext = { send: jest.fn(), waitForMessage: jest.fn() };
      await capturedOnOpen!(mockContext);
      await capturedOnOpen!(mockContext);

      expect(authenticateOkxWebSocket).toHaveBeenCalledTimes(2);
      expect(mockContext.send).toHaveBeenCalledTimes(2);
    });
  });

  describe('a login that fails is not swallowed', () => {
    it('rejects the open so the engine tears the socket down and never reaches the ping phase', async () => {
      const { authenticateOkxWebSocket } = require('../../src/ws/okxWebSocketAuth');
      (authenticateOkxWebSocket as jest.Mock).mockRejectedValueOnce(new Error('Login failed: code 60009'));

      const { stream } = createStream();
      stream.connect();

      const mockContext = { send: jest.fn(), waitForMessage: jest.fn() };

      await expect(capturedOnOpen!(mockContext)).rejects.toThrow('Login failed');
      expect(mockContext.send).not.toHaveBeenCalled();
      expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('login failed on open'));
    });
  });

  describe('the exchange warns a minute before a planned disconnect', () => {
    it('reopens the connection ahead of the break and writes it as information', () => {
      const { ReliableWebSocket } = require('@solncebro/websocket-engine');
      const { stream } = createStream();
      stream.connect();

      capturedOnMessage!({ event: 'notice', code: OKX_SERVICE_UPGRADE_NOTICE_CODE, msg: 'The connection will soon be closed for a service upgrade. Please reconnect.' });

      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining(OKX_SERVICE_UPGRADE_NOTICE_CODE));
      expect(mockWebSocket.close).toHaveBeenCalledTimes(1);
      expect(ReliableWebSocket).toHaveBeenCalledTimes(2);
    });
  });

  describe('handleMessage', () => {
    it('forwards a channel frame with arg and data to the handler', () => {
      const onMessage = jest.fn();
      const { stream } = createStream(onMessage);
      stream.connect();

      const frame = { arg: { channel: 'orders', instId: 'BTC-USDT-SWAP' }, data: [{ ordId: '123' }] };
      capturedOnMessage!(frame);

      expect(onMessage).toHaveBeenCalledWith(frame);
    });

    it('does not forward pong frames', () => {
      const onMessage = jest.fn();
      const { stream } = createStream(onMessage);
      stream.connect();

      capturedOnMessage!({ event: 'pong' });

      expect(onMessage).not.toHaveBeenCalled();
    });

    it('does not forward error frames and logs them', () => {
      const onMessage = jest.fn();
      const { stream } = createStream(onMessage);
      stream.connect();

      capturedOnMessage!({ event: 'error', code: '60018', msg: 'Invalid args' });

      expect(onMessage).not.toHaveBeenCalled();
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('logs an error when the handler throws', () => {
      const onMessage = jest.fn().mockImplementation(() => {
        throw new Error('handler error');
      });
      const { stream } = createStream(onMessage);
      stream.connect();

      capturedOnMessage!({ arg: { channel: 'positions' }, data: [] });

      expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('handler error'));
    });

    it('does not forward notice frames and logs them as a distinct server notice warning carrying the code', () => {
      const onMessage = jest.fn();
      const { stream } = createStream(onMessage);
      stream.connect();

      capturedOnMessage!({ event: 'notice', code: '60041', msg: 'Sub-account has no permission' });

      expect(onMessage).not.toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('server notice'));
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('60041'));
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Sub-account has no permission'));
      expect(mockWebSocket.close).not.toHaveBeenCalled();
    });

    it('logs channel-conn-count-error frames as errors and does not forward them', () => {
      const onMessage = jest.fn();
      const { stream } = createStream(onMessage);
      stream.connect();

      capturedOnMessage!({ event: 'channel-conn-count-error', channel: 'orders', connCount: '30', connId: 'a4d3ae55' });

      expect(onMessage).not.toHaveBeenCalled();
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('logs unrecognized service frames as warnings and does not forward them', () => {
      const onMessage = jest.fn();
      const { stream } = createStream(onMessage);
      stream.connect();

      capturedOnMessage!({ event: 'unsubscribe', arg: { channel: 'orders' } });

      expect(onMessage).not.toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalled();
    });

  });

  describe('a channel that pushes no data of its own must never be torn down by the stream', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('runs no data-silence watchdog: long silence leaves the socket alone', async () => {
      const { ReliableWebSocket } = require('@solncebro/websocket-engine');
      const { stream } = createStream();
      stream.connect();
      await capturedOnOpen!({ send: jest.fn(), waitForMessage: jest.fn() });

      await jest.advanceTimersByTimeAsync(OKX_SILENT_THRESHOLD_MS * 3);

      expect(mockWebSocket.close).not.toHaveBeenCalled();
      expect(ReliableWebSocket).toHaveBeenCalledTimes(1);
      expect(stream.isConnected()).toBe(true);
    });

    it('leaves no stream-owned timer for the engine close to clean up', async () => {
      const { stream } = createStream();
      stream.connect();
      await capturedOnOpen!({ send: jest.fn(), waitForMessage: jest.fn() });

      expect(capturedOnClose).toBeUndefined();
      expect(jest.getTimerCount()).toBe(0);
    });
  });

  describe('getConnectionInfo', () => {
    it('returns null before connect', () => {
      const { stream } = createStream();

      expect(stream.getConnectionInfo()).toBeNull();
    });

    it('returns UserData type and subscription labels after connect', () => {
      const { stream } = createStream(jest.fn(), [
        { channel: 'orders', instType: 'SWAP' },
        { channel: 'account' },
      ]);
      stream.connect();

      const info = stream.getConnectionInfo();

      expect(info?.type).toBe(WebSocketConnectionTypeEnum.UserData);
      expect(info?.subscriptionList).toEqual(['orders SWAP', 'account']);
    });

    /** E3. Список обязан показывать ПРИНЯТОЕ биржей, а не запрошенное нами. */
    it('drops a refused channel from the list instead of listing it as subscribed', async () => {
      const { stream } = createStream(jest.fn(), [
        { channel: 'orders', instType: 'SWAP' },
        { channel: 'account' },
      ]);
      stream.connect();
      await capturedOnOpen!({ send: jest.fn(), waitForMessage: jest.fn() });

      capturedOnMessage!({ event: 'error', code: '60018', msg: 'nope', arg: { channel: 'account' } });

      expect(stream.getConnectionInfo()?.subscriptionList).toEqual(['orders SWAP']);
    });

    it('matches a refusal that names only the channel against a subscription that also names instType', async () => {
      const { stream } = createStream(jest.fn(), [{ channel: 'orders', instType: 'SWAP' }]);
      stream.connect();
      await capturedOnOpen!({ send: jest.fn(), waitForMessage: jest.fn() });

      capturedOnMessage!({ event: 'error', code: '60018', msg: 'nope', arg: { channel: 'orders' } });

      expect(stream.getConnectionInfo()?.subscriptionList).toEqual([]);
    });

    it('keeps the whole list when the refusal names no channel at all', async () => {
      const { stream } = createStream(jest.fn(), [{ channel: 'orders', instType: 'SWAP' }]);
      stream.connect();
      await capturedOnOpen!({ send: jest.fn(), waitForMessage: jest.fn() });

      capturedOnMessage!({ event: 'error', code: '60012', msg: 'Invalid request' });

      expect(stream.getConnectionInfo()?.subscriptionList).toEqual(['orders SWAP']);
    });

    it('puts a refused channel back on the list once the socket is opened and subscribed again', async () => {
      const { stream } = createStream(jest.fn(), [{ channel: 'orders', instType: 'SWAP' }]);
      stream.connect();
      await capturedOnOpen!({ send: jest.fn(), waitForMessage: jest.fn() });

      capturedOnMessage!({ event: 'error', code: '60018', msg: 'nope', arg: { channel: 'orders', instType: 'SWAP' } });

      expect(stream.getConnectionInfo()?.subscriptionList).toEqual([]);

      await capturedOnOpen!({ send: jest.fn(), waitForMessage: jest.fn() });

      expect(stream.getConnectionInfo()?.subscriptionList).toEqual(['orders SWAP']);
    });
  });

  describe('close', () => {
    it('closes the WebSocket and reports itself disconnected', () => {
      const { stream } = createStream();
      stream.connect();

      stream.close();

      expect(mockWebSocket.close).toHaveBeenCalledTimes(1);
      expect(stream.isConnected()).toBe(false);
    });
  });

  describe('isConnected', () => {
    it('returns false before connect', () => {
      const { stream } = createStream();

      expect(stream.isConnected()).toBe(false);
    });

    it('returns true after connect', () => {
      const { stream } = createStream();
      stream.connect();

      expect(stream.isConnected()).toBe(true);
    });
  });
});
