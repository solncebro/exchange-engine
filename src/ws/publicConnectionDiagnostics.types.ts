import type { WebSocketCloseContext, WebSocketStatus } from '@solncebro/websocket-engine';

/** Всё, что публичный поток обязан уметь сказать о состоянии своего сокета. */
export interface PublicConnectionSocket {
  getStatus(): WebSocketStatus;
}

/** То, что о соединении знают ОБА публичных потока и что нужно для диагностики. */
export interface PublicDiagnosticConnection {
  label: string;
  shortLabel: string;
  url: string;
  topicList: string[];
  messageCount: number;
  lastMessageTimestamp: number;
  reconnectCount: number;
  webSocket: PublicConnectionSocket;
}

export interface PublicConnectionCloseLineArgs {
  closingLabel: string;
  closeContext: WebSocketCloseContext;
  connectionList: PublicDiagnosticConnection[];
}
