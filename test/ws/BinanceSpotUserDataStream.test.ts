import { WebSocketStatus } from '@solncebro/websocket-engine';
import { BinanceSpotUserDataStream } from '../../src/ws/BinanceSpotUserDataStream';
import { createMockLogger } from '../fixtures/mockLogger';

let capturedOnMessage: ((message: any) => void) | undefined;
let capturedOnOpen: (() => Promise<void>) | undefined;
let capturedOnReconnectSuccess: (() => void) | undefined;

const mockWebSocket = {
  close: jest.fn(),
  sendToConnectedSocket: jest.fn(),
  getStatus: jest.fn().mockReturnValue(WebSocketStatus.CONNECTED),
};

jest.mock('@solncebro/websocket-engine', () => {
  const actual = jest.requireActual('@solncebro/websocket-engine');
  return {
    ...actual,
    ReliableWebSocket: jest.fn().mockImplementation((args: any) => {
      capturedOnMessage = args.onMessage;
      capturedOnOpen = args.onOpen;
      capturedOnReconnectSuccess = args.onReconnectSuccess;
      return mockWebSocket;
    }),
  };
});

describe('BinanceSpotUserDataStream', () => {
  const mockLogger = createMockLogger();

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Date, 'now').mockReturnValue(1700000000000);
    capturedOnMessage = undefined;
    capturedOnOpen = undefined;
    capturedOnReconnectSuccess = undefined;
  });

  function createStream(onMessage = jest.fn()) {
    return {
      stream: new BinanceSpotUserDataStream({
        label: 'Binance Spot UserData',
        url: 'wss://ws-api.binance.com:443/ws-api/v3',
        apiKey: 'testKey',
        secret: 'testSecret',
        logger: mockLogger,
        onMessage,
      }),
      onMessage,
    };
  }

  describe('connect / subscribe', () => {
    it('creates the WebSocket with the ws-api URL', () => {
      const { ReliableWebSocket } = require('@solncebro/websocket-engine');
      const { stream } = createStream();

      stream.connect();

      expect(ReliableWebSocket).toHaveBeenCalledWith(
        expect.objectContaining({ url: 'wss://ws-api.binance.com:443/ws-api/v3' }),
      );
    });

    it('sends a signed userDataStream.subscribe on open', async () => {
      const { stream } = createStream();
      stream.connect();

      await capturedOnOpen!();

      const sent = mockWebSocket.sendToConnectedSocket.mock.calls[0][0];

      expect(sent.method).toBe('userDataStream.subscribe');
      expect(sent.params.apiKey).toBe('testKey');
      expect(sent.params.signature).toBeDefined();
      expect(sent.params.timestamp).toBe(1700000000000);
    });

    it('re-subscribes on reconnect', async () => {
      const { stream } = createStream();
      stream.connect();

      await capturedOnOpen!();
      capturedOnReconnectSuccess!();

      expect(mockWebSocket.sendToConnectedSocket).toHaveBeenCalledTimes(2);
    });
  });

  describe('handleMessage', () => {
    it('stores subscriptionId from the subscribe response and does not forward it', () => {
      const onMessage = jest.fn();
      const { stream } = createStream(onMessage);
      stream.connect();

      capturedOnMessage!({ id: 'userDataStream.subscribe', status: 200, result: { subscriptionId: 42 } });

      expect(onMessage).not.toHaveBeenCalled();

      stream.close();

      const sent = mockWebSocket.sendToConnectedSocket.mock.calls.at(-1)![0];

      expect(sent.method).toBe('userDataStream.unsubscribe');
      expect(sent.params.subscriptionId).toBe(42);
    });

    it('forwards an executionReport event frame to the handler', () => {
      const onMessage = jest.fn();
      const { stream } = createStream(onMessage);
      stream.connect();

      capturedOnMessage!({ e: 'executionReport', s: 'BTCUSDT', i: 1 });

      expect(onMessage).toHaveBeenCalledWith(expect.objectContaining({ e: 'executionReport', s: 'BTCUSDT' }));
    });

    it('unwraps an event frame wrapped in { event }', () => {
      const onMessage = jest.fn();
      const { stream } = createStream(onMessage);
      stream.connect();

      capturedOnMessage!({ event: { e: 'executionReport', s: 'ETHUSDT' } });

      expect(onMessage).toHaveBeenCalledWith(expect.objectContaining({ e: 'executionReport', s: 'ETHUSDT' }));
    });

    it('logs an error when the subscribe response is not successful', () => {
      const { stream } = createStream();
      stream.connect();

      capturedOnMessage!({ id: 'userDataStream.subscribe', status: 401, error: { code: -2014, msg: 'bad key' } });

      expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('bad key'));
    });
  });

  describe('isConnected', () => {
    it('returns false before connect', () => {
      const { stream } = createStream();

      expect(stream.isConnected()).toBe(false);
    });

    it('returns true after connect when socket is CONNECTED', () => {
      const { stream } = createStream();
      stream.connect();

      expect(stream.isConnected()).toBe(true);
    });

    it('returns false when socket is not CONNECTED', () => {
      const { stream } = createStream();
      stream.connect();
      mockWebSocket.getStatus.mockReturnValueOnce(WebSocketStatus.RECONNECTING);

      expect(stream.isConnected()).toBe(false);
    });
  });
});
