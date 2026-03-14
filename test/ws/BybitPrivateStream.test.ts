import { BybitPrivateStream } from '../../src/ws/BybitPrivateStream';
import { BYBIT_PRIVATE_WEBSOCKET_URL } from '../../src/constants/bybit';
import { createMockLogger } from '../fixtures/mockLogger';

let capturedOnMessage: ((message: any) => void) | undefined;
let capturedOnOpen: ((context: any) => Promise<void>) | undefined;

const mockWebSocket = {
  close: jest.fn(),
};

jest.mock('@solncebro/websocket-engine', () => {
  const actual = jest.requireActual('@solncebro/websocket-engine');
  return {
    ...actual,
    ReliableWebSocket: jest.fn().mockImplementation((args: any) => {
      capturedOnMessage = args.onMessage;
      capturedOnOpen = args.onOpen;
      return mockWebSocket;
    }),
  };
});

jest.mock('../../src/ws/bybitWebSocketUtils', () => {
  const actual = jest.requireActual('../../src/ws/bybitWebSocketUtils');
  return {
    ...actual,
    authenticateBybitWebSocket: jest.fn().mockResolvedValue(undefined),
  };
});

describe('BybitPrivateStream', () => {
  const mockLogger = createMockLogger();

  beforeEach(() => {
    jest.clearAllMocks();
    capturedOnMessage = undefined;
    capturedOnOpen = undefined;
  });

  function createStream(onMessage = jest.fn()) {
    return {
      stream: new BybitPrivateStream({
        apiKey: 'testKey',
        secret: 'testSecret',
        logger: mockLogger,
        onMessage,
      }),
      onMessage,
    };
  }

  describe('connect', () => {
    it('creates WebSocket with correct URL and heartbeat', () => {
      const { ReliableWebSocket } = require('@solncebro/websocket-engine');
      const { stream } = createStream();

      stream.connect();

      expect(ReliableWebSocket).toHaveBeenCalledWith(
        expect.objectContaining({
          url: BYBIT_PRIVATE_WEBSOCKET_URL,
          label: 'BybitPrivateStream',
        }),
      );
    });

    it('does not create second WebSocket on repeated connect', () => {
      const { ReliableWebSocket } = require('@solncebro/websocket-engine');
      const { stream } = createStream();

      stream.connect();
      stream.connect();

      expect(ReliableWebSocket).toHaveBeenCalledTimes(1);
    });

    it('authenticates on open', async () => {
      const { authenticateBybitWebSocket } = require('../../src/ws/bybitWebSocketUtils');
      const { stream } = createStream();
      stream.connect();

      const mockContext = { send: jest.fn(), waitForMessage: jest.fn() };
      await capturedOnOpen!(mockContext);

      expect(authenticateBybitWebSocket).toHaveBeenCalledWith(
        expect.objectContaining({
          context: mockContext,
          apiKey: 'testKey',
          secret: 'testSecret',
          label: 'BybitPrivateStream',
        }),
      );
    });
  });

  describe('handleMessage', () => {
    it('filters auth messages', () => {
      const onMessage = jest.fn();
      const { stream } = createStream(onMessage);
      stream.connect();

      capturedOnMessage!({ op: 'auth', success: true });

      expect(onMessage).not.toHaveBeenCalled();
    });

    it('forwards non-auth messages to handler', () => {
      const onMessage = jest.fn();
      const { stream } = createStream(onMessage);
      stream.connect();

      capturedOnMessage!({ topic: 'order', data: [{ orderId: '123' }] });

      expect(onMessage).toHaveBeenCalledWith({ topic: 'order', data: [{ orderId: '123' }] });
    });

    it('logs error when handler throws', () => {
      const onMessage = jest.fn().mockImplementation(() => {
        throw new Error('handler error');
      });
      const { stream } = createStream(onMessage);
      stream.connect();

      capturedOnMessage!({ topic: 'position', data: [] });

      expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('handler error'));
    });
  });

  describe('close', () => {
    it('closes WebSocket and nullifies', () => {
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
