import { ReliableWebSocket } from '@solncebro/websocket-engine';

import { buildBinanceWebSocketSignedParams } from '../auth/binanceAuth';
import {
  BINANCE_ORDER_PLACE_WEBSOCKET_METHOD,
  BINANCE_ALGO_ORDER_PLACE_WEBSOCKET_METHOD,
  BINANCE_ALGO_ORDER_CANCEL_WEBSOCKET_METHOD,
} from '../constants/binance';
import { ExchangeError } from '../errors/ExchangeError';
import { normalizeBinanceOrder, normalizeBinanceAlgoOrder } from '../normalizers/binanceNormalizer';
import type { BinanceOrderResponseRaw, BinanceAlgoOrderRaw } from '../normalizers/binanceNormalizer';
import type { Order, OrderRateLimitSnapshot } from '../types/common';
import { BaseTradeStream } from './BaseTradeStream';
import { PendingRequestKind } from './BaseTradeStream.types';
import type {
  BinanceTradeWebSocketResponse,
  BinanceWebSocketRateLimitEntry,
  BinanceAlgoOrderCancelAckRaw,
} from './BinanceTradeStream.types';
import { parseWebSocketMessage } from './parseWebSocketMessage';

class BinanceTradeStream extends BaseTradeStream<BinanceTradeWebSocketResponse> {
  private buildSignedRequest(
    method: string,
    params: Record<string, unknown>,
    requestId: string,
  ): unknown {
    const signedParams = buildBinanceWebSocketSignedParams({
      params: {
        ...params,
        apiKey: this.apiKey,
      } as Record<string, string | number | boolean>,
      secret: this.secret,
    });

    return { id: requestId, method, params: signedParams };
  }

  protected buildOrderRequest(
    orderParams: Record<string, unknown>,
    requestId: string,
  ): unknown {
    return this.buildSignedRequest(BINANCE_ORDER_PLACE_WEBSOCKET_METHOD, orderParams, requestId);
  }

  /** Постановка условной заявки. Отдельный метод канала — старый order.place условные типы не принимает. */
  async createConditionalOrder(orderParams: Record<string, unknown>): Promise<Order> {
    await this.ensureConnectedHook();

    const requestId = this.generateReqId();
    const request = this.buildSignedRequest(BINANCE_ALGO_ORDER_PLACE_WEBSOCKET_METHOD, orderParams, requestId);

    return this.sendRequest<Order>(request, requestId, PendingRequestKind.ConditionalOrder);
  }

  /** Отмена условной заявки. Символ не передаётся — вход его не принимает. */
  async cancelConditionalOrder(cancelParams: Record<string, unknown>): Promise<void> {
    await this.ensureConnectedHook();

    const requestId = this.generateReqId();
    const request = this.buildSignedRequest(BINANCE_ALGO_ORDER_CANCEL_WEBSOCKET_METHOD, cancelParams, requestId);

    await this.sendRequest<void>(request, requestId, PendingRequestKind.ConditionalCancel);
  }

  protected initConnection(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.webSocket = new ReliableWebSocket<BinanceTradeWebSocketResponse>({
        label: this.label,
        url: this.url,
        logger: this.logger,
        parseMessage: (rawData) => parseWebSocketMessage<BinanceTradeWebSocketResponse>(rawData),
        onMessage: (message) => this.handleMessage(message),
        onOpen: async () => {
          resolve();
        },
        onNotify: this.onNotify,
      });
    });
  }

  private handleMessage(message: BinanceTradeWebSocketResponse): void {
    if (!message.id) {
      return;
    }

    const pending = this.takePendingRequest(message.id);

    if (!pending) {
      return;
    }

    this.logger.info({ rawMessage: message }, '[Binance] Order response received');

    const isKnownKind =
      pending.kind === PendingRequestKind.SingleOrder ||
      pending.kind === PendingRequestKind.ConditionalOrder ||
      pending.kind === PendingRequestKind.ConditionalCancel;

    if (!isKnownKind) {
      pending.reject(new ExchangeError(
        'Unexpected pending kind for Binance single-order response',
        message.status ?? 'UNKNOWN',
        'binance',
      ));

      return;
    }

    if (message.status !== 200 || !message.result) {
      const errorMessage = message.error?.msg ?? 'Order creation failed';
      const errorCode = message.error?.code ?? message.status;
      pending.reject(new ExchangeError(`Binance WS order error [${errorCode}]: ${errorMessage}`, errorCode, 'binance'));

      return;
    }

    try {
      if (pending.kind === PendingRequestKind.ConditionalCancel) {
        // Внешний status=200 ещё не значит успех: отказ приходит вложенным полем code.
        const ack = message.result as BinanceAlgoOrderCancelAckRaw;

        if (String(ack.code) !== '200') {
          pending.reject(new ExchangeError(
            `Binance WS algo cancel error [${ack.code}]: ${ack.msg}`,
            ack.code,
            'binance',
          ));

          return;
        }

        pending.resolve(undefined);

        return;
      }

      const order = pending.kind === PendingRequestKind.ConditionalOrder
        ? normalizeBinanceAlgoOrder(message.result as BinanceAlgoOrderRaw)
        : normalizeBinanceOrder(message.result as BinanceOrderResponseRaw);
      const rateLimit = parseBinanceRateLimitArray(message.rateLimits);

      if (rateLimit !== undefined) {
        order.rateLimit = rateLimit;
      }

      pending.resolve(order);
    } catch (error) {
      pending.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }
}

function parseBinanceRateLimitArray(
  rateLimits: BinanceWebSocketRateLimitEntry[] | undefined,
): OrderRateLimitSnapshot | undefined {
  if (rateLimits === undefined || rateLimits.length === 0) {
    return undefined;
  }

  const orderSecondEntry = rateLimits.find(
    (entry) => entry.rateLimitType === 'ORDERS' && entry.interval === 'SECOND',
  );

  if (orderSecondEntry === undefined) {
    return undefined;
  }

  const limit = orderSecondEntry.limit;
  const remaining = Math.max(0, orderSecondEntry.limit - orderSecondEntry.count);
  const resetMs = Date.now() + orderSecondEntry.intervalNum * 1000;

  return { limit, remaining, resetMs };
}

export { BinanceTradeStream };
