import type { WebSocketOpenContext } from '@solncebro/websocket-engine';
import { ReliableWebSocket } from '@solncebro/websocket-engine';
import type { RawData } from 'ws';

import type { BybitRawOrderResponse } from '../normalizers/bybitNormalizer';
import { normalizeBybitOrder } from '../normalizers/bybitNormalizer';
import type { ExchangeLogger, Order } from '../types/common';
import type { BybitBaseWsMessage } from './bybitWsUtils';
import {
  BYBIT_HEARTBEAT_CONFIG,
  BYBIT_PING_INTERVAL,
  authenticateBybitWs
} from './bybitWsUtils';

interface BybitTradeMessage extends BybitBaseWsMessage {
  reason?: string;
  reqId?: string;
}

interface BybitTradeStreamArgs {
  url: string;
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

const ORDER_TIMEOUT_MS = 30000;

class BybitTradeStream {
  private webSocket: ReliableWebSocket<BybitTradeMessage> | null = null;
  private readonly url: string;
  private readonly logger: ExchangeLogger;
  private readonly apiKey: string;
  private readonly secret: string;
  private readonly onNotify?: (message: string) => void | Promise<void>;
  private readonly pendingRequestByRequestId: Map<string, PendingRequest> = new Map();
  private connectPromise: Promise<void> | null = null;

  constructor(args: BybitTradeStreamArgs) {
    this.url = args.url;
    this.logger = args.logger;
    this.apiKey = args.apiKey;
    this.secret = args.secret;
    this.onNotify = args.onNotify;
  }

  async createOrder(orderParams: Record<string, unknown>): Promise<Order> {
    await this.ensureConnected();

    const requestId = `order_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const request = {
      op: 'order.create',
      args: [{ ...orderParams }],
      header: { 'X-BAPI-TIMESTAMP': String(Date.now()), 'X-BAPI-RECV-WINDOW': '7000' },
      reqId: requestId,
    };

    return new Promise<Order>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequestByRequestId.delete(requestId);
        reject(new Error(`Order creation timeout after ${ORDER_TIMEOUT_MS}ms`));
      }, ORDER_TIMEOUT_MS);

      this.pendingRequestByRequestId.set(requestId, { resolve, reject, timeout });
      this.webSocket!.sendToConnectedSocket(request);
    });
  }

  disconnect(): void {
    for (const [requestId, pending] of this.pendingRequestByRequestId) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('BybitTradeStream disconnected'));
      this.pendingRequestByRequestId.delete(requestId);
    }

    if (this.webSocket !== null) {
      this.webSocket.close();
      this.webSocket = null;
    }

    this.connectPromise = null;
  }

  isConnected(): boolean {
    return this.webSocket !== null;
  }

  private async ensureConnected(): Promise<void> {
    if (this.webSocket !== null) {
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

      this.webSocket = new ReliableWebSocket<BybitTradeMessage>({
        label: 'BybitTradeStream',
        url: this.url,
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
        heartbeat: BYBIT_HEARTBEAT_CONFIG,
        configuration: {
          pingInterval: BYBIT_PING_INTERVAL,
        },
      });
    });
  }

  private async authenticate(context: WebSocketOpenContext<BybitTradeMessage>): Promise<void> {
    await authenticateBybitWs({ context, apiKey: this.apiKey, secret: this.secret, label: 'BybitTradeStream', logger: this.logger });
  }

  private handleMessage(message: BybitTradeMessage): void {
    if (message.op === 'auth') {
      return;
    }

    if (message.op === 'order.create' && message.reqId) {
      const pending = this.pendingRequestByRequestId.get(message.reqId);

      if (!pending) {
        return;
      }

      clearTimeout(pending.timeout);
      this.pendingRequestByRequestId.delete(message.reqId);

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
