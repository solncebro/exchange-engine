import type { WebSocketOpenContext } from '@solncebro/websocket-engine';
import { ReliableWebSocket } from '@solncebro/websocket-engine';

import { ExchangeError } from '../errors/ExchangeError';
import { buildBybitCreateOutcome } from '../normalizers/bybitNormalizer';
import type { OrderRateLimitSnapshot } from '../types/common';
import { OrderSideEnum, OrderTypeEnum, TimeInForceEnum } from '../types/common';
import type {
  CancelBatchOrdersResult,
  CancelOrderItemResult,
  CreateBatchOrdersResult,
  CreateOrderWebSocketArgs,
  ModifyBatchOrdersResult,
  ModifyOrderItemResult,
} from '../types/exchange';
import { BaseTradeStream } from './BaseTradeStream';
import { PendingRequestKind } from './BaseTradeStream.types';
import type {
  BybitBatchOrderExtInfo,
  BybitBatchTradeMessage,
  BybitTradeAnyMessage,
  BybitTradeMessage,
  BybitTradeOrderData,
  BybitTradeResponseHeader,
} from './BybitTradeStream.types';
import { authenticateBybitWebSocket } from './bybitWebSocketAuth';
import {
  BYBIT_HEARTBEAT_CONFIG,
  BYBIT_PING_INTERVAL,
} from './bybitWebSocketUtils';
import { parseWebSocketMessage } from './parseWebSocketMessage';

type BybitPendingBatchContext =
  | { kind: 'create'; originalArgsList: CreateOrderWebSocketArgs[] }
  | { kind: 'modify'; originalOrderIdList: string[] }
  | { kind: 'cancel'; originalOrderIdList: string[] };

class BybitTradeStream extends BaseTradeStream<BybitTradeAnyMessage> {
  private pendingBatchContextByReqId: Map<string, BybitPendingBatchContext> = new Map();
  /** Последний предел частоты, названный самой биржей в ответе на заявку. */
  private lastReportedOrderRateLimit: OrderRateLimitSnapshot | null = null;

  getLastReportedOrderRateLimit(): OrderRateLimitSnapshot | null {
    return this.lastReportedOrderRateLimit;
  }

  private rememberOrderRateLimit(snapshot: OrderRateLimitSnapshot | undefined): void {
    if (snapshot !== undefined) {
      this.lastReportedOrderRateLimit = snapshot;
    }
  }

  async createBatchOrders(
    category: string,
    originalArgsList: CreateOrderWebSocketArgs[],
    requestPayloadList: Array<Record<string, unknown>>,
  ): Promise<CreateBatchOrdersResult> {
    await this.ensureConnectedHook();
    const reqId = this.generateReqId();
    const request = {
      op: 'order.create-batch',
      args: [{ category, request: requestPayloadList }],
      header: { 'X-BAPI-TIMESTAMP': String(Date.now()), 'X-BAPI-RECV-WINDOW': '7000' },
      reqId,
    };

    this.pendingBatchContextByReqId.set(reqId, { kind: 'create', originalArgsList });

    try {
      return await this.sendRequest<CreateBatchOrdersResult>(request, reqId, PendingRequestKind.CreateBatch);
    } catch (error) {
      this.pendingBatchContextByReqId.delete(reqId);
      throw error;
    }
  }

  async modifyBatchOrders(
    category: string,
    originalOrderIdList: string[],
    requestPayloadList: Array<Record<string, unknown>>,
  ): Promise<ModifyBatchOrdersResult> {
    await this.ensureConnectedHook();
    const reqId = this.generateReqId();
    const request = {
      op: 'order.amend-batch',
      args: [{ category, request: requestPayloadList }],
      header: { 'X-BAPI-TIMESTAMP': String(Date.now()), 'X-BAPI-RECV-WINDOW': '7000' },
      reqId,
    };

    this.pendingBatchContextByReqId.set(reqId, { kind: 'modify', originalOrderIdList });

    try {
      return await this.sendRequest<ModifyBatchOrdersResult>(request, reqId, PendingRequestKind.ModifyBatch);
    } catch (error) {
      this.pendingBatchContextByReqId.delete(reqId);
      throw error;
    }
  }

  async cancelBatchOrders(
    category: string,
    originalOrderIdList: string[],
    requestPayloadList: Array<Record<string, unknown>>,
  ): Promise<CancelBatchOrdersResult> {
    await this.ensureConnectedHook();
    const reqId = this.generateReqId();
    const request = {
      op: 'order.cancel-batch',
      args: [{ category, request: requestPayloadList }],
      header: { 'X-BAPI-TIMESTAMP': String(Date.now()), 'X-BAPI-RECV-WINDOW': '7000' },
      reqId,
    };

    this.pendingBatchContextByReqId.set(reqId, { kind: 'cancel', originalOrderIdList });

    try {
      return await this.sendRequest<CancelBatchOrdersResult>(request, reqId, PendingRequestKind.CancelBatch);
    } catch (error) {
      this.pendingBatchContextByReqId.delete(reqId);
      throw error;
    }
  }

  protected buildOrderRequest(
    orderParams: Record<string, unknown>,
    requestId: string,
  ): unknown {
    return {
      op: 'order.create',
      args: [{ ...orderParams }],
      header: { 'X-BAPI-TIMESTAMP': String(Date.now()), 'X-BAPI-RECV-WINDOW': '7000' },
      reqId: requestId,
    };
  }

  protected initConnection(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let isResolved = false;

      this.webSocket = new ReliableWebSocket<BybitTradeAnyMessage>({
        label: this.label,
        url: this.url,
        logger: this.logger,
        parseMessage: (rawData) => parseWebSocketMessage<BybitTradeAnyMessage>(rawData),
        onMessage: (message) => this.handleMessage(message),
        onOpen: async (context) => {
          try {
            await this.authenticate(context);
            isResolved = true;
            resolve();
          } catch (error) {
            if (!isResolved) {
              isResolved = true;
              reject(error);
            }
          }
        },
        onNotify: this.onNotify,
        heartbeat: BYBIT_HEARTBEAT_CONFIG,
        configuration: {
          pingInterval: BYBIT_PING_INTERVAL,
        },
      });
    });
  }

  private async authenticate(context: WebSocketOpenContext<BybitTradeAnyMessage>): Promise<void> {
    await authenticateBybitWebSocket({
      context,
      apiKey: this.apiKey,
      secret: this.secret,
      label: this.label,
      logger: this.logger,
    });
  }

  private handleMessage(message: BybitTradeAnyMessage): void {
    if (message.op === 'auth') {
      return;
    }

    if (message.op === 'order.create' && message.reqId) {
      this.handleSingleOrderResponse(message as BybitTradeMessage);

      return;
    }

    if (message.op === 'order.create-batch' && message.reqId) {
      this.handleCreateBatchResponse(message as BybitBatchTradeMessage);

      return;
    }

    if (message.op === 'order.amend-batch' && message.reqId) {
      this.handleAmendBatchResponse(message as BybitBatchTradeMessage);

      return;
    }

    if (message.op === 'order.cancel-batch' && message.reqId) {
      this.handleCancelBatchResponse(message as BybitBatchTradeMessage);

      return;
    }
  }

  private handleSingleOrderResponse(message: BybitTradeMessage): void {
    if (!message.reqId) {
      return;
    }

    this.logger.info({ rawMessage: message }, '[Bybit] Order response received');

    const pending = this.takePendingRequest(message.reqId);

    if (!pending) {
      return;
    }

    if (pending.kind !== PendingRequestKind.SingleOrder) {
      pending.reject(new ExchangeError(
        'Unexpected pending kind for Bybit single-order response',
        message.retCode ?? 'UNKNOWN',
        'bybit',
      ));

      return;
    }

    if ((message.success || message.retCode === 0) && message.data) {
      const data = message.data as BybitTradeOrderData;
      pending.resolve({
        id: data.orderId,
        clientOrderId: data.orderLinkId ?? '',
        symbol: '',
        side: OrderSideEnum.Buy,
        type: OrderTypeEnum.Market,
        timeInForce: TimeInForceEnum.Gtc,
        price: 0,
        avgPrice: 0,
        stopPrice: 0,
        amount: 0,
        filledAmount: 0,
        filledQuoteAmount: 0,
        status: 'open',
        reduceOnly: false,
        timestamp: Date.now(),
        updatedTimestamp: Date.now(),
        rateLimit: parseBybitHeaderRateLimit(message.header),
      });
    } else {
      pending.reject(new ExchangeError(message.retMsg ?? 'Order creation failed', message.retCode ?? 'UNKNOWN', 'bybit'));
    }
  }

  private handleCreateBatchResponse(message: BybitBatchTradeMessage): void {
    const reqId = message.reqId;

    if (!reqId) {
      return;
    }

    this.logger.info({ rawMessage: message }, '[Bybit] Create batch response received');

    const pending = this.takePendingRequest(reqId);

    if (!pending) {
      this.pendingBatchContextByReqId.delete(reqId);

      return;
    }

    if (pending.kind !== PendingRequestKind.CreateBatch) {
      this.pendingBatchContextByReqId.delete(reqId);
      pending.reject(new ExchangeError(
        'Unexpected pending kind for create-batch response',
        message.retCode ?? 'UNKNOWN',
        'bybit',
      ));

      return;
    }

    const context = this.pendingBatchContextByReqId.get(reqId);
    this.pendingBatchContextByReqId.delete(reqId);

    if (!context || context.kind !== 'create') {
      pending.reject(new ExchangeError(
        'Missing batch context for create-batch response',
        'CONTEXT_MISSING',
        'bybit',
      ));

      return;
    }

    if (message.retCode !== 0) {
      pending.reject(new ExchangeError(
        message.retMsg ?? 'Batch create failed',
        message.retCode ?? 'UNKNOWN',
        'bybit',
      ));

      return;
    }

    const itemList = message.data?.list ?? [];
    const extInfoList = message.retExtInfo?.list ?? [];
    const rateLimit = parseBybitHeaderRateLimit(message.header);
    this.rememberOrderRateLimit(rateLimit);
    const resultList: CreateBatchOrdersResult = context.originalArgsList.map((args, index) => {
      const outcome = buildBybitCreateOutcome(args, itemList[index], extInfoList[index]);

      if (rateLimit !== undefined) {
        outcome.rateLimit = rateLimit;
      }

      return outcome;
    });
    pending.resolve(resultList);
  }

  private handleAmendBatchResponse(message: BybitBatchTradeMessage): void {
    const reqId = message.reqId;

    if (!reqId) {
      return;
    }

    this.logger.info({ rawMessage: message }, '[Bybit] Amend batch response received');

    const pending = this.takePendingRequest(reqId);

    if (!pending) {
      this.pendingBatchContextByReqId.delete(reqId);

      return;
    }

    if (pending.kind !== PendingRequestKind.ModifyBatch) {
      this.pendingBatchContextByReqId.delete(reqId);
      pending.reject(new ExchangeError(
        'Unexpected pending kind for amend-batch response',
        message.retCode ?? 'UNKNOWN',
        'bybit',
      ));

      return;
    }

    const context = this.pendingBatchContextByReqId.get(reqId);
    this.pendingBatchContextByReqId.delete(reqId);

    if (!context || context.kind !== 'modify') {
      pending.reject(new ExchangeError(
        'Missing batch context for amend-batch response',
        'CONTEXT_MISSING',
        'bybit',
      ));

      return;
    }

    if (message.retCode !== 0) {
      pending.reject(new ExchangeError(
        message.retMsg ?? 'Batch amend failed',
        message.retCode ?? 'UNKNOWN',
        'bybit',
      ));

      return;
    }

    const extInfoList = message.retExtInfo?.list ?? [];
    const rateLimit = parseBybitHeaderRateLimit(message.header);
    this.rememberOrderRateLimit(rateLimit);
    const resultList: ModifyBatchOrdersResult = context.originalOrderIdList.map((orderId, index) => {
      return buildItemResult<ModifyOrderItemResult>(orderId, extInfoList[index], rateLimit);
    });
    pending.resolve(resultList);
  }

  private handleCancelBatchResponse(message: BybitBatchTradeMessage): void {
    const reqId = message.reqId;

    if (!reqId) {
      return;
    }

    this.logger.info({ rawMessage: message }, '[Bybit] Cancel batch response received');

    const pending = this.takePendingRequest(reqId);

    if (!pending) {
      this.pendingBatchContextByReqId.delete(reqId);

      return;
    }

    if (pending.kind !== PendingRequestKind.CancelBatch) {
      this.pendingBatchContextByReqId.delete(reqId);
      pending.reject(new ExchangeError(
        'Unexpected pending kind for cancel-batch response',
        message.retCode ?? 'UNKNOWN',
        'bybit',
      ));

      return;
    }

    const context = this.pendingBatchContextByReqId.get(reqId);
    this.pendingBatchContextByReqId.delete(reqId);

    if (!context || context.kind !== 'cancel') {
      pending.reject(new ExchangeError(
        'Missing batch context for cancel-batch response',
        'CONTEXT_MISSING',
        'bybit',
      ));

      return;
    }

    if (message.retCode !== 0) {
      pending.reject(new ExchangeError(
        message.retMsg ?? 'Batch cancel failed',
        message.retCode ?? 'UNKNOWN',
        'bybit',
      ));

      return;
    }

    const extInfoList = message.retExtInfo?.list ?? [];
    const rateLimit = parseBybitHeaderRateLimit(message.header);
    this.rememberOrderRateLimit(rateLimit);
    const resultList: CancelBatchOrdersResult = context.originalOrderIdList.map((orderId, index) => {
      return buildItemResult<CancelOrderItemResult>(orderId, extInfoList[index], rateLimit);
    });
    pending.resolve(resultList);
  }
}

function buildItemResult<TResult extends { orderId: string; isSuccess: boolean; errorCode: number | null; errorText: string | null }>(
  orderId: string,
  extInfo: BybitBatchOrderExtInfo | undefined,
  rateLimit?: OrderRateLimitSnapshot,
): TResult {
  const hasCode = extInfo !== undefined && typeof extInfo.code === 'number';
  const code = hasCode ? extInfo.code : null;
  const msg = extInfo !== undefined && typeof extInfo.msg === 'string' ? extInfo.msg : null;
  const isSuccess = code === 0;

  return {
    orderId,
    isSuccess,
    errorCode: isSuccess ? null : code,
    errorText: isSuccess ? null : (msg ?? 'Unknown error'),
    ...(rateLimit !== undefined ? { rateLimit } : {}),
  } as TResult;
}

function parseBybitHeaderRateLimit(
  header: BybitTradeResponseHeader | undefined,
): OrderRateLimitSnapshot | undefined {
  if (header === undefined) {
    return undefined;
  }

  const rawLimit = header['X-Bapi-Limit'];
  const rawStatus = header['X-Bapi-Limit-Status'];
  const rawReset = header['X-Bapi-Limit-Reset-Timestamp'];

  if (rawLimit === undefined || rawStatus === undefined || rawReset === undefined) {
    return undefined;
  }

  const limit = Number(rawLimit);
  const remaining = Number(rawStatus);
  const resetMs = Number(rawReset);

  if (!Number.isFinite(limit) || !Number.isFinite(remaining) || !Number.isFinite(resetMs)) {
    return undefined;
  }

  return { limit, remaining, resetMs };
}

export { BybitTradeStream };
