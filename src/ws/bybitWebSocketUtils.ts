import type { BybitBaseWebSocketMessage } from './bybitWebSocketUtils.types';

const BYBIT_PING_INTERVAL = 20000;

function isBybitPongResponse(message: BybitBaseWebSocketMessage): boolean {
  return message.op === 'pong' || message.ret_msg === 'pong';
}

const BYBIT_HEARTBEAT_CONFIG = {
  buildPayload: () => ({ op: 'ping' }),
  isResponse: isBybitPongResponse,
};

export type { AuthenticateBybitWebSocketArgs, BybitBaseWebSocketMessage } from './bybitWebSocketUtils.types';
export { BYBIT_HEARTBEAT_CONFIG, BYBIT_PING_INTERVAL, isBybitPongResponse };
