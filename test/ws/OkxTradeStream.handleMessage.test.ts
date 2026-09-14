import { WebSocketStatus } from '@solncebro/websocket-engine';

import { OkxTradeStream } from '../../src/ws/OkxTradeStream';
import { PendingRequestKind } from '../../src/ws/BaseTradeStream.types';
import { ExchangeError } from '../../src/errors/ExchangeError';
import { MISSING_ORDER_ID_ERROR_TEXT } from '../../src/normalizers/batchOrderOutcome';
import { createMockLogger } from '../fixtures/mockLogger';
import { createOkxSwapSymbolMap } from '../fixtures/okxSymbolMap';

jest.mock('@solncebro/websocket-engine', () => {
  const actual = jest.requireActual('@solncebro/websocket-engine');

  return {
    ...actual,
    ReliableWebSocket: jest.fn().mockImplementation(() => ({
      getStatus: jest.fn().mockReturnValue(actual.WebSocketStatus.CONNECTED),
      close: jest.fn(),
      sendToConnectedSocket: jest.fn(),
    })),
  };
});

jest.mock('../../src/ws/okxWebSocketAuth', () => ({
  authenticateOkxWebSocket: jest.fn().mockResolvedValue(undefined),
}));

describe('OkxTradeStream.handleMessage', () => {
  const mockLogger = createMockLogger();
  const url = 'wss://ws.okx.com:8443/ws/v5/private';
  const label = '[OKX] Trade stream';
  const apiKey = 'testApiKey';
  const secret = 'testSecret';
  const passphrase = 'testPassphrase';

  let stream: OkxTradeStream;

  beforeEach(() => {
    jest.useFakeTimers();
    stream = new OkxTradeStream({ url, label, logger: mockLogger, apiKey, secret, passphrase, symbolMap: createOkxSwapSymbolMap() });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  function addPendingRequest(requestId: string, kind: PendingRequestKind = PendingRequestKind.SingleOrder) {
    const resolveFn = jest.fn();
    const rejectFn = jest.fn();
    const timeout = setTimeout(() => {}, 30000);

    (stream as any).pendingRequestByRequestId.set(requestId, {
      kind,
      resolve: resolveFn,
      reject: rejectFn,
      timeout,
    });

    return { resolveFn, rejectFn };
  }

  it('resolves with a minimal Order on order success', () => {
    const requestId = 'req-1';
    const { resolveFn } = addPendingRequest(requestId, PendingRequestKind.SingleOrder);

    (stream as any).handleMessage({
      id: requestId,
      op: 'order',
      code: '0',
      msg: '',
      data: [{ ordId: 'ord-1', clOrdId: 'client-1', tag: '', ts: '1700000000000', sCode: '0', sMsg: '' }],
    });

    expect(resolveFn).toHaveBeenCalledWith(expect.objectContaining({
      id: 'ord-1',
      clientOrderId: 'client-1',
      status: 'open',
    }));
    expect((stream as any).pendingRequestByRequestId.has(requestId)).toBe(false);
  });

  it('rejects with ExchangeError carrying the item sCode on order failure (code "1")', () => {
    const requestId = 'req-2';
    const { rejectFn } = addPendingRequest(requestId, PendingRequestKind.SingleOrder);

    (stream as any).handleMessage({
      id: requestId,
      op: 'order',
      code: '1',
      msg: 'Operation failed.',
      data: [{ ordId: '', clOrdId: '', tag: '', ts: '1700000000000', sCode: '51008', sMsg: 'Order failed. Insufficient balance.' }],
    });

    expect(rejectFn).toHaveBeenCalledWith(expect.any(ExchangeError));
    expect(rejectFn.mock.calls[0][0].code).toBe(51008);
  });

  it('rejects with ExchangeError carrying the top-level code when data is absent (code "60013")', () => {
    const requestId = 'req-3';
    const { rejectFn } = addPendingRequest(requestId, PendingRequestKind.SingleOrder);

    (stream as any).handleMessage({
      id: requestId,
      op: 'order',
      code: '60013',
      msg: 'Invalid sign.',
      data: [],
    });

    expect(rejectFn).toHaveBeenCalledWith(expect.any(ExchangeError));
    expect(rejectFn.mock.calls[0][0].code).toBe(60013);
  });

  it('resolves cancel-order with the raw result item', () => {
    const requestId = 'req-4';
    const { resolveFn } = addPendingRequest(requestId, PendingRequestKind.SingleCancel);
    const item = { ordId: 'ord-1', clOrdId: 'client-1', tag: '', ts: '1700000000000', sCode: '0', sMsg: '' };

    (stream as any).handleMessage({ id: requestId, op: 'cancel-order', code: '0', msg: '', data: [item] });

    expect(resolveFn).toHaveBeenCalledWith(item);
  });

  it('resolves amend-order with the raw result item', () => {
    const requestId = 'req-5';
    const { resolveFn } = addPendingRequest(requestId, PendingRequestKind.SingleAmend);
    const item = { ordId: 'ord-2', clOrdId: 'client-2', tag: '', ts: '1700000000000', sCode: '0', sMsg: '' };

    (stream as any).handleMessage({ id: requestId, op: 'amend-order', code: '0', msg: '', data: [item] });

    expect(resolveFn).toHaveBeenCalledWith(item);
  });

  it('rejects when the pending kind does not match the response op', () => {
    const requestId = 'req-6';
    const { rejectFn } = addPendingRequest(requestId, PendingRequestKind.CreateBatch);

    (stream as any).handleMessage({ id: requestId, op: 'order', code: '0', msg: '', data: [] });

    expect(rejectFn).toHaveBeenCalledWith(expect.any(ExchangeError));
    expect(rejectFn.mock.calls[0][0].message).toContain("Unexpected pending kind for OKX 'order' response");
  });

  it('warns on an orphan response with no matching pending request', () => {
    (stream as any).handleMessage({ id: 'unknown-req', op: 'order', code: '0', msg: '', data: [] });

    expect(mockLogger.warn).toHaveBeenCalled();
  });

  it('marks the order channel unusable when the exchange complains about instIdCode', () => {
    const requestId = 'req-7';
    addPendingRequest(requestId, PendingRequestKind.SingleOrder);

    expect(stream.isOrderChannelUsable()).toBe(true);

    (stream as any).handleMessage({
      id: requestId,
      op: 'order',
      code: '51000',
      msg: 'Parameter instIdCode error',
      data: [],
    });

    expect(stream.isOrderChannelUsable()).toBe(false);
    expect(mockLogger.error).toHaveBeenCalled();
  });

  it('ignores service frames without id (pong/login/error)', () => {
    const { resolveFn, rejectFn } = addPendingRequest('some-req');

    (stream as any).handleMessage({ event: 'pong' });
    (stream as any).handleMessage({ event: 'login', code: '0', msg: '' });
    (stream as any).handleMessage({ event: 'error', code: '60009', msg: 'Login failed.' });

    expect(resolveFn).not.toHaveBeenCalled();
    expect(rejectFn).not.toHaveBeenCalled();
    expect(mockLogger.error).toHaveBeenCalledTimes(1);
  });

  it('rejects instead of hanging forever when the response has no data field at all', () => {
    const requestId = 'req-nodata';
    const { rejectFn } = addPendingRequest(requestId, PendingRequestKind.SingleOrder);

    (stream as any).handleMessage({ id: requestId, op: 'order', code: '60013', msg: 'Invalid sign.' });

    expect(rejectFn).toHaveBeenCalledWith(expect.any(ExchangeError));
    expect(rejectFn.mock.calls[0][0].code).toBe(60013);
  });

  it('marks every create-batch entry as failed when a batch response has no data field at all', () => {
    const requestId = 'req-batch-nodata';
    const { resolveFn, rejectFn } = addPendingRequest(requestId, PendingRequestKind.CreateBatch);
    (stream as any).pendingBatchContextByReqId.set(requestId, {
      kind: 'create',
      originalArgsList: [{ symbol: 'BTCUSDT' }, { symbol: 'ETHUSDT' }],
      sentAmountList: [1, 2],
    });

    (stream as any).handleMessage({ id: requestId, op: 'batch-orders', code: '1', msg: '' });

    expect(rejectFn).not.toHaveBeenCalled();
    expect(resolveFn).toHaveBeenCalledTimes(1);

    const resultList = resolveFn.mock.calls[0][0];

    expect(resultList).toHaveLength(2);
    expect(resultList.every((result: any) => result.isSuccess === false)).toBe(true);
    expect(resultList.every((result: any) => result.errorText === 'OKX returned no result for this batch entry')).toBe(true);
    expect((stream as any).pendingRequestByRequestId.has(requestId)).toBe(false);
  });

  it('marks every cancel-batch entry as failed when a batch response has no data field at all', () => {
    const requestId = 'req-cancel-batch-nodata';
    const { resolveFn, rejectFn } = addPendingRequest(requestId, PendingRequestKind.CancelBatch);
    (stream as any).pendingBatchContextByReqId.set(requestId, {
      kind: 'cancel',
      originalOrderIdList: ['o-1', 'o-2'],
    });

    (stream as any).handleMessage({ id: requestId, op: 'batch-cancel-orders', code: '1', msg: '' });

    expect(rejectFn).not.toHaveBeenCalled();
    expect(resolveFn).toHaveBeenCalledWith([
      { orderId: 'o-1', isSuccess: false, errorCode: null, errorText: 'OKX returned no result for this batch entry' },
      { orderId: 'o-2', isSuccess: false, errorCode: null, errorText: 'OKX returned no result for this batch entry' },
    ]);
  });

  it('rejects the pending request when response parsing throws instead of leaving it hanging', () => {
    const requestId = 'req-parse-throw';
    const { rejectFn } = addPendingRequest(requestId, PendingRequestKind.CreateBatch);
    (stream as any).pendingBatchContextByReqId.set(requestId, { kind: 'create', originalArgsList: [{ symbol: 'BTCUSDT' }] });

    const routeSpy = jest
      .spyOn(OkxTradeStream.prototype as any, 'routePendingResponse')
      .mockImplementation(() => {
        throw new Error('broken response parsing');
      });

    (stream as any).handleMessage({ id: requestId, op: 'batch-orders', code: '1', msg: '', data: [] });

    expect(rejectFn).toHaveBeenCalledWith(expect.any(Error));
    expect(rejectFn.mock.calls[0][0].message).toBe('broken response parsing');
    expect((stream as any).pendingRequestByRequestId.has(requestId)).toBe(false);
    expect((stream as any).pendingBatchContextByReqId.size).toBe(0);

    routeSpy.mockRestore();
  });

  it('rejects the pending request when the response is an error frame carrying only id/event/code/msg (no op)', () => {
    const requestId = 'req-error-frame';
    const { rejectFn } = addPendingRequest(requestId, PendingRequestKind.SingleOrder);

    (stream as any).handleMessage({ id: requestId, event: 'error', code: '60012', msg: 'Invalid request: ...' });

    expect(rejectFn).toHaveBeenCalledWith(expect.any(ExchangeError));
    expect(rejectFn.mock.calls[0][0].code).toBe(60012);
    expect(rejectFn.mock.calls[0][0].message).toBe('Invalid request: ...');
  });

  it('keeps a non-numeric error code as a string instead of turning it into NaN', () => {
    const requestId = 'req-nonnumeric-code';
    const { rejectFn } = addPendingRequest(requestId, PendingRequestKind.SingleOrder);

    (stream as any).handleMessage({ id: requestId, event: 'error', code: 'CONN_LIMIT', msg: 'Connection limit reached' });

    expect(rejectFn.mock.calls[0][0].code).toBe('CONN_LIMIT');
  });

  it('keeps a non-numeric item error code as a string on a failed single order', () => {
    const requestId = 'req-nonnumeric-scode';
    const { rejectFn } = addPendingRequest(requestId, PendingRequestKind.SingleOrder);

    (stream as any).handleMessage({
      id: requestId,
      op: 'order',
      code: '1',
      msg: 'Operation failed.',
      data: [{ ordId: '', clOrdId: '', tag: '', ts: '1700000000000', sCode: 'NOT_A_NUMBER', sMsg: 'Broken code' }],
    });

    expect(rejectFn.mock.calls[0][0].code).toBe('NOT_A_NUMBER');
  });

  it('keeps a non-numeric top-level batch error code as a string', () => {
    const requestId = 'req-nonnumeric-batch-code';
    const { rejectFn } = addPendingRequest(requestId, PendingRequestKind.CancelBatch);
    (stream as any).pendingBatchContextByReqId.set(requestId, { kind: 'cancel', originalOrderIdList: ['o-1'] });

    (stream as any).handleMessage({ id: requestId, op: 'batch-cancel-orders', code: 'BROKEN', msg: 'Broken code', data: [] });

    expect(rejectFn.mock.calls[0][0].code).toBe('BROKEN');
  });

  it('rejects when the exchange confirms success but returns an empty order id', () => {
    const requestId = 'req-empty-ordid';
    const { rejectFn } = addPendingRequest(requestId, PendingRequestKind.SingleOrder);

    (stream as any).handleMessage({
      id: requestId,
      op: 'order',
      code: '0',
      msg: '',
      data: [{ ordId: '', clOrdId: 'client-1', tag: '', ts: '1700000000000', sCode: '0', sMsg: '' }],
    });

    expect(rejectFn).toHaveBeenCalledWith(expect.any(ExchangeError));
    expect(rejectFn.mock.calls[0][0].code).toBe('OKX_EMPTY_ORDER_ID');
    expect(rejectFn.mock.calls[0][0].message).toBe(MISSING_ORDER_ID_ERROR_TEXT);
  });

  it('reports the order channel unusable only once across repeated instIdCode failures', () => {
    const requestId1 = 'req-once-1';
    const requestId2 = 'req-once-2';
    addPendingRequest(requestId1, PendingRequestKind.SingleOrder);
    addPendingRequest(requestId2, PendingRequestKind.SingleOrder);

    (stream as any).handleMessage({ id: requestId1, op: 'order', code: '51000', msg: 'Parameter instIdCode error', data: [] });
    (stream as any).handleMessage({ id: requestId2, op: 'order', code: '51000', msg: 'Parameter instIdCode error', data: [] });

    expect(mockLogger.error).toHaveBeenCalledTimes(1);
  });

  it('rejects the pending order request after a 30s timeout', async () => {
    (stream as any).webSocket = {
      getStatus: () => WebSocketStatus.CONNECTED,
      sendToConnectedSocket: jest.fn(),
      close: jest.fn(),
    };

    let rejected: Error | undefined;
    stream.createOrder({ instId: 'BTC-USDT-SWAP' }).catch((error) => { rejected = error; });

    await jest.advanceTimersByTimeAsync(30000);

    expect(rejected).toBeDefined();
    expect(rejected!.message).toContain('Request timeout');
  });
  it('rejects with the exchange error even when the response carries no sMsg field', () => {
    const requestId = 'req-no-smsg';
    const { rejectFn } = addPendingRequest(requestId, PendingRequestKind.SingleOrder);

    (stream as any).handleMessage({
      id: requestId,
      op: 'order',
      code: '1',
      data: [{ ordId: '', clOrdId: '', sCode: '51000' }],
    });

    const error = rejectFn.mock.calls[0][0];

    expect(error).toBeInstanceOf(ExchangeError);
    expect((error as ExchangeError).code).toBe(51000);
  });

  it('rejects with the exchange error even when the response carries no code or msg at all', () => {
    const requestId = 'req-no-code';
    const { rejectFn } = addPendingRequest(requestId, PendingRequestKind.SingleOrder);

    (stream as any).handleMessage({ id: requestId, op: 'order', data: [] });

    const error = rejectFn.mock.calls[0][0];

    expect(error).toBeInstanceOf(ExchangeError);
  });
});
