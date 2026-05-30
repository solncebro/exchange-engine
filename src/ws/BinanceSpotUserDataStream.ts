import { ReliableWebSocket, WebSocketStatus } from '@solncebro/websocket-engine';

import type { ExchangeLogger, WebSocketConnectionInfo } from '../types/common';
import { WebSocketConnectionTypeEnum } from '../types/common';
import { buildBinanceWebSocketSignedParams } from '../auth/binanceAuth';
import type {
  BinanceSpotUserDataStreamArgs,
  BinanceSpotUserDataStreamMessage,
} from './BinanceSpotUserDataStream.types';
import { parseWebSocketMessage } from './parseWebSocketMessage';

const SUBSCRIBE_REQUEST_ID = 'userDataStream.subscribe';
const UNSUBSCRIBE_REQUEST_ID = 'userDataStream.unsubscribe';

class BinanceSpotUserDataStream {
  private webSocket: ReliableWebSocket<BinanceSpotUserDataStreamMessage> | null = null;
  private subscriptionId: number | null = null;
  private readonly logger: ExchangeLogger;
  private readonly label: string;
  private readonly url: string;
  private readonly apiKey: string;
  private readonly secret: string;
  private readonly onNotify?: (message: string) => void | Promise<void>;
  private readonly onMessageHandler: (event: Record<string, unknown>) => void;

  constructor(args: BinanceSpotUserDataStreamArgs) {
    this.logger = args.logger;
    this.label = args.label;
    this.url = args.url;
    this.apiKey = args.apiKey;
    this.secret = args.secret;
    this.onNotify = args.onNotify;
    this.onMessageHandler = args.onMessage;
  }

  connect(): void {
    if (this.webSocket !== null) {
      return;
    }

    this.webSocket = new ReliableWebSocket<BinanceSpotUserDataStreamMessage>({
      label: this.label,
      url: this.url,
      logger: this.logger,
      parseMessage: (rawData) => parseWebSocketMessage<BinanceSpotUserDataStreamMessage>(rawData),
      onMessage: (message) => this.handleMessage(message),
      onOpen: async () => {
        this.subscribe();
      },
      onReconnectSuccess: () => this.subscribe(),
      onNotify: this.onNotify,
    });
  }

  close(): void {
    if (this.webSocket !== null && this.subscriptionId !== null) {
      try {
        this.webSocket.sendToConnectedSocket({
          id: UNSUBSCRIBE_REQUEST_ID,
          method: 'userDataStream.unsubscribe',
          params: { subscriptionId: this.subscriptionId },
        });
      } catch (error) {
        this.logger.warn(`BinanceSpotUserDataStream: failed to unsubscribe: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (this.webSocket !== null) {
      this.webSocket.close();
      this.webSocket = null;
    }

    this.subscriptionId = null;
  }

  isConnected(): boolean {
    return this.webSocket !== null && this.webSocket.getStatus() === WebSocketStatus.CONNECTED;
  }

  getConnectionInfo(): WebSocketConnectionInfo | null {
    if (this.webSocket === null) {
      return null;
    }

    return {
      label: this.label,
      url: this.url,
      isConnected: this.isConnected(),
      type: WebSocketConnectionTypeEnum.UserData,
      subscriptionList: [],
    };
  }

  private subscribe(): void {
    if (this.webSocket === null) {
      return;
    }

    const params = buildBinanceWebSocketSignedParams({
      params: { apiKey: this.apiKey },
      secret: this.secret,
    });

    this.webSocket.sendToConnectedSocket({
      id: SUBSCRIBE_REQUEST_ID,
      method: 'userDataStream.subscribe',
      params,
    });
  }

  private handleMessage(message: BinanceSpotUserDataStreamMessage): void {
    if (message.id === SUBSCRIBE_REQUEST_ID) {
      if (message.status === 200 && message.result) {
        this.subscriptionId = message.result.subscriptionId ?? null;
        this.logger.info(`BinanceSpotUserDataStream subscribed (subscriptionId: ${this.subscriptionId})`);
      } else {
        this.logger.error(`BinanceSpotUserDataStream subscribe failed: [${message.error?.code ?? message.status}] ${message.error?.msg ?? 'unknown'}`);
      }

      return;
    }

    if (message.id === UNSUBSCRIBE_REQUEST_ID) {
      return;
    }

    const event = (message.event ?? message) as Record<string, unknown>;

    try {
      this.onMessageHandler(event);
    } catch (error) {
      this.logger.error(`BinanceSpotUserDataStream: error handling message: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

export { BinanceSpotUserDataStream };
