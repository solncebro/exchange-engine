import type { BinanceMiniTickerWebSocketRaw, BinanceWebSocketKlineRaw } from '../../src/normalizers/binanceNormalizer';
import { BinanceSpotPublicStream } from '../../src/ws/BinanceSpotPublicStream';
import { createMockLogger } from '../fixtures/mockLogger';

let capturedOnMessage: ((message: any) => void) | undefined;
let capturedOnOpen: ((context: any) => Promise<void>) | undefined;

const mockWebSocket = {
  close: jest.fn(),
  sendToConnectedSocket: jest.fn(),
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

const MOCK_MINI_TICKER_RAW: BinanceMiniTickerWebSocketRaw = {
  e: '24hrMiniTicker',
  E: 1700000000000,
  s: 'BTCUSDT',
  c: '78462.73000000',
  o: '78384.26000000',
  h: '79760.00000000',
  l: '78060.03000000',
  v: '13831.04130000',
  q: '1091946639.77967220',
};

const MOCK_KLINE_RAW: BinanceWebSocketKlineRaw = {
  t: 1700000000000,
  o: '50000',
  h: '51000',
  l: '49000',
  c: '50500',
  v: '100',
  T: 1700003600000,
  q: '5000000',
  n: 1000,
  V: '50',
  Q: '2500000',
  x: true,
};

describe('BinanceSpotPublicStream', () => {
  const mockLogger = createMockLogger();
  const url = 'wss://stream.binance.com:9443/ws';

  beforeEach(() => {
    jest.clearAllMocks();
    capturedOnMessage = undefined;
    capturedOnOpen = undefined;
  });

  describe('subscribeAllTickers', () => {
    it('creates WebSocket connection with heartbeat', () => {
      const { ReliableWebSocket } = require('@solncebro/websocket-engine');
      const stream = new BinanceSpotPublicStream({ webSocketUrl: url, logger: mockLogger, onNotify: undefined, label: 'BinanceSpotPublicStream' });

      stream.subscribeAllTickers(jest.fn(), []);

      expect(ReliableWebSocket).toHaveBeenCalledWith(
        expect.objectContaining({
          url,
          label: 'BinanceSpotPublicStream',
          heartbeat: expect.objectContaining({
            buildPayload: expect.any(Function),
            isResponse: expect.any(Function),
          }),
        }),
      );
    });

    it('sends SUBSCRIBE on open with miniTicker', () => {
      const stream = new BinanceSpotPublicStream({ webSocketUrl: url, logger: mockLogger, onNotify: undefined, label: 'BinanceSpotPublicStream' });
      stream.subscribeAllTickers(jest.fn(), []);

      capturedOnOpen!({});

      expect(mockWebSocket.sendToConnectedSocket).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'SUBSCRIBE',
          params: expect.arrayContaining(['!miniTicker@arr']),
        }),
      );
    });
  });

  describe('subscribeKlines', () => {
    it('uses correct kline stream format without _perpetual', () => {
      const stream = new BinanceSpotPublicStream({ webSocketUrl: url, logger: mockLogger, onNotify: undefined, label: 'BinanceSpotPublicStream' });
      stream.subscribeAllTickers(jest.fn(), []);

      stream.subscribeKlines('BTCUSDT', '1m', jest.fn());

      expect(mockWebSocket.sendToConnectedSocket).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'SUBSCRIBE',
          params: ['btcusdt@kline_1m'],
        }),
      );
    });

    it('creates connection if not already connected', () => {
      const { ReliableWebSocket } = require('@solncebro/websocket-engine');
      const stream = new BinanceSpotPublicStream({ webSocketUrl: url, logger: mockLogger, onNotify: undefined, label: 'BinanceSpotPublicStream' });

      stream.subscribeKlines('BTCUSDT', '1m', jest.fn());

      expect(ReliableWebSocket).toHaveBeenCalledTimes(1);
    });
  });

  describe('unsubscribeKlines', () => {
    it('sends UNSUBSCRIBE when last handler removed', () => {
      const stream = new BinanceSpotPublicStream({ webSocketUrl: url, logger: mockLogger, onNotify: undefined, label: 'BinanceSpotPublicStream' });
      const handler = jest.fn();
      stream.subscribeAllTickers(jest.fn(), []);

      stream.subscribeKlines('BTCUSDT', '1m', handler);
      stream.unsubscribeKlines('BTCUSDT', '1m', handler);

      expect(mockWebSocket.sendToConnectedSocket).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'UNSUBSCRIBE',
          params: ['btcusdt@kline_1m'],
        }),
      );
    });

    it('does nothing when handler set is empty', () => {
      const stream = new BinanceSpotPublicStream({ webSocketUrl: url, logger: mockLogger, onNotify: undefined, label: 'BinanceSpotPublicStream' });
      mockWebSocket.sendToConnectedSocket.mockClear();

      stream.unsubscribeKlines('UNKNOWN', '1m', jest.fn());

      expect(mockWebSocket.sendToConnectedSocket).not.toHaveBeenCalled();
    });
  });

  describe('handleMessage', () => {
    it('handles the bare array frame the /ws endpoint really sends', () => {
      const stream = new BinanceSpotPublicStream({ webSocketUrl: url, logger: mockLogger, onNotify: undefined, label: 'BinanceSpotPublicStream' });
      const handler = jest.fn();
      stream.subscribeAllTickers(handler, []);

      capturedOnMessage!([MOCK_MINI_TICKER_RAW]);

      expect(handler).toHaveBeenCalledTimes(1);

      const tickerBySymbol = handler.mock.calls[0][0];

      expect(tickerBySymbol).toBeInstanceOf(Map);
      expect(tickerBySymbol.get('BTCUSDT').lastPrice).toBeCloseTo(78462.73);
      expect(tickerBySymbol.get('BTCUSDT').timestamp).toBe(1700000000000);
    });

    it('handles stream: !miniTicker@arr messages', () => {
      const stream = new BinanceSpotPublicStream({ webSocketUrl: url, logger: mockLogger, onNotify: undefined, label: 'BinanceSpotPublicStream' });
      const handler = jest.fn();
      stream.subscribeAllTickers(handler, []);

      capturedOnMessage!({ stream: '!miniTicker@arr', data: [MOCK_MINI_TICKER_RAW] });

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('handles the bare kline frame the /ws endpoint really sends', () => {
      const stream = new BinanceSpotPublicStream({ webSocketUrl: url, logger: mockLogger, onNotify: undefined, label: 'BinanceSpotPublicStream' });
      const handler = jest.fn();
      stream.subscribeKlines('BTCUSDT', '1m', handler);

      capturedOnMessage!({ e: 'kline', E: 1700000000000, s: 'BTCUSDT', k: { ...MOCK_KLINE_RAW, i: '1m' } });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0]).toBe('BTCUSDT');
      expect(handler.mock.calls[0][1].closePrice).toBe(50500);
    });

    it('handles kline messages from stream', () => {
      const stream = new BinanceSpotPublicStream({ webSocketUrl: url, logger: mockLogger, onNotify: undefined, label: 'BinanceSpotPublicStream' });
      const handler = jest.fn();
      stream.subscribeKlines('BTCUSDT', '1m', handler);

      capturedOnMessage!({
        stream: 'btcusdt@kline_1m',
        data: { k: MOCK_KLINE_RAW },
      });

      expect(handler).toHaveBeenCalledWith('BTCUSDT', expect.objectContaining({ openPrice: 50000 }));
    });

    it('ignores messages without stream or event', () => {
      const stream = new BinanceSpotPublicStream({ webSocketUrl: url, logger: mockLogger, onNotify: undefined, label: 'BinanceSpotPublicStream' });
      const handler = jest.fn();
      stream.subscribeAllTickers(handler, []);

      capturedOnMessage!({ id: 1, result: null });

      expect(handler).not.toHaveBeenCalled();
    });

    it('logs error when handler throws', () => {
      const stream = new BinanceSpotPublicStream({ webSocketUrl: url, logger: mockLogger, onNotify: undefined, label: 'BinanceSpotPublicStream' });
      const handler = jest.fn().mockImplementation(() => {
        throw new Error('boom');
      });
      stream.subscribeAllTickers(handler, []);

      capturedOnMessage!({ stream: '!miniTicker@arr', data: [MOCK_MINI_TICKER_RAW] });

      expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('boom'));
    });
  });

  describe('resubscribeAll', () => {
    it('resubscribes all streams on reconnect via onOpen', async () => {
      const stream = new BinanceSpotPublicStream({ webSocketUrl: url, logger: mockLogger, onNotify: undefined, label: 'BinanceSpotPublicStream' });
      stream.subscribeAllTickers(jest.fn(), []);
      stream.subscribeKlines('BTCUSDT', '1m', jest.fn());

      mockWebSocket.sendToConnectedSocket.mockClear();
      await capturedOnOpen!({});

      expect(mockWebSocket.sendToConnectedSocket).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'SUBSCRIBE',
          params: expect.arrayContaining(['!miniTicker@arr', 'btcusdt@kline_1m']),
        }),
      );
    });
  });

  describe('close', () => {
    it('closes WebSocket and nullifies', () => {
      const stream = new BinanceSpotPublicStream({ webSocketUrl: url, logger: mockLogger, onNotify: undefined, label: 'BinanceSpotPublicStream' });
      stream.subscribeAllTickers(jest.fn(), []);

      stream.close();

      expect(mockWebSocket.close).toHaveBeenCalledTimes(1);
    });

    it('is safe to call when not connected', () => {
      const stream = new BinanceSpotPublicStream({ webSocketUrl: url, logger: mockLogger, onNotify: undefined, label: 'BinanceSpotPublicStream' });

      expect(() => stream.close()).not.toThrow();
    });
  });
});
