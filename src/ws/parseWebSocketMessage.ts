import type { RawData } from 'ws';

function parseWebSocketMessage<T>(rawData: RawData): T {
  const text = rawData.toString();

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Failed to parse WebSocket message: ${text.slice(0, 200)}`);
  }
}

export { parseWebSocketMessage };
