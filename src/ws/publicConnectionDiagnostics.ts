import { WebSocketStatus } from '@solncebro/websocket-engine';

import type { WebSocketConnectionInfo } from '../types/common';
import { WebSocketConnectionTypeEnum } from '../types/common';
import type { PublicConnectionCloseLineArgs, PublicDiagnosticConnection } from './publicConnectionDiagnostics.types';

/**
 * Запись реестра соединений публичного потока. Список подписок каждая биржа собирает по-своему —
 * темы у них устроены по-разному, — а всё остальное описывает соединение, а не биржу.
 */
export function buildPublicConnectionInfo(
  connection: PublicDiagnosticConnection,
  subscriptionList: string[],
): WebSocketConnectionInfo {
  return {
    label: connection.label,
    shortLabel: connection.shortLabel,
    url: connection.url,
    isConnected: connection.webSocket.getStatus() === WebSocketStatus.CONNECTED,
    type: WebSocketConnectionTypeEnum.Public,
    subscriptionList,
    messageCount: connection.messageCount,
    lastMessageTimestamp: connection.lastMessageTimestamp > 0 ? connection.lastMessageTimestamp : undefined,
    reconnectCount: connection.reconnectCount,
  };
}

/**
 * Одна строка на КАЖДОЕ закрытие соединения, снимающая состояние ВСЕХ соединений в этот момент:
 * по череде таких строк видно, отвалилась ли связь целиком (много соединений разом молчат) или
 * беда у одного. Запись в столбик: `#<номер><+|- связь>t<тем>/<возраст>ms/↻<переподключений>`.
 */
export function buildPublicConnectionCloseLine(args: PublicConnectionCloseLineArgs): string {
  const now = Date.now();
  const snapshotTokenList = args.connectionList.map((connection, index) => {
    const connectedMark = connection.webSocket.getStatus() === WebSocketStatus.CONNECTED ? '+' : '-';
    const ageMs = connection.lastMessageTimestamp > 0 ? now - connection.lastMessageTimestamp : -1;

    return `#${index + 1}${connectedMark}t${connection.topicList.length}/${ageMs}ms/↻${connection.reconnectCount}`;
  });

  const { closeContext } = args;

  return `${args.closingLabel} closed (code=${closeContext.closeCode ?? 'na'} pong=${closeContext.isPongTimeout} fails=${closeContext.consecutiveFailures}) | ${snapshotTokenList.join(' ')}`;
}
