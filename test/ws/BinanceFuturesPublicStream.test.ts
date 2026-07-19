import type { MarkPriceUpdate } from '../../src/types/common';
import type {
  BinanceMarkPriceWebSocketRaw,
  BinanceTicker24hrRaw,
  BinanceWebSocketKlineRaw,
} from '../../src/normalizers/binanceNormalizer';
import { BinanceFuturesPublicStream } from '../../src/ws/BinanceFuturesPublicStream';
import { createMockLogger } from '../fixtures/mockLogger';

let capturedOnMessage: ((message: any) => void) | undefined;

const mockWebSocket = {
  close: jest.fn(),
  sendToConnectedSocket: jest.fn(),
};

const mockSend = jest.fn();

jest.mock('@solncebro/websocket-engine', () => {
  const actual = jest.requireActual('@solncebro/websocket-engine');
  return {
    ...actual,
    ReliableWebSocket: jest.fn().mockImplementation((args: any) => {
      capturedOnMessage = args.onMessage;

      if (args.onOpen) {
        Promise.resolve().then(() => args.onOpen({ send: mockSend }));
      }

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

const flushAsync = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
};

// Every stream created in a test is tracked here so afterEach can close it and stop its
// stale-watcher setInterval — otherwise the timers leak and Jest force-exits the worker.
const createdStreamList: BinanceFuturesPublicStream[] = [];

const trackStream = (stream: BinanceFuturesPublicStream): BinanceFuturesPublicStream => {
  createdStreamList.push(stream);

  return stream;
};

const createStreamForTest = (args: {
  url: string;
  mockLogger: ReturnType<typeof createMockLogger>;
}): BinanceFuturesPublicStream =>
  trackStream(
    new BinanceFuturesPublicStream({
      webSocketUrl: args.url,
      logger: args.mockLogger,
      onNotify: undefined,
      label: 'test',
      pauseBetweenConnectionsMs: 0,
    }),
  );

describe('BinanceFuturesPublicStream', () => {
  const mockLogger = createMockLogger();
  const url = 'wss://fstream.binance.com/stream';

  beforeEach(() => {
    jest.clearAllMocks();
    capturedOnMessage = undefined;
    mockSend.mockReset();
  });

  afterEach(async () => {
    // Let any deferred connect microtask run so the stale-watcher timer exists before close().
    await flushAsync();

    for (const stream of createdStreamList) {
      stream.close();
    }

    createdStreamList.length = 0;
  });

  describe('subscribeAllTickers', () => {
    it('creates connection without stream in URL (pure SUBSCRIBE pattern)', async () => {
      const { ReliableWebSocket } = require('@solncebro/websocket-engine');
      const stream = createStreamForTest({ url, mockLogger });
      const handler = jest.fn();

      stream.subscribeAllTickers(handler, []);

      await flushAsync();

      expect(ReliableWebSocket).toHaveBeenCalledWith(
        expect.objectContaining({
          url,
        }),
      );

      const callArgs = ReliableWebSocket.mock.calls[0][0];
      expect(callArgs.url).not.toContain('?streams=');
    });

    it('calls handler with normalized tickers on array message', async () => {
      const stream = createStreamForTest({ url, mockLogger });
      const handler = jest.fn();

      stream.subscribeAllTickers(handler, []);
      await flushAsync();

      capturedOnMessage!({ data: [MOCK_TICKER_RAW] });

      expect(handler).toHaveBeenCalledTimes(1);
      const tickerMap = handler.mock.calls[0][0];
      expect(tickerMap).toBeInstanceOf(Map);
      expect(tickerMap.get('BTCUSDT')).toBeDefined();
    });
  });

  describe('subscribeKlines', () => {
    it('creates connection without stream in URL (streams subscribed via SUBSCRIBE batch in onOpen)', async () => {
      const { ReliableWebSocket } = require('@solncebro/websocket-engine');
      const stream = createStreamForTest({ url, mockLogger });

      stream.subscribeKlines('BTCUSDT', '1m', jest.fn());
      await flushAsync();

      const callArgs = ReliableWebSocket.mock.calls[0][0];
      expect(callArgs.url).toBe(url);
      expect(callArgs.url).not.toContain('?streams=');
    });

    it('sends SUBSCRIBE for dynamic subscription when connection of the same timeframe exists', async () => {
      const stream = createStreamForTest({ url, mockLogger });
      stream.subscribeKlines('BTCUSDT', '5m', jest.fn());
      await flushAsync();

      stream.subscribeKlines('ETHUSDT', '5m', jest.fn());

      expect(mockWebSocket.sendToConnectedSocket).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'SUBSCRIBE',
          params: ['ethusdt_perpetual@continuousKline_5m'],
        }),
      );
    });

    it('does not flood per-stream SUBSCRIBE frames when a new interval connection is filled before it opens', async () => {
      const stream = createStreamForTest({ url, mockLogger });

      // Interval 1: establish and fully open a connection so connectionList is non-empty.
      stream.subscribeKlines('AAAUSDT', '1m', jest.fn());
      await flushAsync();
      mockWebSocket.sendToConnectedSocket.mockClear();
      mockSend.mockClear();

      // Interval 2: many symbols subscribed synchronously onto a brand-new (not-yet-open) connection.
      // <= batch size so onOpen sends a single paced batch (no fake timers needed).
      const intervalTwoCount = 40;
      for (let i = 0; i < intervalTwoCount; i++) {
        stream.subscribeKlines(`SYM${i}USDT`, '5m', jest.fn());
      }
      await flushAsync();

      // No per-stream flood: Binance caps incoming messages at 10/sec/connection, so ~40 individual
      // SUBSCRIBE frames at once would get the connection dropped. They must go via the onOpen batch.
      expect(mockWebSocket.sendToConnectedSocket).not.toHaveBeenCalled();

      // They ARE subscribed — through the paced onOpen batch (context.send), which carries every stream.
      const subscribedStreams = mockSend.mock.calls
        .map(([message]) => message)
        .filter((message) => message?.method === 'SUBSCRIBE')
        .flatMap((message) => message.params as string[]);
      expect(subscribedStreams).toContain('sym0usdt_perpetual@continuousKline_5m');
      expect(subscribedStreams).toContain('sym39usdt_perpetual@continuousKline_5m');
      expect(subscribedStreams).toHaveLength(intervalTwoCount);
    });

    it('calls handler when kline message arrives', async () => {
      const stream = createStreamForTest({ url, mockLogger });
      const handler = jest.fn();

      stream.subscribeKlines('BTCUSDT', '1m', handler);
      await flushAsync();

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
      const stream = createStreamForTest({ url, mockLogger });
      const handler = jest.fn();

      stream.subscribeAllTickers(jest.fn(), []);
      await flushAsync();

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
      const stream = createStreamForTest({ url, mockLogger });
      const handler = jest.fn();
      stream.subscribeAllTickers(handler, []);
      await flushAsync();

      capturedOnMessage!({});

      expect(handler).not.toHaveBeenCalled();
    });

    it('logs error when handler throws', async () => {
      const stream = createStreamForTest({ url, mockLogger });
      const handler = jest.fn().mockImplementation(() => {
        throw new Error('handler boom');
      });
      stream.subscribeAllTickers(handler, []);
      await flushAsync();

      capturedOnMessage!({ data: [MOCK_TICKER_RAW] });

      expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('handler boom'));
    });

    it('ignores kline message without k field', async () => {
      const stream = createStreamForTest({ url, mockLogger });
      const handler = jest.fn();
      stream.subscribeKlines('BTCUSDT', '1m', handler);
      await flushAsync();

      capturedOnMessage!({
        stream: 'btcusdt_perpetual@continuousKline_1m',
        data: { noKField: true },
      });

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('close', () => {
    it('closes all connections', async () => {
      const stream = createStreamForTest({ url, mockLogger });
      stream.subscribeAllTickers(jest.fn(), []);
      await flushAsync();

      stream.close();

      expect(mockWebSocket.close).toHaveBeenCalledTimes(1);
    });
  });

  describe('interval grouping', () => {
    it('puts all symbols of one interval into a single connection', async () => {
      const { ReliableWebSocket } = require('@solncebro/websocket-engine');
      const stream = createStreamForTest({ url, mockLogger });

      for (let i = 0; i < 100; i++) {
        stream.subscribeKlines(`SYMBOL${i}USDT`, '1m', jest.fn());
      }

      await flushAsync();

      expect(ReliableWebSocket).toHaveBeenCalledTimes(1);
    });

    it('creates a separate connection per interval', async () => {
      const { ReliableWebSocket } = require('@solncebro/websocket-engine');
      const stream = createStreamForTest({ url, mockLogger });

      stream.subscribeKlines('BTCUSDT', '1m', jest.fn());
      stream.subscribeKlines('BTCUSDT', '5m', jest.fn());
      stream.subscribeKlines('BTCUSDT', '1h', jest.fn());
      stream.subscribeKlines('BTCUSDT', '4h', jest.fn());

      await flushAsync();

      expect(ReliableWebSocket).toHaveBeenCalledTimes(4);
    });

    it('keeps URL clean (no streams query) regardless of subscription count', async () => {
      const { ReliableWebSocket } = require('@solncebro/websocket-engine');
      const stream = createStreamForTest({ url, mockLogger });

      for (let i = 0; i < 100; i++) {
        stream.subscribeKlines(`SYMBOL${i}USDT`, '1m', jest.fn());
      }

      await flushAsync();

      const callArgs = ReliableWebSocket.mock.calls[0][0];
      expect(callArgs.url).toBe(url);
      expect(callArgs.url).not.toContain('?streams=');
    });
  });

  describe('connection sharding (per-connection stream cap)', () => {
    const buildShardedStream = (maxStreamsPerConnection: number): BinanceFuturesPublicStream =>
      trackStream(
        new BinanceFuturesPublicStream({
          webSocketUrl: url,
          logger: mockLogger,
          onNotify: undefined,
          label: 'test',
          pauseBetweenConnectionsMs: 0,
          maxStreamsPerConnection,
        }),
      );

    it('shards one interval across multiple connections when it exceeds the per-connection cap', async () => {
      const { ReliableWebSocket } = require('@solncebro/websocket-engine');
      const stream = buildShardedStream(3);

      for (let i = 0; i < 7; i++) {
        stream.subscribeKlines(`SYM${i}USDT`, '1m', jest.fn());
      }
      await flushAsync();

      expect(ReliableWebSocket).toHaveBeenCalledTimes(3); // ceil(7 / 3)
    });

    it('keeps every shard within the cap and loses no streams', async () => {
      const stream = buildShardedStream(3);

      for (let i = 0; i < 7; i++) {
        stream.subscribeKlines(`SYM${i}USDT`, '1m', jest.fn());
      }
      await flushAsync();

      // @ts-expect-error — private access for test
      const connections = stream.connectionList as Array<{ streamList: string[] }>;
      for (const connection of connections) {
        expect(connection.streamList.length).toBeLessThanOrEqual(3);
      }
      const totalStreams = connections.reduce((sum, connection) => sum + connection.streamList.length, 0);
      expect(totalStreams).toBe(7);
    });

    it('opens a new shard for the same interval when the active one is full (incremental add)', async () => {
      const { ReliableWebSocket } = require('@solncebro/websocket-engine');
      const stream = buildShardedStream(2);

      stream.subscribeKlines('AUSDT', '1m', jest.fn());
      stream.subscribeKlines('BUSDT', '1m', jest.fn());
      await flushAsync();
      expect(ReliableWebSocket).toHaveBeenCalledTimes(1);

      stream.subscribeKlines('CUSDT', '1m', jest.fn());
      await flushAsync();
      expect(ReliableWebSocket).toHaveBeenCalledTimes(2);
    });
  });

  describe('mark price subscription', () => {
    it('registers handler via subscribeMarkPrices and removes via unsubscribeMarkPrices', () => {
      const stream = createStreamForTest({ url, mockLogger });
      const handler = jest.fn();

      stream.subscribeMarkPrices(handler, []);
      // @ts-expect-error — private access for test
      expect(stream.markPriceHandlerSet.size).toBe(1);

      stream.unsubscribeMarkPrices(handler);
      // @ts-expect-error — private access for test
      expect(stream.markPriceHandlerSet.size).toBe(0);
    });

    it('dispatches normalized MarkPriceUpdate list when markPrice payload arrives', async () => {
      const stream = createStreamForTest({ url, mockLogger });
      const received: MarkPriceUpdate[][] = [];
      stream.subscribeMarkPrices((list) => received.push(list), []);
      await flushAsync();

      const rawMarkPrice: BinanceMarkPriceWebSocketRaw = {
        e: 'markPriceUpdate',
        E: 100,
        s: 'BTCUSDT',
        p: '50000.5',
        ap: '49999',
        i: '49998',
        P: '',
        r: '',
        T: 200,
      };

      capturedOnMessage!({
        stream: '!markPrice@arr@1s',
        data: [rawMarkPrice],
      });

      expect(received).toHaveLength(1);
      expect(received[0]).toEqual([
        { symbol: 'BTCUSDT', markPrice: 50000.5, indexPrice: 49998, timestamp: 100 },
      ]);
    });

    it('includes !markPrice@arr@1s stream name when mark price handler is registered', () => {
      const stream = createStreamForTest({ url, mockLogger });
      stream.subscribeMarkPrices(jest.fn(), []);

      // @ts-expect-error — read private method for test
      const streamNameList = stream.buildNonKlineStreamList();
      expect(streamNameList).toContain('!markPrice@arr@1s');
    });
  });
});
