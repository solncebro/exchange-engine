import { ReliableWebSocket } from '@solncebro/websocket-engine';

import type { ExchangeLogger, WebSocketConnectionInfo } from '../types/common';
import { WebSocketConnectionTypeEnum } from '../types/common';
import type { BinanceUserDataStreamArgs } from './BinanceUserDataStream.types';
import { parseWebSocketMessage } from './parseWebSocketMessage';

class BinanceUserDataStream {
  private webSocket: ReliableWebSocket<Record<string, unknown>> | null = null;
  private readonly logger: ExchangeLogger;
  private readonly label: string;
  private readonly listenKey: string;
  private readonly baseWebSocketUrl: string;
  private readonly onNotify?: (message: string) => void | Promise<void>;
  private readonly onMessageHandler: (event: Record<string, unknown>) => void;
  private url: string | null = null;

  constructor(args: BinanceUserDataStreamArgs) {
    this.logger = args.logger;
    this.label = args.label;
    this.listenKey = args.listenKey;
    this.baseWebSocketUrl = args.baseWebSocketUrl;
    this.onNotify = args.onNotify;
    this.onMessageHandler = args.onMessage;
  }

  connect(): void {
    if (this.webSocket !== null) {
      return;
    }

    const url = `${this.baseWebSocketUrl}/${this.listenKey}`;
    this.url = url;

    this.webSocket = new ReliableWebSocket<Record<string, unknown>>({
      label: this.label,
      url,
      logger: this.logger,
      parseMessage: (rawData) => parseWebSocketMessage<Record<string, unknown>>(rawData),
      onMessage: (message) => {
        try {
          this.onMessageHandler(message);
        } catch (error) {
          this.logger.error(`BinanceUserDataStream: error handling message: ${error instanceof Error ? error.message : String(error)}`);
        }
      },
      onNotify: this.onNotify,
    });

    this.logger.info(`BinanceUserDataStream connected with listenKey: ${this.listenKey}`);
  }

  close(): void {
    if (this.webSocket !== null) {
      this.webSocket.close();
      this.webSocket = null;
    }
  }

  getConnectionInfo(): WebSocketConnectionInfo | null {
    if (this.webSocket === null || this.url === null) {
      return null;
    }

    return {
      label: this.label,
      url: this.url,
      isConnected: true,
      type: WebSocketConnectionTypeEnum.UserData,
      subscriptionList: [],
    };
  }

  isConnected(): boolean {
    return this.webSocket !== null;
  }
}

export { BinanceUserDataStream };
