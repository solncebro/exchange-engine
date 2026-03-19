import type { WebSocketOpenContext } from '@solncebro/websocket-engine';
import { ReliableWebSocket } from '@solncebro/websocket-engine';

import { ExchangeError } from '../errors/ExchangeError';
import { OrderSideEnum, OrderTypeEnum, TimeInForceEnum } from '../types/common';
import { BaseTradeStream } from './BaseTradeStream';
import type { BybitTradeMessage } from './BybitTradeStream.types';
import {
  BYBIT_HEARTBEAT_CONFIG,
  BYBIT_PING_INTERVAL,
  authenticateBybitWebSocket,
} from './bybitWebSocketUtils';
import { parseWebSocketMessage } from './parseWebSocketMessage';

class BybitTradeStream extends BaseTradeStream<BybitTradeMessage> {
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
      this.logger.info({ rawMessage: message }, '[Bybit] Order response received');

      const pending = this.takePendingRequest(message.reqId);

      if (!pending) {
        return;
      }

      if ((message.success || message.retCode === 0) && message.data) {
        const data = message.data as { orderId: string; orderLinkId?: string };
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
        });
      } else {
        pending.reject(new ExchangeError(message.retMsg ?? 'Order creation failed', message.retCode ?? 'UNKNOWN', 'bybit'));
      }
    }
  }
}

export { BybitTradeStream };
