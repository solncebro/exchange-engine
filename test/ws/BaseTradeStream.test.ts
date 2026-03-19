import { WebSocketStatus } from '@solncebro/websocket-engine';

import { BaseTradeStream } from '../../src/ws/BaseTradeStream';
import type { BaseTradeStreamArgs } from '../../src/ws/BaseTradeStream.types';
import { createMockLogger } from '../fixtures/mockLogger';

const mockWebSocket = {
  getStatus: jest.fn().mockReturnValue(WebSocketStatus.CONNECTED),
  close: jest.fn(),
  sendToConnectedSocket: jest.fn(),
};

jest.mock('@solncebro/websocket-engine', () => {
  const actual = jest.requireActual('@solncebro/websocket-engine');
  return {
    ...actual,
    ReliableWebSocket: jest.fn().mockImplementation(() => mockWebSocket),
  };
});

class TestTradeStream extends BaseTradeStream<any> {
  public initConnectionMock = jest.fn();
  public buildOrderRequestMock = jest.fn().mockReturnValue({ test: true });

  protected async initConnection(): Promise<void> {
    this.initConnectionMock();
    (this as any).webSocket = mockWebSocket;
  }

  protected buildOrderRequest(orderParams: Record<string, unknown>, requestId: string): unknown {
    return this.buildOrderRequestMock(orderParams, requestId);
  }
}

function createStream(overrides?: Partial<BaseTradeStreamArgs>): TestTradeStream {
  return new TestTradeStream({
    url: 'wss://test.com/ws',
    label: 'TestTradeStream',
    apiKey: 'testKey',
    secret: 'testSecret',
    logger: createMockLogger(),
    ...overrides,
  });
}

describe('BaseTradeStream', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockWebSocket.getStatus.mockReturnValue(WebSocketStatus.CONNECTED);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('connect', () => {
    it('calls initConnection', async () => {
      const stream = createStream();

      await stream.connect();

      expect(stream.initConnectionMock).toHaveBeenCalledTimes(1);
    });

    it('deduplicates parallel connect calls', async () => {
      const stream = createStream();

      await Promise.all([stream.connect(), stream.connect()]);

      expect(stream.initConnectionMock).toHaveBeenCalledTimes(1);
    });

    it('does not call initConnection when already connected', async () => {
      const stream = createStream();

      await stream.connect();
      stream.initConnectionMock.mockClear();

      await stream.connect();

      expect(stream.initConnectionMock).not.toHaveBeenCalled();
    });
  });

  describe('disconnect', () => {
    it('closes WebSocket and nullifies it', async () => {
      const stream = createStream();
      await stream.connect();

      stream.disconnect();

      expect(mockWebSocket.close).toHaveBeenCalledTimes(1);
      expect(stream.isConnected()).toBe(false);
    });

    it('rejects all pending requests', async () => {
      const stream = createStream();
      await stream.connect();

      const resolveFn = jest.fn();
      const rejectFn = jest.fn();
      const timeout = setTimeout(() => {}, 30000);

      (stream as any).pendingRequestByRequestId.set('req-1', {
        resolve: resolveFn,
        reject: rejectFn,
        timeout,
      });

      stream.disconnect();

      expect(rejectFn).toHaveBeenCalledWith(expect.any(Error));
      expect(rejectFn.mock.calls[0][0].message).toContain('disconnected');
      expect((stream as any).pendingRequestByRequestId.size).toBe(0);
    });

    it('is safe to call when not connected', () => {
      const stream = createStream();

      expect(() => stream.disconnect()).not.toThrow();
    });
  });

  describe('isConnected', () => {
    it('returns false when webSocket is null', () => {
      const stream = createStream();

      expect(stream.isConnected()).toBe(false);
    });

    it('returns true when status is CONNECTED', async () => {
      const stream = createStream();
      await stream.connect();

      expect(stream.isConnected()).toBe(true);
    });

    it('returns false when status is not CONNECTED', async () => {
      const stream = createStream();
      await stream.connect();
      mockWebSocket.getStatus.mockReturnValue(WebSocketStatus.CONNECTING);

      expect(stream.isConnected()).toBe(false);
    });
  });

  describe('createOrder', () => {
    it('calls buildOrderRequest and sends to socket', async () => {
      const stream = createStream();
      await stream.connect();

      // Start order — ensureConnected resolves immediately since already connected
      const orderPromise = stream.createOrder({ symbol: 'BTCUSDT', side: 'Buy' });

      // Wait for async ensureConnected to resolve
      await Promise.resolve();
      await Promise.resolve();

      expect(stream.buildOrderRequestMock).toHaveBeenCalledWith(
        { symbol: 'BTCUSDT', side: 'Buy' },
        expect.stringContaining('order_'),
      );
      expect(mockWebSocket.sendToConnectedSocket).toHaveBeenCalledWith({ test: true });

      // Resolve the pending request to complete the promise
      const requestId = stream.buildOrderRequestMock.mock.calls[0][1];
      const pending = (stream as any).pendingRequestByRequestId.get(requestId);
      pending.resolve({ id: '123', symbol: 'BTCUSDT' });

      const result = await orderPromise;
      expect(result).toEqual({ id: '123', symbol: 'BTCUSDT' });
    });

    it('rejects on timeout', async () => {
      const stream = createStream();
      await stream.connect();

      let rejected: Error | undefined;
      stream.createOrder({ symbol: 'BTCUSDT' }).catch((e) => { rejected = e; });

      await jest.advanceTimersByTimeAsync(30000);

      expect(rejected).toBeDefined();
      expect(rejected!.message).toContain('Order creation timeout');
    });

    it('rejects when WebSocket is not connected', async () => {
      const stream = createStream();
      await stream.connect();
      mockWebSocket.getStatus.mockReturnValue(WebSocketStatus.DISCONNECTED);

      await expect(stream.createOrder({ symbol: 'BTCUSDT' })).rejects.toThrow('WebSocket is not connected');
    });
  });

  describe('takePendingRequest', () => {
    it('returns and removes pending request', async () => {
      const stream = createStream();
      const resolveFn = jest.fn();
      const rejectFn = jest.fn();
      const timeout = setTimeout(() => {}, 30000);

      (stream as any).pendingRequestByRequestId.set('req-1', {
        resolve: resolveFn,
        reject: rejectFn,
        timeout,
      });

      const result = (stream as any).takePendingRequest('req-1');

      expect(result).not.toBeNull();
      expect(result.resolve).toBe(resolveFn);
      expect((stream as any).pendingRequestByRequestId.has('req-1')).toBe(false);
    });

    it('returns null for unknown request id', () => {
      const stream = createStream();

      const result = (stream as any).takePendingRequest('unknown-id');

      expect(result).toBeNull();
    });
  });
});
