import { parseWebSocketMessage } from '../../src/ws/parseWebSocketMessage';

describe('parseWebSocketMessage', () => {
  it('parses valid JSON from Buffer', () => {
    const buffer = Buffer.from('{"op":"auth","success":true}');
    const result = parseWebSocketMessage<{ op: string; success: boolean }>(buffer);

    expect(result).toEqual({ op: 'auth', success: true });
  });

  it('parses empty JSON object', () => {
    const result = parseWebSocketMessage<Record<string, unknown>>(Buffer.from('{}'));

    expect(result).toEqual({});
  });

  it('parses nested structure preserving all fields', () => {
    const buffer = Buffer.from(
      '{"op":"order.create","data":{"orderId":"123","symbol":"BTCUSDT","price":"65000.00"}}',
    );
    const result = parseWebSocketMessage<{
      op: string;
      data: { orderId: string; symbol: string; price: string };
    }>(buffer);

    expect(result.op).toBe('order.create');
    expect(result.data).toEqual({ orderId: '123', symbol: 'BTCUSDT', price: '65000.00' });
  });

  it('throws with truncated raw content on invalid JSON', () => {
    const invalidJson = Buffer.from('not valid json');

    expect(() => parseWebSocketMessage(invalidJson)).toThrow('Failed to parse WebSocket message: not valid json');
  });
});
