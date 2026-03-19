import { BybitTradeStream } from '../../src/ws/BybitTradeStream';
import type { BybitTradeMessage } from '../../src/ws/BybitTradeStream.types';
import { ExchangeError } from '../../src/errors/ExchangeError';
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

const BYBIT_TRADE_WS_ORDER_RESPONSE = {
  orderId: 'abc-123-def',
  orderLinkId: 'myBybitOrder123',
};

describe('BybitTradeStream.handleMessage', () => {
  const mockLogger = createMockLogger();
  const apiKey = 'testApiKey';
  const secret = 'testSecret';
  const url = 'wss://stream.bybit.com/v5/private';

  let stream: BybitTradeStream;

  beforeEach(() => {
    jest.useFakeTimers();
    stream = new BybitTradeStream({ url, label: '[Bybit] Trade stream', logger: mockLogger, apiKey, secret });
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

  it('resolves pending request with orderId on success (Private WS format with success: true)', () => {
    const requestId = 'test-req-123';
    const { resolveFn } = addPendingRequest(requestId);

    const message: BybitTradeMessage = {
      op: 'order.create',
      reqId: requestId,
      success: true,
      data: BYBIT_TRADE_WS_ORDER_RESPONSE,
    };

    (stream as any).handleMessage(message);

    expect(resolveFn).toHaveBeenCalledWith(expect.objectContaining({
      id: 'abc-123-def',
      clientOrderId: 'myBybitOrder123',
      status: 'open',
    }));
    expect((stream as any).pendingRequestByRequestId.has(requestId)).toBe(false);
  });

  it('resolves pending request when retCode is 0 (Trade WS format without success field)', () => {
    const requestId = 'test-req-trade-ws';
    const { resolveFn } = addPendingRequest(requestId);

    const message: BybitTradeMessage = {
      op: 'order.create',
      reqId: requestId,
      retCode: 0,
      retMsg: 'OK',
      data: BYBIT_TRADE_WS_ORDER_RESPONSE,
    };

    (stream as any).handleMessage(message);

    expect(resolveFn).toHaveBeenCalledWith(expect.objectContaining({
      id: 'abc-123-def',
      clientOrderId: 'myBybitOrder123',
      status: 'open',
    }));
    expect((stream as any).pendingRequestByRequestId.has(requestId)).toBe(false);
  });

  it('logs raw message on order.create response', () => {
    const requestId = 'test-req-log';
    addPendingRequest(requestId);

    const message: BybitTradeMessage = {
      op: 'order.create',
      reqId: requestId,
      retCode: 0,
      retMsg: 'OK',
      data: BYBIT_TRADE_WS_ORDER_RESPONSE,
    };

    (stream as any).handleMessage(message);

    expect(mockLogger.info).toHaveBeenCalledWith(
      { rawMessage: message },
      '[Bybit] Order response received',
    );
  });

  it('rejects pending request with ExchangeError on failure', () => {
    const requestId = 'test-req-456';
    const { rejectFn } = addPendingRequest(requestId);

    const message: BybitTradeMessage = {
      op: 'order.create',
      reqId: requestId,
      success: false,
      retMsg: 'Insufficient balance',
      retCode: 110007,
    };

    (stream as any).handleMessage(message);

    expect(rejectFn).toHaveBeenCalledWith(expect.any(ExchangeError));
    expect(rejectFn.mock.calls[0][0].message).toContain('Insufficient balance');
    expect((stream as any).pendingRequestByRequestId.has(requestId)).toBe(false);
  });

  it('ignores auth messages without affecting pending requests', () => {
    const { resolveFn, rejectFn } = addPendingRequest('some-req');

    (stream as any).handleMessage({ op: 'auth', success: true } as BybitTradeMessage);

    expect(resolveFn).not.toHaveBeenCalled();
    expect(rejectFn).not.toHaveBeenCalled();
  });

  it('ignores order message with unknown reqId', () => {
    const { resolveFn } = addPendingRequest('existing-req');

    const message: BybitTradeMessage = {
      op: 'order.create',
      reqId: 'unknown-req-id',
      success: true,
      data: BYBIT_TRADE_WS_ORDER_RESPONSE,
    };

    (stream as any).handleMessage(message);

    expect(resolveFn).not.toHaveBeenCalled();
    expect((stream as any).pendingRequestByRequestId.has('existing-req')).toBe(true);
  });
});
