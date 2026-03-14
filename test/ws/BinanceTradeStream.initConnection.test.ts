import { BinanceTradeStream } from '../../src/ws/BinanceTradeStream';
import { createMockLogger } from '../fixtures/mockLogger';

let capturedOnOpen: (() => Promise<void>) | undefined;

jest.mock('@solncebro/websocket-engine', () => {
  const actual = jest.requireActual('@solncebro/websocket-engine');
  return {
    ...actual,
    ReliableWebSocket: jest.fn().mockImplementation((args: any) => {
      capturedOnOpen = args.onOpen;
      // Simulate immediate open
      queueMicrotask(() => {
        if (capturedOnOpen) {
          capturedOnOpen();
        }
      });
      return {
        getStatus: jest.fn().mockReturnValue(1),
        close: jest.fn(),
        sendToConnectedSocket: jest.fn(),
      };
    }),
  };
});

describe('BinanceTradeStream', () => {
  const mockLogger = createMockLogger();
  const url = 'wss://ws-fapi.binance.com/ws-fapi/v1';
  const apiKey = 'testApiKey';
  const secret = 'testSecret';

  beforeEach(() => {
    jest.clearAllMocks();
    capturedOnOpen = undefined;
  });

  describe('initConnection', () => {
    it('creates ReliableWebSocket and resolves on open', async () => {
      const { ReliableWebSocket } = require('@solncebro/websocket-engine');
      const stream = new BinanceTradeStream({ url, logger: mockLogger, apiKey, secret });

      await stream.connect();

      expect(ReliableWebSocket).toHaveBeenCalledWith(
        expect.objectContaining({
          label: 'BinanceTradeStream',
          url,
        }),
      );
    });
  });

  describe('buildOrderRequest', () => {
    it('returns signed order request with id and method', async () => {
      jest.spyOn(Date, 'now').mockReturnValue(1700000000000);
      const stream = new BinanceTradeStream({ url, logger: mockLogger, apiKey, secret });

      const request = (stream as any).buildOrderRequest(
        { symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quantity: '0.001' },
        'req-123',
      );

      expect(request).toEqual(
        expect.objectContaining({
          id: 'req-123',
          method: 'order.place',
          params: expect.objectContaining({
            symbol: 'BTCUSDT',
            side: 'BUY',
            apiKey: 'testApiKey',
            signature: expect.any(String),
            timestamp: expect.any(Number),
          }),
        }),
      );

      jest.restoreAllMocks();
    });
  });
});
