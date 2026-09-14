import type { MarkPriceUpdate } from '../../src/types/common';
import type { BybitPublicTradeDataRaw, BybitTickerRaw, BybitWebSocketKlineRaw } from '../../src/normalizers/bybitNormalizer';
import { BybitPublicStream } from '../../src/ws/BybitPublicStream';
import { createMockLogger } from '../fixtures/mockLogger';

let capturedOnMessage: ((message: any) => void) | undefined;
let capturedParseMessage: ((rawData: any) => any) | undefined;
let capturedOnReconnectSuccess: (() => void) | undefined;
let _capturedOnOpen: ((context: unknown) => Promise<void>) | undefined;

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
      capturedParseMessage = args.parseMessage;
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
  bid1Price: '49999',
  bid1Size: '1.5',
  ask1Price: '50001',
  ask1Size: '2.0',
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
    capturedParseMessage = undefined;
    capturedOnReconnectSuccess = undefined;
    _capturedOnOpen = undefined;
  });

  describe('subscribeAllTickers', () => {
    it('subscribes per-symbol tickers.{symbol} on linear URL', async () => {
      const stream = new BybitPublicStream({ url: 'wss://stream.bybit.com/v5/public/linear', logger: mockLogger, onNotify: undefined, label: 'test' });
      stream.subscribeAllTickers(jest.fn(), ['BTCUSDT', 'ETHUSDT']);

      await Promise.resolve();
      await Promise.resolve();

      expect(mockContextSend).toHaveBeenCalledWith(
        expect.objectContaining({
          op: 'subscribe',
          args: expect.arrayContaining(['tickers.BTCUSDT', 'tickers.ETHUSDT']),
        }),
      );
    });

    it('subscribes per-symbol tickers.{symbol} on spot URL', async () => {
      const stream = new BybitPublicStream({ url: 'wss://stream.bybit.com/v5/public/spot', logger: mockLogger, onNotify: undefined, label: 'test' });
      stream.subscribeAllTickers(jest.fn(), ['BTCUSDT']);

      await Promise.resolve();
      await Promise.resolve();

      expect(mockContextSend).toHaveBeenCalledWith(
        expect.objectContaining({
          op: 'subscribe',
          args: expect.arrayContaining(['tickers.BTCUSDT']),
        }),
      );
    });

    it('calls handler with normalized tickers (per-symbol object payload)', async () => {
      const stream = new BybitPublicStream({ url: 'wss://stream.bybit.com/v5/public/linear', logger: mockLogger, onNotify: undefined, label: 'test' });
      const handler = jest.fn();
      stream.subscribeAllTickers(handler, ['BTCUSDT']);

      await Promise.resolve();

      // Bybit V5 per-symbol tickers.{symbol} deliver `data` as a single object.
      capturedOnMessage!({
        topic: 'tickers.BTCUSDT',
        data: MOCK_TICKER_RAW,
      });

      expect(handler).toHaveBeenCalledTimes(1);
      const tickerMap = handler.mock.calls[0][0];
      expect(tickerMap).toBeInstanceOf(Map);
      const ticker = tickerMap.get('BTCUSDT');
      expect(ticker).toBeDefined();
      // bid1/ask1 must survive normalization — the premium feed reads exactly these.
      expect(ticker.bid1Price).toBeCloseTo(49999);
      expect(ticker.ask1Price).toBeCloseTo(50001);
      expect(ticker.bid1Size).toBeCloseTo(1.5);
      expect(ticker.ask1Size).toBeCloseTo(2.0);
    });

    it('ref-counts tickers.{symbol}: stays subscribed while either markPrice OR ticker handler remains', async () => {
      const stream = new BybitPublicStream({ url: 'wss://stream.bybit.com/v5/public/linear', logger: mockLogger, onNotify: undefined, label: 'test' });
      const tickerHandler = jest.fn();
      const markPriceHandler = jest.fn();

      // The same tickers.{symbol} topic feeds both consumers (Bybit V5 has no aggregate ticker topic).
      stream.subscribeAllTickers(tickerHandler, ['BTCUSDT']);
      stream.subscribeMarkPrices(markPriceHandler, ['BTCUSDT']);
      await Promise.resolve();
      await Promise.resolve();

      const activeSubscriptionSet = (stream as unknown as { activeSubscriptionSet: Set<string> }).activeSubscriptionSet;
      expect(activeSubscriptionSet.has('tickers.BTCUSDT')).toBe(true);

      // Drop the ticker consumer — mark price still needs the topic → it must stay subscribed.
      stream.unsubscribeAllTickers(tickerHandler);
      expect(activeSubscriptionSet.has('tickers.BTCUSDT')).toBe(true);

      // Drop the last remaining consumer (mark price) → only now is the topic released.
      stream.unsubscribeMarkPrices(markPriceHandler);
      expect(activeSubscriptionSet.has('tickers.BTCUSDT')).toBe(false);
    });
  });

  // Живой поток tickers.BTCUSDT, 25 секунд: 176 кадров, из них 175 приращений, и в 149 из
  // них НЕТ цены последней сделки. Приращение, разобранное в одиночку, отдавало наружу
  // lastPrice и суточное изменение «не числами», а объём и границы суток — нулями.
  describe('ticker delta frames carry only changed fields', () => {
    const emitTickerFrame = (type: string, data: Partial<BybitTickerRaw>) => {
      capturedOnMessage!({
        topic: 'tickers.BTCUSDT',
        type,
        data: { symbol: 'BTCUSDT', ...data },
        ts: 1700000000000,
      });
    };

    it('a delta WITHOUT lastPrice carries the price from the snapshot, never NaN', async () => {
      const stream = new BybitPublicStream({ url: 'wss://stream.bybit.com/v5/public/linear', logger: mockLogger, onNotify: undefined, label: 'test' });
      const handler = jest.fn();
      stream.subscribeAllTickers(handler, ['BTCUSDT']);

      await Promise.resolve();

      emitTickerFrame('snapshot', MOCK_TICKER_RAW);
      // Живой кадр биржи: изменился только верх стакана.
      emitTickerFrame('delta', { bid1Price: '78265.30', bid1Size: '1.274' });

      expect(handler).toHaveBeenCalledTimes(2);
      const ticker = handler.mock.calls[1][0].get('BTCUSDT');
      expect(ticker.lastPrice).toBeCloseTo(50000);
      expect(Number.isNaN(ticker.lastPrice)).toBe(false);
      expect(Number.isNaN(ticker.priceChangePercent)).toBe(false);
      expect(ticker.priceChangePercent).toBeCloseTo(2.5);
      // Суточные величины тоже приходят из снимка, а не нулями.
      expect(ticker.highPrice).toBeCloseTo(51000);
      expect(ticker.volume).toBeCloseTo(1000);
      // А то, что реально изменилось, — из приращения.
      expect(ticker.bid1Price).toBeCloseTo(78265.3);
    });

    it('a delta BEFORE any snapshot is not delivered at all (a partial ticker is worse than none)', async () => {
      const stream = new BybitPublicStream({ url: 'wss://stream.bybit.com/v5/public/linear', logger: mockLogger, onNotify: undefined, label: 'test' });
      const handler = jest.fn();
      stream.subscribeAllTickers(handler, ['BTCUSDT']);

      await Promise.resolve();

      emitTickerFrame('delta', { bid1Price: '78265.30', bid1Size: '1.274' });

      expect(handler).not.toHaveBeenCalled();
    });

    it('a later delta merges over the previous merged frame, not only over the snapshot', async () => {
      const stream = new BybitPublicStream({ url: 'wss://stream.bybit.com/v5/public/linear', logger: mockLogger, onNotify: undefined, label: 'test' });
      const handler = jest.fn();
      stream.subscribeAllTickers(handler, ['BTCUSDT']);

      await Promise.resolve();

      emitTickerFrame('snapshot', MOCK_TICKER_RAW);
      emitTickerFrame('delta', { lastPrice: '51500' });
      emitTickerFrame('delta', { bid1Price: '51499' });

      const ticker = handler.mock.calls[2][0].get('BTCUSDT');
      expect(ticker.lastPrice).toBeCloseTo(51500);
      expect(ticker.bid1Price).toBeCloseTo(51499);
    });

    it('mark price still reads the RAW frame: a bid-only delta must not re-emit a stale mark price', async () => {
      const stream = new BybitPublicStream({ url: 'wss://stream.bybit.com/v5/public/linear', logger: mockLogger, onNotify: undefined, label: 'test' });
      const updates: MarkPriceUpdate[] = [];
      stream.subscribeMarkPrices(list => updates.push(...list), ['BTCUSDT']);

      await Promise.resolve();

      emitTickerFrame('snapshot', { ...MOCK_TICKER_RAW, markPrice: '50000', indexPrice: '50100' });
      emitTickerFrame('delta', { bid1Price: '49998' });

      expect(updates).toHaveLength(1);
      expect(updates[0].markPrice).toBeCloseTo(50000);
    });
  });

  describe('mark price index continuity (delta frames carry only changed fields)', () => {
    const emitTicker = (data: Partial<BybitTickerRaw>) => {
      capturedOnMessage!({
        topic: 'tickers.BTCUSDT',
        data: { symbol: 'BTCUSDT', ...data },
        ts: 1700000000000,
      });
    };

    it('a delta WITHOUT indexPrice must carry the last known index, not 0 (OPGUSDT root cause: zero index broke the price-limit boundary)', async () => {
      const stream = new BybitPublicStream({ url: 'wss://stream.bybit.com/v5/public/linear', logger: mockLogger, onNotify: undefined, label: 'test' });
      const updates: MarkPriceUpdate[] = [];
      stream.subscribeMarkPrices(list => updates.push(...list), ['BTCUSDT']);
      await Promise.resolve();

      // Snapshot: both fields present.
      emitTicker({ markPrice: '50000', indexPrice: '50100' });
      // Delta: mark changed, index NOT included in the frame (exchange sends changed fields only).
      emitTicker({ markPrice: '50050' });

      expect(updates).toHaveLength(2);
      expect(updates[0].indexPrice).toBeCloseTo(50100);
      expect(updates[1].markPrice).toBeCloseTo(50050);
      expect(updates[1].indexPrice).toBeCloseTo(50100); // last known — NOT zero
    });

    it('an index-only delta (no markPrice) is remembered and used by the next mark delta', async () => {
      const stream = new BybitPublicStream({ url: 'wss://stream.bybit.com/v5/public/linear', logger: mockLogger, onNotify: undefined, label: 'test' });
      const updates: MarkPriceUpdate[] = [];
      stream.subscribeMarkPrices(list => updates.push(...list), ['BTCUSDT']);
      await Promise.resolve();

      emitTicker({ markPrice: '50000', indexPrice: '50100' });
      emitTicker({ indexPrice: '50200' }); // index moved, mark unchanged → no emit, but must be remembered
      emitTicker({ markPrice: '50075' }); // mark delta without index

      expect(updates).toHaveLength(2);
      expect(updates[1].indexPrice).toBeCloseTo(50200);
    });

    it('never-seen index is emitted as undefined — NEVER a fake 0 placeholder', async () => {
      const stream = new BybitPublicStream({ url: 'wss://stream.bybit.com/v5/public/linear', logger: mockLogger, onNotify: undefined, label: 'test' });
      const updates: MarkPriceUpdate[] = [];
      stream.subscribeMarkPrices(list => updates.push(...list), ['BTCUSDT']);
      await Promise.resolve();

      emitTicker({ markPrice: '50000' }); // no index ever seen yet

      expect(updates).toHaveLength(1);
      expect(updates[0].indexPrice).toBeUndefined();
    });
  });

  describe('subscribeKlines', () => {
    it('converts interval and subscribes with correct topic', async () => {
      const stream = new BybitPublicStream({ url: 'wss://stream.bybit.com/v5/public/linear', logger: mockLogger, onNotify: undefined, label: 'test' });
      stream.subscribeAllTickers(jest.fn(), ['BTCUSDT']);

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
      stream.subscribeAllTickers(jest.fn(), ['BTCUSDT']);

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
      stream.subscribeAllTickers(jest.fn(), ['BTCUSDT']);

      await Promise.resolve();

      mockLogger.info.mockClear();
      capturedOnMessage!({ op: 'subscribe', success: true });

      expect(mockLogger.info).not.toHaveBeenCalled();
    });

    it('logs subscription error as a single line including retMsg', async () => {
      const stream = new BybitPublicStream({ url: 'wss://stream.bybit.com/v5/public/linear', logger: mockLogger, onNotify: undefined, label: 'test' });
      stream.subscribeAllTickers(jest.fn(), ['BTCUSDT']);

      await Promise.resolve();

      capturedOnMessage!({ op: 'subscribe', success: false, ret_msg: 'invalid' });

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('subscribe error (invalid'),
      );
    });

    it('downgrades benign "already subscribed" to debug (not error)', async () => {
      const stream = new BybitPublicStream({ url: 'wss://stream.bybit.com/v5/public/linear', logger: mockLogger, onNotify: undefined, label: 'test' });
      stream.subscribeAllTickers(jest.fn(), ['BTCUSDT']);

      await Promise.resolve();
      mockLogger.error.mockClear();

      capturedOnMessage!({ op: 'subscribe', success: false, ret_msg: 'error:already subscribed,topic:orderbook.200.BTCUSDT' });

      expect(mockLogger.error).not.toHaveBeenCalled();
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('already subscribed'),
      );
    });

    it('ignores messages without topic or data', async () => {
      const stream = new BybitPublicStream({ url: 'wss://stream.bybit.com/v5/public/linear', logger: mockLogger, onNotify: undefined, label: 'test' });
      const handler = jest.fn();
      stream.subscribeAllTickers(handler, ['BTCUSDT']);

      await Promise.resolve();

      capturedOnMessage!({ op: 'pong' });

      expect(handler).not.toHaveBeenCalled();
    });

    it('logs error when handler throws', async () => {
      const stream = new BybitPublicStream({ url: 'wss://stream.bybit.com/v5/public/linear', logger: mockLogger, onNotify: undefined, label: 'test' });
      const handler = jest.fn().mockImplementation(() => {
        throw new Error('ticker handler error');
      });
      stream.subscribeAllTickers(handler, ['BTCUSDT']);

      await Promise.resolve();

      capturedOnMessage!({ topic: 'tickers.linear', data: [MOCK_TICKER_RAW] });

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ topic: 'tickers.linear', error: expect.any(Error) }),
        'BybitPublicStream: error handling message',
      );
    });
  });

  describe('lazyOrderbookParse', () => {
    const ORDERBOOK_RAW = JSON.stringify({
      topic: 'orderbook.200.BTCUSDT',
      type: 'delta',
      ts: 1700000000123,
      data: { s: 'BTCUSDT', b: [['100', '1']], a: [['101', '2']], u: 5, seq: 9 },
    });

    async function setupLazyStream(lazy: boolean) {
      const stream = new BybitPublicStream({
        url: 'wss://stream.bybit.com/v5/public/linear',
        logger: mockLogger,
        onNotify: undefined,
        label: 'test',
        lazyOrderbookParse: lazy,
      });
      const orderbookHandler = jest.fn();
      const rawHandler = jest.fn();
      stream.subscribeOrderbook('BTCUSDT', 200, orderbookHandler);
      stream.subscribeRawOrderbook(rawHandler);

      await Promise.resolve();

      return { stream, orderbookHandler, rawHandler };
    }

    it('lazy ON: non-live orderbook frame is shelved raw, body NOT parsed, not dispatched', async () => {
      const { orderbookHandler, rawHandler } = await setupLazyStream(true);

      const message = capturedParseMessage!(Buffer.from(ORDERBOOK_RAW));

      // The ~200-level body was NOT JSON.parsed — only the symbol was extracted from the head.
      expect(message.__rawOrderbook).toBeDefined();
      expect(message.__rawOrderbook.symbol).toBe('BTCUSDT');
      expect(message.__rawOrderbook.raw).toBe(ORDERBOOK_RAW);
      expect(typeof message.__rawOrderbook.receivedTimestamp).toBe('number');
      expect(message.data).toBeUndefined();

      capturedOnMessage!(message);

      expect(rawHandler).toHaveBeenCalledTimes(1);
      expect(rawHandler).toHaveBeenCalledWith(
        expect.objectContaining({ symbol: 'BTCUSDT', raw: ORDERBOOK_RAW }),
      );
      expect(orderbookHandler).not.toHaveBeenCalled();
    });

    it('lazy ON: live symbol frame is shelved raw AND fully parsed/dispatched', async () => {
      const { stream, orderbookHandler, rawHandler } = await setupLazyStream(true);
      stream.setOrderbookLiveSymbol('BTCUSDT', true);

      const message = capturedParseMessage!(Buffer.from(ORDERBOOK_RAW));
      capturedOnMessage!(message);

      expect(rawHandler).toHaveBeenCalledTimes(1);
      expect(orderbookHandler).toHaveBeenCalledTimes(1);
      const [symbol, update] = orderbookHandler.mock.calls[0];
      expect(symbol).toBe('BTCUSDT');
      expect(update.updateType).toBe('delta');
      expect(update.askList).toEqual([['101', '2']]);
      expect(update.updateId).toBe(5);
      // eventTimestamp comes from the envelope `ts`, not the (absent) data.ts.
      expect(update.eventTimestamp).toBe(1700000000123);
    });

    it('lazy ON: removing a symbol from the live-set stops full parsing', async () => {
      const { stream, orderbookHandler } = await setupLazyStream(true);
      stream.setOrderbookLiveSymbol('BTCUSDT', true);
      stream.setOrderbookLiveSymbol('BTCUSDT', false);

      capturedOnMessage!(capturedParseMessage!(Buffer.from(ORDERBOOK_RAW)));

      expect(orderbookHandler).not.toHaveBeenCalled();
    });

    it('lazy ON: non-orderbook (ticker) frame is parsed normally, never raw-shelved', async () => {
      const { rawHandler } = await setupLazyStream(true);
      const tickerRaw = JSON.stringify({ topic: 'tickers.linear', data: [MOCK_TICKER_RAW] });

      const message = capturedParseMessage!(Buffer.from(tickerRaw));

      expect(message.__rawOrderbook).toBeUndefined();
      expect(message.topic).toBe('tickers.linear');
      expect(Array.isArray(message.data)).toBe(true);

      capturedOnMessage!(message);

      expect(rawHandler).not.toHaveBeenCalled();
    });

    it('lazy OFF: orderbook frame is parsed normally and raw handler is never called', async () => {
      const { orderbookHandler, rawHandler } = await setupLazyStream(false);

      const message = capturedParseMessage!(Buffer.from(ORDERBOOK_RAW));

      expect(message.__rawOrderbook).toBeUndefined();
      expect(message.topic).toBe('orderbook.200.BTCUSDT');
      expect(message.data).toBeDefined();

      capturedOnMessage!(message);

      expect(rawHandler).not.toHaveBeenCalled();
      expect(orderbookHandler).toHaveBeenCalledTimes(1);
    });

    it('lazy ON: topic beyond the scanned head falls back to a full parse (safe, no saving)', async () => {
      const { orderbookHandler, rawHandler } = await setupLazyStream(true);
      // Force the topic past FRAME_HEAD_SCAN_LENGTH by padding a leading field.
      const padded = JSON.stringify({
        pad: 'x'.repeat(300),
        topic: 'orderbook.200.BTCUSDT',
        type: 'delta',
        ts: 1700000000123,
        data: { s: 'BTCUSDT', b: [], a: [['101', '2']], u: 5 },
      });

      const message = capturedParseMessage!(Buffer.from(padded));

      // Not recognized as lazy (topic not in head) → fully parsed, processed normally.
      expect(message.__rawOrderbook).toBeUndefined();
      expect(message.data).toBeDefined();

      capturedOnMessage!(message);

      expect(rawHandler).not.toHaveBeenCalled();
      expect(orderbookHandler).toHaveBeenCalledTimes(1);
    });
  });

  describe('resubscribeAll', () => {
    it('resubscribes all active subscriptions on reconnect', async () => {
      const stream = new BybitPublicStream({ url: 'wss://stream.bybit.com/v5/public/linear', logger: mockLogger, onNotify: undefined, label: 'test' });
      stream.subscribeAllTickers(jest.fn(), ['BTCUSDT']);
      stream.subscribeKlines('BTCUSDT', '1m', jest.fn());

      await Promise.resolve();

      mockWebSocket.sendToConnectedSocket.mockClear();
      capturedOnReconnectSuccess!();

      expect(mockWebSocket.sendToConnectedSocket).toHaveBeenCalledWith(
        expect.objectContaining({
          op: 'subscribe',
          args: expect.arrayContaining(['tickers.BTCUSDT', 'kline.1.BTCUSDT']),
        }),
      );
    });
  });

  describe('resubscribeStream (light path)', () => {
    it('sends unsubscribe + subscribe frames on same WS when connected', async () => {
      mockWebSocket.getStatus.mockReturnValue('connected');

      const stream = new BybitPublicStream({ url: 'wss://stream.bybit.com/v5/public/linear', logger: mockLogger, onNotify: undefined, label: 'test' });
      stream.subscribeKlines('BTCUSDT', '5m', jest.fn());

      await Promise.resolve();
      await Promise.resolve();

      mockWebSocket.sendToConnectedSocket.mockClear();
      mockWebSocket.close.mockClear();

      stream.resubscribeStream('BTCUSDT', '5m');

      expect(mockWebSocket.sendToConnectedSocket).toHaveBeenNthCalledWith(1, {
        op: 'unsubscribe',
        args: ['kline.5.BTCUSDT'],
      });
      expect(mockWebSocket.sendToConnectedSocket).toHaveBeenNthCalledWith(2, {
        op: 'subscribe',
        args: ['kline.5.BTCUSDT'],
      });
      expect(mockWebSocket.close).not.toHaveBeenCalled();
    });

    it('falls back to recreate when WS is disconnected', async () => {
      mockWebSocket.getStatus.mockReturnValue('connected');

      const stream = new BybitPublicStream({ url: 'wss://stream.bybit.com/v5/public/linear', logger: mockLogger, onNotify: undefined, label: 'test' });
      stream.subscribeKlines('BTCUSDT', '5m', jest.fn());

      await Promise.resolve();
      await Promise.resolve();

      mockWebSocket.getStatus.mockReturnValue('disconnected');
      mockWebSocket.close.mockClear();
      mockWebSocket.sendToConnectedSocket.mockClear();

      stream.resubscribeStream('BTCUSDT', '5m');

      expect(mockWebSocket.close).toHaveBeenCalled();
      expect(mockWebSocket.sendToConnectedSocket).not.toHaveBeenCalledWith(
        expect.objectContaining({ op: 'unsubscribe' }),
      );
    });

    it('falls back to recreate when sendToConnectedSocket throws', async () => {
      mockWebSocket.getStatus.mockReturnValue('connected');

      const stream = new BybitPublicStream({ url: 'wss://stream.bybit.com/v5/public/linear', logger: mockLogger, onNotify: undefined, label: 'test' });
      stream.subscribeKlines('BTCUSDT', '5m', jest.fn());

      await Promise.resolve();
      await Promise.resolve();

      mockWebSocket.close.mockClear();
      mockWebSocket.sendToConnectedSocket.mockImplementationOnce(() => {
        throw new Error('socket send failed');
      });

      stream.resubscribeStream('BTCUSDT', '5m');

      expect(mockWebSocket.close).toHaveBeenCalled();
    });

    it('resubscribeMarkPrices recreates the connection instead of a per-topic repair once the subscribed ticker topic count reaches the cascade threshold', async () => {
      mockWebSocket.getStatus.mockReturnValue('connected');

      const stream = new BybitPublicStream({ url: 'wss://stream.bybit.com/v5/public/linear', logger: mockLogger, onNotify: undefined, label: 'test' });
      const symbolList = Array.from({ length: 60 }, (_unused, index) => `SYM${index}USDT`);
      stream.subscribeMarkPrices(jest.fn(), symbolList);

      await Promise.resolve();
      await Promise.resolve();

      mockWebSocket.sendToConnectedSocket.mockClear();
      mockWebSocket.close.mockClear();

      stream.resubscribeMarkPrices();

      expect(mockWebSocket.close).toHaveBeenCalledTimes(1);
      expect(mockWebSocket.sendToConnectedSocket).not.toHaveBeenCalledWith(
        expect.objectContaining({ op: 'unsubscribe' }),
      );
      expect(mockWebSocket.sendToConnectedSocket).not.toHaveBeenCalledWith(
        expect.objectContaining({ op: 'subscribe' }),
      );
    });
  });

  describe('resubscribeStreamList (batched recovery)', () => {
    it('sends one unsubscribe + one subscribe frame for the whole list, not a pair per symbol', async () => {
      mockWebSocket.getStatus.mockReturnValue('connected');

      const stream = new BybitPublicStream({ url: 'wss://stream.bybit.com/v5/public/linear', logger: mockLogger, onNotify: undefined, label: 'test' });
      const symbolList = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
      symbolList.forEach((symbol) => stream.subscribeKlines(symbol, '5m', jest.fn()));

      await Promise.resolve();
      await Promise.resolve();

      mockWebSocket.sendToConnectedSocket.mockClear();
      mockWebSocket.close.mockClear();

      stream.resubscribeStreamList(symbolList.map((symbol) => ({ symbol, interval: '5m' as const })));

      const topicList = symbolList.map((symbol) => `kline.5.${symbol}`);

      expect(mockWebSocket.sendToConnectedSocket).toHaveBeenCalledTimes(2);
      expect(mockWebSocket.sendToConnectedSocket).toHaveBeenNthCalledWith(1, { op: 'unsubscribe', args: topicList });
      expect(mockWebSocket.sendToConnectedSocket).toHaveBeenNthCalledWith(2, { op: 'subscribe', args: topicList });
      expect(mockWebSocket.close).not.toHaveBeenCalled();
    });

    it('recreates the connection once the list reaches the cascade threshold', async () => {
      mockWebSocket.getStatus.mockReturnValue('connected');

      const stream = new BybitPublicStream({ url: 'wss://stream.bybit.com/v5/public/linear', logger: mockLogger, onNotify: undefined, label: 'test' });
      const symbolList = Array.from({ length: 60 }, (_unused, index) => `SYM${index}USDT`);
      symbolList.forEach((symbol) => stream.subscribeKlines(symbol, '5m', jest.fn()));

      await Promise.resolve();
      await Promise.resolve();

      mockWebSocket.sendToConnectedSocket.mockClear();
      mockWebSocket.close.mockClear();

      stream.resubscribeStreamList(symbolList.map((symbol) => ({ symbol, interval: '5m' as const })));

      expect(mockWebSocket.close).toHaveBeenCalledTimes(1);
      expect(mockWebSocket.sendToConnectedSocket).not.toHaveBeenCalledWith(
        expect.objectContaining({ op: 'unsubscribe' }),
      );
      expect(mockWebSocket.sendToConnectedSocket).not.toHaveBeenCalledWith(
        expect.objectContaining({ op: 'subscribe' }),
      );
    });

    it('does nothing for an empty list', async () => {
      mockWebSocket.getStatus.mockReturnValue('connected');

      const stream = new BybitPublicStream({ url: 'wss://stream.bybit.com/v5/public/linear', logger: mockLogger, onNotify: undefined, label: 'test' });
      stream.subscribeKlines('BTCUSDT', '5m', jest.fn());

      await Promise.resolve();
      await Promise.resolve();

      mockWebSocket.sendToConnectedSocket.mockClear();
      mockWebSocket.close.mockClear();

      stream.resubscribeStreamList([]);

      expect(mockWebSocket.sendToConnectedSocket).not.toHaveBeenCalled();
      expect(mockWebSocket.close).not.toHaveBeenCalled();
    });
  });

  describe('resubscribeOrderbook / resubscribePublicTrades / resubscribeMarkPrices (light path)', () => {
    it('resubscribeOrderbook sends unsubscribe + subscribe for the orderbook topic', async () => {
      mockWebSocket.getStatus.mockReturnValue('connected');

      const stream = new BybitPublicStream({ url: 'wss://stream.bybit.com/v5/public/linear', logger: mockLogger, onNotify: undefined, label: 'test' });
      stream.subscribeOrderbook('BTCUSDT', 200, jest.fn());

      await Promise.resolve();
      await Promise.resolve();

      mockWebSocket.sendToConnectedSocket.mockClear();
      mockWebSocket.close.mockClear();

      stream.resubscribeOrderbook('BTCUSDT', 200);

      expect(mockWebSocket.sendToConnectedSocket).toHaveBeenNthCalledWith(1, {
        op: 'unsubscribe',
        args: ['orderbook.200.BTCUSDT'],
      });
      expect(mockWebSocket.sendToConnectedSocket).toHaveBeenNthCalledWith(2, {
        op: 'subscribe',
        args: ['orderbook.200.BTCUSDT'],
      });
      expect(mockWebSocket.close).not.toHaveBeenCalled();
    });

    it('resubscribePublicTrades sends unsubscribe + subscribe for the publicTrade topic', async () => {
      mockWebSocket.getStatus.mockReturnValue('connected');

      const stream = new BybitPublicStream({ url: 'wss://stream.bybit.com/v5/public/linear', logger: mockLogger, onNotify: undefined, label: 'test' });
      stream.subscribePublicTrades('BTCUSDT', jest.fn());

      await Promise.resolve();
      await Promise.resolve();

      mockWebSocket.sendToConnectedSocket.mockClear();
      mockWebSocket.close.mockClear();

      stream.resubscribePublicTrades('BTCUSDT');

      expect(mockWebSocket.sendToConnectedSocket).toHaveBeenNthCalledWith(1, {
        op: 'unsubscribe',
        args: ['publicTrade.BTCUSDT'],
      });
      expect(mockWebSocket.sendToConnectedSocket).toHaveBeenNthCalledWith(2, {
        op: 'subscribe',
        args: ['publicTrade.BTCUSDT'],
      });
      expect(mockWebSocket.close).not.toHaveBeenCalled();
    });

    it('resubscribeMarkPrices batch-resubscribes all subscribed ticker topics', async () => {
      mockWebSocket.getStatus.mockReturnValue('connected');

      const stream = new BybitPublicStream({ url: 'wss://stream.bybit.com/v5/public/linear', logger: mockLogger, onNotify: undefined, label: 'test' });
      stream.subscribeMarkPrices(jest.fn(), ['BTCUSDT', 'ETHUSDT']);

      await Promise.resolve();
      await Promise.resolve();

      mockWebSocket.sendToConnectedSocket.mockClear();
      mockWebSocket.close.mockClear();

      stream.resubscribeMarkPrices();

      expect(mockWebSocket.sendToConnectedSocket).toHaveBeenNthCalledWith(1, {
        op: 'unsubscribe',
        args: ['tickers.BTCUSDT', 'tickers.ETHUSDT'],
      });
      expect(mockWebSocket.sendToConnectedSocket).toHaveBeenNthCalledWith(2, {
        op: 'subscribe',
        args: ['tickers.BTCUSDT', 'tickers.ETHUSDT'],
      });
      expect(mockWebSocket.close).not.toHaveBeenCalled();
    });

    it('resubscribeMarkPrices is a no-op when no ticker symbols are subscribed', () => {
      const stream = new BybitPublicStream({ url: 'wss://stream.bybit.com/v5/public/linear', logger: mockLogger, onNotify: undefined, label: 'test' });

      mockWebSocket.sendToConnectedSocket.mockClear();
      stream.resubscribeMarkPrices();

      expect(mockWebSocket.sendToConnectedSocket).not.toHaveBeenCalled();
    });
  });

  describe('1s klines via trade aggregation', () => {
    it('subscribes to publicTrade topic for 1s interval', async () => {
      const stream = new BybitPublicStream({ url: 'wss://stream.bybit.com/v5/public/linear', logger: mockLogger, onNotify: undefined, label: 'test' });
      stream.subscribeAllTickers(jest.fn(), ['BTCUSDT']);

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
      stream.subscribeAllTickers(jest.fn(), ['BTCUSDT']);

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
      stream.subscribeAllTickers(jest.fn(), ['BTCUSDT']);

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

      stream.subscribeMarkPrices(handler, ['BTCUSDT']);
      // @ts-expect-error — private access for test
      expect(stream.markPriceHandlerSet.size).toBe(1);

      stream.unsubscribeMarkPrices(handler);
      // @ts-expect-error — private access for test
      expect(stream.markPriceHandlerSet.size).toBe(0);
    });

    it('dispatches MarkPriceUpdate[] from tickers.{symbol} payload', async () => {
      const stream = new BybitPublicStream({ url: 'wss://stream.bybit.com/v5/public/linear', logger: mockLogger, onNotify: undefined, label: 'test' });
      const received: MarkPriceUpdate[][] = [];
      stream.subscribeMarkPrices((list) => received.push(list), ['BTCUSDT']);

      await Promise.resolve();

      // Per-symbol tickers deliver `data` as a single object (snapshot).
      capturedOnMessage!({
        topic: 'tickers.BTCUSDT',
        type: 'snapshot',
        ts: 1000,
        data: {
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
      });

      expect(received).toHaveLength(1);
      expect(received[0]).toEqual([
        { symbol: 'BTCUSDT', markPrice: 49950, indexPrice: 49955, timestamp: 1000 },
      ]);
    });

    it('ignores entries without markPrice (e.g. partial delta object)', async () => {
      const stream = new BybitPublicStream({ url: 'wss://stream.bybit.com/v5/public/linear', logger: mockLogger, onNotify: undefined, label: 'test' });
      const received: MarkPriceUpdate[][] = [];
      stream.subscribeMarkPrices((list) => received.push(list), ['BTCUSDT']);

      await Promise.resolve();

      // Partial delta as a single object (no markPrice field → ignored).
      capturedOnMessage!({
        topic: 'tickers.BTCUSDT',
        type: 'delta',
        ts: 2000,
        data: { symbol: 'BTCUSDT', lastPrice: '51000' },
      });

      expect(received).toEqual([]);
    });

    it('activates per-symbol tickers subscription when subscribeMarkPrices is called', () => {
      const stream = new BybitPublicStream({ url: 'wss://stream.bybit.com/v5/public/linear', logger: mockLogger, onNotify: undefined, label: 'test' });
      stream.subscribeMarkPrices(jest.fn(), ['BTCUSDT']);

      // @ts-expect-error — private access for test
      expect(stream.activeSubscriptionSet.has('tickers.BTCUSDT')).toBe(true);
    });

    it('sends ticker topic to an existing connection when subscribed after connect (regression: mark price added post-connect)', async () => {
      const stream = new BybitPublicStream({ url: 'wss://stream.bybit.com/v5/public/linear', logger: mockLogger, onNotify: undefined, label: 'test' });

      // Establish a connection first via an unrelated subscription.
      stream.subscribeKlines('BTCUSDT', '1m', jest.fn());
      await Promise.resolve();
      await Promise.resolve();
      mockWebSocket.sendToConnectedSocket.mockClear();

      // Mark price subscription arrives AFTER the connection already exists.
      stream.subscribeMarkPrices(jest.fn(), ['ETHUSDT']);

      expect(mockWebSocket.sendToConnectedSocket).toHaveBeenCalledWith(
        expect.objectContaining({ op: 'subscribe', args: ['tickers.ETHUSDT'] }),
      );
    });
  });

  describe('subscribeOrderbook', () => {
    it('subscribes to orderbook.{depth}.{symbol} topic', async () => {
      const stream = new BybitPublicStream({ url: 'wss://stream.bybit.com/v5/public/linear', logger: mockLogger, onNotify: undefined, label: 'test' });
      stream.subscribeOrderbook('BTCUSDT', 500, jest.fn());

      await Promise.resolve();
      await Promise.resolve();

      expect(mockContextSend).toHaveBeenCalledWith(
        expect.objectContaining({
          op: 'subscribe',
          args: expect.arrayContaining(['orderbook.500.BTCUSDT']),
        }),
      );
    });

    it('dispatches normalized OrderBookUpdate on snapshot message', async () => {
      const stream = new BybitPublicStream({ url: 'wss://stream.bybit.com/v5/public/linear', logger: mockLogger, onNotify: undefined, label: 'test' });
      const handler = jest.fn();
      stream.subscribeOrderbook('BTCUSDT', 50, handler);

      await Promise.resolve();

      capturedOnMessage!({
        topic: 'orderbook.50.BTCUSDT',
        type: 'snapshot',
        ts: 1700000000005,
        data: {
          s: 'BTCUSDT',
          b: [['65000.00', '1.5']],
          a: [['65001.00', '0.8']],
          u: 1,
          seq: 100,
          ts: 1700000000000,
        },
      });

      expect(handler).toHaveBeenCalledTimes(1);
      const [symbol, update] = handler.mock.calls[0];
      expect(symbol).toBe('BTCUSDT');
      expect(update.updateType).toBe('snapshot');
      expect(update.bidList).toEqual([['65000.00', '1.5']]);
      expect(update.askList).toEqual([['65001.00', '0.8']]);
      expect(update.updateId).toBe(1);
      // eventTimestamp comes from the message ENVELOPE ts (1700000000005), which takes
      // precedence over data.ts — real Bybit V5 orderbook frames carry ts only in the envelope.
      expect(update.eventTimestamp).toBe(1700000000005);
      expect(typeof update.receivedTimestamp).toBe('number');
    });

    it('dispatches updateType=delta when message type is not snapshot', async () => {
      const stream = new BybitPublicStream({ url: 'wss://stream.bybit.com/v5/public/linear', logger: mockLogger, onNotify: undefined, label: 'test' });
      const handler = jest.fn();
      stream.subscribeOrderbook('BTCUSDT', 50, handler);

      await Promise.resolve();

      capturedOnMessage!({
        topic: 'orderbook.50.BTCUSDT',
        type: 'delta',
        ts: 1700000000050,
        data: { s: 'BTCUSDT', b: [], a: [], u: 2, ts: 1700000000050 },
      });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][1].updateType).toBe('delta');
    });

    it('ignores orderbook payloads when data is missing or not an object', async () => {
      const stream = new BybitPublicStream({ url: 'wss://stream.bybit.com/v5/public/linear', logger: mockLogger, onNotify: undefined, label: 'test' });
      const handler = jest.fn();
      stream.subscribeOrderbook('BTCUSDT', 50, handler);

      await Promise.resolve();

      capturedOnMessage!({ topic: 'orderbook.50.BTCUSDT', type: 'snapshot', ts: 1, data: [] });
      capturedOnMessage!({ topic: 'orderbook.50.BTCUSDT', type: 'snapshot', ts: 1 });

      expect(handler).not.toHaveBeenCalled();
    });

    it('removes topic when last handler unsubscribes', async () => {
      const stream = new BybitPublicStream({ url: 'wss://stream.bybit.com/v5/public/linear', logger: mockLogger, onNotify: undefined, label: 'test' });
      const handler = jest.fn();
      stream.subscribeOrderbook('BTCUSDT', 50, handler);
      stream.unsubscribeOrderbook('BTCUSDT', 50, handler);

      // @ts-expect-error — private access for test
      expect(stream.activeSubscriptionSet.has('orderbook.50.BTCUSDT')).toBe(false);
    });

    it('keeps additional handlers active when one unsubscribes', () => {
      const stream = new BybitPublicStream({ url: 'wss://stream.bybit.com/v5/public/linear', logger: mockLogger, onNotify: undefined, label: 'test' });
      const handler1 = jest.fn();
      const handler2 = jest.fn();
      stream.subscribeOrderbook('BTCUSDT', 50, handler1);
      stream.subscribeOrderbook('BTCUSDT', 50, handler2);
      stream.unsubscribeOrderbook('BTCUSDT', 50, handler1);

      // @ts-expect-error — private access for test
      expect(stream.activeSubscriptionSet.has('orderbook.50.BTCUSDT')).toBe(true);
    });
  });

  describe('subscribePublicTrades', () => {
    it('subscribes to publicTrade.{symbol} topic', async () => {
      const stream = new BybitPublicStream({ url: 'wss://stream.bybit.com/v5/public/linear', logger: mockLogger, onNotify: undefined, label: 'test' });
      stream.subscribePublicTrades('BTCUSDT', jest.fn());

      await Promise.resolve();
      await Promise.resolve();

      expect(mockContextSend).toHaveBeenCalledWith(
        expect.objectContaining({
          op: 'subscribe',
          args: expect.arrayContaining(['publicTrade.BTCUSDT']),
        }),
      );
    });

    it('dispatches normalized PublicTrade list to custom subscriber', async () => {
      const stream = new BybitPublicStream({ url: 'wss://stream.bybit.com/v5/public/linear', logger: mockLogger, onNotify: undefined, label: 'test' });
      const handler = jest.fn();
      stream.subscribePublicTrades('BTCUSDT', handler);

      await Promise.resolve();

      const tradeRaw: BybitPublicTradeDataRaw = { T: 1700000000000, s: 'BTCUSDT', p: '65000.00', v: '0.1', S: 'Buy', i: 'trade-1', BT: false };
      capturedOnMessage!({ topic: 'publicTrade.BTCUSDT', type: 'snapshot', ts: 1700000000050, data: [tradeRaw] });

      expect(handler).toHaveBeenCalledTimes(1);
      const [symbol, tradeList] = handler.mock.calls[0];
      expect(symbol).toBe('BTCUSDT');
      expect(tradeList).toHaveLength(1);
      expect(tradeList[0].id).toBe('trade-1');
      expect(tradeList[0].price).toBe(65000);
      expect(tradeList[0].side).toBe('buy');
    });

    it('does not remove topic if kline 1s aggregator still holds it', () => {
      const stream = new BybitPublicStream({ url: 'wss://stream.bybit.com/v5/public/linear', logger: mockLogger, onNotify: undefined, label: 'test' });
      const klineHandler = jest.fn();
      const tradeHandler = jest.fn();
      stream.subscribeKlines('BTCUSDT', '1s', klineHandler);
      stream.subscribePublicTrades('BTCUSDT', tradeHandler);

      stream.unsubscribePublicTrades('BTCUSDT', tradeHandler);

      // @ts-expect-error — private access for test
      expect(stream.activeSubscriptionSet.has('publicTrade.BTCUSDT')).toBe(true);
    });

    it('does not remove topic when kline 1s unsubscribes but custom subscriber remains', () => {
      const stream = new BybitPublicStream({ url: 'wss://stream.bybit.com/v5/public/linear', logger: mockLogger, onNotify: undefined, label: 'test' });
      const klineHandler = jest.fn();
      const tradeHandler = jest.fn();
      stream.subscribeKlines('BTCUSDT', '1s', klineHandler);
      stream.subscribePublicTrades('BTCUSDT', tradeHandler);

      stream.unsubscribeKlines('BTCUSDT', '1s', klineHandler);

      // @ts-expect-error — private access for test
      expect(stream.activeSubscriptionSet.has('publicTrade.BTCUSDT')).toBe(true);
    });

    it('removes topic when both consumers unsubscribe', () => {
      const stream = new BybitPublicStream({ url: 'wss://stream.bybit.com/v5/public/linear', logger: mockLogger, onNotify: undefined, label: 'test' });
      const klineHandler = jest.fn();
      const tradeHandler = jest.fn();
      stream.subscribeKlines('BTCUSDT', '1s', klineHandler);
      stream.subscribePublicTrades('BTCUSDT', tradeHandler);

      stream.unsubscribePublicTrades('BTCUSDT', tradeHandler);
      stream.unsubscribeKlines('BTCUSDT', '1s', klineHandler);

      // @ts-expect-error — private access for test
      expect(stream.activeSubscriptionSet.has('publicTrade.BTCUSDT')).toBe(false);
    });
  });

  describe('connection packing (separateByTopicType)', () => {
    const typePrefixSet = (subscriptionList: string[]): Set<string> =>
      new Set(subscriptionList.map((entry) => entry.split(' ')[0]));

    it('packs each connection with a single topic type — never mixing', async () => {
      const stream = new BybitPublicStream({
        url: 'wss://stream.bybit.com/v5/public/linear',
        logger: mockLogger,
        onNotify: undefined,
        label: 'test',
        connectionPacking: {
          separateByTopicType: true,
          maxTopicsPerConnectionByType: { orderbook: 1 },
        },
      });

      stream.subscribeMarkPrices(jest.fn(), ['BTCUSDT', 'ETHUSDT']);
      stream.subscribeKlines('BTCUSDT', '1m', jest.fn());
      stream.subscribeOrderbook('BTCUSDT', 200, jest.fn());
      stream.subscribeOrderbook('ETHUSDT', 200, jest.fn());
      stream.subscribePublicTrades('BTCUSDT', jest.fn());

      await Promise.resolve();
      await Promise.resolve();

      const infoList = stream.getConnectionInfoList();

      for (const info of infoList) {
        expect(typePrefixSet(info.subscriptionList).size).toBe(1);
      }

      const orderbookConnectionList = infoList.filter((info) =>
        info.subscriptionList.every((entry) => entry.startsWith('Orderbook')),
      );
      expect(orderbookConnectionList).toHaveLength(2);
      expect(orderbookConnectionList.every((info) => info.subscriptionList.length === 1)).toBe(true);
    });

    it('labels carry the topic type and a stable #N (single source via getConnectionInfoList)', async () => {
      const stream = new BybitPublicStream({
        url: 'wss://stream.bybit.com/v5/public/linear',
        logger: mockLogger,
        onNotify: undefined,
        label: 'Bybit Linear Public WebSocket',
        connectionPacking: { separateByTopicType: true },
      });

      stream.subscribeOrderbook('BTCUSDT', 200, jest.fn());

      await Promise.resolve();
      await Promise.resolve();

      const [info] = stream.getConnectionInfoList();
      expect(info.label).toBe('Bybit Linear Public WebSocket orderbook #1');
      // shortLabel is the context-free tail of the same label (for grouped UI listings).
      expect(info.shortLabel).toBe('orderbook #1');
    });

    it('legacy mode (no packing config) keeps the flat mixed packing and a numbered label', async () => {
      const stream = new BybitPublicStream({
        url: 'wss://stream.bybit.com/v5/public/linear',
        logger: mockLogger,
        onNotify: undefined,
        label: 'test',
      });

      stream.subscribeMarkPrices(jest.fn(), ['BTCUSDT']);
      stream.subscribeOrderbook('BTCUSDT', 200, jest.fn());

      await Promise.resolve();
      await Promise.resolve();

      const infoList = stream.getConnectionInfoList();
      expect(infoList).toHaveLength(1);
      expect(typePrefixSet(infoList[0].subscriptionList).size).toBe(2);
      expect(infoList[0].label).toBe('test #1');
      expect(infoList[0].shortLabel).toBe('#1');
    });

    it('post-connect subscription joins its own type pool, never back-filling another', async () => {
      const stream = new BybitPublicStream({
        url: 'wss://stream.bybit.com/v5/public/linear',
        logger: mockLogger,
        onNotify: undefined,
        label: 'test',
        connectionPacking: { separateByTopicType: true },
      });

      stream.subscribeOrderbook('BTCUSDT', 200, jest.fn());

      await Promise.resolve();
      await Promise.resolve();

      // Added AFTER connections exist → must NOT join the orderbook connection.
      stream.subscribeKlines('ETHUSDT', '1m', jest.fn());

      await Promise.resolve();

      const infoList = stream.getConnectionInfoList();

      for (const info of infoList) {
        expect(typePrefixSet(info.subscriptionList).size).toBe(1);
      }
      expect(infoList.some((info) => info.subscriptionList.every((entry) => entry.startsWith('Orderbook')))).toBe(true);
      expect(infoList.some((info) => info.subscriptionList.every((entry) => entry.startsWith('Klines')))).toBe(true);
    });
  });

  // Ожидание готовности потоков у Bybit возвращалось МГНОВЕННО (базовый класс отдавал уже
  // решённое обещание), и бот начинал торговать на пустом кэше. У соседней биржи это
  // ожидание настоящее.
  describe('awaitConnectionsReady', () => {
    it('does not resolve before the connection has opened', async () => {
      const stream = new BybitPublicStream({ url: 'wss://stream.bybit.com/v5/public/linear', logger: mockLogger, onNotify: undefined, label: 'test' });
      stream.subscribeKlines('BTCUSDT', '1m' as never, jest.fn());

      let isResolved = false;
      const readyPromise = stream.awaitConnectionsReady().then(() => { isResolved = true; });

      // Пока сокет не открылся, ждать обязано.
      await Promise.resolve();
      expect(isResolved).toBe(false);

      _capturedOnOpen?.({ send: mockContextSend, waitForMessage: jest.fn() });
      await readyPromise;

      expect(isResolved).toBe(true);
      stream.close();
    });
  });
});
