import type { WebSocketOpenContext } from '@solncebro/websocket-engine';
import { ReliableWebSocket } from '@solncebro/websocket-engine';

import { ExchangeError } from '../errors/ExchangeError';
import { buildBatchItemResult } from '../normalizers/batchOrderOutcome';
import { buildBybitCreateOutcome } from '../normalizers/bybitNormalizer';
import type { OrderRateLimitSnapshot } from '../types/common';
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
import { buildMinimalTradeStreamOrder } from './tradeStreamOrder';

type BybitPendingBatchContext =
  | { kind: 'create'; originalArgsList: CreateOrderWebSocketArgs[] }
  | { kind: 'modify'; originalOrderIdList: string[] }
  | { kind: 'cancel'; originalOrderIdList: string[] };

/** Разбор ответа на пачку: всё, чем три вида пачки отличаются друг от друга. */
interface BybitBatchOp {
  label: string;
  logMessage: string;
  pendingKind: PendingRequestKind;
  contextKind: BybitPendingBatchContext['kind'];
  failureText: string;
}

const BYBIT_BATCH_OP_BY_NAME: Record<string, BybitBatchOp> = {
  'order.create-batch': {
    label: 'create-batch',
    logMessage: '[Bybit] Create batch response received',
    pendingKind: PendingRequestKind.CreateBatch,
    contextKind: 'create',
    failureText: 'Batch create failed',
  },
  'order.amend-batch': {
    label: 'amend-batch',
    logMessage: '[Bybit] Amend batch response received',
    pendingKind: PendingRequestKind.ModifyBatch,
    contextKind: 'modify',
    failureText: 'Batch amend failed',
  },
  'order.cancel-batch': {
    label: 'cancel-batch',
    logMessage: '[Bybit] Cancel batch response received',
    pendingKind: PendingRequestKind.CancelBatch,
    contextKind: 'cancel',
    failureText: 'Batch cancel failed',
  },
};

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

    const batchOp = message.op === undefined ? undefined : BYBIT_BATCH_OP_BY_NAME[message.op];

    if (batchOp !== undefined && message.reqId) {
      this.handleBatchResponse(message as BybitBatchTradeMessage, batchOp);
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
      const order = buildMinimalTradeStreamOrder(data.orderId, data.orderLinkId ?? '');
      const rateLimit = parseBybitHeaderRateLimit(message.header);
      // Одиночная постановка — подавляющее большинство обращений. Не запомнив предел здесь,
      // счёт узнавал бы его только после первой пачки, а до тех пор жил бы на зашитой цифре.
      this.rememberOrderRateLimit(rateLimit);
      order.rateLimit = rateLimit;

      pending.resolve(order);
    } else {
      pending.reject(new ExchangeError(message.retMsg ?? 'Order creation failed', message.retCode ?? 'UNKNOWN', 'bybit'));
    }
  }

  /**
   * Один разбор ответа на все три вида пачки. Раньше их было три, слово в слово, и различались они
   * только раскладкой исходов — из-за чего запоминание предела частоты и потерялось на четвёртом,
   * одиночном пути: забыть одно из четырёх мест было слишком легко.
   */
  private handleBatchResponse(message: BybitBatchTradeMessage, batchOp: BybitBatchOp): void {
    const reqId = message.reqId;

    if (!reqId) {
      return;
    }

    this.logger.info({ rawMessage: message }, batchOp.logMessage);

    const pending = this.takePendingRequest(reqId);

    if (!pending) {
      this.pendingBatchContextByReqId.delete(reqId);

      return;
    }

    if (pending.kind !== batchOp.pendingKind) {
      this.pendingBatchContextByReqId.delete(reqId);
      pending.reject(new ExchangeError(
        `Unexpected pending kind for ${batchOp.label} response`,
        message.retCode ?? 'UNKNOWN',
        'bybit',
      ));

      return;
    }

    const context = this.pendingBatchContextByReqId.get(reqId);
    this.pendingBatchContextByReqId.delete(reqId);

    if (!context || context.kind !== batchOp.contextKind) {
      pending.reject(new ExchangeError(
        `Missing batch context for ${batchOp.label} response`,
        'CONTEXT_MISSING',
        'bybit',
      ));

      return;
    }

    if (message.retCode !== 0) {
      pending.reject(new ExchangeError(
        message.retMsg ?? batchOp.failureText,
        message.retCode ?? 'UNKNOWN',
        'bybit',
      ));

      return;
    }

    const rateLimit = parseBybitHeaderRateLimit(message.header);
    this.rememberOrderRateLimit(rateLimit);

    pending.resolve(this.buildBatchResultList(context, message, rateLimit));
  }

  private buildBatchResultList(
    context: BybitPendingBatchContext,
    message: BybitBatchTradeMessage,
    rateLimit: OrderRateLimitSnapshot | undefined,
  ): CreateBatchOrdersResult | ModifyBatchOrdersResult | CancelBatchOrdersResult {
    const extInfoList = message.retExtInfo?.list ?? [];

    if (context.kind === 'create') {
      const itemList = message.data?.list ?? [];

      return context.originalArgsList.map((args, index) => {
        const outcome = buildBybitCreateOutcome(args, itemList[index], extInfoList[index]);

        if (rateLimit !== undefined) {
          outcome.rateLimit = rateLimit;
        }

        return outcome;
      });
    }

    if (context.kind === 'modify') {
      return context.originalOrderIdList.map(
        (orderId, index) => buildBatchItemResult<ModifyOrderItemResult>(orderId, extInfoList[index], rateLimit),
      );
    }

    return context.originalOrderIdList.map(
      (orderId, index) => buildBatchItemResult<CancelOrderItemResult>(orderId, extInfoList[index], rateLimit),
    );
  }
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
