import type { BybitPublicTradeDataRaw, BybitTickerRaw, BybitWebSocketKlineRaw } from '../../src/normalizers/bybitNormalizer';
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
      const stream = new BybitPublicStream({ url: 'wss://stream.bybit.com/v5/public/linear', logger: mockLogger, onNotify: undefined, label: 'test' });
      stream.subscribeAllTickers(jest.fn());

      expect(mockWebSocket.sendToConnectedSocket).toHaveBeenCalledWith(
        expect.objectContaining({
          op: 'subscribe',
          args: expect.arrayContaining(['tickers.linear']),
        }),
      );
    });

    it('resolves topic as tickers.spot for spot URL', () => {
      const stream = new BybitPublicStream({ url: 'wss://stream.bybit.com/v5/public/spot', logger: mockLogger, onNotify: undefined, label: 'test' });
      stream.subscribeAllTickers(jest.fn());

      expect(mockWebSocket.sendToConnectedSocket).toHaveBeenCalledWith(
        expect.objectContaining({
          op: 'subscribe',
          args: expect.arrayContaining(['tickers.spot']),
        }),
      );
    });

    it('calls handler with normalized tickers', () => {
      const stream = new BybitPublicStream({ url: 'wss://stream.bybit.com/v5/public/linear', logger: mockLogger, onNotify: undefined, label: 'test' });
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
      const stream = new BybitPublicStream({ url: 'wss://stream.bybit.com/v5/public/linear', logger: mockLogger, onNotify: undefined, label: 'test' });
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
      const stream = new BybitPublicStream({ url: 'wss://stream.bybit.com/v5/public/linear', logger: mockLogger, onNotify: undefined, label: 'test' });
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
      const stream = new BybitPublicStream({ url: 'wss://stream.bybit.com/v5/public/linear', logger: mockLogger, onNotify: undefined, label: 'test' });

      stream.subscribeKlines('BTCUSDT', '1m', jest.fn());

      expect(ReliableWebSocket).toHaveBeenCalledTimes(1);
    });
  });

  describe('unsubscribeKlines', () => {
    it('sends unsubscribe and removes from activeSubscriptionSet', () => {
      const stream = new BybitPublicStream({ url: 'wss://stream.bybit.com/v5/public/linear', logger: mockLogger, onNotify: undefined, label: 'test' });
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
      const stream = new BybitPublicStream({ url: 'wss://stream.bybit.com/v5/public/linear', logger: mockLogger, onNotify: undefined, label: 'test' });
      mockWebSocket.sendToConnectedSocket.mockClear();

      stream.unsubscribeKlines('UNKNOWN', '1m', jest.fn());

      expect(mockWebSocket.sendToConnectedSocket).not.toHaveBeenCalled();
    });
  });

  describe('handleMessage', () => {
    it('logs subscription success', () => {
      const stream = new BybitPublicStream({ url: 'wss://stream.bybit.com/v5/public/linear', logger: mockLogger, onNotify: undefined, label: 'test' });
      stream.subscribeAllTickers(jest.fn());

      capturedOnMessage!({ op: 'subscribe', success: true });

      expect(mockLogger.debug).toHaveBeenCalledWith({ operation: 'subscribe' }, 'Bybit subscription successful');
    });

    it('logs subscription error', () => {
      const stream = new BybitPublicStream({ url: 'wss://stream.bybit.com/v5/public/linear', logger: mockLogger, onNotify: undefined, label: 'test' });
      stream.subscribeAllTickers(jest.fn());

      capturedOnMessage!({ op: 'subscribe', success: false, ret_msg: 'invalid' });

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ subscriptionMessage: expect.any(Object) }),
        'Bybit subscription error',
      );
    });

    it('ignores messages without topic or data', () => {
      const stream = new BybitPublicStream({ url: 'wss://stream.bybit.com/v5/public/linear', logger: mockLogger, onNotify: undefined, label: 'test' });
      const handler = jest.fn();
      stream.subscribeAllTickers(handler);

      capturedOnMessage!({ op: 'pong' });

      expect(handler).not.toHaveBeenCalled();
    });

    it('logs error when handler throws', () => {
      const stream = new BybitPublicStream({ url: 'wss://stream.bybit.com/v5/public/linear', logger: mockLogger, onNotify: undefined, label: 'test' });
      const handler = jest.fn().mockImplementation(() => {
        throw new Error('ticker handler error');
      });
      stream.subscribeAllTickers(handler);

      capturedOnMessage!({ topic: 'tickers.linear', data: [MOCK_TICKER_RAW] });

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ topic: 'tickers.linear', error: expect.any(Error) }),
        'BybitPublicStream: error handling message',
      );
    });
  });

  describe('resubscribeAll', () => {
    it('resubscribes all active subscriptions on reconnect', () => {
      const stream = new BybitPublicStream({ url: 'wss://stream.bybit.com/v5/public/linear', logger: mockLogger, onNotify: undefined, label: 'test' });
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

  describe('1s klines via trade aggregation', () => {
    it('subscribes to publicTrade topic for 1s interval', () => {
      const stream = new BybitPublicStream({ url: 'wss://stream.bybit.com/v5/public/linear', logger: mockLogger, onNotify: undefined, label: 'test' });
      stream.subscribeAllTickers(jest.fn());

      stream.subscribeKlines('BTCUSDT', '1s', jest.fn());

      expect(mockWebSocket.sendToConnectedSocket).toHaveBeenCalledWith(
        expect.objectContaining({
          op: 'subscribe',
          args: ['publicTrade.BTCUSDT'],
        }),
      );
    });

    it('routes publicTrade messages through aggregator to handler', () => {
      const stream = new BybitPublicStream({ url: 'wss://stream.bybit.com/v5/public/linear', logger: mockLogger, onNotify: undefined, label: 'test' });
      const handler = jest.fn();
      stream.subscribeKlines('BTCUSDT', '1s', handler);

      const trade1: BybitPublicTradeDataRaw = { s: 'BTCUSDT', p: '50000', v: '0.1', T: 1700000000500 };
      const trade2: BybitPublicTradeDataRaw = { s: 'BTCUSDT', p: '50100', v: '0.2', T: 1700000001200 };
      const trade3: BybitPublicTradeDataRaw = { s: 'BTCUSDT', p: '50200', v: '0.1', T: 1700000002100 };

      capturedOnMessage!({ topic: 'publicTrade.BTCUSDT', data: [trade1] });
      capturedOnMessage!({ topic: 'publicTrade.BTCUSDT', data: [trade2] });
      capturedOnMessage!({ topic: 'publicTrade.BTCUSDT', data: [trade3] });

      expect(handler).toHaveBeenCalledWith('BTCUSDT', expect.objectContaining({ isClosed: true }));
    });

    it('unsubscribes from publicTrade topic for 1s interval', () => {
      const stream = new BybitPublicStream({ url: 'wss://stream.bybit.com/v5/public/linear', logger: mockLogger, onNotify: undefined, label: 'test' });
      const handler = jest.fn();
      stream.subscribeAllTickers(jest.fn());

      stream.subscribeKlines('BTCUSDT', '1s', handler);
      mockWebSocket.sendToConnectedSocket.mockClear();

      stream.unsubscribeKlines('BTCUSDT', '1s', handler);

      expect(mockWebSocket.sendToConnectedSocket).toHaveBeenCalledWith(
        expect.objectContaining({
          op: 'unsubscribe',
          args: ['publicTrade.BTCUSDT'],
        }),
      );
    });

    it('emits pending klines on close', () => {
      const stream = new BybitPublicStream({ url: 'wss://stream.bybit.com/v5/public/linear', logger: mockLogger, onNotify: undefined, label: 'test' });
      const handler = jest.fn();
      stream.subscribeKlines('BTCUSDT', '1s', handler);

      const trade1: BybitPublicTradeDataRaw = { s: 'BTCUSDT', p: '50000', v: '0.1', T: 1700000000500 };
      const trade2: BybitPublicTradeDataRaw = { s: 'BTCUSDT', p: '50100', v: '0.2', T: 1700000001200 };

      capturedOnMessage!({ topic: 'publicTrade.BTCUSDT', data: [trade1] });
      capturedOnMessage!({ topic: 'publicTrade.BTCUSDT', data: [trade2] });

      stream.close();

      expect(handler).toHaveBeenCalledWith('BTCUSDT', expect.objectContaining({ openPrice: 50100 }));
    });

    it('clears aggregator state on resubscribeAll', () => {
      const stream = new BybitPublicStream({ url: 'wss://stream.bybit.com/v5/public/linear', logger: mockLogger, onNotify: undefined, label: 'test' });
      const handler = jest.fn();
      stream.subscribeKlines('BTCUSDT', '1s', handler);

      const trade1: BybitPublicTradeDataRaw = { s: 'BTCUSDT', p: '50000', v: '0.1', T: 1700000000500 };

      capturedOnMessage!({ topic: 'publicTrade.BTCUSDT', data: [trade1] });

      capturedOnReconnectSuccess!();

      const trade2: BybitPublicTradeDataRaw = { s: 'BTCUSDT', p: '50100', v: '0.2', T: 1700000003500 };

      capturedOnMessage!({ topic: 'publicTrade.BTCUSDT', data: [trade2] });

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('close', () => {
    it('closes WebSocket and nullifies', () => {
      const stream = new BybitPublicStream({ url: 'wss://stream.bybit.com/v5/public/linear', logger: mockLogger, onNotify: undefined, label: 'test' });
      stream.subscribeAllTickers(jest.fn());

      stream.close();

      expect(mockWebSocket.close).toHaveBeenCalledTimes(1);
    });
  });
});
