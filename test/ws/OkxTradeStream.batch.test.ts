import { WebSocketStatus } from '@solncebro/websocket-engine';

import { OkxTradeStream } from '../../src/ws/OkxTradeStream';
import { OrderSideEnum, OrderTypeEnum } from '../../src/types/common';
import type { CreateOrderWebSocketArgs } from '../../src/types/exchange';
import { createMockLogger } from '../fixtures/mockLogger';
import { createOkxSwapSymbolMap, OKX_BTC_SWAP_INST_ID_CODE } from '../fixtures/okxSymbolMap';

let capturedOnMessage: ((message: any) => void) | undefined;
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

jest.mock('../../src/ws/okxWebSocketAuth', () => ({
  authenticateOkxWebSocket: jest.fn().mockResolvedValue(undefined),
}));

describe('OkxTradeStream batch operations', () => {
  const mockLogger = createMockLogger();
  const url = 'wss://ws.okx.com:8443/ws/v5/private';
  const label = '[OKX] Trade stream';
  const apiKey = 'testApiKey';
  const secret = 'testSecret';
  const passphrase = 'testPassphrase';

  let stream: OkxTradeStream;

  async function connectStream(): Promise<void> {
    const connectPromise = stream.connect();
    const mockContext = { send: jest.fn(), waitForMessage: jest.fn().mockResolvedValue(undefined) };
    await capturedOnOpen!(mockContext);
    await connectPromise;
  }

  beforeEach(() => {
    jest.useFakeTimers();
    mockWebSocket.getStatus.mockReturnValue(WebSocketStatus.CONNECTED);
    mockWebSocket.sendToConnectedSocket.mockClear();
    capturedOnMessage = undefined;
    capturedOnOpen = undefined;
    stream = new OkxTradeStream({ url, label, logger: mockLogger, apiKey, secret, passphrase, symbolMap: createOkxSwapSymbolMap() });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  describe('createBatchOrders', () => {
    it('sends batch-orders request and resolves per-order outcomes on partial success (code "2")', async () => {
      await connectStream();

      const originalArgsList: CreateOrderWebSocketArgs[] = [
        { symbol: 'BTCUSDT', type: OrderTypeEnum.Market, side: OrderSideEnum.Buy, amount: 0.001 },
        { symbol: 'BTCUSDT', type: OrderTypeEnum.Limit, side: OrderSideEnum.Sell, amount: 0.002, price: 30000 },
      ];
      const requestPayloadList = [
        { instId: 'BTC-USDT-SWAP', side: 'buy', ordType: 'market', sz: '0.001' },
        { instId: 'BTC-USDT-SWAP', side: 'sell', ordType: 'limit', sz: '0.002', px: '30000' },
      ];

      const promise = stream.createBatchOrders(originalArgsList, requestPayloadList, [0.001, 0.002]);
      await jest.advanceTimersByTimeAsync(0);

      const sentMessage = mockWebSocket.sendToConnectedSocket.mock.calls[0][0];

      expect(sentMessage.op).toBe('batch-orders');
      expect(sentMessage.args).toEqual([
        { instIdCode: OKX_BTC_SWAP_INST_ID_CODE, side: 'buy', ordType: 'market', sz: '0.001' },
        { instIdCode: OKX_BTC_SWAP_INST_ID_CODE, side: 'sell', ordType: 'limit', sz: '0.002', px: '30000' },
      ]);
      expect(typeof sentMessage.id).toBe('string');

      capturedOnMessage!({
        id: sentMessage.id,
        op: 'batch-orders',
        code: '2',
        msg: '',
        data: [
          { ordId: 'o-1', clOrdId: '', tag: '', ts: '1700000000000', sCode: '0', sMsg: '' },
          { ordId: '', clOrdId: '', tag: '', ts: '1700000000000', sCode: '51008', sMsg: 'Insufficient balance' },
        ],
      });

      const result = await promise;

      expect(result).toHaveLength(2);
      expect(result[0].isSuccess).toBe(true);
      expect(result[0].order?.id).toBe('o-1');
      expect(result[0].order?.symbol).toBe('BTCUSDT');
      expect(result[1].isSuccess).toBe(false);
      expect(result[1].errorCode).toBe(51008);
      expect(result[1].errorText).toBe('Insufficient balance');
      expect((stream as any).pendingBatchContextByReqId.size).toBe(0);
    });

    it('treats a missing response element as a rejected order', async () => {
      await connectStream();

      const originalArgsList: CreateOrderWebSocketArgs[] = [
        { symbol: 'BTCUSDT', type: OrderTypeEnum.Market, side: OrderSideEnum.Buy, amount: 0.001 },
      ];
      const promise = stream.createBatchOrders(originalArgsList, [{ instId: 'BTC-USDT-SWAP' }], [0.001]);
      await jest.advanceTimersByTimeAsync(0);

      const sentMessage = mockWebSocket.sendToConnectedSocket.mock.calls[0][0];
      capturedOnMessage!({ id: sentMessage.id, op: 'batch-orders', code: '1', msg: '', data: [] });

      const result = await promise;

      expect(result).toHaveLength(1);
      expect(result[0].isSuccess).toBe(false);
      expect(result[0].errorText).toBe('OKX returned no result for this batch entry');
    });

    it('rejects entirely and clears the batch context on an unexpected top-level code (rate limit 50011)', async () => {
      await connectStream();

      const promise = stream.createBatchOrders(
        [{ symbol: 'BTCUSDT', type: OrderTypeEnum.Market, side: OrderSideEnum.Buy, amount: 0.001 }],
        [{ instId: 'BTC-USDT-SWAP' }],
        [0.001],
      );
      await jest.advanceTimersByTimeAsync(0);

      const sentMessage = mockWebSocket.sendToConnectedSocket.mock.calls[0][0];
      capturedOnMessage!({ id: sentMessage.id, op: 'batch-orders', code: '50011', msg: 'Too Many Requests', data: [] });

      await expect(promise).rejects.toThrow('Too Many Requests');
      expect((stream as any).pendingBatchContextByReqId.size).toBe(0);
    });

    it('marks the order channel unusable when every batch element is rejected for instIdCode', async () => {
      await connectStream();

      const promise = stream.createBatchOrders(
        [{ symbol: 'BTCUSDT', type: OrderTypeEnum.Market, side: OrderSideEnum.Buy, amount: 0.001 }],
        [{ instId: 'BTC-USDT-SWAP' }],
        [0.001],
      );
      await jest.advanceTimersByTimeAsync(0);

      const sentMessage = mockWebSocket.sendToConnectedSocket.mock.calls[0][0];
      capturedOnMessage!({
        id: sentMessage.id,
        op: 'batch-orders',
        code: '1',
        msg: '',
        data: [{ ordId: '', clOrdId: '', tag: '', ts: '1700000000000', sCode: '51000', sMsg: 'Parameter instIdCode error' }],
      });

      await promise;

      expect(stream.isOrderChannelUsable()).toBe(false);
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('does not mark the order channel unusable when only some batch elements are rejected for instIdCode', async () => {
      await connectStream();

      const promise = stream.createBatchOrders(
        [
          { symbol: 'BTCUSDT', type: OrderTypeEnum.Market, side: OrderSideEnum.Buy, amount: 0.001 },
          { symbol: 'BTCUSDT', type: OrderTypeEnum.Market, side: OrderSideEnum.Buy, amount: 0.001 },
        ],
        [{ instId: 'BTC-USDT-SWAP' }, { instId: 'BTC-USDT-SWAP' }],
        [0.001, 0.001],
      );
      await jest.advanceTimersByTimeAsync(0);

      const sentMessage = mockWebSocket.sendToConnectedSocket.mock.calls[0][0];
      capturedOnMessage!({
        id: sentMessage.id,
        op: 'batch-orders',
        code: '2',
        msg: '',
        data: [
          { ordId: 'o-1', clOrdId: '', tag: '', ts: '1700000000000', sCode: '0', sMsg: '' },
          { ordId: '', clOrdId: '', tag: '', ts: '1700000000000', sCode: '51000', sMsg: 'Parameter instIdCode error' },
        ],
      });

      await promise;

      expect(stream.isOrderChannelUsable()).toBe(true);
    });
  });

  describe('modifyBatchOrders', () => {
    it('sends batch-amend-orders request and resolves per-order results', async () => {
      await connectStream();

      const originalOrderIdList = ['1', '2'];
      const requestPayloadList = [
        { instId: 'BTC-USDT-SWAP', ordId: '1', newPx: '30000' },
        { instId: 'BTC-USDT-SWAP', ordId: '2', newPx: '30100' },
      ];

      const promise = stream.modifyBatchOrders(originalOrderIdList, requestPayloadList);
      await jest.advanceTimersByTimeAsync(0);

      const sentMessage = mockWebSocket.sendToConnectedSocket.mock.calls[0][0];

      expect(sentMessage.op).toBe('batch-amend-orders');
      expect(sentMessage.args).toEqual([
        { instIdCode: OKX_BTC_SWAP_INST_ID_CODE, ordId: '1', newPx: '30000' },
        { instIdCode: OKX_BTC_SWAP_INST_ID_CODE, ordId: '2', newPx: '30100' },
      ]);

      capturedOnMessage!({
        id: sentMessage.id,
        op: 'batch-amend-orders',
        code: '2',
        msg: '',
        data: [
          { ordId: '1', clOrdId: '', tag: '', ts: '1700000000000', sCode: '0', sMsg: '' },
          { ordId: '2', clOrdId: '', tag: '', ts: '1700000000000', sCode: '51503', sMsg: 'Order does not exist' },
        ],
      });

      const result = await promise;

      expect(result).toEqual([
        { orderId: '1', isSuccess: true, errorCode: null, errorText: null },
        { orderId: '2', isSuccess: false, errorCode: 51503, errorText: 'Order does not exist' },
      ]);
      expect((stream as any).pendingBatchContextByReqId.size).toBe(0);
    });

    it('falls back to a missing-entry error text when the response element is absent', async () => {
      await connectStream();

      const promise = stream.modifyBatchOrders(['1'], [{ instId: 'BTC-USDT-SWAP', ordId: '1' }]);
      await jest.advanceTimersByTimeAsync(0);

      const sentMessage = mockWebSocket.sendToConnectedSocket.mock.calls[0][0];
      capturedOnMessage!({ id: sentMessage.id, op: 'batch-amend-orders', code: '1', msg: '', data: [] });

      const result = await promise;

      expect(result).toEqual([
        { orderId: '1', isSuccess: false, errorCode: null, errorText: 'OKX returned no result for this batch entry' },
      ]);
    });
  });

  describe('cancelBatchOrders', () => {
    it('sends batch-cancel-orders request and resolves per-order results', async () => {
      await connectStream();

      const originalOrderIdList = ['o-1', 'o-2'];
      const requestPayloadList = [
        { instId: 'BTC-USDT-SWAP', ordId: 'o-1' },
        { instId: 'BTC-USDT-SWAP', ordId: 'o-2' },
      ];

      const promise = stream.cancelBatchOrders(originalOrderIdList, requestPayloadList);
      await jest.advanceTimersByTimeAsync(0);

      const sentMessage = mockWebSocket.sendToConnectedSocket.mock.calls[0][0];

      expect(sentMessage.op).toBe('batch-cancel-orders');
      expect(sentMessage.args).toEqual([
        { instIdCode: OKX_BTC_SWAP_INST_ID_CODE, ordId: 'o-1' },
        { instIdCode: OKX_BTC_SWAP_INST_ID_CODE, ordId: 'o-2' },
      ]);

      capturedOnMessage!({
        id: sentMessage.id,
        op: 'batch-cancel-orders',
        code: '2',
        msg: '',
        data: [
          { ordId: 'o-1', clOrdId: '', tag: '', ts: '1700000000000', sCode: '0', sMsg: '' },
          { ordId: 'o-2', clOrdId: '', tag: '', ts: '1700000000000', sCode: '51400', sMsg: 'Cancellation failed as the order does not exist' },
        ],
      });

      const result = await promise;

      expect(result).toEqual([
        { orderId: 'o-1', isSuccess: true, errorCode: null, errorText: null },
        { orderId: 'o-2', isSuccess: false, errorCode: 51400, errorText: 'Cancellation failed as the order does not exist' },
      ]);
      expect((stream as any).pendingBatchContextByReqId.size).toBe(0);
    });

    it('rejects entirely and clears the batch context on an unexpected top-level code (rate limit 50011)', async () => {
      await connectStream();

      const promise = stream.cancelBatchOrders(['o-1'], [{ instId: 'BTC-USDT-SWAP', ordId: 'o-1' }]);
      await jest.advanceTimersByTimeAsync(0);

      const sentMessage = mockWebSocket.sendToConnectedSocket.mock.calls[0][0];
      capturedOnMessage!({ id: sentMessage.id, op: 'batch-cancel-orders', code: '50011', msg: 'Too Many Requests', data: [] });

      await expect(promise).rejects.toThrow('Too Many Requests');
      expect((stream as any).pendingBatchContextByReqId.size).toBe(0);
    });
  });
});
