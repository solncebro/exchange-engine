import { WebSocketStatus } from '@solncebro/websocket-engine';

import type { MarkPriceUpdate } from '../../src/types/common';
import type {
  BinanceMarkPriceWebSocketRaw,
  BinanceTicker24hrRaw,
  BinanceWebSocketKlineRaw,
} from '../../src/normalizers/binanceNormalizer';
import { BinanceFuturesPublicStream } from '../../src/ws/BinanceFuturesPublicStream';
import { createMockLogger } from '../fixtures/mockLogger';
import {
  BINANCE_WS_POLICY_VIOLATION_CLOSE_CODE,
  BINANCE_WS_QUEUE_RATE_PER_SECOND,
  BINANCE_WS_RESUBSCRIBE_COALESCE_WINDOW_MS,
} from '../../src/ws/streamCommandRateLimit';

let capturedOnMessage: ((message: any) => void) | undefined;
let capturedOnClose: ((closeContext: any) => void) | undefined;

const mockWebSocket = {
  close: jest.fn(),
  sendToConnectedSocket: jest.fn(),
  getStatus: jest.fn(() => WebSocketStatus.CONNECTED),
};

const mockSend = jest.fn();

jest.mock('@solncebro/websocket-engine', () => {
  const actual = jest.requireActual('@solncebro/websocket-engine');
  return {
    ...actual,
    ReliableWebSocket: jest.fn().mockImplementation((args: any) => {
      capturedOnMessage = args.onMessage;
      capturedOnClose = args.onClose;

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
    mockWebSocket.getStatus.mockReturnValue(WebSocketStatus.CONNECTED);
    capturedOnMessage = undefined;
    capturedOnClose = undefined;
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
      jest.useFakeTimers({ doNotFake: ['queueMicrotask'] });

      try {
        const stream = createStreamForTest({ url, mockLogger });
        stream.subscribeKlines('BTCUSDT', '5m', jest.fn());
        await flushAsync();
        await jest.advanceTimersByTimeAsync(1000);

        stream.subscribeKlines('ETHUSDT', '5m', jest.fn());
        await jest.advanceTimersByTimeAsync(1000);

        expect(mockWebSocket.sendToConnectedSocket).toHaveBeenCalledWith(
          expect.objectContaining({
            method: 'SUBSCRIBE',
            params: ['ethusdt_perpetual@continuousKline_5m'],
          }),
        );
      } finally {
        jest.useRealTimers();
      }
    });

    it('does not flood per-stream SUBSCRIBE frames when a new interval connection is filled before it opens', async () => {
      jest.useFakeTimers({ doNotFake: ['queueMicrotask'] });

      try {
        const stream = createStreamForTest({ url, mockLogger });

        // Interval 1: establish and fully open a connection so connectionList is non-empty.
        stream.subscribeKlines('AAAUSDT', '1m', jest.fn());
        await flushAsync();
        await jest.advanceTimersByTimeAsync(1000);

        mockWebSocket.sendToConnectedSocket.mockClear();
        mockSend.mockClear();

        // Interval 2: many symbols subscribed synchronously onto a brand-new (not-yet-open) connection.
        // <= batch size so onOpen sends a single paced batch.
        const intervalTwoCount = 40;
        for (let i = 0; i < intervalTwoCount; i++) {
          stream.subscribeKlines(`SYM${i}USDT`, '5m', jest.fn());
        }
        await flushAsync();
        await jest.advanceTimersByTimeAsync(1000);

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
      } finally {
        jest.useRealTimers();
      }
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
      jest.useFakeTimers({ doNotFake: ['queueMicrotask'] });

      try {
        const stream = createStreamForTest({ url, mockLogger });
        const handler = jest.fn();

        stream.subscribeAllTickers(jest.fn(), []);
        await flushAsync();

        stream.subscribeKlines('BTCUSDT', '1m', handler);
        stream.unsubscribeKlines('BTCUSDT', '1m', handler);

        await jest.advanceTimersByTimeAsync(1000);

        expect(mockWebSocket.sendToConnectedSocket).toHaveBeenCalledWith(
          expect.objectContaining({
            method: 'UNSUBSCRIBE',
            params: ['btcusdt_perpetual@continuousKline_1m'],
          }),
        );
      } finally {
        jest.useRealTimers();
      }
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

    it('routes a coalesced resubscribe to the shard owning each stream, leaving sibling shards untouched', async () => {
      jest.useFakeTimers({ doNotFake: ['queueMicrotask'] });

      try {
        const stream = buildShardedStream(3);

        for (let i = 0; i < 6; i++) {
          stream.subscribeKlines(`SYM${i}USDT`, '1m', jest.fn());
        }
        await flushAsync();
        await jest.advanceTimersByTimeAsync(3000);

        // @ts-expect-error — private access for test
        const connections = stream.connectionList as Array<{ streamList: string[] }>;
        const firstShardStream = connections[0].streamList[0];
        const secondShardStream = connections[1].streamList[0];

        stream.resubscribeStreamList([
          { symbol: 'SYM0USDT', interval: '1m' },
          { symbol: 'SYM3USDT', interval: '1m' },
        ]);
        await jest.advanceTimersByTimeAsync(3000);

        const infoText = mockLogger.info.mock.calls.map(([message]) => String(message)).join('\n');

        expect(firstShardStream).toContain('sym0usdt');
        expect(secondShardStream).toContain('sym3usdt');
        expect(infoText).toContain('light resubscribe of 1 stream(s) on test interval-1m in 2 command(s)');
        expect(infoText).toContain('light resubscribe of 1 stream(s) on test interval-1m #2 in 2 command(s)');
        expect(mockLogger.warn).not.toHaveBeenCalledWith(
          expect.stringContaining('not found in any connection'),
        );
      } finally {
        jest.useRealTimers();
      }
    });

    it('gives every shard of a group a distinct label so logs and diagnostics can tell them apart', async () => {
      const stream = buildShardedStream(3);

      for (let i = 0; i < 7; i++) {
        stream.subscribeKlines(`SYM${i}USDT`, '1m', jest.fn());
      }
      await flushAsync();

      // @ts-expect-error — private access for test
      const connections = stream.connectionList as Array<{ label: string }>;
      const labelList = connections.map((connection) => connection.label);

      expect(labelList).toEqual([
        'test interval-1m',
        'test interval-1m #2',
        'test interval-1m #3',
      ]);
      expect(new Set(labelList).size).toBe(labelList.length);
    });

    it('keeps the legacy label untouched for a single-connection group', async () => {
      const stream = buildShardedStream(10);

      for (let i = 0; i < 7; i++) {
        stream.subscribeKlines(`SYM${i}USDT`, '1m', jest.fn());
      }
      await flushAsync();

      // @ts-expect-error — private access for test
      const connections = stream.connectionList as Array<{ label: string }>;

      expect(connections.map((connection) => connection.label)).toEqual(['test interval-1m']);
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

  // Потока стакана у фьючерсов Binance не было вовсе — подписка честно отказывала, а
  // переподписка и пометка «живого» символа молча ничего не делали. Биржа поток даёт;
  // это была наша незаконченная работа.
  describe('subscribeOrderbook', () => {
    const buildDepthFrame = (updateId: number) => ({
      e: 'depthUpdate',
      E: 1700000000000,
      s: 'BTCUSDT',
      U: updateId - 1,
      u: updateId,
      b: [['49999.5', '2']],
      a: [['50000.5', '1.5']],
    });

    it('subscribes to the exchange depth stream for the requested symbol and depth', async () => {
      const stream = createStreamForTest({ url, mockLogger });
      stream.subscribeOrderbook('BTCUSDT', 20, jest.fn());

      await flushAsync();

      // @ts-expect-error — read private method for test
      const streamNameList = stream.buildOrderbookStreamList();
      expect(streamNameList).toContain('btcusdt@depth20@100ms');
    });

    it('delivers the book to the handler in the shape both exchanges share', async () => {
      const stream = createStreamForTest({ url, mockLogger });
      const received: unknown[] = [];
      stream.subscribeOrderbook('BTCUSDT', 20, (symbol, update) => received.push([symbol, update]));

      await flushAsync();
      capturedOnMessage?.({ stream: 'btcusdt@depth20@100ms', data: buildDepthFrame(160) });

      expect(received).toHaveLength(1);
      const [symbol, update] = received[0] as [string, Record<string, unknown>];
      expect(symbol).toBe('BTCUSDT');
      expect(update.bidList).toEqual([['49999.5', '2']]);
      expect(update.askList).toEqual([['50000.5', '1.5']]);
      expect(update.updateId).toBe(160);
      // Поток «частичной глубины» присылает готовый срез верхних уровней, а не поправку.
      expect(update.updateType).toBe('snapshot');
    });

    it('stops delivering after the last handler is gone', async () => {
      const stream = createStreamForTest({ url, mockLogger });
      const handler = jest.fn();
      stream.subscribeOrderbook('BTCUSDT', 20, handler);

      await flushAsync();
      stream.unsubscribeOrderbook('BTCUSDT', 20, handler);
      capturedOnMessage?.({ stream: 'btcusdt@depth20@100ms', data: buildDepthFrame(161) });

      expect(handler).not.toHaveBeenCalled();
    });

    it('refuses a depth the exchange does not serve instead of quietly giving another one', () => {
      const stream = createStreamForTest({ url, mockLogger });

      expect(() => stream.subscribeOrderbook('BTCUSDT', 200, jest.fn())).toThrow(/depth/i);
    });
  });

  describe('outgoing command throttle', () => {
    it('never sends more than the queue budget in any 1000ms window while draining ~300 subscribed streams', async () => {
      jest.useFakeTimers({ doNotFake: ['queueMicrotask'] });

      try {
        const stream = createStreamForTest({ url, mockLogger });

        // Open the connection first so every further subscribe takes the dynamic single-command
        // path (one command per stream) rather than being folded into the initial onOpen batch.
        stream.subscribeKlines('SYM0USDT', '1m', jest.fn());
        await flushAsync();
        await jest.advanceTimersByTimeAsync(1000);

        mockWebSocket.sendToConnectedSocket.mockClear();
        const sendTimestampList: number[] = [];
        mockWebSocket.sendToConnectedSocket.mockImplementation(() => {
          sendTimestampList.push(Date.now());
        });

        const additionalStreamCount = 299;
        for (let i = 1; i <= additionalStreamCount; i++) {
          stream.subscribeKlines(`SYM${i}USDT`, '1m', jest.fn());
        }

        await jest.advanceTimersByTimeAsync(additionalStreamCount * 200);

        expect(sendTimestampList).toHaveLength(additionalStreamCount);

        for (const windowStart of sendTimestampList) {
          const windowEnd = windowStart + 1000;
          const countInWindow = sendTimestampList.filter(
            (timestamp) => timestamp >= windowStart && timestamp < windowEnd,
          ).length;

          expect(countInWindow).toBeLessThanOrEqual(BINANCE_WS_QUEUE_RATE_PER_SECOND);
        }
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('cascade resubscribe', () => {
    it('recreates the connection instead of per-stream repair once a coalesced resubscribe batch reaches the cascade threshold', async () => {
      jest.useFakeTimers({ doNotFake: ['queueMicrotask'] });

      try {
        const stream = createStreamForTest({ url, mockLogger });
        const symbolList = Array.from({ length: 60 }, (_unused, index) => `SYM${index}USDT`);

        for (const symbol of symbolList) {
          stream.subscribeKlines(symbol, '1m', jest.fn());
        }

        await flushAsync();
        await jest.advanceTimersByTimeAsync(1000);

        mockWebSocket.close.mockClear();
        mockWebSocket.sendToConnectedSocket.mockClear();

        for (const symbol of symbolList) {
          stream.resubscribeStream(symbol, '1m');
        }

        await jest.advanceTimersByTimeAsync(BINANCE_WS_RESUBSCRIBE_COALESCE_WINDOW_MS + 100);

        expect(mockWebSocket.close).toHaveBeenCalledTimes(1);

        const unsubscribeCallList = mockWebSocket.sendToConnectedSocket.mock.calls.filter(
          ([command]) => command?.method === 'UNSUBSCRIBE',
        );
        expect(unsubscribeCallList).toHaveLength(0);
      } finally {
        jest.useRealTimers();
      }
    });

    it('coalesces multiple resubscribeStream calls made in the same tick into a single UNSUBSCRIBE + SUBSCRIBE pair carrying every stream', async () => {
      jest.useFakeTimers({ doNotFake: ['queueMicrotask'] });

      try {
        const stream = createStreamForTest({ url, mockLogger });
        const symbolList = ['AAAUSDT', 'BBBUSDT', 'CCCUSDT', 'DDDUSDT', 'EEEUSDT'];

        for (const symbol of symbolList) {
          stream.subscribeKlines(symbol, '1m', jest.fn());
        }

        await flushAsync();
        await jest.advanceTimersByTimeAsync(1000);

        mockWebSocket.close.mockClear();
        mockWebSocket.sendToConnectedSocket.mockClear();

        for (const symbol of symbolList) {
          stream.resubscribeStream(symbol, '1m');
        }

        await jest.advanceTimersByTimeAsync(BINANCE_WS_RESUBSCRIBE_COALESCE_WINDOW_MS + 500);

        expect(mockWebSocket.close).not.toHaveBeenCalled();

        const expectedStreamList = symbolList.map(
          (symbol) => `${symbol.toLowerCase()}_perpetual@continuousKline_1m`,
        );
        const unsubscribeCallList = mockWebSocket.sendToConnectedSocket.mock.calls.filter(
          ([command]) => command?.method === 'UNSUBSCRIBE',
        );
        const subscribeCallList = mockWebSocket.sendToConnectedSocket.mock.calls.filter(
          ([command]) => command?.method === 'SUBSCRIBE',
        );

        expect(unsubscribeCallList).toHaveLength(1);
        expect(unsubscribeCallList[0][0].params).toEqual(expectedStreamList);

        expect(subscribeCallList).toHaveLength(1);
        expect(subscribeCallList[0][0].params).toEqual(expectedStreamList);
      } finally {
        jest.useRealTimers();
      }
    });

    it('still takes the recreate path when the socket is disconnected (existing behaviour preserved)', async () => {
      jest.useFakeTimers({ doNotFake: ['queueMicrotask'] });

      try {
        const stream = createStreamForTest({ url, mockLogger });
        stream.subscribeKlines('BTCUSDT', '1m', jest.fn());

        await flushAsync();
        await jest.advanceTimersByTimeAsync(1000);

        mockWebSocket.getStatus.mockReturnValue(WebSocketStatus.DISCONNECTED);
        mockWebSocket.close.mockClear();
        mockWebSocket.sendToConnectedSocket.mockClear();

        stream.resubscribeStream('BTCUSDT', '1m');

        await jest.advanceTimersByTimeAsync(BINANCE_WS_RESUBSCRIBE_COALESCE_WINDOW_MS + 100);

        expect(mockWebSocket.close).toHaveBeenCalledTimes(1);

        const unsubscribeCallList = mockWebSocket.sendToConnectedSocket.mock.calls.filter(
          ([command]) => command?.method === 'UNSUBSCRIBE',
        );
        expect(unsubscribeCallList).toHaveLength(0);
      } finally {
        jest.useRealTimers();
      }
    });

    it('awaitConnectionsReady() flushes pending coalesced resubscribes before resolving', async () => {
      jest.useFakeTimers({ doNotFake: ['queueMicrotask'] });

      try {
        const stream = createStreamForTest({ url, mockLogger });
        stream.subscribeKlines('BTCUSDT', '1m', jest.fn());

        await flushAsync();
        await jest.advanceTimersByTimeAsync(1000);

        mockWebSocket.sendToConnectedSocket.mockClear();

        stream.resubscribeStream('BTCUSDT', '1m');

        const readyPromise = stream.awaitConnectionsReady();

        await jest.advanceTimersByTimeAsync(BINANCE_WS_RESUBSCRIBE_COALESCE_WINDOW_MS + 1000);
        await readyPromise;

        const unsubscribeCallList = mockWebSocket.sendToConnectedSocket.mock.calls.filter(
          ([command]) => command?.method === 'UNSUBSCRIBE',
        );
        const subscribeCallList = mockWebSocket.sendToConnectedSocket.mock.calls.filter(
          ([command]) => command?.method === 'SUBSCRIBE',
        );

        expect(unsubscribeCallList).toHaveLength(1);
        expect(subscribeCallList).toHaveLength(1);
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('policy violation close', () => {
    it('pauses per-stream repairs and forces a recreate on the next resubscribe after the exchange closes the socket with code 1008', async () => {
      jest.useFakeTimers({ doNotFake: ['queueMicrotask'] });

      try {
        const stream = createStreamForTest({ url, mockLogger });
        stream.subscribeKlines('BTCUSDT', '1m', jest.fn());

        await flushAsync();
        await jest.advanceTimersByTimeAsync(1000);

        expect(capturedOnClose).toBeDefined();

        capturedOnClose!({ closeCode: BINANCE_WS_POLICY_VIOLATION_CLOSE_CODE });

        expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('policy violation'));

        mockWebSocket.close.mockClear();
        mockWebSocket.sendToConnectedSocket.mockClear();

        stream.resubscribeStream('BTCUSDT', '1m');

        await jest.advanceTimersByTimeAsync(BINANCE_WS_RESUBSCRIBE_COALESCE_WINDOW_MS + 100);

        expect(mockWebSocket.close).toHaveBeenCalledTimes(1);

        const unsubscribeCallList = mockWebSocket.sendToConnectedSocket.mock.calls.filter(
          ([command]) => command?.method === 'UNSUBSCRIBE',
        );
        expect(unsubscribeCallList).toHaveLength(0);
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('connection info', () => {
    it('exposes maxCommandsPerSecond and a pendingCommandCount that is non-zero while the queue still has work', async () => {
      jest.useFakeTimers({ doNotFake: ['queueMicrotask'] });

      try {
        const stream = createStreamForTest({ url, mockLogger });
        const symbolList = Array.from({ length: 300 }, (_unused, index) => `SYM${index}USDT`);

        for (const symbol of symbolList) {
          stream.subscribeKlines(symbol, '1m', jest.fn());
        }

        await flushAsync();

        const infoListWhileDraining = stream.getConnectionInfoList();
        expect(infoListWhileDraining).toHaveLength(1);
        expect(infoListWhileDraining[0].maxCommandsPerSecond).toBe(BINANCE_WS_QUEUE_RATE_PER_SECOND);
        expect(infoListWhileDraining[0].pendingCommandCount).toBeGreaterThan(0);

        await jest.advanceTimersByTimeAsync(10000);

        const infoListAfterDrain = stream.getConnectionInfoList();
        expect(infoListAfterDrain[0].pendingCommandCount).toBe(0);
      } finally {
        jest.useRealTimers();
      }
    });
  });
});
