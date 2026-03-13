import type { RawData } from 'ws';

function parseWebSocketMessage<T>(rawData: RawData): T {
  return JSON.parse(rawData.toString()) as T;
}

export { parseWebSocketMessage };
