import type { RawData } from '@solncebro/websocket-engine';

import {
  OKX_PING_INTERVAL,
  OKX_STALE_CHECK_INTERVAL_MS,
  OKX_STALE_THRESHOLD_MS,
} from '../constants/okx';
import type { OkxSubscriptionArg, OkxWebSocketMessage } from './okxWebSocketUtils.types';

const OKX_PING_TEXT = 'ping';

function parseOkxWebSocketMessage(rawData: RawData): OkxWebSocketMessage {
  const text = rawData.toString();
  const trimmed = text.trim();

  if (trimmed === 'pong') {
    return { event: 'pong' };
  }

  try {
    return JSON.parse(text) as OkxWebSocketMessage;
  } catch {
    throw new Error(`Failed to parse OKX WebSocket message: ${text.slice(0, 200)}`);
  }
}

function isOkxPongMessage(message: OkxWebSocketMessage): boolean {
  return message.event === 'pong';
}

function buildOkxTopicKey(channel: string, instId: string): string {
  return `${channel}|${instId}`;
}

function parseOkxTopicKey(key: string): OkxSubscriptionArg {
  const separatorIndex = key.indexOf('|');

  if (separatorIndex === -1) {
    throw new Error(`OkxPublicStream: malformed topic key '${key}' (missing '|' separator)`);
  }

  return {
    channel: key.slice(0, separatorIndex),
    instId: key.slice(separatorIndex + 1),
  };
}

/**
 * Проверка живости OKX — голый текст `ping`, а не объект. Движок отправляет строку как есть, поэтому
 * своего отправителя проверок и своего слежения за ответом потокам OKX больше не нужно: разрыв при
 * молчании сокета делает движок по `staleThreshold`.
 */
const OKX_HEARTBEAT_CONFIG = {
  buildPayload: () => OKX_PING_TEXT,
  isResponse: isOkxPongMessage,
};

/**
 * Пороги живости OKX для движка: те же значения, что помощник держал у себя, — проверка каждые
 * `OKX_STALE_CHECK_INTERVAL_MS`, разрыв после `OKX_STALE_THRESHOLD_MS` молчания сокета.
 */
const OKX_WEBSOCKET_CONFIGURATION = {
  pingInterval: OKX_PING_INTERVAL,
  staleThreshold: OKX_STALE_THRESHOLD_MS,
  staleCheckInterval: OKX_STALE_CHECK_INTERVAL_MS,
};

export {
  OKX_HEARTBEAT_CONFIG,
  OKX_PING_TEXT,
  OKX_WEBSOCKET_CONFIGURATION,
  buildOkxTopicKey,
  isOkxPongMessage,
  parseOkxTopicKey,
  parseOkxWebSocketMessage,
};
