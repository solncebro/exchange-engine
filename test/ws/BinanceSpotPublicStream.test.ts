import type { BinanceTicker24hrRaw, BinanceWebSocketKlineRaw } from '../../src/normalizers/binanceNormalizer';
import { BinanceSpotPublicStream } from '../../src/ws/BinanceSpotPublicStream';
import { createMockLogger } from '../fixtures/mockLogger';

let capturedOnMessage: ((message: any) => void) | undefined;
let capturedOnOpen: ((context: any) => Promise<void>) | undefined;
let capturedOnReconnectSuccess: (() => void) | undefined;

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
      capturedOnReconnectSuccess = args.onReconnectSuccess;
      return mockWebSocket;
    }),
  };
});

const MOCK_TICKER_RAW: BinanceTicker24hrRaw = {
  symbol: 'BTCUSDT',
  lastPrice: '50000',
  openPrice: '48000',
  highPrice: '51000',
  lowPrice: '49000',
  priceChangePercent: '2.5',
  volume: '1000',
  quoteVolume: '50000000',
  time: 1700000000000,
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
    capturedOnReconnectSuccess = undefined;
  });

  describe('subscribeAllTickers', () => {
    it('creates WebSocket connection with heartbeat', () => {
      const { ReliableWebSocket } = require('@solncebro/websocket-engine');
      const stream = new BinanceSpotPublicStream({ webSocketUrl: url, logger: mockLogger, onNotify: undefined, label: 'BinanceSpotPublicStream' });

      stream.subscribeAllTickers(jest.fn());

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
      stream.subscribeAllTickers(jest.fn());

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
      stream.subscribeAllTickers(jest.fn());

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
      stream.subscribeAllTickers(jest.fn());

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
    it('handles e: 24hrMiniTicker array messages', () => {
      const stream = new BinanceSpotPublicStream({ webSocketUrl: url, logger: mockLogger, onNotify: undefined, label: 'BinanceSpotPublicStream' });
      const handler = jest.fn();
      stream.subscribeAllTickers(handler);

      capturedOnMessage!({ e: '24hrMiniTicker', data: [MOCK_TICKER_RAW] });

      expect(handler).toHaveBeenCalledTimes(1);
      const tickerMap = handler.mock.calls[0][0];
      expect(tickerMap).toBeInstanceOf(Map);
    });

    it('handles stream: !miniTicker@arr messages', () => {
      const stream = new BinanceSpotPublicStream({ webSocketUrl: url, logger: mockLogger, onNotify: undefined, label: 'BinanceSpotPublicStream' });
      const handler = jest.fn();
      stream.subscribeAllTickers(handler);

      capturedOnMessage!({ stream: '!miniTicker@arr', data: [MOCK_TICKER_RAW] });

      expect(handler).toHaveBeenCalledTimes(1);
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
      stream.subscribeAllTickers(handler);

      capturedOnMessage!({ id: 1, result: null });

      expect(handler).not.toHaveBeenCalled();
    });

    it('logs error when handler throws', () => {
      const stream = new BinanceSpotPublicStream({ webSocketUrl: url, logger: mockLogger, onNotify: undefined, label: 'BinanceSpotPublicStream' });
      const handler = jest.fn().mockImplementation(() => {
        throw new Error('boom');
      });
      stream.subscribeAllTickers(handler);

      capturedOnMessage!({ stream: '!miniTicker@arr', data: [MOCK_TICKER_RAW] });

      expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('boom'));
    });
  });

  describe('resubscribeAll', () => {
    it('resubscribes all streams on reconnect', () => {
      const stream = new BinanceSpotPublicStream({ webSocketUrl: url, logger: mockLogger, onNotify: undefined, label: 'BinanceSpotPublicStream' });
      stream.subscribeAllTickers(jest.fn());
      stream.subscribeKlines('BTCUSDT', '1m', jest.fn());

      mockWebSocket.sendToConnectedSocket.mockClear();
      capturedOnReconnectSuccess!();

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
      stream.subscribeAllTickers(jest.fn());

      stream.close();

      expect(mockWebSocket.close).toHaveBeenCalledTimes(1);
    });

    it('is safe to call when not connected', () => {
      const stream = new BinanceSpotPublicStream({ webSocketUrl: url, logger: mockLogger, onNotify: undefined, label: 'BinanceSpotPublicStream' });

      expect(() => stream.close()).not.toThrow();
    });
  });
});
