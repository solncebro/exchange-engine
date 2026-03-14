import { ReliableWebSocket } from '@solncebro/websocket-engine';

import { buildBinanceWebSocketSignedParams } from '../auth/binanceAuth';
import { ExchangeError } from '../errors/ExchangeError';
import { normalizeBinanceOrder } from '../normalizers/binanceNormalizer';
import { BaseTradeStream } from './BaseTradeStream';
import type { BinanceTradeWebSocketResponse } from './BinanceTradeStream.types';
import { parseWebSocketMessage } from './parseWebSocketMessage';

class BinanceTradeStream extends BaseTradeStream<BinanceTradeWebSocketResponse> {
  protected readonly label = 'BinanceTradeStream';

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

    if (message.status === 200 && message.result) {
      try {
        const order = normalizeBinanceOrder(message.result);
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

export { BinanceTradeStream };
