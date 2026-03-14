import { ReliableWebSocket, WebSocketStatus } from '@solncebro/websocket-engine';

import type { ExchangeLogger, Order } from '../types/common';
import type { BaseTradeStreamArgs, PendingRequest } from './BaseTradeStream.types';

const ORDER_TIMEOUT_MS = 30000;

abstract class BaseTradeStream<TMessage> {
  protected webSocket: ReliableWebSocket<TMessage> | null = null;
  protected readonly url: string;
  protected readonly logger: ExchangeLogger;
  protected readonly apiKey: string;
  protected readonly secret: string;
  protected readonly onNotify?: (message: string) => void | Promise<void>;
  protected readonly pendingRequestByRequestId: Map<string, PendingRequest> = new Map();

  protected abstract readonly label: string;

  private connectPromise: Promise<void> | null = null;

  constructor(args: BaseTradeStreamArgs) {
    this.url = args.url;
    this.logger = args.logger;
    this.apiKey = args.apiKey;
    this.secret = args.secret;
    this.onNotify = args.onNotify;
  }

  async connect(): Promise<void> {
    await this.ensureConnected();
  }

  async createOrder(orderParams: Record<string, unknown>): Promise<Order> {
    await this.ensureConnected();

    const requestId = `order_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const request = this.buildOrderRequest(orderParams, requestId);

    return this.sendOrderRequest(request, requestId);
  }

  disconnect(): void {
    for (const [requestId, pending] of this.pendingRequestByRequestId) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(`${this.label} disconnected`));
      this.pendingRequestByRequestId.delete(requestId);
    }

    if (this.webSocket !== null) {
      this.webSocket.close();
      this.webSocket = null;
    }

    this.connectPromise = null;
  }

  isConnected(): boolean {
    if (this.webSocket === null) {
      return false;
    }

    return this.webSocket.getStatus() === WebSocketStatus.CONNECTED;
  }

  protected abstract initConnection(): Promise<void>;

  protected abstract buildOrderRequest(
    orderParams: Record<string, unknown>,
    requestId: string,
  ): unknown;

  protected takePendingRequest(requestId: string): PendingRequest | null {
    const pending = this.pendingRequestByRequestId.get(requestId);

    if (!pending) {
      return null;
    }

    clearTimeout(pending.timeout);
    this.pendingRequestByRequestId.delete(requestId);

    return pending;
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

  private sendOrderRequest(request: unknown, requestId: string): Promise<Order> {
    return new Promise<Order>((resolve, reject) => {
      if (this.webSocket === null || !this.isConnected()) {
        reject(new Error(`${this.label}: WebSocket is not connected`));

        return;
      }

      const timeout = setTimeout(() => {
        this.pendingRequestByRequestId.delete(requestId);
        this.logger.error({ requestId, timeoutMs: ORDER_TIMEOUT_MS }, `${this.label}: Order creation timeout`);
        reject(new Error(`${this.label}: Order creation timeout after ${ORDER_TIMEOUT_MS}ms`));
      }, ORDER_TIMEOUT_MS);

      this.pendingRequestByRequestId.set(requestId, { resolve, reject, timeout });

      this.logger.info({ requestId, request }, `${this.label}: Sending order request`);
      this.webSocket.sendToConnectedSocket(request);
    });
  }
}

export { BaseTradeStream };
