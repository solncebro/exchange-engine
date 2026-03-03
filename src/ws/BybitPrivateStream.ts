import type { RawData } from 'ws';
import { ReliableWebSocket } from '@solncebro/websocket-engine';
import type { WebSocketOpenContext } from '@solncebro/websocket-engine';

import type { ExchangeLogger } from '../types/common';
import { BYBIT_PRIVATE_WS_URL } from '../constants/bybit';
import {
  BYBIT_HEARTBEAT_CONFIG,
  BYBIT_PING_INTERVAL,
  authenticateBybitWs,
} from './bybitWsUtils';
import type { BybitBaseWsMessage } from './bybitWsUtils';

interface BybitPrivateMessage extends BybitBaseWsMessage {
  topic?: string;
}

interface BybitPrivateStreamArgs {
  apiKey: string;
  secret: string;
  logger: ExchangeLogger;
  onNotify?: (message: string) => void | Promise<void>;
  onMessage: (event: Record<string, unknown>) => void;
}

function parseBybitPrivateMessage(rawData: RawData): BybitPrivateMessage {
  return JSON.parse(rawData.toString()) as BybitPrivateMessage;
}

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
      url: BYBIT_PRIVATE_WS_URL,
      logger: this.logger,
      parseMessage: parseBybitPrivateMessage,
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
    await authenticateBybitWs({ context, apiKey: this.apiKey, secret: this.secret, label: 'BybitPrivateStream', logger: this.logger });
  }

  private handleMessage(message: BybitPrivateMessage): void {
    if (message.op === 'auth') {
      return;
    }

    this.onMessageHandler(message as Record<string, unknown>);
  }
}

export { BybitPrivateStream };
export type { BybitPrivateStreamArgs };
