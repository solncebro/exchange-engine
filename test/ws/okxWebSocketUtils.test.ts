import {
  OKX_PING_TEXT,
  buildOkxTopicKey,
  isOkxPongMessage,
  parseOkxTopicKey,
  parseOkxWebSocketMessage,
} from '../../src/ws/okxWebSocketUtils';

describe('okxWebSocketUtils', () => {
  describe('parseOkxWebSocketMessage', () => {
    it('parses the text "pong" into a pong event message', () => {
      const result = parseOkxWebSocketMessage('pong');

      expect(result).toEqual({ event: 'pong' });
    });

    it('parses "pong" surrounded by whitespace into a pong event message', () => {
      const result = parseOkxWebSocketMessage('  pong  ');

      expect(result).toEqual({ event: 'pong' });
    });

    it('parses a JSON message', () => {
      const result = parseOkxWebSocketMessage('{"event":"subscribe","arg":{"channel":"tickers","instId":"BTC-USDT"}}');

      expect(result).toEqual({ event: 'subscribe', arg: { channel: 'tickers', instId: 'BTC-USDT' } });
    });

    it('throws a descriptive error for invalid JSON', () => {
      expect(() => parseOkxWebSocketMessage('not json')).toThrow('Failed to parse OKX WebSocket message: not json');
    });
  });

  describe('isOkxPongMessage', () => {
    it('returns true for a pong event message', () => {
      expect(isOkxPongMessage({ event: 'pong' })).toBe(true);
    });

    it('returns false for a non-pong message', () => {
      expect(isOkxPongMessage({ event: 'subscribe' })).toBe(false);
      expect(isOkxPongMessage({})).toBe(false);
    });
  });

  describe('buildOkxTopicKey', () => {
    it('joins channel and instId with a pipe', () => {
      expect(buildOkxTopicKey('tickers', 'BTC-USDT')).toBe('tickers|BTC-USDT');
    });
  });

  describe('parseOkxTopicKey', () => {
    it('splits a topic key back into channel and instId', () => {
      expect(parseOkxTopicKey('tickers|BTC-USDT')).toEqual({ channel: 'tickers', instId: 'BTC-USDT' });
    });

    it('splits a candle topic key with a numeric interval suffix', () => {
      expect(parseOkxTopicKey('candle1m|BTC-USDT-SWAP')).toEqual({ channel: 'candle1m', instId: 'BTC-USDT-SWAP' });
    });

    it('throws for a key without a separator instead of silently producing an empty instId', () => {
      expect(() => parseOkxTopicKey('tickers')).toThrow("malformed topic key 'tickers'");
    });
  });

  describe('OKX_PING_TEXT', () => {
    it('is not parseable as a WebSocket message — a plain wire string, never JSON', () => {
      expect(() => parseOkxWebSocketMessage(OKX_PING_TEXT)).toThrow();
    });
  });
});
