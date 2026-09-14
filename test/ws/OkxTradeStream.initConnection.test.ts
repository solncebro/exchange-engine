import { WebSocketStatus } from '@solncebro/websocket-engine';

import { OkxTradeStream } from '../../src/ws/OkxTradeStream';
import {
  OKX_CLIENT_ORDER_ID_PATTERN,
  OKX_PING_INTERVAL,
  OKX_SERVICE_UPGRADE_NOTICE_CODE,
  OKX_SERVICE_UPGRADE_RECONNECT_DEADLINE_MS,
  OKX_SILENT_THRESHOLD_MS,
  OKX_STALE_CHECK_INTERVAL_MS,
  OKX_STALE_THRESHOLD_MS,
} from '../../src/constants/okx';
import { createMockLogger } from '../fixtures/mockLogger';
import { createOkxSwapSymbolMap, OKX_BTC_SWAP_INST_ID_CODE } from '../fixtures/okxSymbolMap';

let capturedOnOpen: ((context: any) => Promise<void>) | undefined;
let capturedOnMessage: ((message: any) => void) | undefined;

const mockWebSocket = {
  getStatus: jest.fn().mockReturnValue(WebSocketStatus.CONNECTED),
  close: jest.fn(),
  sendToConnectedSocket: jest.fn(),
};

jest.mock('@solncebro/websocket-engine', () => {
  const actual = jest.requireActual('@solncebro/websocket-engine');

  return {
    ...actual,
    ReliableWebSocket: jest.fn().mockImplementation((args: any) => {
      capturedOnOpen = args.onOpen;
      capturedOnMessage = args.onMessage;

      return mockWebSocket;
    }),
  };
});

jest.mock('../../src/ws/okxWebSocketAuth', () => ({
  authenticateOkxWebSocket: jest.fn().mockResolvedValue(undefined),
}));

async function flushMicrotasks(rounds = 5): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await Promise.resolve();
  }
}

describe('OkxTradeStream', () => {
  const mockLogger = createMockLogger();
  const url = 'wss://ws.okx.com:8443/ws/v5/private';
  const label = '[OKX] Trade stream';
  const apiKey = 'testApiKey';
  const secret = 'testSecret';
  const passphrase = 'testPassphrase';

  function createStream(): OkxTradeStream {
    return new OkxTradeStream({ url, label, logger: mockLogger, apiKey, secret, passphrase, symbolMap: createOkxSwapSymbolMap() });
  }

  async function openConnection(stream: OkxTradeStream): Promise<{ send: jest.Mock; waitForMessage: jest.Mock }> {
    const connectPromise = stream.connect();
    const mockContext = { send: jest.fn(), waitForMessage: jest.fn().mockResolvedValue(undefined) };
    await capturedOnOpen!(mockContext);
    await connectPromise;

    return mockContext;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockWebSocket.getStatus.mockReturnValue(WebSocketStatus.CONNECTED);
    capturedOnOpen = undefined;
    capturedOnMessage = undefined;
  });

  describe('a login that fails on reopen is not swallowed', () => {
    it('rejects the open and keeps isConnected false', async () => {
      const { authenticateOkxWebSocket } = require('../../src/ws/okxWebSocketAuth');
      const stream = createStream();

      await openConnection(stream);

      mockWebSocket.getStatus.mockReturnValue(WebSocketStatus.DISCONNECTED);
      (authenticateOkxWebSocket as jest.Mock).mockRejectedValueOnce(new Error('Login failed: code 60009'));

      const mockContext = { send: jest.fn(), waitForMessage: jest.fn() };

      await expect(capturedOnOpen!(mockContext)).rejects.toThrow('Login failed');
      expect(stream.isConnected()).toBe(false);
      expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('login failed on open'));
    });

    it('rejects the very first connect when the login is refused', async () => {
      const { authenticateOkxWebSocket } = require('../../src/ws/okxWebSocketAuth');
      (authenticateOkxWebSocket as jest.Mock).mockRejectedValueOnce(new Error('Login failed: code 60009'));

      const stream = createStream();
      const connectPromise = stream.connect();
      const mockContext = { send: jest.fn(), waitForMessage: jest.fn() };

      await expect(capturedOnOpen!(mockContext)).rejects.toThrow('Login failed');
      await expect(connectPromise).rejects.toThrow('Login failed');
    });
  });

  describe('the exchange warns a minute before a planned disconnect', () => {
    it('reconnects ahead of the break when no request is in flight', async () => {
      const stream = createStream();

      await openConnection(stream);

      const { ReliableWebSocket } = require('@solncebro/websocket-engine');

      capturedOnMessage!({ event: 'notice', code: OKX_SERVICE_UPGRADE_NOTICE_CODE, msg: 'The connection will soon be closed for a service upgrade. Please reconnect.' });

      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining(OKX_SERVICE_UPGRADE_NOTICE_CODE));
      expect(mockWebSocket.close).toHaveBeenCalledTimes(1);
      expect(ReliableWebSocket).toHaveBeenCalledTimes(2);
    });

    it('leaves a socket with orders in flight to the exchange instead of rejecting them', async () => {
      const stream = createStream();

      await openConnection(stream);

      const orderPromise = stream.createOrder({ instId: 'BTC-USDT-SWAP', side: 'buy', ordType: 'market', sz: '1' });

      await flushMicrotasks();

      capturedOnMessage!({ event: 'notice', code: OKX_SERVICE_UPGRADE_NOTICE_CODE, msg: 'The connection will soon be closed for a service upgrade. Please reconnect.' });

      expect(mockWebSocket.close).not.toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('request(s) in flight'));

      stream.disconnect();

      await expect(orderPromise).rejects.toThrow('disconnected');
    });

    /** E17. Подаренная биржей минута больше не пропадает: переоткрываемся на последнем ответе. */
    it('reopens as soon as the last answer arrives when the notice found a request in flight', async () => {
      const stream = createStream();

      await openConnection(stream);

      const { ReliableWebSocket } = require('@solncebro/websocket-engine');
      const orderPromise = stream.createOrder({ instId: 'BTC-USDT-SWAP', side: 'buy', ordType: 'market', sz: '1' });

      await flushMicrotasks();

      const sendCallList = mockWebSocket.sendToConnectedSocket.mock.calls as unknown as Array<[{ id: string }]>;
      const [sentRequest] = sendCallList[sendCallList.length - 1];

      capturedOnMessage!({ event: 'notice', code: OKX_SERVICE_UPGRADE_NOTICE_CODE, msg: 'The connection will soon be closed for a service upgrade. Please reconnect.' });

      expect(mockWebSocket.close).not.toHaveBeenCalled();

      capturedOnMessage!({
        id: sentRequest.id,
        op: 'order',
        code: '0',
        msg: '',
        data: [{ ordId: '77', clOrdId: '', sCode: '0', sMsg: '' }],
      });

      await expect(orderPromise).resolves.toEqual(expect.objectContaining({ id: '77' }));
      expect(mockWebSocket.close).toHaveBeenCalledTimes(1);
      expect(ReliableWebSocket).toHaveBeenCalledTimes(2);
    });

    it('reopens at the deadline when the answer never comes and no frame is left to wake on', async () => {
      jest.useFakeTimers();

      try {
        const stream = createStream();

        await openConnection(stream);

        const { ReliableWebSocket } = require('@solncebro/websocket-engine');
        const orderPromise = stream.createOrder({ instId: 'BTC-USDT-SWAP', side: 'buy', ordType: 'market', sz: '1' });
        orderPromise.catch(() => undefined);

        await flushMicrotasks();

        capturedOnMessage!({ event: 'notice', code: OKX_SERVICE_UPGRADE_NOTICE_CODE, msg: 'The connection will soon be closed for a service upgrade. Please reconnect.' });

        expect(mockWebSocket.close).not.toHaveBeenCalled();

        await jest.advanceTimersByTimeAsync(OKX_SERVICE_UPGRADE_RECONNECT_DEADLINE_MS);

        await expect(orderPromise).rejects.toThrow('timeout');
        expect(mockWebSocket.close).toHaveBeenCalledTimes(1);
        expect(ReliableWebSocket).toHaveBeenCalledTimes(2);
      } finally {
        jest.useRealTimers();
      }
    });

    it('leaves the break to the exchange when a request is still in flight at the deadline', async () => {
      jest.useFakeTimers();

      try {
        const stream = createStream();

        await openConnection(stream);

        const firstOrderPromise = stream.createOrder({ instId: 'BTC-USDT-SWAP', side: 'buy', ordType: 'market', sz: '1' });
        firstOrderPromise.catch(() => undefined);

        await flushMicrotasks();

        capturedOnMessage!({ event: 'notice', code: OKX_SERVICE_UPGRADE_NOTICE_CODE, msg: 'The connection will soon be closed for a service upgrade. Please reconnect.' });

        await jest.advanceTimersByTimeAsync(OKX_SERVICE_UPGRADE_RECONNECT_DEADLINE_MS - 1000);

        const secondOrderPromise = stream.createOrder({ instId: 'ETH-USDT-SWAP', side: 'buy', ordType: 'market', sz: '1' });
        secondOrderPromise.catch(() => undefined);

        await flushMicrotasks();
        await jest.advanceTimersByTimeAsync(1000);

        expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('still in flight at the reconnect deadline'));
        expect(mockWebSocket.close).not.toHaveBeenCalled();

        stream.disconnect();
      } finally {
        jest.useRealTimers();
      }
    });

    it('writes a notice it has no plan for as a warning', async () => {
      const stream = createStream();

      await openConnection(stream);

      capturedOnMessage!({ event: 'notice', code: '60041', msg: 'something happened' });

      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('server notice (60041)'));
      expect(mockWebSocket.close).not.toHaveBeenCalled();
    });
  });

  describe('initConnection', () => {
    it('authenticates with passphrase on open', async () => {
      const { authenticateOkxWebSocket } = require('../../src/ws/okxWebSocketAuth');
      const stream = createStream();
      const mockContext = await openConnection(stream);

      expect(authenticateOkxWebSocket).toHaveBeenCalledWith(
        expect.objectContaining({
          context: mockContext,
          apiKey,
          secret,
          passphrase,
          label,
        }),
      );
    });

    it('hands the liveness check to the engine as a bare-text ping with the OKX thresholds', async () => {
      const { ReliableWebSocket } = require('@solncebro/websocket-engine');
      const stream = createStream();

      await openConnection(stream);

      const args = (ReliableWebSocket as jest.Mock).mock.calls[0][0];

      expect(args.label).toBe(label);
      expect(args.url).toBe(url);
      expect(args.heartbeat.buildPayload()).toBe('ping');
      expect(args.heartbeat.isResponse({ event: 'pong' })).toBe(true);
      expect(args.heartbeat.isResponse({ id: 'r1', op: 'order', code: '0', msg: '' })).toBe(false);
      expect(args.configuration).toEqual({
        pingInterval: OKX_PING_INTERVAL,
        staleThreshold: OKX_STALE_THRESHOLD_MS,
        staleCheckInterval: OKX_STALE_CHECK_INTERVAL_MS,
      });
    });
  });

  describe('buildOrderRequest + generateReqId', () => {
    it('builds an order request with an alphanumeric id no longer than 32 characters', () => {
      const stream = createStream();

      const requestId = (stream as any).generateReqId();
      const request = (stream as any).buildOrderRequest({ instId: 'BTC-USDT-SWAP', side: 'buy' }, requestId);

      expect(request).toEqual({
        id: requestId,
        op: 'order',
        args: [{ instIdCode: OKX_BTC_SWAP_INST_ID_CODE, side: 'buy' }],
      });
      expect(requestId).toMatch(OKX_CLIENT_ORDER_ID_PATTERN);
    });
  });

  describe('createOrder (end-to-end)', () => {
    it('sends the actually-built order frame through the socket with a valid alphanumeric id', async () => {
      const stream = createStream();
      await openConnection(stream);

      const orderPromise = stream.createOrder({ instId: 'BTC-USDT-SWAP', side: 'buy', ordType: 'market', sz: '1' });
      await new Promise((resolve) => setImmediate(resolve));

      const sentFrame = mockWebSocket.sendToConnectedSocket.mock.calls[0][0];

      expect(sentFrame.op).toBe('order');
      expect(sentFrame.args).toEqual([{ instIdCode: OKX_BTC_SWAP_INST_ID_CODE, side: 'buy', ordType: 'market', sz: '1' }]);
      expect(sentFrame.id).toMatch(OKX_CLIENT_ORDER_ID_PATTERN);

      capturedOnMessage!({
        id: sentFrame.id,
        op: 'order',
        code: '0',
        msg: '',
        data: [{ ordId: 'ord-1', clOrdId: '', tag: '', ts: '1700000000000', sCode: '0', sMsg: '' }],
      });

      await expect(orderPromise).resolves.toEqual(expect.objectContaining({ id: 'ord-1' }));
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
      const stream = createStream();
      await openConnection(stream);

      await jest.advanceTimersByTimeAsync(OKX_SILENT_THRESHOLD_MS * 3);

      expect(mockWebSocket.close).not.toHaveBeenCalled();
      expect(ReliableWebSocket).toHaveBeenCalledTimes(1);
      expect(stream.isConnected()).toBe(true);
    });
  });

  describe('login handshake and connection status', () => {
    it('reports the socket as not connected until the login handshake has completed', async () => {
      const { authenticateOkxWebSocket } = require('../../src/ws/okxWebSocketAuth');
      let resolveLogin: () => void = () => undefined;
      authenticateOkxWebSocket.mockImplementationOnce(() => new Promise<void>((resolve) => {
        resolveLogin = resolve;
      }));

      let isEngineOpen = false;
      mockWebSocket.getStatus.mockImplementation(() => (isEngineOpen ? WebSocketStatus.CONNECTED : WebSocketStatus.CONNECTING));

      const stream = createStream();
      const connectPromise = stream.connect();
      const openPromise = (async () => {
        await capturedOnOpen!({ send: jest.fn(), waitForMessage: jest.fn().mockResolvedValue(undefined) });
        isEngineOpen = true;
      })();

      expect(stream.isConnected()).toBe(false);

      resolveLogin();
      await openPromise;
      await connectPromise;

      expect(stream.isConnected()).toBe(true);
    });
  });

  describe('disconnect', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('leaves no stream-owned timer running and sends nothing more after disconnect', async () => {
      const stream = createStream();
      await openConnection(stream);

      stream.disconnect();
      mockWebSocket.sendToConnectedSocket.mockClear();

      await jest.advanceTimersByTimeAsync(OKX_PING_INTERVAL * 3);

      expect(jest.getTimerCount()).toBe(0);
      expect(mockWebSocket.sendToConnectedSocket).not.toHaveBeenCalled();
    });
  });
});
