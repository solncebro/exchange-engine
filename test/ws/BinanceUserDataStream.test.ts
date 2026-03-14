import { BinanceUserDataStream } from '../../src/ws/BinanceUserDataStream';
import { createMockLogger } from '../fixtures/mockLogger';

let capturedOnMessage: ((message: any) => void) | undefined;

const mockWebSocket = {
  close: jest.fn(),
};

jest.mock('@solncebro/websocket-engine', () => {
  const actual = jest.requireActual('@solncebro/websocket-engine');
  return {
    ...actual,
    ReliableWebSocket: jest.fn().mockImplementation((args: any) => {
      capturedOnMessage = args.onMessage;
      return mockWebSocket;
    }),
  };
});

describe('BinanceUserDataStream', () => {
  const mockLogger = createMockLogger();

  beforeEach(() => {
    jest.clearAllMocks();
    capturedOnMessage = undefined;
  });

  function createStream(onMessage = jest.fn()) {
    return {
      stream: new BinanceUserDataStream({
        listenKey: 'testListenKey123',
        baseWebSocketUrl: 'wss://stream.binance.com:9443/ws',
        logger: mockLogger,
        onMessage,
      }),
      onMessage,
    };
  }

  describe('connect', () => {
    it('creates WebSocket with listenKey URL', () => {
      const { ReliableWebSocket } = require('@solncebro/websocket-engine');
      const { stream } = createStream();

      stream.connect();

      expect(ReliableWebSocket).toHaveBeenCalledWith(
        expect.objectContaining({
          url: 'wss://stream.binance.com:9443/ws/testListenKey123',
          label: 'BinanceUserDataStream',
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

    it('logs connection with listenKey', () => {
      const { stream } = createStream();

      stream.connect();

      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('testListenKey123'));
    });
  });

  describe('onMessage', () => {
    it('forwards messages to handler', () => {
      const onMessage = jest.fn();
      const { stream } = createStream(onMessage);
      stream.connect();

      capturedOnMessage!({ e: 'ACCOUNT_UPDATE', data: {} });

      expect(onMessage).toHaveBeenCalledWith({ e: 'ACCOUNT_UPDATE', data: {} });
    });

    it('logs error when handler throws', () => {
      const onMessage = jest.fn().mockImplementation(() => {
        throw new Error('handler failure');
      });
      const { stream } = createStream(onMessage);
      stream.connect();

      capturedOnMessage!({ e: 'test' });

      expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('handler failure'));
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

    it('is safe to call when not connected', () => {
      const { stream } = createStream();

      expect(() => stream.close()).not.toThrow();
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
