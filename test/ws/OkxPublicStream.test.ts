import type { RawData, ReliableWebSocketArgs, WebSocketCloseContext, WebSocketOpenContext } from '@solncebro/websocket-engine';

import type { KlineHandler } from '../../src/types/exchange';
import type { OkxIndexTickerRaw, OkxMarkPriceRaw, OkxPublicTradeRaw, OkxTickerRaw } from '../../src/normalizers/okxNormalizer';
import { OkxPublicStream } from '../../src/ws/OkxPublicStream';
import type { OkxPublicStreamArgs } from '../../src/ws/OkxPublicStream.types';
import type { OkxWebSocketMessage } from '../../src/ws/okxWebSocketUtils.types';
import { OkxSymbolMap } from '../../src/exchanges/okxSymbol';
import { OkxSilenceWatchdog } from '../../src/ws/OkxSilenceWatchdog';
import {
  OKX_CONNECTION_CREATE_ATTEMPT_LIMIT,
  OKX_CONNECTION_OPERATION_LIMIT_PER_HOUR,
  OKX_MAX_ORDERBOOK_TOPICS_PER_CONNECTION,
  OKX_ORDERBOOK_RESYNC_MIN_INTERVAL_MS,
  OKX_PAUSE_BETWEEN_CONNECTIONS_MS,
  OKX_PING_INTERVAL,
  OKX_SERVICE_UPGRADE_NOTICE_CODE,
  OKX_SILENT_THRESHOLD_MS,
  OKX_STALE_CHECK_INTERVAL_MS,
  OKX_STALE_THRESHOLD_MS,
} from '../../src/constants/okx';
import { createMockLogger } from '../fixtures/mockLogger';

const PUBLIC_URL = 'wss://ws.okx.com:8443/ws/v5/public';
const BUSINESS_URL = 'wss://ws.okx.com:8443/ws/v5/business';

interface CapturedConnection {
  url: string;
  label: string;
  onMessage: (message: OkxWebSocketMessage) => void;
  parseMessage: (rawData: RawData) => OkxWebSocketMessage;
  onOpen: ((context: WebSocketOpenContext<OkxWebSocketMessage>) => Promise<void>) | undefined;
  onReconnectSuccess: (() => void) | undefined;
  onClose: ((context: WebSocketCloseContext) => void) | undefined;
  contextSend: jest.Mock;
  webSocket: { close: jest.Mock; sendToConnectedSocket: jest.Mock; getStatus: jest.Mock };
}

let capturedConnectionList: CapturedConnection[] = [];

jest.mock('@solncebro/websocket-engine', () => {
  const actual = jest.requireActual('@solncebro/websocket-engine');

  return {
    ...actual,
    ReliableWebSocket: jest.fn().mockImplementation((args: ReliableWebSocketArgs<OkxWebSocketMessage>) => {
      const webSocket = {
        close: jest.fn(),
        sendToConnectedSocket: jest.fn(),
        getStatus: jest.fn().mockReturnValue(actual.WebSocketStatus.CONNECTED),
      };
      const contextSend = jest.fn();

      capturedConnectionList.push({
        url: args.url,
        label: args.label,
        onMessage: args.onMessage,
        parseMessage: args.parseMessage as (rawData: RawData) => OkxWebSocketMessage,
        onOpen: args.onOpen,
        onReconnectSuccess: args.onReconnectSuccess,
        onClose: args.onClose,
        contextSend,
        webSocket,
      });

      if (args.onOpen) {
        const mockContext = { send: contextSend, waitForMessage: jest.fn() };
        queueMicrotask(() => args.onOpen?.(mockContext));
      }

      return webSocket;
    }),
  };
});

async function flushMicrotasks(rounds = 10): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await Promise.resolve();
  }
}

function collectSentFrameList(): unknown[] {
  return capturedConnectionList.flatMap((connection) => [
    ...connection.contextSend.mock.calls.map((call) => call[0]),
    ...connection.webSocket.sendToConnectedSocket.mock.calls.map((call) => call[0]),
  ]);
}

function createStream(overrides: Partial<OkxPublicStreamArgs> = {}): OkxPublicStream {
  return new OkxPublicStream({
    publicUrl: PUBLIC_URL,
    businessUrl: BUSINESS_URL,
    label: 'OKX Linear',
    logger: createMockLogger(),
    onNotify: undefined,
    isSwap: false,
    symbolMap: new OkxSymbolMap({ isSwap: overrides.isSwap ?? false }),
    contractValueBySymbol: new Map(),
    pauseBetweenConnectionsMs: 0,
    ...overrides,
  });
}

const MOCK_TICKER_RAW: OkxTickerRaw = {
  instType: 'SPOT',
  instId: 'BTC-USDT',
  last: '50000',
  lastSz: '0.1',
  askPx: '50001',
  askSz: '2',
  bidPx: '49999',
  bidSz: '1.5',
  open24h: '49000',
  high24h: '51000',
  low24h: '48000',
  volCcy24h: '1000',
  vol24h: '1000',
  ts: '1700000000000',
};

function buildIndexTickerRaw(idxPx: string): OkxIndexTickerRaw {
  return {
    instId: 'BTC-USDT',
    idxPx,
    high24h: '50100',
    low24h: '49000',
    open24h: '49500',
    sodUtc0: '49500',
    sodUtc8: '49500',
    ts: '1700000000000',
  };
}

function sendMarkPrice(connection: CapturedConnection, markPx: string): void {
  connection.onMessage({
    arg: { channel: 'mark-price', instId: 'BTC-USDT-SWAP' },
    data: [{ instType: 'SWAP', instId: 'BTC-USDT-SWAP', markPx, ts: '1700000000000' }],
  });
}

const MOCK_KLINE_ROW = ['1700000000000', '50000', '51000', '49000', '50500', '10', '500000', '5000000', '1'];

function sendOrderbookSnapshot(connection: CapturedConnection, seqId: number): void {
  connection.onMessage({
    arg: { channel: 'books', instId: 'BTC-USDT' },
    action: 'snapshot',
    data: [{ asks: [], bids: [], ts: '1700000000000', seqId, prevSeqId: -1 }],
  });
}

function sendOrderbookDelta(connection: CapturedConnection, prevSeqId: number, seqId: number): void {
  connection.onMessage({
    arg: { channel: 'books', instId: 'BTC-USDT' },
    action: 'update',
    data: [{ asks: [], bids: [], ts: '1700000000100', seqId, prevSeqId }],
  });
}

/**
 * Пересоздание соединения — та же дверь, которой пользуются лечение немоты и разрыв стакана. Раньше
 * эти проверки заводили его сроком молчания сокета, но срок молчания теперь считает движок, а он в
 * этих проверках подменён.
 */
async function forceRecreate(stream: OkxPublicStream, connectionId: number): Promise<void> {
  // @ts-expect-error — приватный вход, чтобы завести пересоздание тем же путём, что и сам поток
  stream.recreateConnection(connectionId, 'test');
  await jest.advanceTimersByTimeAsync(0);
}

function countSentFrameOp(connection: CapturedConnection, op: string): number {
  const callList = connection.webSocket.sendToConnectedSocket.mock.calls as unknown as [{ op: string }][];

  return callList.filter(([payload]) => payload.op === op).length;
}

describe('OkxPublicStream', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    capturedConnectionList = [];
  });

  describe('connection pools', () => {
    it('routes candle subscriptions to the business pool and tickers to the public pool', async () => {
      const stream = createStream();
      stream.subscribeAllTickers(jest.fn(), ['BTCUSDT']);
      stream.subscribeKlines('ETHUSDT', '1m', jest.fn());

      await flushMicrotasks();

      expect(capturedConnectionList).toHaveLength(2);
      const publicConnection = capturedConnectionList.find((connection) => connection.url === PUBLIC_URL);
      const businessConnection = capturedConnectionList.find((connection) => connection.url === BUSINESS_URL);

      expect(publicConnection).toBeDefined();
      expect(businessConnection).toBeDefined();
      expect(publicConnection!.label).toContain('public');
      expect(businessConnection!.label).toContain('business');
    });
  });

  describe('subscription batching', () => {
    it('subscribes in onOpen via {op: "subscribe", args: [...]}', async () => {
      const stream = createStream();
      stream.subscribeAllTickers(jest.fn(), ['BTCUSDT']);

      await flushMicrotasks();

      expect(capturedConnectionList).toHaveLength(1);
      expect(capturedConnectionList[0].contextSend).toHaveBeenCalledWith({
        op: 'subscribe',
        args: [{ channel: 'tickers', instId: 'BTC-USDT' }],
      });
    });

    it('splits subscribe batches at 50 topics per message', async () => {
      const stream = createStream();

      for (let i = 0; i < 60; i++) {
        stream.subscribeAllTickers(jest.fn(), [`SYM${i}USDT`]);
      }

      await flushMicrotasks();

      expect(capturedConnectionList).toHaveLength(1);
      const sendCallList = capturedConnectionList[0].contextSend.mock.calls;
      expect(sendCallList).toHaveLength(2);
      expect(sendCallList[0][0].args).toHaveLength(50);
      expect(sendCallList[1][0].args).toHaveLength(10);
    });
  });

  describe('heartbeat pong text', () => {
    it('parses the literal "pong" text without throwing and does not reach handlers', async () => {
      const stream = createStream();
      const handler = jest.fn();
      stream.subscribeAllTickers(handler, ['BTCUSDT']);

      await flushMicrotasks();

      const message = capturedConnectionList[0].parseMessage(Buffer.from('pong'));
      expect(message).toEqual({ event: 'pong' });

      expect(() => capturedConnectionList[0].onMessage(message)).not.toThrow();
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('tickers', () => {
    it('normalizes a tickers frame into a TickerBySymbol keyed by BTCUSDT', async () => {
      const stream = createStream();
      const handler = jest.fn();
      stream.subscribeAllTickers(handler, ['BTCUSDT']);

      await flushMicrotasks();

      capturedConnectionList[0].onMessage({
        arg: { channel: 'tickers', instId: 'BTC-USDT' },
        data: [MOCK_TICKER_RAW],
      });

      expect(handler).toHaveBeenCalledTimes(1);
      const tickerMap = handler.mock.calls[0][0];
      expect(tickerMap).toBeInstanceOf(Map);
      expect(tickerMap.get('BTCUSDT')).toBeDefined();
      expect(tickerMap.get('BTCUSDT').lastPrice).toBe(50000);
    });
  });

  describe('mark price', () => {
    it('dispatches MarkPriceUpdate[] from the mark-price channel', async () => {
      const stream = createStream({ isSwap: true });
      const handler = jest.fn();
      stream.subscribeMarkPrices(handler, ['BTCUSDT']);

      await flushMicrotasks();

      const rawList: OkxMarkPriceRaw[] = [{ instType: 'SWAP', instId: 'BTC-USDT', markPx: '49950', ts: '1700000000000' }];
      capturedConnectionList[0].onMessage({
        arg: { channel: 'mark-price', instId: 'BTC-USDT' },
        data: rawList,
      });

      expect(handler).toHaveBeenCalledWith([{ symbol: 'BTCUSDT', markPrice: 49950, timestamp: 1700000000000 }]);
    });

    it('warns and skips subscribing on a spot instance — OKX has no spot mark-price channel', async () => {
      const logger = createMockLogger();
      const stream = createStream({ isSwap: false, logger });
      const handler = jest.fn();

      stream.subscribeMarkPrices(handler, ['BTCUSDT']);

      await flushMicrotasks();

      expect(capturedConnectionList).toHaveLength(0);
      expect(logger.warn).toHaveBeenCalledWith('OkxPublicStream: OKX spot has no mark-price channel');
    });

    /** E1. Индекс живёт своим каналом, и обозначение в нём — сам индекс, без хвоста `-SWAP`. */
    describe('index price', () => {
      it('subscribes the index channel next to the mark-price one', async () => {
        const stream = createStream({ isSwap: true });
        stream.subscribeMarkPrices(jest.fn(), ['BTCUSDT']);

        await flushMicrotasks();

        expect(capturedConnectionList).toHaveLength(1);
        expect(capturedConnectionList[0].contextSend).toHaveBeenCalledWith({
          op: 'subscribe',
          args: [
            { channel: 'mark-price', instId: 'BTC-USDT-SWAP' },
            { channel: 'index-tickers', instId: 'BTC-USDT' },
          ],
        });
        expect(stream.getConnectionInfoList()[0].subscriptionList).toEqual(['MarkPrices BTCUSDT', 'IndexPrices BTCUSDT']);
      });

      it('raises no event on an index frame of its own', async () => {
        const stream = createStream({ isSwap: true });
        const handler = jest.fn();
        stream.subscribeMarkPrices(handler, ['BTCUSDT']);

        await flushMicrotasks();

        capturedConnectionList[0].onMessage({
          arg: { channel: 'index-tickers', instId: 'BTC-USDT' },
          data: [buildIndexTickerRaw('49900')],
        });

        expect(handler).not.toHaveBeenCalled();
      });

      it('carries the last known index price on the next mark-price frame', async () => {
        const stream = createStream({ isSwap: true });
        const handler = jest.fn();
        stream.subscribeMarkPrices(handler, ['BTCUSDT']);

        await flushMicrotasks();

        const connection = capturedConnectionList[0];
        sendMarkPrice(connection, '49950');

        expect(handler).toHaveBeenLastCalledWith([{ symbol: 'BTCUSDT', markPrice: 49950, timestamp: 1700000000000 }]);

        connection.onMessage({
          arg: { channel: 'index-tickers', instId: 'BTC-USDT' },
          data: [buildIndexTickerRaw('49900')],
        });
        sendMarkPrice(connection, '49960');

        expect(handler).toHaveBeenLastCalledWith([
          { symbol: 'BTCUSDT', markPrice: 49960, indexPrice: 49900, timestamp: 1700000000000 },
        ]);
      });

      it('leaves the index price empty rather than zero while the exchange has not sent one', async () => {
        const stream = createStream({ isSwap: true });
        const handler = jest.fn();
        stream.subscribeMarkPrices(handler, ['BTCUSDT']);

        await flushMicrotasks();

        const connection = capturedConnectionList[0];
        connection.onMessage({
          arg: { channel: 'index-tickers', instId: 'BTC-USDT' },
          data: [buildIndexTickerRaw('')],
        });
        sendMarkPrice(connection, '49950');

        const [markPriceList] = handler.mock.calls[handler.mock.calls.length - 1] as [Array<Record<string, unknown>>];
        expect(markPriceList[0]).not.toHaveProperty('indexPrice');
      });

      it('drops both channels when the last mark-price handler goes away', async () => {
        const stream = createStream({ isSwap: true });
        const handler = jest.fn();
        stream.subscribeMarkPrices(handler, ['BTCUSDT']);

        await flushMicrotasks();

        const connection = capturedConnectionList[0];
        stream.unsubscribeMarkPrices(handler);

        await flushMicrotasks();

        expect(stream.getConnectionInfoList()).toEqual([]);
        expect(connection.webSocket.close).toHaveBeenCalled();
      });

      it('resubscribes both channels on a forced mark-price resubscribe', async () => {
        const stream = createStream({ isSwap: true });
        stream.subscribeMarkPrices(jest.fn(), ['BTCUSDT']);

        await flushMicrotasks();

        const connection = capturedConnectionList[0];
        connection.webSocket.sendToConnectedSocket.mockClear();

        stream.resubscribeMarkPrices();

        const sentFrameList = connection.webSocket.sendToConnectedSocket.mock.calls.map((call) => call[0]);
        const expectedArgList = [
          { channel: 'mark-price', instId: 'BTC-USDT-SWAP' },
          { channel: 'index-tickers', instId: 'BTC-USDT' },
        ];

        expect(sentFrameList).toContainEqual({ op: 'unsubscribe', args: expectedArgList });
        expect(sentFrameList).toContainEqual({ op: 'subscribe', args: expectedArgList });
      });
    });
  });

  describe('klines', () => {
    it('normalizes a candle1m frame into a Kline with isClosed', async () => {
      const stream = createStream();
      const handler = jest.fn();
      stream.subscribeKlines('BTCUSDT', '1m', handler);

      await flushMicrotasks();

      capturedConnectionList[0].onMessage({
        arg: { channel: 'candle1m', instId: 'BTC-USDT' },
        data: [MOCK_KLINE_ROW],
      });

      expect(handler).toHaveBeenCalledTimes(1);
      const [symbol, kline] = handler.mock.calls[0];
      expect(symbol).toBe('BTCUSDT');
      expect(kline.openPrice).toBe(50000);
      expect(kline.isClosed).toBe(true);
    });

    it('subscribes candle1s directly, with no trade-to-kline aggregator involved', async () => {
      const stream = createStream();
      const handler = jest.fn();
      stream.subscribeKlines('BTCUSDT', '1s', handler);

      await flushMicrotasks();

      expect(capturedConnectionList[0].contextSend).toHaveBeenCalledWith({
        op: 'subscribe',
        args: [{ channel: 'candle1s', instId: 'BTC-USDT' }],
      });

      capturedConnectionList[0].onMessage({
        arg: { channel: 'candle1s', instId: 'BTC-USDT' },
        data: [MOCK_KLINE_ROW],
      });

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('throws for an interval OKX does not support', () => {
      const stream = createStream();
      const untypedSubscribeKlines = stream.subscribeKlines.bind(stream) as (
        symbol: string,
        interval: string,
        handler: KlineHandler,
      ) => void;

      expect(() => untypedSubscribeKlines('BTCUSDT', '2s', jest.fn())).toThrow(
        "Kline interval '2s' is not supported by OKX",
      );
    });
  });

  describe('public trades', () => {
    it('converts swap trade contracts into coins using ctVal', async () => {
      const stream = createStream({
        isSwap: true,
        contractValueBySymbol: new Map([['BTCUSDT', '0.01']]),
      });
      const handler = jest.fn();
      stream.subscribePublicTrades('BTCUSDT', handler);

      await flushMicrotasks();

      const rawList: OkxPublicTradeRaw[] = [
        { instId: 'BTC-USDT-SWAP', tradeId: '1', px: '50000', sz: '5', side: 'buy', ts: '1700000000000' },
      ];
      capturedConnectionList[0].onMessage({
        arg: { channel: 'trades', instId: 'BTC-USDT-SWAP' },
        data: rawList,
      });

      expect(handler).toHaveBeenCalledTimes(1);
      const [symbol, tradeList] = handler.mock.calls[0];
      expect(symbol).toBe('BTCUSDT');
      expect(tradeList[0].quantity).toBeCloseTo(0.05);
    });

    it('throws OKX_INSTRUMENTS_NOT_LOADED when subscribing to swap trades without a known contract value', () => {
      const stream = createStream({ isSwap: true, contractValueBySymbol: new Map() });

      let caughtError: unknown;

      try {
        stream.subscribePublicTrades('ETHUSDT', jest.fn());
      } catch (error) {
        caughtError = error;
      }

      expect(caughtError).toBeDefined();
      expect((caughtError as { code?: string }).code).toBe('OKX_INSTRUMENTS_NOT_LOADED');
    });
  });

  describe('orderbook', () => {
    it('maps action=snapshot to updateType snapshot', async () => {
      const stream = createStream();
      const handler = jest.fn();
      stream.subscribeOrderbook('BTCUSDT', 400, handler);

      await flushMicrotasks();

      capturedConnectionList[0].onMessage({
        arg: { channel: 'books', instId: 'BTC-USDT' },
        action: 'snapshot',
        data: [{ asks: [['101', '2', '0', '1']], bids: [['100', '1', '0', '1']], ts: '1700000000000', seqId: 100, prevSeqId: -1 }],
      });

      expect(handler).toHaveBeenCalledTimes(1);
      const [, update] = handler.mock.calls[0];
      expect(update.updateType).toBe('snapshot');
    });

    it('maps action=update to updateType delta', async () => {
      const stream = createStream();
      const handler = jest.fn();
      stream.subscribeOrderbook('BTCUSDT', 400, handler);

      await flushMicrotasks();

      capturedConnectionList[0].onMessage({
        arg: { channel: 'books', instId: 'BTC-USDT' },
        action: 'snapshot',
        data: [{ asks: [], bids: [], ts: '1700000000000', seqId: 100, prevSeqId: -1 }],
      });
      capturedConnectionList[0].onMessage({
        arg: { channel: 'books', instId: 'BTC-USDT' },
        action: 'update',
        data: [{ asks: [], bids: [], ts: '1700000000100', seqId: 101, prevSeqId: 100 }],
      });

      const [, update] = handler.mock.calls[1];
      expect(update.updateType).toBe('delta');
    });

    it('treats a books5 frame with no action field as a snapshot', async () => {
      const stream = createStream();
      const handler = jest.fn();
      stream.subscribeOrderbook('BTCUSDT', 5, handler);

      await flushMicrotasks();

      capturedConnectionList[0].onMessage({
        arg: { channel: 'books5', instId: 'BTC-USDT' },
        data: [{ asks: [['101', '2', '0', '1']], bids: [['100', '1', '0', '1']], ts: '1700000000000', seqId: 100 }],
      });

      const [, update] = handler.mock.calls[0];
      expect(update.updateType).toBe('snapshot');
    });

    it('withholds a delta that arrives after a gap and resyncs the topic at once', async () => {
      const stream = createStream();
      const handler = jest.fn();
      stream.subscribeOrderbook('BTCUSDT', 400, handler);

      await flushMicrotasks();

      sendOrderbookSnapshot(capturedConnectionList[0], 100);
      capturedConnectionList[0].contextSend.mockClear();
      capturedConnectionList[0].webSocket.sendToConnectedSocket.mockClear();

      sendOrderbookDelta(capturedConnectionList[0], 999, 105);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(capturedConnectionList[0].webSocket.sendToConnectedSocket).toHaveBeenCalledWith(
        expect.objectContaining({ op: 'unsubscribe' }),
      );
      expect(capturedConnectionList[0].webSocket.sendToConnectedSocket).toHaveBeenCalledWith(
        expect.objectContaining({ op: 'subscribe' }),
      );
    });

    it('keeps withholding deltas until a fresh snapshot arrives, then delivers again', async () => {
      const stream = createStream();
      const handler = jest.fn();
      stream.subscribeOrderbook('BTCUSDT', 400, handler);

      await flushMicrotasks();

      sendOrderbookSnapshot(capturedConnectionList[0], 100);
      sendOrderbookDelta(capturedConnectionList[0], 999, 105);
      sendOrderbookDelta(capturedConnectionList[0], 105, 106);

      expect(handler).toHaveBeenCalledTimes(1);

      sendOrderbookSnapshot(capturedConnectionList[0], 200);

      expect(handler).toHaveBeenCalledTimes(2);
      expect(handler.mock.calls[1][1].updateType).toBe('snapshot');

      sendOrderbookDelta(capturedConnectionList[0], 200, 201);

      expect(handler).toHaveBeenCalledTimes(3);
      expect(handler.mock.calls[2][1].updateType).toBe('delta');
    });

    it('reports swap depth in coins, not in contracts', async () => {
      const stream = createStream({
        isSwap: true,
        contractValueBySymbol: new Map([['BTCUSDT', '0.01']]),
      });
      const handler = jest.fn();
      stream.subscribeOrderbook('BTCUSDT', 400, handler);

      await flushMicrotasks();

      capturedConnectionList[0].onMessage({
        arg: { channel: 'books', instId: 'BTC-USDT-SWAP' },
        action: 'snapshot',
        data: [{ asks: [['62000', '10', '0', '4']], bids: [['61999', '20', '0', '4']], ts: '1700000000000', seqId: 100, prevSeqId: -1 }],
      });

      const [, update] = handler.mock.calls[0];

      expect(update.askList[0]).toEqual(['62000', '0.1']);
      expect(update.bidList[0]).toEqual(['61999', '0.2']);
    });

    it('refuses to subscribe a swap orderbook before the instruments are loaded', () => {
      const stream = createStream({ isSwap: true, contractValueBySymbol: new Map() });

      expect(() => stream.subscribeOrderbook('BTCUSDT', 400, jest.fn()))
        .toThrow('OKX contract value for BTCUSDT is unknown — call loadTradeSymbols() first');
    });
  });

  describe('unsubscribe', () => {
    it('removes the topic from the connection and sends unsubscribe', async () => {
      const stream = createStream();
      const handler = jest.fn();
      stream.subscribePublicTrades('ETHUSDT', jest.fn());
      stream.subscribeAllTickers(handler, ['BTCUSDT']);

      await flushMicrotasks();

      stream.unsubscribeAllTickers(handler);

      await flushMicrotasks();

      expect(capturedConnectionList[0].webSocket.sendToConnectedSocket).toHaveBeenCalledWith({
        op: 'unsubscribe',
        args: [{ channel: 'tickers', instId: 'BTC-USDT' }],
      });

      // @ts-expect-error — private access for test
      expect((stream.activeSubscriptionSet as Set<string>).has('tickers|BTC-USDT')).toBe(false);
    });
  });

  describe('resubscribeStream', () => {
    it('sends unsubscribe + subscribe on the same socket', async () => {
      const stream = createStream();
      stream.subscribeKlines('BTCUSDT', '1m', jest.fn());

      await flushMicrotasks();
      capturedConnectionList[0].webSocket.sendToConnectedSocket.mockClear();

      stream.resubscribeStream!('BTCUSDT', '1m');

      expect(capturedConnectionList[0].webSocket.sendToConnectedSocket).toHaveBeenNthCalledWith(1, {
        op: 'unsubscribe',
        args: [{ channel: 'candle1m', instId: 'BTC-USDT' }],
      });
      expect(capturedConnectionList[0].webSocket.sendToConnectedSocket).toHaveBeenNthCalledWith(2, {
        op: 'subscribe',
        args: [{ channel: 'candle1m', instId: 'BTC-USDT' }],
      });
    });
  });

  describe('getConnectionInfoList', () => {
    it('reports labels, urls and subscriptionList per pool', async () => {
      const stream = createStream();
      stream.subscribeAllTickers(jest.fn(), ['BTCUSDT']);
      stream.subscribeKlines('ETHUSDT', '1m', jest.fn());

      await flushMicrotasks();

      const infoList = stream.getConnectionInfoList();
      expect(infoList).toHaveLength(2);

      const publicInfo = infoList.find((info) => info.url === PUBLIC_URL)!;
      const businessInfo = infoList.find((info) => info.url === BUSINESS_URL)!;

      expect(publicInfo.subscriptionList).toContain('Tickers BTCUSDT');
      expect(businessInfo.subscriptionList).toContain('Klines ETHUSDT 1m');
    });
  });

  describe('close', () => {
    it('stops the silence watchdogs and closes every WebSocket', async () => {
      const stopSpy = jest.spyOn(OkxSilenceWatchdog.prototype, 'stop');
      const stream = createStream();
      stream.subscribeAllTickers(jest.fn(), ['BTCUSDT']);
      stream.subscribeKlines('ETHUSDT', '1m', jest.fn());

      await flushMicrotasks();

      stream.close();

      expect(capturedConnectionList).toHaveLength(2);
      expect(capturedConnectionList[0].webSocket.close).toHaveBeenCalled();
      expect(capturedConnectionList[1].webSocket.close).toHaveBeenCalled();
      expect(stopSpy).toHaveBeenCalled();

      stopSpy.mockRestore();
    });
  });

  describe('lazyOrderbookParse', () => {
    const ORDERBOOK_RAW = JSON.stringify({
      arg: { channel: 'books', instId: 'BTC-USDT' },
      action: 'update',
      data: [{ asks: [['101', '2', '0', '1']], bids: [], ts: '1700000000123', seqId: 5, prevSeqId: -1 }],
    });

    async function setupLazyStream() {
      const stream = createStream({ lazyOrderbookParse: true });
      const orderbookHandler = jest.fn();
      const rawHandler = jest.fn();
      stream.subscribeOrderbook('BTCUSDT', 400, orderbookHandler);
      stream.subscribeRawOrderbook!(rawHandler);

      await flushMicrotasks();

      return { stream, orderbookHandler, rawHandler };
    }

    it('shelves a non-live symbol frame raw without dispatching it to the orderbook handler', async () => {
      const { orderbookHandler, rawHandler } = await setupLazyStream();

      const message = capturedConnectionList[0].parseMessage(Buffer.from(ORDERBOOK_RAW));

      expect(message.__rawOrderbook).toBeDefined();
      expect(message.__rawOrderbook?.symbol).toBe('BTCUSDT');
      expect(message.data).toBeUndefined();

      capturedConnectionList[0].onMessage(message);

      expect(rawHandler).toHaveBeenCalledTimes(1);
      expect(orderbookHandler).not.toHaveBeenCalled();
    });

    it('fully parses and dispatches a live symbol frame', async () => {
      const { stream, orderbookHandler, rawHandler } = await setupLazyStream();
      stream.setOrderbookLiveSymbol!('BTCUSDT', true);

      const message = capturedConnectionList[0].parseMessage(Buffer.from(ORDERBOOK_RAW));
      capturedConnectionList[0].onMessage(message);

      expect(rawHandler).toHaveBeenCalledTimes(1);
      expect(orderbookHandler).toHaveBeenCalledTimes(1);
      const [symbol, update] = orderbookHandler.mock.calls[0];
      expect(symbol).toBe('BTCUSDT');
      expect(update.updateType).toBe('delta');
    });
  });

  describe('connection creation pacing', () => {
    it('creates the second connection only after pauseBetweenConnectionsMs elapses', async () => {
      jest.useFakeTimers();

      const { ReliableWebSocket } = require('@solncebro/websocket-engine');
      const stream = createStream({
        pauseBetweenConnectionsMs: 350,
        connectionPacking: { maxTopicsPerConnection: 1 },
      });

      stream.subscribeAllTickers(jest.fn(), ['BTCUSDT']);
      stream.subscribeAllTickers(jest.fn(), ['ETHUSDT']);

      await jest.advanceTimersByTimeAsync(0);

      expect(ReliableWebSocket).toHaveBeenCalledTimes(1);

      await jest.advanceTimersByTimeAsync(350);

      expect(ReliableWebSocket).toHaveBeenCalledTimes(2);

      jest.useRealTimers();
    });
  });

  describe('pool overflow batching (critical fix #1)', () => {
    it('batches overflow topics into full connections instead of one connection per topic', async () => {
      jest.useFakeTimers();

      const stream = createStream({
        pauseBetweenConnectionsMs: 350,
        connectionPacking: { maxTopicsPerConnection: 2 },
      });

      stream.subscribeAllTickers(jest.fn(), ['AAAUSDT', 'BBBUSDT']);
      await jest.advanceTimersByTimeAsync(0);

      expect(capturedConnectionList).toHaveLength(1);

      stream.subscribeAllTickers(jest.fn(), ['CCCUSDT', 'DDDUSDT', 'EEEUSDT', 'FFFUSDT']);
      await jest.advanceTimersByTimeAsync(1000);

      expect(capturedConnectionList).toHaveLength(3);
      const topicCountList = capturedConnectionList.map(
        (connection) => (connection.contextSend.mock.calls[0]?.[0] as { args: unknown[] } | undefined)?.args.length ?? 0,
      );
      expect(topicCountList).toEqual([2, 2, 2]);

      jest.useRealTimers();
    });
  });

  describe('reconnect does not double-subscribe (important fix #2)', () => {
    it('subscribes only via onOpen — onReconnectSuccess does not resend it', async () => {
      const stream = createStream();
      stream.subscribeAllTickers(jest.fn(), ['BTCUSDT']);

      await flushMicrotasks();

      capturedConnectionList[0].contextSend.mockClear();
      capturedConnectionList[0].webSocket.sendToConnectedSocket.mockClear();

      await capturedConnectionList[0].onOpen!({ send: capturedConnectionList[0].contextSend, waitForMessage: jest.fn() });
      capturedConnectionList[0].onReconnectSuccess!();

      expect(capturedConnectionList[0].contextSend).toHaveBeenCalledTimes(1);
      expect(capturedConnectionList[0].webSocket.sendToConnectedSocket).not.toHaveBeenCalled();
    });
  });

  describe('close cancels pending connection creation (important fix #3)', () => {
    it('does not create a connection scheduled before close(), and connectionList stays empty', async () => {
      jest.useFakeTimers();

      const stream = createStream({
        pauseBetweenConnectionsMs: 350,
        connectionPacking: { maxTopicsPerConnection: 1 },
      });

      stream.subscribeAllTickers(jest.fn(), ['AAAUSDT', 'BBBUSDT']);
      await jest.advanceTimersByTimeAsync(0);

      expect(capturedConnectionList).toHaveLength(1);

      stream.close();

      await jest.advanceTimersByTimeAsync(1000);

      expect(capturedConnectionList).toHaveLength(1);

      // @ts-expect-error — private access for test
      expect((stream.connectionList as unknown[]).length).toBe(0);

      jest.useRealTimers();
    });

    it('rejects new subscriptions after close() with a warning instead of throwing', async () => {
      const logger = createMockLogger();
      const stream = createStream({ logger });
      stream.subscribeAllTickers(jest.fn(), ['BTCUSDT']);

      await flushMicrotasks();

      stream.close();

      expect(() => stream.subscribeAllTickers(jest.fn(), ['ETHUSDT'])).not.toThrow();
      expect(logger.warn).toHaveBeenCalledWith('OkxPublicStream: subscribeAllTickers called after close(), ignored');
    });
  });

  describe('kline multi-row frames (important fix #4)', () => {
    it('delivers every row in the frame, in order', async () => {
      const stream = createStream();
      const handler = jest.fn();
      stream.subscribeKlines('BTCUSDT', '1m', handler);

      await flushMicrotasks();

      capturedConnectionList[0].onMessage({
        arg: { channel: 'candle1m', instId: 'BTC-USDT' },
        data: [
          ['1700000000000', '50000', '51000', '49000', '50500', '10', '500000', '5000000', '1'],
          ['1700000060000', '50500', '50600', '50400', '50550', '1', '50000', '500000', '0'],
        ],
      });

      expect(handler).toHaveBeenCalledTimes(2);
      expect(handler.mock.calls[0][1].isClosed).toBe(true);
      expect(handler.mock.calls[1][1].isClosed).toBe(false);
    });
  });

  describe('awaitConnectionsReady waits for the full creation chain (important fix #5)', () => {
    it('does not resolve until all pooled connections exist and their onOpen has fired', async () => {
      jest.useFakeTimers();

      const stream = createStream({
        pauseBetweenConnectionsMs: 350,
        connectionPacking: { maxTopicsPerConnection: 1 },
      });

      stream.subscribeAllTickers(jest.fn(), ['AAAUSDT', 'BBBUSDT', 'CCCUSDT']);
      await jest.advanceTimersByTimeAsync(0);

      expect(capturedConnectionList).toHaveLength(1);

      let isResolved = false;
      stream.awaitConnectionsReady().then(() => {
        isResolved = true;
      });

      await jest.advanceTimersByTimeAsync(0);
      expect(isResolved).toBe(false);

      await jest.advanceTimersByTimeAsync(1000);

      expect(capturedConnectionList).toHaveLength(3);
      expect(isResolved).toBe(true);

      jest.useRealTimers();
    });
  });

  describe('the ready promise always settles', () => {
    it('settles the promise a waiter already holds when the connection is recreated under it', async () => {
      const stream = createStream();
      stream.subscribeAllTickers(jest.fn(), ['BTCUSDT']);

      await flushMicrotasks();

      (stream as any).registerReadyPromise(1);
      const heldPromise = (stream as any).readyPromiseByConnectionId.get(1) as Promise<void>;
      let isSettled = false;
      heldPromise.then(() => {
        isSettled = true;
      });

      (stream as any).recreateConnection(1, 'test');

      await flushMicrotasks();

      expect(isSettled).toBe(true);
      expect(capturedConnectionList.length).toBeGreaterThan(1);
    });

    it('settles and forgets the promise when creating the connection fails outright', async () => {
      const { ReliableWebSocket } = require('@solncebro/websocket-engine');
      const stream = createStream();
      ReliableWebSocket.mockImplementationOnce(() => {
        throw new Error('handshake refused');
      });

      stream.subscribeAllTickers(jest.fn(), ['BTCUSDT']);

      await flushMicrotasks();

      expect((stream as any).resolveReadyById.size).toBe(0);
      expect((stream as any).readyPromiseByConnectionId.has(1)).toBe(false);
      await expect(stream.awaitConnectionsReady()).resolves.toBeUndefined();
    });

    it('releases a waiter when the stream is closed before the socket ever opened', async () => {
      const stream = createStream();
      stream.subscribeAllTickers(jest.fn(), ['BTCUSDT']);

      await flushMicrotasks();

      (stream as any).registerReadyPromise(1);
      const heldPromise = (stream as any).readyPromiseByConnectionId.get(1) as Promise<void>;
      let isSettled = false;
      heldPromise.then(() => {
        isSettled = true;
      });

      stream.close();

      await flushMicrotasks();

      expect(isSettled).toBe(true);
    });
  });

  describe('the silence watchdog tells a dead socket from a mute one', () => {
    it('does not count a pong as data, only a subscription frame', async () => {
      const noteContentMessageSpy = jest.spyOn(OkxSilenceWatchdog.prototype, 'noteContentMessage');
      const stream = createStream();
      stream.subscribeAllTickers(jest.fn(), ['BTCUSDT']);

      await flushMicrotasks();
      noteContentMessageSpy.mockClear();

      capturedConnectionList[0].onMessage({ event: 'pong' });

      expect(noteContentMessageSpy).not.toHaveBeenCalled();

      capturedConnectionList[0].onMessage({
        arg: { channel: 'tickers', instId: 'BTC-USDT' },
        data: [MOCK_TICKER_RAW],
      });

      expect(noteContentMessageSpy).toHaveBeenCalledTimes(1);

      noteContentMessageSpy.mockRestore();
    });

    it('leaves lastMessageTimestamp untouched by a pong', async () => {
      const stream = createStream();
      stream.subscribeAllTickers(jest.fn(), ['BTCUSDT']);

      await flushMicrotasks();

      capturedConnectionList[0].onMessage({ event: 'pong' });

      expect(stream.getConnectionInfoList()[0].lastMessageTimestamp).toBeUndefined();
    });

    describe('when the socket answers the liveness check and sends nothing else', () => {
      beforeEach(() => {
        jest.useFakeTimers();
      });

      afterEach(() => {
        jest.useRealTimers();
      });

      it('resubscribes the topics of that connection instead of recreating it', async () => {
        const logger = createMockLogger();
        const stream = createStream({ logger });
        stream.subscribeAllTickers(jest.fn(), ['BTCUSDT']);

        await jest.advanceTimersByTimeAsync(0);

        const connection = capturedConnectionList[0];
        connection.webSocket.sendToConnectedSocket.mockClear();

        await jest.advanceTimersByTimeAsync(OKX_SILENT_THRESHOLD_MS + OKX_STALE_CHECK_INTERVAL_MS);

        expect(capturedConnectionList).toHaveLength(1);
        expect(connection.webSocket.close).not.toHaveBeenCalled();
        expect(connection.webSocket.sendToConnectedSocket).toHaveBeenCalledWith({
          op: 'unsubscribe',
          args: [{ channel: 'tickers', instId: 'BTC-USDT' }],
        });
        expect(connection.webSocket.sendToConnectedSocket).toHaveBeenCalledWith({
          op: 'subscribe',
          args: [{ channel: 'tickers', instId: 'BTC-USDT' }],
        });
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('no data'));
        });

      it('never gets to judge a connection without topics — that one is closed and gone', async () => {
        const handler = jest.fn();
        const stream = createStream();
        stream.subscribeAllTickers(handler, ['BTCUSDT']);

        await jest.advanceTimersByTimeAsync(0);

        stream.unsubscribeAllTickers(handler);

        await jest.advanceTimersByTimeAsync(0);

        const connection = capturedConnectionList[0];

        expect(connection.webSocket.close).toHaveBeenCalledTimes(1);
        expect(stream.getConnectionInfoList()).toEqual([]);

        connection.webSocket.sendToConnectedSocket.mockClear();

        await jest.advanceTimersByTimeAsync(OKX_SILENT_THRESHOLD_MS + OKX_STALE_CHECK_INTERVAL_MS);

        expect(capturedConnectionList).toHaveLength(1);
        expect(connection.webSocket.sendToConnectedSocket).not.toHaveBeenCalled();
        });

      /**
       * E14. Лечение немоты состоит из двух половин, и часовой бюджет может кончиться между ними:
       * снимающая команда ушла, ставящая отвергнута — тема снята НА БИРЖЕ, сокет цел, реестр врёт.
       */
      it('rebuilds the connection when the spent operation budget refuses the second half of the healing', async () => {
        const logger = createMockLogger();
        const stream = createStream({ logger });
        stream.subscribeAllTickers(jest.fn(), ['BTCUSDT']);

        await jest.advanceTimersByTimeAsync(0);

        const connection = capturedConnectionList[0];
        const { operationBudget } = (stream as any).connectionList[0];

        while (operationBudget.getUsedOperationCount() < OKX_CONNECTION_OPERATION_LIMIT_PER_HOUR - 1) {
          operationBudget.registerOperation('probe');
        }

        connection.webSocket.sendToConnectedSocket.mockClear();

        await jest.advanceTimersByTimeAsync(OKX_SILENT_THRESHOLD_MS + OKX_STALE_CHECK_INTERVAL_MS);

        expect(connection.webSocket.sendToConnectedSocket).toHaveBeenCalledWith({
          op: 'unsubscribe',
          args: [{ channel: 'tickers', instId: 'BTC-USDT' }],
        });
        expect(countSentFrameOp(connection, 'subscribe')).toBe(0);
        expect(connection.webSocket.close).toHaveBeenCalled();
        expect(capturedConnectionList).toHaveLength(2);
        expect(capturedConnectionList[1].contextSend).toHaveBeenCalledWith({
          op: 'subscribe',
          args: [{ channel: 'tickers', instId: 'BTC-USDT' }],
        });
        expect(stream.getConnectionInfoList()[0].subscriptionList).toEqual(['Tickers BTCUSDT']);
      });

      /**
       * E16. Молчащий стакан биржа подпирает сама: «If there are no updates to the depth for an
       * extended period(Around 60 seconds) … OKX will send a message with 'asks': [], 'bids': []
       * to inform users that the connection is still active». Пока порог немоты равнялся порогу
       * «сокет не отвечает» (45 с), такое соединение лечилось каждую минуту без повода.
       */
      it('raises no alarm while the exchange keeps a quiet orderbook fed once a minute', async () => {
        const logger = createMockLogger();
        const stream = createStream({ logger });
        stream.subscribeOrderbook('BTCUSDT', 400, jest.fn());

        await jest.advanceTimersByTimeAsync(0);

        const connection = capturedConnectionList.find((item) => item.label.includes('orderbook'))!;
        sendOrderbookSnapshot(connection, 10);
        connection.webSocket.sendToConnectedSocket.mockClear();

        for (let minute = 0; minute < 20; minute++) {
          await jest.advanceTimersByTimeAsync(60000);
          sendOrderbookDelta(connection, 10, 10);
        }

        expect(logger.warn).not.toHaveBeenCalledWith(expect.stringContaining('delivered no data'));
        expect(countSentFrameOp(connection, 'unsubscribe')).toBe(0);
        expect(countSentFrameOp(connection, 'subscribe')).toBe(0);
        expect(capturedConnectionList).toHaveLength(1);
      });
    });
  });

  describe('a refused unsubscribe frame does not escape the microtask', () => {
    it('warns and keeps the topic gone instead of throwing out of the flush', async () => {
      const logger = createMockLogger();
      const stream = createStream({ logger });
      const handler = jest.fn();
      stream.subscribePublicTrades('ETHUSDT', jest.fn());
      stream.subscribeAllTickers(handler, ['BTCUSDT']);

      await flushMicrotasks();

      capturedConnectionList[0].webSocket.sendToConnectedSocket.mockImplementation(() => {
        throw new Error('Cannot send: WebSocket is not open');
      });

      const connectionId = (stream as any).connectionList[0].id;
      stream.unsubscribeAllTickers(handler);

      expect(() => (stream as any).flushPendingTopicMutations(connectionId)).not.toThrow();
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('failed to unsubscribe'));
      expect(stream.getConnectionInfoList()[0].subscriptionList).toEqual(['Trades ETHUSDT']);
    });
  });

  /**
   * Кадры считаются ТОЛЬКО ПОСЛЕ отказа биржи. Сверка накопленного с начала списка проверкой не
   * является: её удовлетворяет самый первый кадр подписки, отправленный ещё ДО отказа, и повторная
   * подписка может не отправить ничего — правка всё равно выглядела бы зелёной (E15).
   */
  describe('a refused subscription can be subscribed again', () => {
    it('sends the tickers subscribe frame again after the exchange refused it', async () => {
      const stream = createStream();
      stream.subscribeAllTickers(jest.fn(), ['BTCUSDT']);

      await flushMicrotasks();

      capturedConnectionList[0].onMessage({
        event: 'error',
        code: '60018',
        msg: 'nope',
        arg: { channel: 'tickers', instId: 'BTC-USDT' },
      });

      const frameCountBeforeRetry = collectSentFrameList().length;

      stream.subscribeAllTickers(jest.fn(), ['BTCUSDT']);

      await flushMicrotasks();

      expect(collectSentFrameList().slice(frameCountBeforeRetry)).toContainEqual({
        op: 'subscribe',
        args: [{ channel: 'tickers', instId: 'BTC-USDT' }],
      });
    });

    it('sends the mark-price subscribe frame again after the exchange refused it', async () => {
      const stream = createStream({ isSwap: true });
      stream.subscribeMarkPrices(jest.fn(), ['BTCUSDT']);

      await flushMicrotasks();

      capturedConnectionList[0].onMessage({
        event: 'error',
        code: '60018',
        msg: 'nope',
        arg: { channel: 'mark-price', instId: 'BTC-USDT-SWAP' },
      });

      const frameCountBeforeRetry = collectSentFrameList().length;

      stream.subscribeMarkPrices(jest.fn(), ['BTCUSDT']);

      await flushMicrotasks();

      expect(collectSentFrameList().slice(frameCountBeforeRetry)).toContainEqual({
        op: 'subscribe',
        args: [{ channel: 'mark-price', instId: 'BTC-USDT-SWAP' }],
      });
    });

    /**
     * F1. Индекс живёт СВОИМ каналом, и биржа вольна отвергнуть его, приняв цену маркировки: пока
     * признак «уже подписан» был у пары один на двоих, такой отказ лишал символ индекса до конца
     * жизни процесса — ни повторная подписка, ни принудительная переподписка не слали ни кадра.
     */
    it('sends the index-tickers subscribe frame again after the exchange refused it', async () => {
      const stream = createStream({ isSwap: true });
      const handler = jest.fn();
      stream.subscribeMarkPrices(handler, ['BTCUSDT']);

      await flushMicrotasks();

      const connection = capturedConnectionList[0];
      connection.onMessage({
        event: 'error',
        code: '60018',
        msg: 'nope',
        arg: { channel: 'index-tickers', instId: 'BTC-USDT' },
      });

      expect(stream.getConnectionInfoList()[0].subscriptionList).toEqual(['MarkPrices BTCUSDT']);

      const frameCountBeforeRetry = collectSentFrameList().length;

      stream.subscribeMarkPrices(jest.fn(), ['BTCUSDT']);

      await flushMicrotasks();

      expect(collectSentFrameList().slice(frameCountBeforeRetry)).toContainEqual({
        op: 'subscribe',
        args: [{ channel: 'index-tickers', instId: 'BTC-USDT' }],
      });
      expect(stream.getConnectionInfoList()[0].subscriptionList).toEqual(['MarkPrices BTCUSDT', 'IndexPrices BTCUSDT']);

      connection.onMessage({
        arg: { channel: 'index-tickers', instId: 'BTC-USDT' },
        data: [buildIndexTickerRaw('49900')],
      });
      sendMarkPrice(connection, '49960');

      expect(handler).toHaveBeenLastCalledWith([
        { symbol: 'BTCUSDT', markPrice: 49960, indexPrice: 49900, timestamp: 1700000000000 },
      ]);
    });

    it('sends the klines, trades and orderbook subscribe frames again after the exchange refused them', async () => {
      const stream = createStream();
      stream.subscribePublicTrades('BTCUSDT', jest.fn());
      stream.subscribeOrderbook('BTCUSDT', 400, jest.fn());
      stream.subscribeKlines('BTCUSDT', '1m', jest.fn());

      await flushMicrotasks();

      const tradeConnection = capturedConnectionList.find((item) => item.label.includes('public'))!;
      const orderbookConnection = capturedConnectionList.find((item) => item.label.includes('orderbook'))!;
      const businessConnection = capturedConnectionList.find((item) => item.url === BUSINESS_URL)!;

      tradeConnection.onMessage({ event: 'error', code: '60018', msg: 'nope', arg: { channel: 'trades', instId: 'BTC-USDT' } });
      orderbookConnection.onMessage({ event: 'error', code: '60018', msg: 'nope', arg: { channel: 'books', instId: 'BTC-USDT' } });
      businessConnection.onMessage({ event: 'error', code: '60018', msg: 'nope', arg: { channel: 'candle1m', instId: 'BTC-USDT' } });

      const frameCountBeforeRetry = collectSentFrameList().length;

      stream.subscribePublicTrades('BTCUSDT', jest.fn());
      stream.subscribeOrderbook('BTCUSDT', 400, jest.fn());
      stream.subscribeKlines('BTCUSDT', '1m', jest.fn());

      await flushMicrotasks();

      const sentFrameList = collectSentFrameList().slice(frameCountBeforeRetry);

      expect(sentFrameList).toContainEqual({ op: 'subscribe', args: [{ channel: 'trades', instId: 'BTC-USDT' }] });
      expect(sentFrameList).toContainEqual({ op: 'subscribe', args: [{ channel: 'books', instId: 'BTC-USDT' }] });
      expect(sentFrameList).toContainEqual({ op: 'subscribe', args: [{ channel: 'candle1m', instId: 'BTC-USDT' }] });
    });
  });

  describe('a refused subscription leaves the registry honest', () => {
    it('drops the refused topic from the connection instead of listing it as subscribed', async () => {
      const stream = createStream();
      stream.subscribeAllTickers(jest.fn(), ['BTCUSDT', 'ETHUSDT']);

      await flushMicrotasks();

      expect(stream.getConnectionInfoList()[0].subscriptionList).toEqual(['Tickers BTCUSDT', 'Tickers ETHUSDT']);

      capturedConnectionList[0].onMessage({
        event: 'error',
        code: '60018',
        msg: "Wrong URL or channel doesn't exist",
        arg: { channel: 'tickers', instId: 'BTC-USDT' },
      });

      expect(stream.getConnectionInfoList()[0].subscriptionList).toEqual(['Tickers ETHUSDT']);
    });

    it('sends no unsubscribe for a subscription that never happened', async () => {
      const stream = createStream();
      stream.subscribeAllTickers(jest.fn(), ['BTCUSDT']);

      await flushMicrotasks();
      capturedConnectionList[0].webSocket.sendToConnectedSocket.mockClear();

      capturedConnectionList[0].onMessage({
        event: 'error',
        code: '60018',
        msg: 'nope',
        arg: { channel: 'tickers', instId: 'BTC-USDT' },
      });

      await flushMicrotasks();

      expect(capturedConnectionList[0].webSocket.sendToConnectedSocket).not.toHaveBeenCalledWith(
        expect.objectContaining({ op: 'unsubscribe' }),
      );
    });

    /**
     * E18. Отказ БЕЗ поля `arg` биржа документирует собственным примером («Failure Response
     * Example» несёт только `code` и `msg`, `arg` помечен необязательным). Опознать тему нечем,
     * поэтому под подозрением всё соединение: оно пересоздаётся, подписка на открытии вернёт то,
     * что биржа примет.
     */
    it('rebuilds the connection when the refusal names no topic', async () => {
      const logger = createMockLogger();
      const stream = createStream({ logger });
      stream.subscribeAllTickers(jest.fn(), ['BTCUSDT', 'ETHUSDT']);

      await flushMicrotasks();

      const connection = capturedConnectionList[0];
      connection.onMessage({ event: 'error', code: '60012', msg: 'Invalid request' });

      await flushMicrotasks();

      expect(logger.error).toHaveBeenCalled();
      expect(connection.webSocket.close).toHaveBeenCalledTimes(1);
      expect(capturedConnectionList).toHaveLength(2);
      expect(capturedConnectionList[1].contextSend).toHaveBeenCalledWith({
        op: 'subscribe',
        args: [
          { channel: 'tickers', instId: 'BTC-USDT' },
          { channel: 'tickers', instId: 'ETH-USDT' },
        ],
      });
      expect(stream.getConnectionInfoList()[0].subscriptionList).toEqual(['Tickers BTCUSDT', 'Tickers ETHUSDT']);
    });
  });

  describe('lazyOrderbookParse — a subscribe ack is not mistaken for an orderbook frame (important fix #6)', () => {
    it('routes an ack with "event" through the full parser instead of the raw orderbook sentinel', async () => {
      const stream = createStream({ lazyOrderbookParse: true });
      const orderbookHandler = jest.fn();
      const rawHandler = jest.fn();
      stream.subscribeOrderbook('BTCUSDT', 400, orderbookHandler);
      stream.subscribeRawOrderbook!(rawHandler);

      await flushMicrotasks();

      const ack = JSON.stringify({ id: '1512', event: 'subscribe', arg: { channel: 'books', instId: 'BTC-USDT' }, connId: 'a4d3ae55' });
      const message = capturedConnectionList[0].parseMessage(Buffer.from(ack));

      expect(message.__rawOrderbook).toBeUndefined();
      expect(message.event).toBe('subscribe');

      capturedConnectionList[0].onMessage(message);

      expect(rawHandler).not.toHaveBeenCalled();
      expect(orderbookHandler).not.toHaveBeenCalled();
    });
  });

  describe('handleMessage catches raw orderbook handler errors (important fix #7)', () => {
    it('does not let a subscriber error escape onMessage', async () => {
      const stream = createStream({ lazyOrderbookParse: true });
      stream.subscribeOrderbook('BTCUSDT', 400, jest.fn());
      stream.subscribeRawOrderbook!(() => {
        throw new Error('boom');
      });

      await flushMicrotasks();

      const frame = JSON.stringify({
        arg: { channel: 'books', instId: 'BTC-USDT' },
        action: 'update',
        data: [{ asks: [], bids: [], ts: '1', seqId: 2, prevSeqId: 1 }],
      });
      const message = capturedConnectionList[0].parseMessage(Buffer.from(frame));

      expect(() => capturedConnectionList[0].onMessage(message)).not.toThrow();
    });
  });

  describe('orderbook gap escalation walks all three steps', () => {
    let dateSpy: jest.SpyInstance<number, []>;
    let nowMs = 1700000000000;

    beforeEach(() => {
      nowMs = 1700000000000;
      dateSpy = jest.spyOn(Date, 'now').mockImplementation(() => nowMs);
    });

    afterEach(() => {
      dateSpy.mockRestore();
    });

    it('sends one resync for a burst of gap frames in the same tick and delivers none of them', async () => {
      const stream = createStream();
      const handler = jest.fn();
      stream.subscribeOrderbook('BTCUSDT', 400, handler);

      await flushMicrotasks();

      sendOrderbookSnapshot(capturedConnectionList[0], 100);
      handler.mockClear();
      capturedConnectionList[0].webSocket.sendToConnectedSocket.mockClear();

      for (let i = 0; i < 5; i++) {
        sendOrderbookDelta(capturedConnectionList[0], 999, 200 + i);
      }

      expect(handler).not.toHaveBeenCalled();
      expect(countSentFrameOp(capturedConnectionList[0], 'unsubscribe')).toBe(1);
      expect(countSentFrameOp(capturedConnectionList[0], 'subscribe')).toBe(1);
      expect(capturedConnectionList[0].webSocket.close).not.toHaveBeenCalled();
    });

    it('counts a second break inside the resync window without sending a second resync', async () => {
      const stream = createStream();
      stream.subscribeOrderbook('BTCUSDT', 400, jest.fn());

      await flushMicrotasks();

      sendOrderbookSnapshot(capturedConnectionList[0], 100);
      sendOrderbookDelta(capturedConnectionList[0], 999, 105);
      capturedConnectionList[0].webSocket.sendToConnectedSocket.mockClear();

      sendOrderbookSnapshot(capturedConnectionList[0], 200);
      sendOrderbookDelta(capturedConnectionList[0], 999, 205);

      expect(countSentFrameOp(capturedConnectionList[0], 'unsubscribe')).toBe(0);
      expect(countSentFrameOp(capturedConnectionList[0], 'subscribe')).toBe(0);
      expect(capturedConnectionList[0].webSocket.close).not.toHaveBeenCalled();
      // @ts-expect-error — private access for test
      expect((stream.gapCountByTopic as Map<string, number>).get('books|BTC-USDT')).toBe(2);
    });

    it('recreates the connection on the third break, because a healing snapshot no longer clears the count', async () => {
      const stream = createStream();
      stream.subscribeOrderbook('BTCUSDT', 400, jest.fn());

      await flushMicrotasks();

      const firstSocket = capturedConnectionList[0].webSocket;

      for (let i = 0; i < 3; i++) {
        sendOrderbookSnapshot(capturedConnectionList[0], 100 + i);
        sendOrderbookDelta(capturedConnectionList[0], 999, 200 + i);
        nowMs += OKX_ORDERBOOK_RESYNC_MIN_INTERVAL_MS + 1000;
      }

      expect(countSentFrameOp(capturedConnectionList[0], 'unsubscribe')).toBe(2);
      expect(firstSocket.close).toHaveBeenCalledTimes(1);
    });

    it('escalates when the resync brings no snapshot at all, instead of staying mute forever', async () => {
      const stream = createStream();
      const handler = jest.fn();
      stream.subscribeOrderbook('BTCUSDT', 400, handler);

      await flushMicrotasks();

      const firstSocket = capturedConnectionList[0].webSocket;

      sendOrderbookSnapshot(capturedConnectionList[0], 100);
      sendOrderbookDelta(capturedConnectionList[0], 999, 105);
      handler.mockClear();

      for (let i = 0; i < 2; i++) {
        nowMs += OKX_ORDERBOOK_RESYNC_MIN_INTERVAL_MS + 1000;
        sendOrderbookDelta(capturedConnectionList[0], 105 + i, 106 + i);
      }

      expect(handler).not.toHaveBeenCalled();
      expect(firstSocket.close).toHaveBeenCalledTimes(1);
    });

    it('forgets the gap count after the topic has run clean past the resync window', async () => {
      const stream = createStream();
      stream.subscribeOrderbook('BTCUSDT', 400, jest.fn());

      await flushMicrotasks();

      sendOrderbookSnapshot(capturedConnectionList[0], 100);
      sendOrderbookDelta(capturedConnectionList[0], 999, 105);
      sendOrderbookSnapshot(capturedConnectionList[0], 200);

      nowMs += OKX_ORDERBOOK_RESYNC_MIN_INTERVAL_MS + 1000;
      sendOrderbookDelta(capturedConnectionList[0], 200, 201);

      // @ts-expect-error — private access for test
      expect((stream.gapCountByTopic as Map<string, number>).has('books|BTC-USDT')).toBe(false);
    });
  });

  describe('unknown candle channel is skipped, not treated as 1m (мелкий #2)', () => {
    it('warns and does not call the handler for an unrecognized candle channel', async () => {
      const logger = createMockLogger();
      const stream = createStream({ logger });
      const handler = jest.fn();
      stream.subscribeKlines('BTCUSDT', '1d', handler);

      await flushMicrotasks();

      capturedConnectionList[0].onMessage({
        arg: { channel: 'candle1D', instId: 'BTC-USDT' },
        data: [MOCK_KLINE_ROW],
      });

      expect(handler).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("unknown candle channel 'candle1D'"));
    });
  });

  describe('unsubscribeAllTickers with two handlers (мелкий #10)', () => {
    it('keeps the topic subscribed until the second handler unsubscribes', async () => {
      const stream = createStream();
      const h1 = jest.fn();
      const h2 = jest.fn();
      stream.subscribePublicTrades('ETHUSDT', jest.fn());
      stream.subscribeAllTickers(h1, ['BTCUSDT']);
      stream.subscribeAllTickers(h2, ['BTCUSDT']);

      await flushMicrotasks();

      capturedConnectionList[0].webSocket.sendToConnectedSocket.mockClear();

      stream.unsubscribeAllTickers(h1);
      await flushMicrotasks();
      expect(capturedConnectionList[0].webSocket.sendToConnectedSocket).not.toHaveBeenCalled();

      stream.unsubscribeAllTickers(h2);
      await flushMicrotasks();
      expect(capturedConnectionList[0].webSocket.sendToConnectedSocket).toHaveBeenCalledWith({
        op: 'unsubscribe',
        args: [{ channel: 'tickers', instId: 'BTC-USDT' }],
      });
    });
  });

  describe('getConnectionInfoList tolerates an unresolvable symbol (мелкий #8)', () => {
    it('falls back to the raw instId instead of throwing', async () => {
      const stream = createStream();
      stream.subscribeAllTickers(jest.fn(), ['BTCUSDT']);

      await flushMicrotasks();

      // @ts-expect-error — private access to inject an unresolvable topic for the test
      (stream.connectionList[0].topicList as string[]).push('tickers|WEIRD-INST-ID-X');

      expect(() => stream.getConnectionInfoList()).not.toThrow();
      const infoList = stream.getConnectionInfoList();
      expect(infoList[0].subscriptionList).toContain('Tickers WEIRD-INST-ID-X');
    });
  });

  describe('the liveness check is handed to the engine', () => {
    it('passes a bare-text ping and the OKX thresholds to every connection', async () => {
      const { ReliableWebSocket } = require('@solncebro/websocket-engine');
      const stream = createStream();
      stream.subscribeAllTickers(jest.fn(), ['BTCUSDT']);

      await flushMicrotasks();

      const args = (ReliableWebSocket as jest.Mock).mock.calls[0][0];

      expect(args.heartbeat.buildPayload()).toBe('ping');
      expect(args.heartbeat.isResponse({ event: 'pong' })).toBe(true);
      expect(args.heartbeat.isResponse({ arg: { channel: 'tickers', instId: 'BTC-USDT' }, data: [] })).toBe(false);
      expect(args.configuration).toEqual({
        pingInterval: OKX_PING_INTERVAL,
        staleThreshold: OKX_STALE_THRESHOLD_MS,
        staleCheckInterval: OKX_STALE_CHECK_INTERVAL_MS,
      });
    });
  });

  describe('silence watchdog lifecycle at the stream level (мелкий #5)', () => {
    it('stops the silence watchdog when the engine reports the connection closed', async () => {
      const stream = createStream();
      stream.subscribeAllTickers(jest.fn(), ['BTCUSDT']);

      await flushMicrotasks();

      const stopSpy = jest.spyOn(OkxSilenceWatchdog.prototype, 'stop');
      capturedConnectionList[0].onClose!({
        wasEverOpen: true,
        consecutiveFailures: 1,
        missedPongCount: 0,
        isPongTimeout: false,
      });

      expect(stopSpy).toHaveBeenCalled();

      stopSpy.mockRestore();
    });

    it('leaves the dead-socket verdict to the engine: no stream timer tears a connection down', async () => {
      jest.useFakeTimers();

      const stream = createStream();
      stream.subscribeAllTickers(jest.fn(), ['BTCUSDT']);

      await jest.advanceTimersByTimeAsync(0);
      expect(capturedConnectionList).toHaveLength(1);

      await jest.advanceTimersByTimeAsync(OKX_STALE_THRESHOLD_MS * 3);

      expect(capturedConnectionList[0].webSocket.close).not.toHaveBeenCalled();
      expect(capturedConnectionList).toHaveLength(1);

      jest.useRealTimers();
    });

    it('keeps the silence watchdog alive after a second recreate is dropped by the dedup guard (review finding 15)', async () => {
      jest.useFakeTimers();
      let nowMs = 1700000000000;
      const dateSpy = jest.spyOn(Date, 'now').mockImplementation(() => nowMs);

      const stream = createStream();
      const handler = jest.fn();
      stream.subscribeOrderbook('BTCUSDT', 400, handler);

      await jest.advanceTimersByTimeAsync(0);

      const firstSocket = capturedConnectionList[0].webSocket;

      for (let i = 0; i < 3; i++) {
        sendOrderbookSnapshot(capturedConnectionList[0], 100 + i);
        sendOrderbookDelta(capturedConnectionList[0], 999, 200 + i);
        nowMs += OKX_ORDERBOOK_RESYNC_MIN_INTERVAL_MS + 1000;
      }

      expect(firstSocket.close).toHaveBeenCalledTimes(1);

      await jest.advanceTimersByTimeAsync(0);
      const secondSocket = capturedConnectionList[1].webSocket;

      for (let i = 0; i < 3; i++) {
        sendOrderbookSnapshot(capturedConnectionList[0], 300 + i);
        sendOrderbookDelta(capturedConnectionList[0], 999, 400 + i);
      }

      expect(secondSocket.close).not.toHaveBeenCalled();

      secondSocket.sendToConnectedSocket.mockClear();

      nowMs += OKX_SILENT_THRESHOLD_MS + OKX_STALE_CHECK_INTERVAL_MS;
      await jest.advanceTimersByTimeAsync(OKX_SILENT_THRESHOLD_MS + OKX_STALE_CHECK_INTERVAL_MS);

      expect(countSentFrameOp(capturedConnectionList[1], 'unsubscribe')).toBeGreaterThan(0);
      expect(countSentFrameOp(capturedConnectionList[1], 'subscribe')).toBeGreaterThan(0);

      jest.useRealTimers();
      dateSpy.mockRestore();
    });
  });

  describe('retired socket callbacks (round 2 fix #8)', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('ignores a late close from the retired socket so the recreated connection keeps its silence watchdog', async () => {
      const stream = createStream();
      stream.subscribeAllTickers(jest.fn(), ['BTCUSDT']);

      await jest.advanceTimersByTimeAsync(0);
      expect(capturedConnectionList).toHaveLength(1);

      const retiredConnection = capturedConnectionList[0];

      await forceRecreate(stream, 1);
      expect(capturedConnectionList).toHaveLength(2);

      const currentConnection = capturedConnectionList[1];

      retiredConnection.onClose!({
        wasEverOpen: true,
        consecutiveFailures: 1,
        missedPongCount: 0,
        isPongTimeout: false,
      });

      currentConnection.webSocket.sendToConnectedSocket.mockClear();
      await jest.advanceTimersByTimeAsync(OKX_SILENT_THRESHOLD_MS + OKX_STALE_CHECK_INTERVAL_MS);

      expect(countSentFrameOp(currentConnection, 'unsubscribe')).toBeGreaterThan(0);
      expect(countSentFrameOp(currentConnection, 'subscribe')).toBeGreaterThan(0);
    });

    it('ignores a late open from the retired socket, so it cannot resubscribe over the live one', async () => {
      const stream = createStream();
      stream.subscribeAllTickers(jest.fn(), ['BTCUSDT']);

      await jest.advanceTimersByTimeAsync(0);

      const retiredConnection = capturedConnectionList[0];

      await forceRecreate(stream, 1);
      expect(capturedConnectionList).toHaveLength(2);

      retiredConnection.contextSend.mockClear();
      await retiredConnection.onOpen!({ send: retiredConnection.contextSend, waitForMessage: jest.fn() } as any);

      expect(retiredConnection.contextSend).not.toHaveBeenCalled();
    });

    it('ignores a reconnect notice from the retired socket', async () => {
      const stream = createStream();
      stream.subscribeAllTickers(jest.fn(), ['BTCUSDT']);

      await jest.advanceTimersByTimeAsync(0);

      const retiredConnection = capturedConnectionList[0];

      await forceRecreate(stream, 1);
      expect(capturedConnectionList).toHaveLength(2);

      retiredConnection.onReconnectSuccess!();

      expect(stream.getConnectionInfoList()[0].reconnectCount).toBe(0);

      capturedConnectionList[1].onReconnectSuccess!();

      expect(stream.getConnectionInfoList()[0].reconnectCount).toBe(1);
    });

    it('ignores messages delivered by the retired socket after the connection was recreated', async () => {
      const handler = jest.fn();
      const stream = createStream();
      stream.subscribeAllTickers(handler, ['BTCUSDT']);

      await jest.advanceTimersByTimeAsync(0);

      const retiredConnection = capturedConnectionList[0];

      await forceRecreate(stream, 1);
      expect(capturedConnectionList).toHaveLength(2);

      handler.mockClear();
      retiredConnection.onMessage({ arg: { channel: 'tickers', instId: 'BTC-USDT' }, data: [MOCK_TICKER_RAW] });

      expect(handler).not.toHaveBeenCalled();

      capturedConnectionList[1].onMessage({ arg: { channel: 'tickers', instId: 'BTC-USDT' }, data: [MOCK_TICKER_RAW] });

      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe('unhandled service frames (round 2 fix #9)', () => {
    it('warns on a channel-conn-count-error frame instead of dropping it silently', async () => {
      const logger = createMockLogger();
      const stream = createStream({ logger });
      stream.subscribeAllTickers(jest.fn(), ['BTCUSDT']);

      await flushMicrotasks();

      capturedConnectionList[0].onMessage({ event: 'channel-conn-count-error', channel: 'tickers', connCount: '30', connId: 'a4d3ae55' } as OkxWebSocketMessage);

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ frame: expect.objectContaining({ event: 'channel-conn-count-error' }) }),
        expect.stringContaining('unhandled service frame'),
      );
    });

    it('warns on an unknown event frame instead of dropping it silently', async () => {
      const logger = createMockLogger();
      const stream = createStream({ logger });
      stream.subscribeAllTickers(jest.fn(), ['BTCUSDT']);

      await flushMicrotasks();

      capturedConnectionList[0].onMessage({ event: 'login', code: '0', msg: '' } as OkxWebSocketMessage);

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ frame: expect.objectContaining({ event: 'login' }) }),
        expect.stringContaining('unhandled service frame'),
      );
    });
  });

  describe('dynamic topic batching on an already-open connection (round 2 fix #1)', () => {
    it('accumulates 60 topics added to an open connection into two batched subscribe frames', async () => {
      const stream = createStream();
      stream.subscribeAllTickers(jest.fn(), ['SEEDUSDT']);

      await flushMicrotasks();

      capturedConnectionList[0].webSocket.sendToConnectedSocket.mockClear();

      for (let i = 0; i < 60; i++) {
        stream.subscribeAllTickers(jest.fn(), [`SYM${i}USDT`]);
      }

      await flushMicrotasks();

      const sendCallList = capturedConnectionList[0].webSocket.sendToConnectedSocket.mock.calls as unknown as [{ op: string; args: unknown[] }][];
      const subscribeCallList = sendCallList.filter(([payload]) => payload.op === 'subscribe');

      expect(subscribeCallList).toHaveLength(2);
      expect(subscribeCallList[0][0].args).toHaveLength(50);
      expect(subscribeCallList[1][0].args).toHaveLength(10);
    });

    it('sends nothing when a topic is subscribed and unsubscribed within the same tick', async () => {
      const stream = createStream();
      stream.subscribeAllTickers(jest.fn(), ['SEEDUSDT']);

      await flushMicrotasks();

      capturedConnectionList[0].webSocket.sendToConnectedSocket.mockClear();

      const handler = jest.fn();
      stream.subscribeOrderbook('NEWUSDT', 400, handler);
      stream.unsubscribeOrderbook('NEWUSDT', 400, handler);

      await flushMicrotasks();

      expect(capturedConnectionList[0].webSocket.sendToConnectedSocket).not.toHaveBeenCalled();
    });
  });

  describe('recreated connections respect the pause the exchange demands', () => {
    it('opens one recreated socket per pause instead of all of them in one tick', async () => {
      jest.useFakeTimers();

      const stream = createStream({
        pauseBetweenConnectionsMs: OKX_PAUSE_BETWEEN_CONNECTIONS_MS,
        connectionPacking: { maxTopicsPerConnection: 1 },
      });
      stream.subscribeAllTickers(jest.fn(), ['AAAUSDT', 'BBBUSDT', 'CCCUSDT']);

      await jest.advanceTimersByTimeAsync(OKX_PAUSE_BETWEEN_CONNECTIONS_MS * 5);
      expect(capturedConnectionList).toHaveLength(3);

      (stream as any).recreateConnection(1, 'test');
      (stream as any).recreateConnection(2, 'test');
      (stream as any).recreateConnection(3, 'test');

      await jest.advanceTimersByTimeAsync(0);
      expect(capturedConnectionList).toHaveLength(3);

      await jest.advanceTimersByTimeAsync(OKX_PAUSE_BETWEEN_CONNECTIONS_MS);
      expect(capturedConnectionList).toHaveLength(4);

      await jest.advanceTimersByTimeAsync(OKX_PAUSE_BETWEEN_CONNECTIONS_MS);
      expect(capturedConnectionList).toHaveLength(5);

      await jest.advanceTimersByTimeAsync(OKX_PAUSE_BETWEEN_CONNECTIONS_MS);
      expect(capturedConnectionList).toHaveLength(6);

      stream.close();
      jest.useRealTimers();
    });

    it('does not queue a second rebuild while the first one is still waiting out the pause', async () => {
      jest.useFakeTimers();
      const dateSpy = jest.spyOn(Date, 'now').mockReturnValue(1700000000000);

      const logger = createMockLogger();
      const stream = createStream({ logger, pauseBetweenConnectionsMs: OKX_PAUSE_BETWEEN_CONNECTIONS_MS });
      stream.subscribeAllTickers(jest.fn(), ['BTCUSDT']);

      await jest.advanceTimersByTimeAsync(0);
      expect(capturedConnectionList).toHaveLength(1);

      (stream as any).recreateConnection(1, 'first');
      dateSpy.mockReturnValue(1700000000000 + 5000);
      (stream as any).recreateConnection(1, 'second');

      await jest.advanceTimersByTimeAsync(OKX_PAUSE_BETWEEN_CONNECTIONS_MS * 3);

      expect(capturedConnectionList).toHaveLength(2);
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('rebuild already queued'));

      stream.close();
      dateSpy.mockRestore();
      jest.useRealTimers();
    });

    it('settles the ready promise of a rebuild that is dropped because the stream closed', async () => {
      jest.useFakeTimers();

      const stream = createStream({ pauseBetweenConnectionsMs: OKX_PAUSE_BETWEEN_CONNECTIONS_MS });
      stream.subscribeAllTickers(jest.fn(), ['BTCUSDT']);

      await jest.advanceTimersByTimeAsync(0);

      (stream as any).recreateConnection(1, 'test');
      const heldPromise = (stream as any).readyPromiseByConnectionId.get(1) as Promise<void>;
      let isSettled = false;
      heldPromise.then(() => {
        isSettled = true;
      });

      stream.close();

      await jest.advanceTimersByTimeAsync(OKX_PAUSE_BETWEEN_CONNECTIONS_MS * 3);

      expect(isSettled).toBe(true);
      expect(capturedConnectionList).toHaveLength(1);

      jest.useRealTimers();
    });
  });

  describe('the topic queue after close', () => {
    it('creates nothing when the stream is closed before the queue is worked', async () => {
      const stream = createStream();
      stream.subscribeAllTickers(jest.fn(), ['AAAUSDT']);
      stream.close();

      await flushMicrotasks();

      expect(capturedConnectionList).toHaveLength(0);
    });

    it('creates nothing when the stream is closed while the queue waits out the pause', async () => {
      jest.useFakeTimers();

      const stream = createStream({
        pauseBetweenConnectionsMs: OKX_PAUSE_BETWEEN_CONNECTIONS_MS,
        connectionPacking: { maxTopicsPerConnection: 1 },
      });
      stream.subscribeAllTickers(jest.fn(), ['AAAUSDT', 'BBBUSDT']);

      await jest.advanceTimersByTimeAsync(0);
      expect(capturedConnectionList).toHaveLength(1);

      stream.close();

      await jest.advanceTimersByTimeAsync(OKX_PAUSE_BETWEEN_CONNECTIONS_MS * 3);

      expect(capturedConnectionList).toHaveLength(1);

      jest.useRealTimers();
    });
  });

  describe('service frames of the exchange', () => {
    it('writes a server notice it has no plan for into the log', async () => {
      const logger = createMockLogger();
      const stream = createStream({ logger });
      stream.subscribeAllTickers(jest.fn(), ['BTCUSDT']);

      await flushMicrotasks();

      capturedConnectionList[0].onMessage({ event: 'notice', code: '60041', msg: 'something happened' } as any);

      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('server notice (60041) something happened'));
      expect(capturedConnectionList[0].webSocket.close).not.toHaveBeenCalled();

      stream.close();
    });

    it('writes a service frame it does not know into the log instead of dropping it', async () => {
      const logger = createMockLogger();
      const stream = createStream({ logger });
      stream.subscribeAllTickers(jest.fn(), ['BTCUSDT']);

      await flushMicrotasks();

      capturedConnectionList[0].onMessage({ event: 'login' } as any);

      expect(logger.warn).toHaveBeenCalledWith({ frame: { event: 'login' } }, 'OkxPublicStream: unhandled service frame');

      stream.close();
    });
  });

  describe('connection creation failure requeues pending topics (round 2 fix #3)', () => {
    it('returns the requeued topic to work by itself, without an outside subscription', async () => {
      const { ReliableWebSocket } = require('@solncebro/websocket-engine');
      (ReliableWebSocket as jest.Mock).mockImplementationOnce(() => {
        throw new Error('socket boom');
      });

      const logger = createMockLogger();
      const stream = createStream({ logger });

      stream.subscribeAllTickers(jest.fn(), ['AAAUSDT']);

      await flushMicrotasks(40);

      expect(capturedConnectionList).toHaveLength(1);
      expect(capturedConnectionList[0].contextSend).toHaveBeenCalledWith({
        op: 'subscribe',
        args: [{ channel: 'tickers', instId: 'AAA-USDT' }],
      });
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('topic(s) requeued'));

      stream.close();
    });

    it('keeps the topics of both subscriptions when the first creation failed', async () => {
      const { ReliableWebSocket } = require('@solncebro/websocket-engine');
      (ReliableWebSocket as jest.Mock).mockImplementationOnce(() => {
        throw new Error('socket boom');
      });

      const stream = createStream();

      stream.subscribeAllTickers(jest.fn(), ['AAAUSDT']);
      stream.subscribeAllTickers(jest.fn(), ['BBBUSDT']);

      await flushMicrotasks(40);

      const subscribedInstIdList = capturedConnectionList
        .flatMap((connection) => connection.contextSend.mock.calls as unknown as [{ op: string; args: Array<{ instId: string }> }][])
        .filter(([payload]) => payload.op === 'subscribe')
        .flatMap(([payload]) => payload.args.map((entry) => entry.instId));

      expect(subscribedInstIdList).toEqual(expect.arrayContaining(['AAA-USDT', 'BBB-USDT']));

      stream.close();
    });

    it('gives up honestly after the attempt limit instead of retrying forever', async () => {
      const { ReliableWebSocket } = require('@solncebro/websocket-engine');

      for (let i = 0; i < OKX_CONNECTION_CREATE_ATTEMPT_LIMIT; i++) {
        (ReliableWebSocket as jest.Mock).mockImplementationOnce(() => {
          throw new Error('socket boom');
        });
      }

      const logger = createMockLogger();
      const stream = createStream({ logger });

      stream.subscribeAllTickers(jest.fn(), ['AAAUSDT']);

      await flushMicrotasks(200);

      expect(ReliableWebSocket as jest.Mock).toHaveBeenCalledTimes(OKX_CONNECTION_CREATE_ATTEMPT_LIMIT);
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('topic(s) dropped'));

      stream.close();
    });
  });
  describe('a connection left without topics is closed, not kept spinning', () => {
    it('closes the socket and drops the connection from the registry when the last topic goes', async () => {
      const stream = createStream();
      const handler = jest.fn();
      stream.subscribeAllTickers(handler, ['BTCUSDT']);

      await flushMicrotasks();

      expect(stream.getConnectionInfoList()).toHaveLength(1);

      stream.unsubscribeAllTickers(handler);

      await flushMicrotasks();

      expect(capturedConnectionList[0].webSocket.close).toHaveBeenCalledTimes(1);
      expect(stream.getConnectionInfoList()).toEqual([]);
    });

    it('spends no unsubscribe operation on a connection it is about to close', async () => {
      const stream = createStream();
      const handler = jest.fn();
      stream.subscribeAllTickers(handler, ['BTCUSDT']);

      await flushMicrotasks();
      capturedConnectionList[0].webSocket.sendToConnectedSocket.mockClear();

      stream.unsubscribeAllTickers(handler);

      await flushMicrotasks();

      expect(capturedConnectionList[0].webSocket.sendToConnectedSocket).not.toHaveBeenCalled();
    });

    it('builds no socket at all when the topic is dropped before the connection is created', async () => {
      const stream = createStream();
      const handler: KlineHandler = jest.fn();
      stream.subscribeKlines('BTCUSDT', '1m', handler);
      stream.unsubscribeKlines('BTCUSDT', '1m', handler);

      await flushMicrotasks(20);

      expect(capturedConnectionList).toHaveLength(0);
      expect(stream.getConnectionInfoList()).toEqual([]);
    });

    it('closes a connection whose only topic the exchange refused', async () => {
      const stream = createStream();
      stream.subscribeAllTickers(jest.fn(), ['BTCUSDT']);

      await flushMicrotasks();

      capturedConnectionList[0].onMessage({
        event: 'error',
        code: '60018',
        msg: 'nope',
        arg: { channel: 'tickers', instId: 'BTC-USDT' },
      });

      expect(capturedConnectionList[0].webSocket.close).toHaveBeenCalledTimes(1);
      expect(stream.getConnectionInfoList()).toEqual([]);
    });
  });

  describe('the exchange warns a minute before a planned disconnect', () => {
    it('reopens the connection ahead of the break and writes the warning as information', async () => {
      const logger = createMockLogger();
      const stream = createStream({ logger });
      stream.subscribeAllTickers(jest.fn(), ['BTCUSDT']);

      await flushMicrotasks();

      const firstSocket = capturedConnectionList[0].webSocket;

      capturedConnectionList[0].onMessage({
        event: 'notice',
        code: OKX_SERVICE_UPGRADE_NOTICE_CODE,
        msg: 'The connection will soon be closed for a service upgrade. Please reconnect.',
      });

      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining(OKX_SERVICE_UPGRADE_NOTICE_CODE));
      expect(firstSocket.close).toHaveBeenCalledTimes(1);

      await flushMicrotasks(20);

      expect(capturedConnectionList).toHaveLength(2);
      expect(capturedConnectionList[1].contextSend).toHaveBeenCalledWith({
        op: 'subscribe',
        args: [{ channel: 'tickers', instId: 'BTC-USDT' }],
      });

      stream.close();
    });
  });

  describe('deep orderbook topics keep their own connections', () => {
    it('does not put a 400-level book on the same connection as tickers and trades', async () => {
      const stream = createStream();
      stream.subscribeAllTickers(jest.fn(), ['BTCUSDT']);
      stream.subscribePublicTrades('BTCUSDT', jest.fn());
      stream.subscribeOrderbook('BTCUSDT', 400, jest.fn());

      await flushMicrotasks(20);

      const infoList = stream.getConnectionInfoList();
      const orderbookInfo = infoList.find((info) => info.subscriptionList.includes('Orderbook BTCUSDT depth=400'))!;

      expect(orderbookInfo).toBeDefined();
      expect(orderbookInfo.subscriptionList).toEqual(['Orderbook BTCUSDT depth=400']);
      expect(orderbookInfo.shortLabel).toContain('orderbook');
      expect(orderbookInfo.url).toBe(PUBLIC_URL);
    });

    it('keeps a five-level book with the light topics — the exchange recommends nothing else for it', async () => {
      const stream = createStream();
      stream.subscribeAllTickers(jest.fn(), ['BTCUSDT']);
      stream.subscribeOrderbook('BTCUSDT', 5, jest.fn());

      await flushMicrotasks(20);

      expect(stream.getConnectionInfoList()).toHaveLength(1);
      expect(stream.getConnectionInfoList()[0].subscriptionList).toEqual(['Tickers BTCUSDT', 'Orderbook BTCUSDT depth=5']);
    });

    it('opens a second orderbook connection once the documented 29 channels are used up', async () => {
      const stream = createStream();

      for (let i = 0; i < OKX_MAX_ORDERBOOK_TOPICS_PER_CONNECTION + 1; i++) {
        stream.subscribeOrderbook(`SYM${i}USDT`, 400, jest.fn());
      }

      await flushMicrotasks(30);

      const topicCountList = stream.getConnectionInfoList().map((info) => info.subscriptionList.length);

      expect(topicCountList).toEqual([OKX_MAX_ORDERBOOK_TOPICS_PER_CONNECTION, 1]);
    });

    it('still packs light topics up to the library cap on one connection', async () => {
      const stream = createStream();

      for (let i = 0; i < OKX_MAX_ORDERBOOK_TOPICS_PER_CONNECTION + 1; i++) {
        stream.subscribeAllTickers(jest.fn(), [`SYM${i}USDT`]);
      }

      await flushMicrotasks(30);

      expect(stream.getConnectionInfoList()).toHaveLength(1);
      expect(stream.getConnectionInfoList()[0].subscriptionList).toHaveLength(OKX_MAX_ORDERBOOK_TOPICS_PER_CONNECTION + 1);
    });
  });

  describe('the hourly budget of subscribe operations is counted per connection', () => {
    it('reports the pending topic changes of a connection so the queue is visible from outside', async () => {
      const stream = createStream();
      stream.subscribeAllTickers(jest.fn(), ['BTCUSDT']);

      await flushMicrotasks();

      expect(stream.getConnectionInfoList()[0].pendingCommandCount).toBe(0);

      stream.subscribePublicTrades('ETHUSDT', jest.fn());

      expect(stream.getConnectionInfoList()[0].pendingCommandCount).toBe(1);

      await flushMicrotasks();

      expect(stream.getConnectionInfoList()[0].pendingCommandCount).toBe(0);
    });

    it('sends no subscribe frame once the connection has spent its 480 operations, and rebuilds it instead', async () => {
      const logger = createMockLogger();
      const stream = createStream({ logger });
      stream.subscribeAllTickers(jest.fn(), ['BTCUSDT']);

      await flushMicrotasks();

      const connection = (stream as any).connectionList[0];

      for (let i = 0; i < OKX_CONNECTION_OPERATION_LIMIT_PER_HOUR; i++) {
        connection.operationBudget.registerOperation('subscribe');
      }

      capturedConnectionList[0].webSocket.sendToConnectedSocket.mockClear();
      stream.subscribePublicTrades('ETHUSDT', jest.fn());

      await flushMicrotasks(20);

      expect(capturedConnectionList[0].webSocket.sendToConnectedSocket).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('480 subscribe/unsubscribe operations'));
      expect(capturedConnectionList[0].webSocket.close).toHaveBeenCalledTimes(1);
      expect(capturedConnectionList).toHaveLength(2);
    });

    /**
     * F2. Подписка на открытии сокета — третье место, где отправка может быть отвергнута. Пока
     * отказ здесь оставался без последствий, переоткрытое соединение жило со ВСЕМИ снятыми темами:
     * сокет цел, реестр показывает подписки, кадров нет.
     */
    it('rebuilds the connection when the spent budget refuses the subscribe on open', async () => {
      const logger = createMockLogger();
      const stream = createStream({ logger });
      stream.subscribeAllTickers(jest.fn(), ['BTCUSDT']);

      await flushMicrotasks();

      const connection = capturedConnectionList[0];
      const { operationBudget } = (stream as any).connectionList[0];

      while (operationBudget.getUsedOperationCount() < OKX_CONNECTION_OPERATION_LIMIT_PER_HOUR) {
        operationBudget.registerOperation('probe');
      }

      connection.contextSend.mockClear();

      await connection.onOpen!({ send: connection.contextSend, waitForMessage: jest.fn() });
      await flushMicrotasks(20);

      expect(connection.contextSend).not.toHaveBeenCalled();
      expect(connection.webSocket.close).toHaveBeenCalledTimes(1);
      expect(capturedConnectionList).toHaveLength(2);
      expect(capturedConnectionList[1].contextSend).toHaveBeenCalledWith({
        op: 'subscribe',
        args: [{ channel: 'tickers', instId: 'BTC-USDT' }],
      });
      expect(stream.getConnectionInfoList()[0].subscriptionList).toEqual(['Tickers BTCUSDT']);
    });

    it('gives the rebuilt socket a budget of its own — the exchange counts per connection', async () => {
      const stream = createStream();
      stream.subscribeAllTickers(jest.fn(), ['BTCUSDT']);

      await flushMicrotasks();

      const connection = (stream as any).connectionList[0];

      for (let i = 0; i < OKX_CONNECTION_OPERATION_LIMIT_PER_HOUR; i++) {
        connection.operationBudget.registerOperation('subscribe');
      }

      (stream as any).recreateConnection(connection.id, 'test');

      await flushMicrotasks(20);

      expect((stream as any).connectionList[0].operationBudget.getUsedOperationCount()).toBe(1);
    });
  });

  describe('a topic that is subscribed but lives in no connection', () => {
    it('is put back to work by resubscribe instead of only being warned about', async () => {
      const logger = createMockLogger();
      const stream = createStream({ logger });
      stream.subscribeOrderbook('BTCUSDT', 400, jest.fn());

      await flushMicrotasks();

      const connection = (stream as any).connectionList[0];
      connection.topicList.length = 0;
      capturedConnectionList[0].webSocket.sendToConnectedSocket.mockClear();

      stream.resubscribeOrderbook('BTCUSDT', 400);

      await flushMicrotasks(20);

      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('live in no connection'));
      expect(collectSentFrameList()).toContainEqual({
        op: 'subscribe',
        args: [{ channel: 'books', instId: 'BTC-USDT' }],
      });
    });
  });
  describe('the small holes the review pointed at', () => {
    it('rebuilds the connection when a subscribe frame is refused, instead of listing topics it never subscribed', async () => {
      const logger = createMockLogger();
      const stream = createStream({ logger });
      stream.subscribeAllTickers(jest.fn(), ['BTCUSDT']);

      await flushMicrotasks();

      capturedConnectionList[0].webSocket.sendToConnectedSocket.mockImplementation(() => {
        throw new Error('Cannot send: WebSocket is not open');
      });

      stream.subscribePublicTrades('ETHUSDT', jest.fn());

      await flushMicrotasks(20);

      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('failed to subscribe'));
      expect(capturedConnectionList[0].webSocket.close).toHaveBeenCalledTimes(1);
      expect(capturedConnectionList).toHaveLength(2);
      expect(capturedConnectionList[1].contextSend).toHaveBeenCalledWith({
        op: 'subscribe',
        args: [{ channel: 'tickers', instId: 'BTC-USDT' }, { channel: 'trades', instId: 'ETH-USDT' }],
      });
    });

    it('drops pending topic changes while the socket is down and says so, leaving onOpen to subscribe the lot', async () => {
      const { WebSocketStatus } = require('@solncebro/websocket-engine');
      const logger = createMockLogger();
      const stream = createStream({ logger });
      stream.subscribeAllTickers(jest.fn(), ['BTCUSDT']);

      await flushMicrotasks();

      capturedConnectionList[0].webSocket.getStatus.mockReturnValue(WebSocketStatus.DISCONNECTED);
      stream.subscribePublicTrades('ETHUSDT', jest.fn());

      expect(stream.getConnectionInfoList()[0].pendingCommandCount).toBe(1);

      await flushMicrotasks();

      expect(stream.getConnectionInfoList()[0].pendingCommandCount).toBe(0);
      expect(capturedConnectionList[0].webSocket.sendToConnectedSocket).not.toHaveBeenCalled();
      expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('onOpen will subscribe the full topic list'));
    });

    it('refuses a raw orderbook subscriber and a live-symbol switch after close, as every other subscribe does', async () => {
      const logger = createMockLogger();
      const stream = createStream({ logger, lazyOrderbookParse: true });
      stream.subscribeOrderbook('BTCUSDT', 400, jest.fn());

      await flushMicrotasks();

      stream.close();

      const rawHandler = jest.fn();
      stream.subscribeRawOrderbook!(rawHandler);
      stream.setOrderbookLiveSymbol!('BTCUSDT', true);

      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('subscribeRawOrderbook called after close()'));
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('setOrderbookLiveSymbol called after close()'));
      // @ts-expect-error — private access for test
      expect((stream.rawOrderbookHandlerSet as Set<unknown>).size).toBe(0);
      // @ts-expect-error — private access for test
      expect((stream.liveOrderbookSymbolSet as Set<string>).size).toBe(0);
    });
  });
});
