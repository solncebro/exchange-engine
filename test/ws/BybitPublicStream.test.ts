import type { BybitTickerRaw, BybitWebSocketKlineRaw } from '../../src/normalizers/bybitNormalizer';
import { BybitPublicStream } from '../../src/ws/BybitPublicStream';
import { createMockLogger } from '../fixtures/mockLogger';

let capturedOnMessage: ((message: any) => void) | undefined;
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
      capturedOnReconnectSuccess = args.onReconnectSuccess;
      return mockWebSocket;
    }),
  };
});

const MOCK_TICKER_RAW: BybitTickerRaw = {
  symbol: 'BTCUSDT',
  lastPrice: '50000',
  prevPrice24h: '48000',
  highPrice24h: '51000',
  lowPrice24h: '49000',
  price24hPcnt: '0.025',
  volume24h: '1000',
  turnover24h: '50000000',
};

const MOCK_KLINE_RAW: BybitWebSocketKlineRaw = {
  start: 1700000000000,
  open: '50000',
  high: '51000',
  low: '49000',
  close: '50500',
  volume: '100',
  turnover: '5000000',
  confirm: true,
  timestamp: 1700003600000,
};

describe('BybitPublicStream', () => {
  const mockLogger = createMockLogger();

  beforeEach(() => {
    jest.clearAllMocks();
    capturedOnMessage = undefined;
    capturedOnReconnectSuccess = undefined;
  });

  describe('subscribeAllTickers', () => {
    it('resolves topic as tickers.linear for linear URL', () => {
      const stream = new BybitPublicStream('wss://stream.bybit.com/v5/public/linear', mockLogger);
      stream.subscribeAllTickers(jest.fn());

      expect(mockWebSocket.sendToConnectedSocket).toHaveBeenCalledWith(
        expect.objectContaining({
          op: 'subscribe',
          args: expect.arrayContaining(['tickers.linear']),
        }),
      );
    });

    it('resolves topic as tickers.spot for spot URL', () => {
      const stream = new BybitPublicStream('wss://stream.bybit.com/v5/public/spot', mockLogger);
      stream.subscribeAllTickers(jest.fn());

      expect(mockWebSocket.sendToConnectedSocket).toHaveBeenCalledWith(
        expect.objectContaining({
          op: 'subscribe',
          args: expect.arrayContaining(['tickers.spot']),
        }),
      );
    });

    it('calls handler with normalized tickers', () => {
      const stream = new BybitPublicStream('wss://stream.bybit.com/v5/public/linear', mockLogger);
      const handler = jest.fn();
      stream.subscribeAllTickers(handler);

      capturedOnMessage!({
        topic: 'tickers.linear',
        data: [MOCK_TICKER_RAW],
      });

      expect(handler).toHaveBeenCalledTimes(1);
      const tickerMap = handler.mock.calls[0][0];
      expect(tickerMap).toBeInstanceOf(Map);
      expect(tickerMap.get('BTCUSDT')).toBeDefined();
    });
  });

  describe('subscribeKlines', () => {
    it('converts interval and subscribes with correct topic', () => {
      const stream = new BybitPublicStream('wss://stream.bybit.com/v5/public/linear', mockLogger);
      stream.subscribeAllTickers(jest.fn());

      stream.subscribeKlines('BTCUSDT', '1h', jest.fn());

      expect(mockWebSocket.sendToConnectedSocket).toHaveBeenCalledWith(
        expect.objectContaining({
          op: 'subscribe',
          args: ['kline.60.BTCUSDT'],
        }),
      );
    });

    it('calls handler when kline message arrives', () => {
      const stream = new BybitPublicStream('wss://stream.bybit.com/v5/public/linear', mockLogger);
      const handler = jest.fn();
      stream.subscribeKlines('BTCUSDT', '1m', handler);

      capturedOnMessage!({
        topic: 'kline.1.BTCUSDT',
        data: [MOCK_KLINE_RAW],
      });

      expect(handler).toHaveBeenCalledWith('BTCUSDT', expect.objectContaining({ openPrice: 50000 }));
    });

    it('creates connection if not already connected', () => {
      const { ReliableWebSocket } = require('@solncebro/websocket-engine');
      const stream = new BybitPublicStream('wss://stream.bybit.com/v5/public/linear', mockLogger);

      stream.subscribeKlines('BTCUSDT', '1m', jest.fn());

      expect(ReliableWebSocket).toHaveBeenCalledTimes(1);
    });
  });

  describe('unsubscribeKlines', () => {
    it('sends unsubscribe and removes from activeSubscriptionSet', () => {
      const stream = new BybitPublicStream('wss://stream.bybit.com/v5/public/linear', mockLogger);
      const handler = jest.fn();
      stream.subscribeAllTickers(jest.fn());

      stream.subscribeKlines('BTCUSDT', '1h', handler);
      mockWebSocket.sendToConnectedSocket.mockClear();

      stream.unsubscribeKlines('BTCUSDT', '1h', handler);

      expect(mockWebSocket.sendToConnectedSocket).toHaveBeenCalledWith(
        expect.objectContaining({
          op: 'unsubscribe',
          args: ['kline.60.BTCUSDT'],
        }),
      );
    });

    it('does nothing for unknown handler', () => {
      const stream = new BybitPublicStream('wss://stream.bybit.com/v5/public/linear', mockLogger);
      mockWebSocket.sendToConnectedSocket.mockClear();

      stream.unsubscribeKlines('UNKNOWN', '1m', jest.fn());

      expect(mockWebSocket.sendToConnectedSocket).not.toHaveBeenCalled();
    });
  });

  describe('handleMessage', () => {
    it('logs subscription success', () => {
      const stream = new BybitPublicStream('wss://stream.bybit.com/v5/public/linear', mockLogger);
      stream.subscribeAllTickers(jest.fn());

      capturedOnMessage!({ op: 'subscribe', success: true });

      expect(mockLogger.debug).toHaveBeenCalledWith(expect.stringContaining('subscription successful'));
    });

    it('logs subscription error', () => {
      const stream = new BybitPublicStream('wss://stream.bybit.com/v5/public/linear', mockLogger);
      stream.subscribeAllTickers(jest.fn());

      capturedOnMessage!({ op: 'subscribe', success: false, ret_msg: 'invalid' });

      expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('subscription error'));
    });

    it('ignores messages without topic or data', () => {
      const stream = new BybitPublicStream('wss://stream.bybit.com/v5/public/linear', mockLogger);
      const handler = jest.fn();
      stream.subscribeAllTickers(handler);

      capturedOnMessage!({ op: 'pong' });

      expect(handler).not.toHaveBeenCalled();
    });

    it('logs error when handler throws', () => {
      const stream = new BybitPublicStream('wss://stream.bybit.com/v5/public/linear', mockLogger);
      const handler = jest.fn().mockImplementation(() => {
        throw new Error('ticker handler error');
      });
      stream.subscribeAllTickers(handler);

      capturedOnMessage!({ topic: 'tickers.linear', data: [MOCK_TICKER_RAW] });

      expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('ticker handler error'));
    });
  });

  describe('resubscribeAll', () => {
    it('resubscribes all active subscriptions on reconnect', () => {
      const stream = new BybitPublicStream('wss://stream.bybit.com/v5/public/linear', mockLogger);
      stream.subscribeAllTickers(jest.fn());
      stream.subscribeKlines('BTCUSDT', '1m', jest.fn());

      mockWebSocket.sendToConnectedSocket.mockClear();
      capturedOnReconnectSuccess!();

      expect(mockWebSocket.sendToConnectedSocket).toHaveBeenCalledWith(
        expect.objectContaining({
          op: 'subscribe',
          args: expect.arrayContaining(['tickers.linear', 'kline.1.BTCUSDT']),
        }),
      );
    });
  });

  describe('close', () => {
    it('closes WebSocket and nullifies', () => {
      const stream = new BybitPublicStream('wss://stream.bybit.com/v5/public/linear', mockLogger);
      stream.subscribeAllTickers(jest.fn());

      stream.close();

      expect(mockWebSocket.close).toHaveBeenCalledTimes(1);
    });
  });
});
