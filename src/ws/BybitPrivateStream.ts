import crypto from 'node:crypto';
import type { RawData } from 'ws';
import { ReliableWebSocket } from '@solncebro/websocket-engine';
import type { WebSocketOpenContext } from '@solncebro/websocket-engine';

import type { ExchangeLogger } from '../types/common';
import { BYBIT_PRIVATE_WS_URL } from '../constants/bybit';

interface BybitPrivateMessage {
  op?: string;
  topic?: string;
  data?: unknown;
  success?: boolean;
  ret_msg?: string;
  [key: string]: unknown;
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

function isBybitPongResponse(message: BybitPrivateMessage): boolean {
  return message.op === 'pong' || message.ret_msg === 'pong';
}

class BybitPrivateStream {
  private ws: ReliableWebSocket<BybitPrivateMessage> | null = null;
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
    if (this.ws !== null) {
      return;
    }

    this.ws = new ReliableWebSocket<BybitPrivateMessage>({
      label: 'BybitPrivateStream',
      url: BYBIT_PRIVATE_WS_URL,
      logger: this.logger,
      parseMessage: parseBybitPrivateMessage,
      onMessage: (message) => this.handleMessage(message),
      onOpen: (context) => this.authenticate(context),
      onNotify: this.onNotify,
      heartbeat: {
        buildPayload: () => ({ op: 'ping' }),
        isResponse: isBybitPongResponse,
      },
      configuration: {
        pingInterval: 20000,
      },
    });
  }

  close(): void {
    if (this.ws !== null) {
      this.ws.close();
      this.ws = null;
    }
  }

  isConnected(): boolean {
    return this.ws !== null;
  }

  private async authenticate(context: WebSocketOpenContext<BybitPrivateMessage>): Promise<void> {
    const timestamp = Date.now();

    const payload = `GET/realtime${timestamp}`;

    const signature = crypto.createHmac('sha256', this.secret).update(payload).digest('hex');

    context.send({
      op: 'auth',
      args: [this.apiKey, timestamp, signature],
    });

    await context.waitForMessage(
      (message) => message.op === 'auth' && message.success === true,
      10000,
    );

    this.logger.info('BybitPrivateStream authenticated');
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
