import type { MarkPriceUpdate } from '../../src/types/common';
import type { BybitPublicTradeDataRaw, BybitTickerRaw, BybitWebSocketKlineRaw } from '../../src/normalizers/bybitNormalizer';
import { BybitPublicStream } from '../../src/ws/BybitPublicStream';
import { createMockLogger } from '../fixtures/mockLogger';

let capturedOnMessage: ((message: any) => void) | undefined;
let capturedOnReconnectSuccess: (() => void) | undefined;
let _capturedOnOpen: (() => Promise<void>) | undefined;

const mockContextSend = jest.fn();

const mockWebSocket = {
  close: jest.fn(),
  sendToConnectedSocket: jest.fn(),
  getStatus: jest.fn().mockReturnValue('connected'),
};

jest.mock('@solncebro/websocket-engine', () => {
  const actual = jest.requireActual('@solncebro/websocket-engine');
  return {
    ...actual,
    ReliableWebSocket: jest.fn().mockImplementation((args: any) => {
      capturedOnMessage = args.onMessage;
      capturedOnReconnectSuccess = args.onReconnectSuccess;
      _capturedOnOpen = args.onOpen;

      if (args.onOpen) {
        const mockContext = { send: mockContextSend, waitForMessage: jest.fn() };
        queueMicrotask(() => args.onOpen(mockContext));
      }

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
    mockContextSend.mockClear();
    capturedOnMessage = undefined;
    capturedOnReconnectSuccess = undefined;
    _capturedOnOpen = undefined;
  });

  describe('subscribeAllTickers', () => {
    it('resolves topic as tickers.linear for linear URL', async () => {
      const stream = new BybitPublicStream({ url: 'wss://stream.bybit.com/v5/public/linear', logger: mockLogger, onNotify: undefined, label: 'test' });
      stream.subscribeAllTickers(jest.fn());

      await Promise.resolve();
      await Promise.resolve();

      expect(mockContextSend).toHaveBeenCalledWith(
        expect.objectContaining({
          op: 'subscribe',
          args: expect.arrayContaining(['tickers.linear']),
        }),
      );
    });

    it('resolves topic as tickers.spot for spot URL', async () => {
      const stream = new BybitPublicStream({ url: 'wss://stream.bybit.com/v5/public/spot', logger: mockLogger, onNotify: undefined, label: 'test' });
      stream.subscribeAllTickers(jest.fn());

      await Promise.resolve();
      await Promise.resolve();

      expect(mockContextSend).toHaveBeenCalledWith(
        expect.objectContaining({
          op: 'subscribe',
          args: expect.arrayContaining(['tickers.spot']),
        }),
      );
    });

    it('calls handler with normalized tickers', async () => {
      const stream = new BybitPublicStream({ url: 'wss://stream.bybit.com/v5/public/linear', logger: mockLogger, onNotify: undefined, label: 'test' });
      const handler = jest.fn();
      stream.subscribeAllTickers(handler);

      await Promise.resolve();

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
    it('converts interval and subscribes with correct topic', async () => {
      const stream = new BybitPublicStream({ url: 'wss://stream.bybit.com/v5/public/linear', logger: mockLogger, onNotify: undefined, label: 'test' });
      stream.subscribeAllTickers(jest.fn());

      await Promise.resolve();

      stream.subscribeKlines('BTCUSDT', '1h', jest.fn());

      expect(mockWebSocket.sendToConnectedSocket).toHaveBeenCalledWith(
        expect.objectContaining({
          op: 'subscribe',
          args: ['kline.60.BTCUSDT'],
        }),
      );
    });

    it('calls handler when kline message arrives', async () => {
      const stream = new BybitPublicStream({ url: 'wss://stream.bybit.com/v5/public/linear', logger: mockLogger, onNotify: undefined, label: 'test' });
      const handler = jest.fn();
      stream.subscribeKlines('BTCUSDT', '1m', handler);

      await Promise.resolve();

      capturedOnMessage!({
        topic: 'kline.1.BTCUSDT',
        data: [MOCK_KLINE_RAW],
      });

      expect(handler).toHaveBeenCalledWith('BTCUSDT', expect.objectContaining({ openPrice: 50000 }));
    });

    it('creates connection if not already connected', async () => {
      const { ReliableWebSocket } = require('@solncebro/websocket-engine');
      const stream = new BybitPublicStream({ url: 'wss://stream.bybit.com/v5/public/linear', logger: mockLogger, onNotify: undefined, label: 'test' });

      stream.subscribeKlines('BTCUSDT', '1m', jest.fn());

      await Promise.resolve();

      expect(ReliableWebSocket).toHaveBeenCalledTimes(1);
    });
  });

  describe('unsubscribeKlines', () => {
    it('sends unsubscribe and removes from activeSubscriptionSet', async () => {
      const stream = new BybitPublicStream({ url: 'wss://stream.bybit.com/v5/public/linear', logger: mockLogger, onNotify: undefined, label: 'test' });
      const handler = jest.fn();
      stream.subscribeAllTickers(jest.fn());

      await Promise.resolve();

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
    it('does not log on subscription success', async () => {
      const stream = new BybitPublicStream({ url: 'wss://stream.bybit.com/v5/public/linear', logger: mockLogger, onNotify: undefined, label: 'test' });
      stream.subscribeAllTickers(jest.fn());

      await Promise.resolve();

      mockLogger.info.mockClear();
      capturedOnMessage!({ op: 'subscribe', success: true });

      expect(mockLogger.info).not.toHaveBeenCalled();
    });

    it('logs subscription error', async () => {
      const stream = new BybitPublicStream({ url: 'wss://stream.bybit.com/v5/public/linear', logger: mockLogger, onNotify: undefined, label: 'test' });
      stream.subscribeAllTickers(jest.fn());

      await Promise.resolve();

      capturedOnMessage!({ op: 'subscribe', success: false, ret_msg: 'invalid' });

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ subscriptionMessage: expect.any(Object) }),
        'Bybit subscription error',
      );
    });

    it('ignores messages without topic or data', async () => {
      const stream = new BybitPublicStream({ url: 'wss://stream.bybit.com/v5/public/linear', logger: mockLogger, onNotify: undefined, label: 'test' });
      const handler = jest.fn();
      stream.subscribeAllTickers(handler);

      await Promise.resolve();

      capturedOnMessage!({ op: 'pong' });

      expect(handler).not.toHaveBeenCalled();
    });

    it('logs error when handler throws', async () => {
      const stream = new BybitPublicStream({ url: 'wss://stream.bybit.com/v5/public/linear', logger: mockLogger, onNotify: undefined, label: 'test' });
      const handler = jest.fn().mockImplementation(() => {
        throw new Error('ticker handler error');
      });
      stream.subscribeAllTickers(handler);

      await Promise.resolve();

      capturedOnMessage!({ topic: 'tickers.linear', data: [MOCK_TICKER_RAW] });

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ topic: 'tickers.linear', error: expect.any(Error) }),
        'BybitPublicStream: error handling message',
      );
    });
  });

  describe('resubscribeAll', () => {
    it('resubscribes all active subscriptions on reconnect', async () => {
      const stream = new BybitPublicStream({ url: 'wss://stream.bybit.com/v5/public/linear', logger: mockLogger, onNotify: undefined, label: 'test' });
      stream.subscribeAllTickers(jest.fn());
      stream.subscribeKlines('BTCUSDT', '1m', jest.fn());

      await Promise.resolve();

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
    it('subscribes to publicTrade topic for 1s interval', async () => {
      const stream = new BybitPublicStream({ url: 'wss://stream.bybit.com/v5/public/linear', logger: mockLogger, onNotify: undefined, label: 'test' });
      stream.subscribeAllTickers(jest.fn());

      await Promise.resolve();

      stream.subscribeKlines('BTCUSDT', '1s', jest.fn());

      expect(mockWebSocket.sendToConnectedSocket).toHaveBeenCalledWith(
        expect.objectContaining({
          op: 'subscribe',
          args: ['publicTrade.BTCUSDT'],
        }),
      );
    });

    it('routes publicTrade messages through aggregator to handler', async () => {
      const stream = new BybitPublicStream({ url: 'wss://stream.bybit.com/v5/public/linear', logger: mockLogger, onNotify: undefined, label: 'test' });
      const handler = jest.fn();
      stream.subscribeKlines('BTCUSDT', '1s', handler);

      await Promise.resolve();

      const trade1: BybitPublicTradeDataRaw = { s: 'BTCUSDT', p: '50000', v: '0.1', T: 1700000000500 };
      const trade2: BybitPublicTradeDataRaw = { s: 'BTCUSDT', p: '50100', v: '0.2', T: 1700000001200 };
      const trade3: BybitPublicTradeDataRaw = { s: 'BTCUSDT', p: '50200', v: '0.1', T: 1700000002100 };

      capturedOnMessage!({ topic: 'publicTrade.BTCUSDT', data: [trade1] });
      capturedOnMessage!({ topic: 'publicTrade.BTCUSDT', data: [trade2] });
      capturedOnMessage!({ topic: 'publicTrade.BTCUSDT', data: [trade3] });

      expect(handler).toHaveBeenCalledWith('BTCUSDT', expect.objectContaining({ isClosed: true }));
    });

    it('unsubscribes from publicTrade topic for 1s interval', async () => {
      const stream = new BybitPublicStream({ url: 'wss://stream.bybit.com/v5/public/linear', logger: mockLogger, onNotify: undefined, label: 'test' });
      const handler = jest.fn();
      stream.subscribeAllTickers(jest.fn());

      await Promise.resolve();

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

    it('emits pending klines on close', async () => {
      const stream = new BybitPublicStream({ url: 'wss://stream.bybit.com/v5/public/linear', logger: mockLogger, onNotify: undefined, label: 'test' });
      const handler = jest.fn();
      stream.subscribeKlines('BTCUSDT', '1s', handler);

      await Promise.resolve();

      const trade1: BybitPublicTradeDataRaw = { s: 'BTCUSDT', p: '50000', v: '0.1', T: 1700000000500 };
      const trade2: BybitPublicTradeDataRaw = { s: 'BTCUSDT', p: '50100', v: '0.2', T: 1700000001200 };

      capturedOnMessage!({ topic: 'publicTrade.BTCUSDT', data: [trade1] });
      capturedOnMessage!({ topic: 'publicTrade.BTCUSDT', data: [trade2] });

      stream.close();

      expect(handler).toHaveBeenCalledWith('BTCUSDT', expect.objectContaining({ openPrice: 50100 }));
    });

    it('clears aggregator state on resubscribeAll', async () => {
      const stream = new BybitPublicStream({ url: 'wss://stream.bybit.com/v5/public/linear', logger: mockLogger, onNotify: undefined, label: 'test' });
      const handler = jest.fn();
      stream.subscribeKlines('BTCUSDT', '1s', handler);

      await Promise.resolve();

      const trade1: BybitPublicTradeDataRaw = { s: 'BTCUSDT', p: '50000', v: '0.1', T: 1700000000500 };

      capturedOnMessage!({ topic: 'publicTrade.BTCUSDT', data: [trade1] });

      capturedOnReconnectSuccess!();

      const trade2: BybitPublicTradeDataRaw = { s: 'BTCUSDT', p: '50100', v: '0.2', T: 1700000003500 };

      capturedOnMessage!({ topic: 'publicTrade.BTCUSDT', data: [trade2] });

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('close', () => {
    it('closes WebSocket and nullifies', async () => {
      const stream = new BybitPublicStream({ url: 'wss://stream.bybit.com/v5/public/linear', logger: mockLogger, onNotify: undefined, label: 'test' });
      stream.subscribeAllTickers(jest.fn());

      await Promise.resolve();

      stream.close();

      expect(mockWebSocket.close).toHaveBeenCalledTimes(1);
    });
  });

  describe('chunking', () => {
    it('creates multiple connections when topics exceed limit', async () => {
      const { ReliableWebSocket } = require('@solncebro/websocket-engine');
      const stream = new BybitPublicStream({ url: 'wss://stream.bybit.com/v5/public/linear', logger: mockLogger, onNotify: undefined, label: 'test' });

      for (let i = 0; i < 201; i++) {
        stream.subscribeKlines(`SYMBOL${i}USDT`, '1m', jest.fn());
      }

      await Promise.resolve();

      expect(ReliableWebSocket).toHaveBeenCalledTimes(2);
    });
  });

  describe('mark price subscription', () => {
    it('registers and removes mark price handler', () => {
      const stream = new BybitPublicStream({ url: 'wss://stream.bybit.com/v5/public/linear', logger: mockLogger, onNotify: undefined, label: 'test' });
      const handler = jest.fn();

      stream.subscribeMarkPrices(handler);
      // @ts-expect-error — private access for test
      expect(stream.markPriceHandlerSet.size).toBe(1);

      stream.unsubscribeMarkPrices(handler);
      // @ts-expect-error — private access for test
      expect(stream.markPriceHandlerSet.size).toBe(0);
    });

    it('dispatches MarkPriceUpdate[] from tickers.linear payload', async () => {
      const stream = new BybitPublicStream({ url: 'wss://stream.bybit.com/v5/public/linear', logger: mockLogger, onNotify: undefined, label: 'test' });
      const received: MarkPriceUpdate[][] = [];
      stream.subscribeMarkPrices((list) => received.push(list));

      await Promise.resolve();

      capturedOnMessage!({
        topic: 'tickers.linear',
        type: 'snapshot',
        ts: 1000,
        data: [
          {
            symbol: 'BTCUSDT',
            lastPrice: '50000',
            prevPrice24h: '0',
            highPrice24h: '0',
            lowPrice24h: '0',
            price24hPcnt: '0',
            volume24h: '0',
            turnover24h: '0',
            markPrice: '49950',
            indexPrice: '49955',
            time: 1000,
          },
        ],
      });

      expect(received).toHaveLength(1);
      expect(received[0]).toEqual([
        { symbol: 'BTCUSDT', markPrice: 49950, indexPrice: 49955, timestamp: 1000 },
      ]);
    });

    it('ignores entries without markPrice (e.g. partial delta)', async () => {
      const stream = new BybitPublicStream({ url: 'wss://stream.bybit.com/v5/public/linear', logger: mockLogger, onNotify: undefined, label: 'test' });
      const received: MarkPriceUpdate[][] = [];
      stream.subscribeMarkPrices((list) => received.push(list));

      await Promise.resolve();

      capturedOnMessage!({
        topic: 'tickers.linear',
        type: 'delta',
        ts: 2000,
        data: [{ symbol: 'BTCUSDT', lastPrice: '51000' }],
      });

      expect(received).toEqual([]);
    });

    it('activates tickers.linear subscription when subscribeMarkPrices is called', () => {
      const stream = new BybitPublicStream({ url: 'wss://stream.bybit.com/v5/public/linear', logger: mockLogger, onNotify: undefined, label: 'test' });
      stream.subscribeMarkPrices(jest.fn());

      // @ts-expect-error — private access for test
      expect(stream.activeSubscriptionSet.has('tickers.linear')).toBe(true);
    });
  });
});
