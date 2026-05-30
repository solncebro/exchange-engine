import { ReliableWebSocket } from '@solncebro/websocket-engine';

import { buildBinanceWebSocketSignedParams } from '../auth/binanceAuth';
import { ExchangeError } from '../errors/ExchangeError';
import { normalizeBinanceOrder } from '../normalizers/binanceNormalizer';
import type { OrderRateLimitSnapshot } from '../types/common';
import { BaseTradeStream } from './BaseTradeStream';
import { PendingRequestKind } from './BaseTradeStream.types';
import type {
  BinanceTradeWebSocketResponse,
  BinanceWebSocketRateLimitEntry,
} from './BinanceTradeStream.types';
import { parseWebSocketMessage } from './parseWebSocketMessage';

class BinanceTradeStream extends BaseTradeStream<BinanceTradeWebSocketResponse> {
  protected buildOrderRequest(
    orderParams: Record<string, unknown>,
    requestId: string,
  ): unknown {
    const signedParams = buildBinanceWebSocketSignedParams({
      params: {
        ...orderParams,
        apiKey: this.apiKey,
      } as Record<string, string | number | boolean>,
      secret: this.secret,
    });

    return {
      id: requestId,
      method: 'order.place',
      params: signedParams,
    };
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

    if (pending.kind !== PendingRequestKind.SingleOrder) {
      pending.reject(new ExchangeError(
        'Unexpected pending kind for Binance single-order response',
        message.status ?? 'UNKNOWN',
        'binance',
      ));

      return;
    }

    if (message.status === 200 && message.result) {
      try {
        const order = normalizeBinanceOrder(message.result);
        const rateLimit = parseBinanceRateLimitArray(message.rateLimits);

        if (rateLimit !== undefined) {
          order.rateLimit = rateLimit;
        }

        pending.resolve(order);
      } catch (error) {
        pending.reject(error instanceof Error ? error : new Error(String(error)));
      }
    } else {
      const errorMessage = message.error?.msg ?? 'Order creation failed';
      const errorCode = message.error?.code ?? message.status;
      pending.reject(new ExchangeError(`Binance WS order error [${errorCode}]: ${errorMessage}`, errorCode, 'binance'));
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
