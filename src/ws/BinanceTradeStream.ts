import { ReliableWebSocket } from '@solncebro/websocket-engine';

import { buildBinanceWebSocketSignedParams } from '../auth/binanceAuth';
import type { BinanceOrderResponseRaw } from '../normalizers/binanceNormalizer';
import { normalizeBinanceOrder } from '../normalizers/binanceNormalizer';
import { BaseTradeStream } from './BaseTradeStream';
import { parseWebSocketMessage } from './parseWebSocketMessage';

interface BinanceTradeWebSocketResponse {
  id: string;
  status: number;
  result?: BinanceOrderResponseRaw;
  error?: {
    code: number;
    msg: string;
  };
}

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

    const pending = this.pendingRequestByRequestId.get(message.id);

    if (!pending) {
      return;
    }

    clearTimeout(pending.timeout);
    this.pendingRequestByRequestId.delete(message.id);

    if (message.status === 200 && message.result) {
      const order = normalizeBinanceOrder(message.result);
      pending.resolve(order);
    } else {
      const errorMessage = message.error?.msg ?? 'Order creation failed';
      const errorCode = message.error?.code ?? message.status;
      pending.reject(new Error(`Binance WS order error [${errorCode}]: ${errorMessage}`));
    }
  }
}

export { BinanceTradeStream };
