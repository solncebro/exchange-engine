import { ReliableWebSocket } from '@solncebro/websocket-engine';
import type { WebSocketOpenContext } from '@solncebro/websocket-engine';

import type { ExchangeLogger } from '../types/common';
import { BYBIT_PRIVATE_WEBSOCKET_URL } from '../constants/bybit';
import {
  BYBIT_HEARTBEAT_CONFIG,
  BYBIT_PING_INTERVAL,
  authenticateBybitWebSocket,
} from './bybitWebSocketUtils';
import type { BybitPrivateMessage, BybitPrivateStreamArgs } from './BybitPrivateStream.types';
import { parseWebSocketMessage } from './parseWebSocketMessage';

class BybitPrivateStream {
  private webSocket: ReliableWebSocket<BybitPrivateMessage> | null = null;
  private readonly logger: ExchangeLogger;
  private readonly apiKey: string;
  private readonly secret: string;
  private readonly onNotify?: (message: string) => void | Promise<void>;
  private readonly onMessageHandler: (event: Record<string, unknown>) => void;

  constructor(args: BybitPrivateStreamArgs) {
    this.logger = args.logger;
    this.apiKey = args.apiKey;
    this.secret = args.secret;
    this.onNotify = args.onNotify;
    this.onMessageHandler = args.onMessage;
  }

  connect(): void {
    if (this.webSocket !== null) {
      return;
    }

    this.webSocket = new ReliableWebSocket<BybitPrivateMessage>({
      label: 'BybitPrivateStream',
      url: BYBIT_PRIVATE_WEBSOCKET_URL,
      logger: this.logger,
      parseMessage: (rawData) => parseWebSocketMessage<BybitPrivateMessage>(rawData),
      onMessage: (message) => this.handleMessage(message),
      onOpen: (context) => this.authenticate(context),
      onNotify: this.onNotify,
      heartbeat: BYBIT_HEARTBEAT_CONFIG,
      configuration: {
        pingInterval: BYBIT_PING_INTERVAL,
      },
    });
  }

  close(): void {
    if (this.webSocket !== null) {
      this.webSocket.close();
      this.webSocket = null;
    }
  }

  isConnected(): boolean {
    return this.webSocket !== null;
  }

  private async authenticate(context: WebSocketOpenContext<BybitPrivateMessage>): Promise<void> {
    await authenticateBybitWebSocket({ context, apiKey: this.apiKey, secret: this.secret, label: 'BybitPrivateStream', logger: this.logger });
  }

  private handleMessage(message: BybitPrivateMessage): void {
    if (message.op === 'auth') {
      return;
    }

    try {
      this.onMessageHandler(message as Record<string, unknown>);
    } catch (error) {
      this.logger.error(`BybitPrivateStream: error handling message: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

export { BybitPrivateStream };
