import type { BinanceTicker24hrRaw, BinanceWebSocketKlineRaw } from '../../src/normalizers/binanceNormalizer';
import { BinanceFuturesPublicStream } from '../../src/ws/BinanceFuturesPublicStream';
import { createMockLogger } from '../fixtures/mockLogger';

let capturedOnMessage: ((message: any) => void) | undefined;

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
};

describe('BinanceFuturesPublicStream', () => {
  const mockLogger = createMockLogger();
  const url = 'wss://fstream.binance.com/stream';

  beforeEach(() => {
    jest.clearAllMocks();
    capturedOnMessage = undefined;
  });

  describe('subscribeAllTickers', () => {
    it('creates connection with miniTicker stream in URL', async () => {
      const { ReliableWebSocket } = require('@solncebro/websocket-engine');
      const stream = new BinanceFuturesPublicStream(url, mockLogger);
      const handler = jest.fn();

      stream.subscribeAllTickers(handler);

      // Wait for queueMicrotask
      await Promise.resolve();

      expect(ReliableWebSocket).toHaveBeenCalledWith(
        expect.objectContaining({
          url: expect.stringContaining('!miniTicker@arr'),
        }),
      );
    });

    it('calls handler with normalized tickers on array message', async () => {
      const stream = new BinanceFuturesPublicStream(url, mockLogger);
      const handler = jest.fn();

      stream.subscribeAllTickers(handler);
      await Promise.resolve();

      capturedOnMessage!({ data: [MOCK_TICKER_RAW] });

      expect(handler).toHaveBeenCalledTimes(1);
      const tickerMap = handler.mock.calls[0][0];
      expect(tickerMap).toBeInstanceOf(Map);
      expect(tickerMap.get('BTCUSDT')).toBeDefined();
    });
  });

  describe('subscribeKlines', () => {
    it('includes kline stream in connection URL', async () => {
      const { ReliableWebSocket } = require('@solncebro/websocket-engine');
      const stream = new BinanceFuturesPublicStream(url, mockLogger);

      stream.subscribeKlines('BTCUSDT', '1m', jest.fn());
      await Promise.resolve();

      expect(ReliableWebSocket).toHaveBeenCalledWith(
        expect.objectContaining({
          url: expect.stringContaining('btcusdt_perpetual@continuousKline_1m'),
        }),
      );
    });

    it('sends SUBSCRIBE for dynamic subscription when connection exists', async () => {
      const stream = new BinanceFuturesPublicStream(url, mockLogger);
      stream.subscribeAllTickers(jest.fn());
      await Promise.resolve();

      stream.subscribeKlines('ETHUSDT', '5m', jest.fn());

      expect(mockWebSocket.sendToConnectedSocket).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'SUBSCRIBE',
          params: ['ethusdt_perpetual@continuousKline_5m'],
        }),
      );
    });

    it('calls handler when kline message arrives', async () => {
      const stream = new BinanceFuturesPublicStream(url, mockLogger);
      const handler = jest.fn();

      stream.subscribeKlines('BTCUSDT', '1m', handler);
      await Promise.resolve();

      capturedOnMessage!({
        stream: 'btcusdt_perpetual@continuousKline_1m',
        data: { k: MOCK_KLINE_RAW },
      });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith('BTCUSDT', expect.objectContaining({ openPrice: 50000 }));
    });
  });

  describe('unsubscribeKlines', () => {
    it('sends UNSUBSCRIBE when last handler removed', async () => {
      const stream = new BinanceFuturesPublicStream(url, mockLogger);
      const handler = jest.fn();

      stream.subscribeAllTickers(jest.fn());
      await Promise.resolve();

      stream.subscribeKlines('BTCUSDT', '1m', handler);
      stream.unsubscribeKlines('BTCUSDT', '1m', handler);

      expect(mockWebSocket.sendToConnectedSocket).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'UNSUBSCRIBE',
          params: ['btcusdt_perpetual@continuousKline_1m'],
        }),
      );
    });
  });

  describe('handleMessage', () => {
    it('ignores message without data', async () => {
      const stream = new BinanceFuturesPublicStream(url, mockLogger);
      const handler = jest.fn();
      stream.subscribeAllTickers(handler);
      await Promise.resolve();

      capturedOnMessage!({});

      expect(handler).not.toHaveBeenCalled();
    });

    it('logs error when handler throws', async () => {
      const stream = new BinanceFuturesPublicStream(url, mockLogger);
      const handler = jest.fn().mockImplementation(() => {
        throw new Error('handler boom');
      });
      stream.subscribeAllTickers(handler);
      await Promise.resolve();

      capturedOnMessage!({ data: [MOCK_TICKER_RAW] });

      expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('handler boom'));
    });

    it('ignores kline message without k field', async () => {
      const stream = new BinanceFuturesPublicStream(url, mockLogger);
      const handler = jest.fn();
      stream.subscribeKlines('BTCUSDT', '1m', handler);
      await Promise.resolve();

      capturedOnMessage!({
        stream: 'btcusdt_perpetual@continuousKline_1m',
        data: { noKField: true },
      });

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('close', () => {
    it('closes all connections', async () => {
      const stream = new BinanceFuturesPublicStream(url, mockLogger);
      stream.subscribeAllTickers(jest.fn());
      await Promise.resolve();

      stream.close();

      expect(mockWebSocket.close).toHaveBeenCalledTimes(1);
    });
  });

  describe('chunking', () => {
    it('creates multiple connections when streams exceed limit', async () => {
      const { ReliableWebSocket } = require('@solncebro/websocket-engine');
      const stream = new BinanceFuturesPublicStream(url, mockLogger);

      // Subscribe to 201 kline streams to exceed MAX_STREAMS_PER_CONNECTION (200)
      for (let i = 0; i < 201; i++) {
        stream.subscribeKlines(`SYMBOL${i}USDT`, '1m', jest.fn());
      }

      await Promise.resolve();

      expect(ReliableWebSocket).toHaveBeenCalledTimes(2);
    });
  });
});
