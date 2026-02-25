import crypto from 'node:crypto';
import type { RawData } from 'ws';
import { ReliableWebSocket } from '@solncebro/websocket-engine';
import type { WebSocketOpenContext } from '@solncebro/websocket-engine';

import type { ExchangeLogger, Order } from '../types/common';
import { normalizeBybitOrder } from '../normalizers/bybitNormalizer';
import type { BybitRawOrderResponse } from '../normalizers/bybitNormalizer';
import { BYBIT_TRADE_WS_URL } from '../constants/bybit';

interface BybitTradeMessage {
  op?: string;
  data?: unknown;
  success?: boolean;
  reason?: string;
  ret_msg?: string;
  reqId?: string;
  [key: string]: unknown;
}

interface BybitTradeStreamArgs {
  apiKey: string;
  secret: string;
  logger: ExchangeLogger;
  onNotify?: (message: string) => void | Promise<void>;
}

interface PendingRequest {
  resolve: (order: Order) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

function parseBybitTradeMessage(rawData: RawData): BybitTradeMessage {
  return JSON.parse(rawData.toString()) as BybitTradeMessage;
}

function isBybitPongResponse(message: BybitTradeMessage): boolean {
  return message.op === 'pong' || message.ret_msg === 'pong';
}

const ORDER_TIMEOUT_MS = 30000;

class BybitTradeStream {
  private ws: ReliableWebSocket<BybitTradeMessage> | null = null;
  private readonly logger: ExchangeLogger;
  private readonly apiKey: string;
  private readonly secret: string;
  private readonly onNotify?: (message: string) => void | Promise<void>;
  private readonly pendingRequestByReqId: Map<string, PendingRequest> = new Map();
  private connectPromise: Promise<void> | null = null;

  constructor(args: BybitTradeStreamArgs) {
    this.logger = args.logger;
    this.apiKey = args.apiKey;
    this.secret = args.secret;
    this.onNotify = args.onNotify;
  }

  async createOrder(orderParams: Record<string, unknown>): Promise<Order> {
    await this.ensureConnected();

    const reqId = `order_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const request = {
      op: 'order.create',
      args: [{ ...orderParams }],
      header: { 'X-BAPI-TIMESTAMP': String(Date.now()), 'X-BAPI-RECV-WINDOW': '7000' },
      reqId,
    };

    return new Promise<Order>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequestByReqId.delete(reqId);
        reject(new Error(`Order creation timeout after ${ORDER_TIMEOUT_MS}ms`));
      }, ORDER_TIMEOUT_MS);

      this.pendingRequestByReqId.set(reqId, { resolve, reject, timeout });
      this.ws!.sendToConnectedSocket(request);
    });
  }

  disconnect(): void {
    for (const [reqId, pending] of this.pendingRequestByReqId) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('BybitTradeStream disconnected'));
      this.pendingRequestByReqId.delete(reqId);
    }

    if (this.ws !== null) {
      this.ws.close();
      this.ws = null;
    }

    this.connectPromise = null;
  }

  isConnected(): boolean {
    return this.ws !== null;
  }

  private async ensureConnected(): Promise<void> {
    if (this.ws !== null) {
      return;
    }

    if (this.connectPromise !== null) {
      return this.connectPromise;
    }

    this.connectPromise = this.initConnection();

    try {
      await this.connectPromise;
    } finally {
      this.connectPromise = null;
    }
  }

  private initConnection(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let resolved = false;

      this.ws = new ReliableWebSocket<BybitTradeMessage>({
        label: 'BybitTradeStream',
        url: BYBIT_TRADE_WS_URL,
        logger: this.logger,
        parseMessage: parseBybitTradeMessage,
        onMessage: (message) => this.handleMessage(message),
        onOpen: async (context) => {
          try {
            await this.authenticate(context);
            resolved = true;
            resolve();
          } catch (error) {
            if (!resolved) {
              resolved = true;
              reject(error);
            }
          }
        },
        onNotify: this.onNotify,
        heartbeat: {
          buildPayload: () => ({ op: 'ping' }),
          isResponse: isBybitPongResponse,
        },
        configuration: {
          pingInterval: 20000,
        },
      });
    });
  }

  private async authenticate(context: WebSocketOpenContext<BybitTradeMessage>): Promise<void> {
    const timestamp = Date.now();
    const payload = `GET/realtime${timestamp}`;
    const signature = crypto.createHmac('sha256', this.secret).update(payload).digest('hex');

    context.send({
      op: 'auth',
      args: [this.apiKey, timestamp, signature],
    });

    await context.waitForMessage(
      (message) => message.op === 'auth' && message.success === true,
      10000,
    );

    this.logger.info('BybitTradeStream authenticated');
  }

  private handleMessage(message: BybitTradeMessage): void {
    if (message.op === 'auth') {
      return;
    }

    if (message.op === 'order.create' && message.reqId) {
      const pending = this.pendingRequestByReqId.get(message.reqId);

      if (!pending) {
        return;
      }

      clearTimeout(pending.timeout);
      this.pendingRequestByReqId.delete(message.reqId);

      if (message.success && message.data) {
        const order = normalizeBybitOrder(message.data as BybitRawOrderResponse);
        pending.resolve(order);
      } else {
        pending.reject(new Error(message.reason ?? message.ret_msg ?? 'Order creation failed'));
      }
    }
  }
}

export { BybitTradeStream };
export type { BybitTradeStreamArgs };
