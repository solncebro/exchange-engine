import type { RawData } from 'ws';
import { ReliableWebSocket } from '@solncebro/websocket-engine';

import type { ExchangeLogger } from '../types/common';

interface BinanceUserDataStreamArgs {
  listenKey: string;
  baseWsUrl: string;
  logger: ExchangeLogger;
  onNotify?: (message: string) => void | Promise<void>;
  onMessage: (event: Record<string, unknown>) => void;
}

function parseUserDataMessage(rawData: RawData): Record<string, unknown> {
  return JSON.parse(rawData.toString()) as Record<string, unknown>;
}

class BinanceUserDataStream {
  private webSocket: ReliableWebSocket<Record<string, unknown>> | null = null;
  private readonly logger: ExchangeLogger;
  private readonly listenKey: string;
  private readonly baseWsUrl: string;
  private readonly onNotify?: (message: string) => void | Promise<void>;
  private readonly onMessageHandler: (event: Record<string, unknown>) => void;

  constructor(args: BinanceUserDataStreamArgs) {
    this.logger = args.logger;
    this.listenKey = args.listenKey;
    this.baseWsUrl = args.baseWsUrl;
    this.onNotify = args.onNotify;
    this.onMessageHandler = args.onMessage;
  }

  connect(): void {
    if (this.webSocket !== null) {
      return;
    }

    const url = `${this.baseWsUrl}/${this.listenKey}`;

    this.webSocket = new ReliableWebSocket<Record<string, unknown>>({
      label: 'BinanceUserDataStream',
      url,
      logger: this.logger,
      parseMessage: parseUserDataMessage,
      onMessage: (message) => this.onMessageHandler(message),
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

  isConnected(): boolean {
    return this.webSocket !== null;
  }
}

export { BinanceUserDataStream };
export type { BinanceUserDataStreamArgs };
