import { BinanceTradeStream } from '../../src/ws/BinanceTradeStream';
import type { BinanceTradeWebSocketResponse } from '../../src/ws/BinanceTradeStream.types';
import { ExchangeError } from '../../src/errors/ExchangeError';
import { BINANCE_RAW_ORDER_RESPONSE } from '../fixtures/binanceRaw';
import { createMockLogger } from '../fixtures/mockLogger';

jest.mock('@solncebro/websocket-engine', () => {
  const actual = jest.requireActual('@solncebro/websocket-engine');
  return {
    ...actual,
    ReliableWebSocket: jest.fn().mockImplementation(() => ({
      getStatus: jest.fn().mockReturnValue(1),
      close: jest.fn(),
      sendToConnectedSocket: jest.fn(),
    })),
  };
});

describe('BinanceTradeStream.handleMessage', () => {
  const mockLogger = createMockLogger();
  const apiKey = 'testApiKey';
  const secret = 'testSecret';
  const url = 'wss://fstream.binance.com/ws';

  let stream: BinanceTradeStream;

  beforeEach(() => {
    jest.useFakeTimers();
    stream = new BinanceTradeStream({ url, label: '[Binance] Trade stream', logger: mockLogger, apiKey, secret });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  function addPendingRequest(requestId: string) {
    const resolveFn = jest.fn();
    const rejectFn = jest.fn();
    const timeout = setTimeout(() => {}, 30000);

    (stream as any).pendingRequestByRequestId.set(requestId, {
      resolve: resolveFn,
      reject: rejectFn,
      timeout,
    });

    return { resolveFn, rejectFn };
  }

  it('resolves pending request with normalized order on success', () => {
    const requestId = 'test-req-123';
    const { resolveFn } = addPendingRequest(requestId);

    const message: BinanceTradeWebSocketResponse = {
      id: requestId,
      status: 200,
      result: BINANCE_RAW_ORDER_RESPONSE,
    };

    (stream as any).handleMessage(message);

    expect(resolveFn).toHaveBeenCalledWith(expect.objectContaining({ symbol: 'BTCUSDT' }));
    expect((stream as any).pendingRequestByRequestId.has(requestId)).toBe(false);
  });

  it('rejects pending request with ExchangeError on error response', () => {
    const requestId = 'test-req-456';
    const { rejectFn } = addPendingRequest(requestId);

    const message: BinanceTradeWebSocketResponse = {
      id: requestId,
      status: 400,
      error: { code: -2010, msg: 'Account has insufficient balance' },
    };

    (stream as any).handleMessage(message);

    expect(rejectFn).toHaveBeenCalledWith(expect.any(ExchangeError));
    expect(rejectFn.mock.calls[0][0].message).toContain('Account has insufficient balance');
    expect((stream as any).pendingRequestByRequestId.has(requestId)).toBe(false);
  });

  it('ignores message without id field', () => {
    const { resolveFn, rejectFn } = addPendingRequest('existing-req');

    (stream as any).handleMessage({ status: 200, result: BINANCE_RAW_ORDER_RESPONSE });

    expect(resolveFn).not.toHaveBeenCalled();
    expect(rejectFn).not.toHaveBeenCalled();
  });

  it('ignores message with unknown request id', () => {
    const { resolveFn } = addPendingRequest('existing-req');

    const message: BinanceTradeWebSocketResponse = {
      id: 'unknown-req-id',
      status: 200,
      result: BINANCE_RAW_ORDER_RESPONSE,
    };

    (stream as any).handleMessage(message);

    expect(resolveFn).not.toHaveBeenCalled();
    expect((stream as any).pendingRequestByRequestId.has('existing-req')).toBe(true);
  });
});
