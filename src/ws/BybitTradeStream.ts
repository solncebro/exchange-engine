import type { WebSocketOpenContext } from '@solncebro/websocket-engine';
import { ReliableWebSocket } from '@solncebro/websocket-engine';

import { ExchangeError } from '../errors/ExchangeError';
import type { BybitOrderResponseRaw } from '../normalizers/bybitNormalizer';
import { normalizeBybitOrder } from '../normalizers/bybitNormalizer';
import { BaseTradeStream } from './BaseTradeStream';
import type { BybitTradeMessage } from './BybitTradeStream.types';
import {
  BYBIT_HEARTBEAT_CONFIG,
  BYBIT_PING_INTERVAL,
  authenticateBybitWebSocket,
} from './bybitWebSocketUtils';
import { parseWebSocketMessage } from './parseWebSocketMessage';

class BybitTradeStream extends BaseTradeStream<BybitTradeMessage> {
  protected readonly label = 'BybitTradeStream';

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

      this.webSocket = new ReliableWebSocket<BybitTradeMessage>({
        label: this.label,
        url: this.url,
        logger: this.logger,
        parseMessage: (rawData) => parseWebSocketMessage<BybitTradeMessage>(rawData),
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

  private async authenticate(context: WebSocketOpenContext<BybitTradeMessage>): Promise<void> {
    await authenticateBybitWebSocket({
      context,
      apiKey: this.apiKey,
      secret: this.secret,
      label: this.label,
      logger: this.logger,
    });
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
        const order = normalizeBybitOrder(message.data as BybitOrderResponseRaw);
        pending.resolve(order);
      } else {
        pending.reject(new ExchangeError(message.reason ?? message.ret_msg ?? 'Order creation failed', (message.ret_code as string | number) ?? 'UNKNOWN', 'bybit'));
      }
    }
  }
}

export { BybitTradeStream };
