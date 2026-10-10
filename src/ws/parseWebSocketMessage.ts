import type { RawData } from '@solncebro/websocket-engine';
import { parseJsonPreservingLargeIntegers } from '../utils/parseJsonPreservingLargeIntegers';

function parseWebSocketMessage<T>(rawData: RawData): T {
  const text = rawData.toString();

  try {
    return parseJsonPreservingLargeIntegers(text) as T;
  } catch {
    throw new Error(`Failed to parse WebSocket message: ${text.slice(0, 200)}`);
  }
}

export { parseWebSocketMessage };
