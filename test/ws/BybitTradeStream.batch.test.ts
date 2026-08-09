import { WebSocketStatus } from '@solncebro/websocket-engine';

import { BybitTradeStream } from '../../src/ws/BybitTradeStream';
import { PendingRequestKind } from '../../src/ws/BaseTradeStream.types';
import type { BybitBatchTradeMessage, BybitTradeAnyMessage } from '../../src/ws/BybitTradeStream.types';
import { OrderSideEnum, OrderTypeEnum } from '../../src/types/common';
import type { CreateOrderWebSocketArgs } from '../../src/types/exchange';
import {
  BYBIT_WS_RAW_AMEND_BATCH_RESPONSE,
  BYBIT_WS_RAW_CANCEL_BATCH_RESPONSE,
  BYBIT_WS_RAW_CREATE_BATCH_RESPONSE,
} from '../fixtures/bybitRaw';
import { createMockLogger } from '../fixtures/mockLogger';

let capturedOnMessage: ((message: BybitTradeAnyMessage) => void) | undefined;
let capturedOnOpen: ((context: any) => Promise<void>) | undefined;

const mockWebSocket = {
  getStatus: jest.fn().mockReturnValue(WebSocketStatus.CONNECTED),
  close: jest.fn(),
  sendToConnectedSocket: jest.fn(),
};

jest.mock('@solncebro/websocket-engine', () => {
  const actual = jest.requireActual('@solncebro/websocket-engine');

  return {
    ...actual,
    ReliableWebSocket: jest.fn().mockImplementation((args: any) => {
      capturedOnMessage = args.onMessage;
      capturedOnOpen = args.onOpen;

      return mockWebSocket;
    }),
  };
});

jest.mock('../../src/ws/bybitWebSocketAuth', () => ({
  authenticateBybitWebSocket: jest.fn().mockResolvedValue(undefined),
}));

describe('BybitTradeStream batch operations', () => {
  const mockLogger = createMockLogger();
  const url = 'wss://stream.bybit.com/v5/trade';
  const apiKey = 'testApiKey';
  const secret = 'testSecret';

  let stream: BybitTradeStream;

  async function connectStream(): Promise<void> {
    const connectPromise = stream.connect();
    const mockContext = { send: jest.fn(), waitForMessage: jest.fn().mockResolvedValue(undefined) };
    await capturedOnOpen!(mockContext);
    await connectPromise;
  }

  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(Date, 'now').mockReturnValue(1700000000000);
    mockWebSocket.getStatus.mockReturnValue(WebSocketStatus.CONNECTED);
    mockWebSocket.sendToConnectedSocket.mockClear();
    capturedOnMessage = undefined;
    capturedOnOpen = undefined;
    stream = new BybitTradeStream({ url, label: '[Bybit] Trade stream', logger: mockLogger, apiKey, secret });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  describe('createBatchOrders', () => {
    it('sends order.create-batch request with reqId, category, and payload', async () => {
      await connectStream();

      const originalArgsList: CreateOrderWebSocketArgs[] = [
        { symbol: 'BTCUSDT', type: OrderTypeEnum.Market, side: OrderSideEnum.Buy, amount: 0.001 },
        { symbol: 'BTCUSDT', type: OrderTypeEnum.Limit, side: OrderSideEnum.Sell, amount: 0.002, price: 30000 },
      ];
      const requestPayloadList = [
        { category: 'linear', symbol: 'BTCUSDT', side: 'Buy', orderType: 'Market', qty: '0.001' },
        { category: 'linear', symbol: 'BTCUSDT', side: 'Sell', orderType: 'Limit', qty: '0.002', price: '30000' },
      ];

      const promise = stream.createBatchOrders('linear', originalArgsList, requestPayloadList);

      await jest.advanceTimersByTimeAsync(0);

      const sentMessage = mockWebSocket.sendToConnectedSocket.mock.calls[0][0];

      expect(sentMessage.op).toBe('order.create-batch');
      expect(sentMessage.args).toEqual([{ category: 'linear', request: requestPayloadList }]);
      expect(sentMessage.header).toEqual({ 'X-BAPI-TIMESTAMP': '1700000000000', 'X-BAPI-RECV-WINDOW': '7000' });
      expect(typeof sentMessage.reqId).toBe('string');

      capturedOnMessage!({ ...BYBIT_WS_RAW_CREATE_BATCH_RESPONSE, reqId: sentMessage.reqId });

      const result = await promise;

      expect(result).toHaveLength(2);
      expect(result[0].order?.id).toBe('o-1');
      expect(result[0].order?.symbol).toBe('BTCUSDT');
      expect(result[0].order?.type).toBe(OrderTypeEnum.Market);
      expect(result[0].order?.side).toBe(OrderSideEnum.Buy);
      expect(result[1].order?.id).toBe('o-2');
      expect(result[1].order?.symbol).toBe('BTCUSDT');
      expect(result[1].order?.type).toBe(OrderTypeEnum.Limit);
      expect(result[1].order?.side).toBe(OrderSideEnum.Sell);
      expect((stream as any).pendingBatchContextByReqId.size).toBe(0);
    });

    it('rejects on top-level retCode !== 0', async () => {
      await connectStream();

      const originalArgsList: CreateOrderWebSocketArgs[] = [
        { symbol: 'BTCUSDT', type: OrderTypeEnum.Market, side: OrderSideEnum.Buy, amount: 0.001 },
      ];
      const promise = stream.createBatchOrders('linear', originalArgsList, [{ symbol: 'BTCUSDT' }]);

      await jest.advanceTimersByTimeAsync(0);

      const sentMessage = mockWebSocket.sendToConnectedSocket.mock.calls[0][0];
      capturedOnMessage!({
        op: 'order.create-batch',
        reqId: sentMessage.reqId,
        retCode: 110001,
        retMsg: 'Some failure',
      } as BybitBatchTradeMessage);

      await expect(promise).rejects.toThrow('Some failure');
      expect((stream as any).pendingBatchContextByReqId.size).toBe(0);
    });

    it('rejects when WebSocket is not connected', async () => {
      mockWebSocket.getStatus.mockReturnValue(WebSocketStatus.DISCONNECTED);
      await connectStream();
      mockWebSocket.getStatus.mockReturnValue(WebSocketStatus.DISCONNECTED);

      await expect(
        stream.createBatchOrders('linear', [
          { symbol: 'BTCUSDT', type: OrderTypeEnum.Market, side: OrderSideEnum.Buy, amount: 0.001 },
        ], [{ symbol: 'BTCUSDT' }]),
      ).rejects.toThrow('WebSocket is not connected');
      expect((stream as any).pendingBatchContextByReqId.size).toBe(0);
    });

    it('rejects on timeout', async () => {
      await connectStream();

      const promise = stream.createBatchOrders('linear', [
        { symbol: 'BTCUSDT', type: OrderTypeEnum.Market, side: OrderSideEnum.Buy, amount: 0.001 },
      ], [{ symbol: 'BTCUSDT' }]);

      let rejected: Error | undefined;
      promise.catch((error) => { rejected = error; });

      await jest.advanceTimersByTimeAsync(30000);

      expect(rejected).toBeDefined();
      expect(rejected!.message).toContain('Request timeout');
    });
  });

  describe('modifyBatchOrders', () => {
    it('sends order.amend-batch and resolves with per-order results from retExtInfo', async () => {
      await connectStream();

      const originalOrderIdList = ['1', '2'];
      const requestPayloadList = [
        { symbol: 'BTCUSDT', orderId: '1', price: '30000' },
        { symbol: 'BTCUSDT', orderId: '2', price: '30100' },
      ];

      const promise = stream.modifyBatchOrders('linear', originalOrderIdList, requestPayloadList);

      await jest.advanceTimersByTimeAsync(0);

      const sentMessage = mockWebSocket.sendToConnectedSocket.mock.calls[0][0];

      expect(sentMessage.op).toBe('order.amend-batch');
      expect(sentMessage.args).toEqual([{ category: 'linear', request: requestPayloadList }]);
      expect(typeof sentMessage.reqId).toBe('string');

      capturedOnMessage!({ ...BYBIT_WS_RAW_AMEND_BATCH_RESPONSE, reqId: sentMessage.reqId });

      const result = await promise;

      expect(result).toEqual([
        { orderId: '1', isSuccess: true, errorCode: null, errorText: null },
        { orderId: '2', isSuccess: false, errorCode: 110001, errorText: 'Order does not exist' },
      ]);
      expect((stream as any).pendingBatchContextByReqId.size).toBe(0);
    });

    it('falls back to "Unknown error" when retExtInfo entry is missing', async () => {
      await connectStream();

      const promise = stream.modifyBatchOrders('linear', ['1'], [{ symbol: 'BTCUSDT', orderId: '1' }]);

      await jest.advanceTimersByTimeAsync(0);

      const sentMessage = mockWebSocket.sendToConnectedSocket.mock.calls[0][0];
      capturedOnMessage!({
        op: 'order.amend-batch',
        reqId: sentMessage.reqId,
        retCode: 0,
        retMsg: 'OK',
        data: { list: [{ orderId: '1' }] },
      } as BybitBatchTradeMessage);

      const result = await promise;

      expect(result).toEqual([
        { orderId: '1', isSuccess: false, errorCode: null, errorText: 'Unknown error' },
      ]);
    });

    it('rejects when WebSocket is not connected', async () => {
      await connectStream();
      mockWebSocket.getStatus.mockReturnValue(WebSocketStatus.DISCONNECTED);

      await expect(
        stream.modifyBatchOrders('linear', ['1'], [{ symbol: 'BTCUSDT', orderId: '1' }]),
      ).rejects.toThrow('WebSocket is not connected');
      expect((stream as any).pendingBatchContextByReqId.size).toBe(0);
    });

    it('propagates the X-Bapi-Limit header as rateLimit on every item (consumer budget accounting)', async () => {
      await connectStream();

      const promise = stream.modifyBatchOrders('linear', ['1'], [{ symbol: 'BTCUSDT', orderId: '1', price: '30000' }]);

      await jest.advanceTimersByTimeAsync(0);

      const sentMessage = mockWebSocket.sendToConnectedSocket.mock.calls[0][0];
      capturedOnMessage!({
        op: 'order.amend-batch',
        reqId: sentMessage.reqId,
        retCode: 0,
        retMsg: 'OK',
        data: { list: [{ orderId: '1' }] },
        retExtInfo: { list: [{ code: 0, msg: 'OK' }] },
        header: {
          'X-Bapi-Limit': '10',
          'X-Bapi-Limit-Status': '7',
          'X-Bapi-Limit-Reset-Timestamp': '1700000000500',
        },
      } as BybitBatchTradeMessage);

      const result = await promise;

      expect(result[0].rateLimit).toEqual({ limit: 10, remaining: 7, resetMs: 1700000000500 });
    });
  });

  describe('cancelBatchOrders', () => {
    it('sends order.cancel-batch and resolves with per-order results', async () => {
      await connectStream();

      const originalOrderIdList = ['o-1', 'o-2'];
      const requestPayloadList = [
        { category: 'linear', symbol: 'BTCUSDT', orderId: 'o-1' },
        { category: 'linear', symbol: 'BTCUSDT', orderId: 'o-2' },
      ];

      const promise = stream.cancelBatchOrders('linear', originalOrderIdList, requestPayloadList);

      await jest.advanceTimersByTimeAsync(0);

      const sentMessage = mockWebSocket.sendToConnectedSocket.mock.calls[0][0];

      expect(sentMessage.op).toBe('order.cancel-batch');
      expect(sentMessage.args).toEqual([{ category: 'linear', request: requestPayloadList }]);

      capturedOnMessage!({ ...BYBIT_WS_RAW_CANCEL_BATCH_RESPONSE, reqId: sentMessage.reqId });

      const result = await promise;

      expect(result).toEqual([
        { orderId: 'o-1', isSuccess: true, errorCode: null, errorText: null },
        { orderId: 'o-2', isSuccess: false, errorCode: 110001, errorText: 'Order does not exist' },
      ]);
      expect((stream as any).pendingBatchContextByReqId.size).toBe(0);
    });

    it('rejects on top-level retCode !== 0', async () => {
      await connectStream();

      const promise = stream.cancelBatchOrders('linear', ['o-1'], [{ symbol: 'BTCUSDT', orderId: 'o-1' }]);

      await jest.advanceTimersByTimeAsync(0);

      const sentMessage = mockWebSocket.sendToConnectedSocket.mock.calls[0][0];
      capturedOnMessage!({
        op: 'order.cancel-batch',
        reqId: sentMessage.reqId,
        retCode: 10001,
        retMsg: 'Top-level failure',
      } as BybitBatchTradeMessage);

      await expect(promise).rejects.toThrow('Top-level failure');
      expect((stream as any).pendingBatchContextByReqId.size).toBe(0);
    });

    it('propagates the X-Bapi-Limit header as rateLimit on every item (consumer budget accounting)', async () => {
      await connectStream();

      const promise = stream.cancelBatchOrders('linear', ['o-1'], [{ category: 'linear', symbol: 'BTCUSDT', orderId: 'o-1' }]);

      await jest.advanceTimersByTimeAsync(0);

      const sentMessage = mockWebSocket.sendToConnectedSocket.mock.calls[0][0];
      capturedOnMessage!({
        op: 'order.cancel-batch',
        reqId: sentMessage.reqId,
        retCode: 0,
        retMsg: 'OK',
        data: { list: [{ orderId: 'o-1' }] },
        retExtInfo: { list: [{ code: 0, msg: 'OK' }] },
        header: {
          'X-Bapi-Limit': '10',
          'X-Bapi-Limit-Status': '6',
          'X-Bapi-Limit-Reset-Timestamp': '1700000000700',
        },
      } as BybitBatchTradeMessage);

      const result = await promise;

      expect(result[0].rateLimit).toEqual({ limit: 10, remaining: 6, resetMs: 1700000000700 });
    });
  });

  describe('handleMessage routing', () => {
    it('ignores auth messages', async () => {
      await connectStream();

      capturedOnMessage!({ op: 'auth', success: true } as BybitTradeAnyMessage);

      expect((stream as any).pendingRequestByRequestId.size).toBe(0);
    });

    it('ignores order.create-batch without reqId', async () => {
      await connectStream();

      capturedOnMessage!({ op: 'order.create-batch', retCode: 0 } as BybitBatchTradeMessage);

      expect((stream as any).pendingRequestByRequestId.size).toBe(0);
    });

    it('ignores unknown ops', async () => {
      await connectStream();

      capturedOnMessage!({ op: 'order.unknown', reqId: 'something' } as BybitTradeAnyMessage);

      expect((stream as any).pendingRequestByRequestId.size).toBe(0);
    });

    it('cleans up batch context when no pending request matches reqId', async () => {
      await connectStream();

      (stream as any).pendingBatchContextByReqId.set('orphan-req', { kind: 'create', originalArgsList: [] });

      capturedOnMessage!({
        op: 'order.create-batch',
        reqId: 'orphan-req',
        retCode: 0,
      } as BybitBatchTradeMessage);

      expect((stream as any).pendingBatchContextByReqId.size).toBe(0);
    });
  });

  describe('kind mismatch protection', () => {
    it('rejects amend-batch response if pending kind is CreateBatch', async () => {
      await connectStream();

      const promise = stream.createBatchOrders('linear', [
        { symbol: 'BTCUSDT', type: OrderTypeEnum.Market, side: OrderSideEnum.Buy, amount: 0.001 },
      ], [{ symbol: 'BTCUSDT' }]);

      await jest.advanceTimersByTimeAsync(0);

      const sentMessage = mockWebSocket.sendToConnectedSocket.mock.calls[0][0];
      capturedOnMessage!({
        op: 'order.amend-batch',
        reqId: sentMessage.reqId,
        retCode: 0,
        retMsg: 'OK',
      } as BybitBatchTradeMessage);

      await expect(promise).rejects.toThrow('Unexpected pending kind for amend-batch response');
    });

    it('rejects create-batch response if pending kind is SingleOrder', async () => {
      await connectStream();

      const pending = {
        kind: PendingRequestKind.SingleOrder,
        resolve: jest.fn(),
        reject: jest.fn(),
        timeout: setTimeout(() => {}, 30000),
      };
      (stream as any).pendingRequestByRequestId.set('forced-req', pending);

      capturedOnMessage!({
        op: 'order.create-batch',
        reqId: 'forced-req',
        retCode: 0,
      } as BybitBatchTradeMessage);

      expect(pending.reject).toHaveBeenCalled();
      expect((pending.reject as jest.Mock).mock.calls[0][0].message).toContain('Unexpected pending kind for create-batch response');
    });
  });
});
