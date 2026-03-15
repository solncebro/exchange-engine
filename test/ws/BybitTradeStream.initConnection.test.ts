import { BybitTradeStream } from '../../src/ws/BybitTradeStream';
import { createMockLogger } from '../fixtures/mockLogger';

let capturedOnOpen: ((context: any) => Promise<void>) | undefined;

jest.mock('@solncebro/websocket-engine', () => {
  const actual = jest.requireActual('@solncebro/websocket-engine');
  return {
    ...actual,
    ReliableWebSocket: jest.fn().mockImplementation((args: any) => {
      capturedOnOpen = args.onOpen;
      return {
        getStatus: jest.fn().mockReturnValue(1),
        close: jest.fn(),
        sendToConnectedSocket: jest.fn(),
      };
    }),
  };
});

jest.mock('../../src/ws/bybitWebSocketUtils', () => {
  const actual = jest.requireActual('../../src/ws/bybitWebSocketUtils');
  return {
    ...actual,
    authenticateBybitWebSocket: jest.fn().mockResolvedValue(undefined),
  };
});

describe('BybitTradeStream', () => {
  const mockLogger = createMockLogger();
  const url = 'wss://stream.bybit.com/v5/trade';
  const apiKey = 'testApiKey';
  const secret = 'testSecret';

  beforeEach(() => {
    jest.clearAllMocks();
    capturedOnOpen = undefined;
  });

  describe('initConnection', () => {
    it('creates ReliableWebSocket with heartbeat', async () => {
      const { ReliableWebSocket } = require('@solncebro/websocket-engine');
      const stream = new BybitTradeStream({ url, logger: mockLogger, apiKey, secret });

      // Trigger initConnection, simulate open with auth
      const connectPromise = stream.connect();
      const mockContext = { send: jest.fn(), waitForMessage: jest.fn().mockResolvedValue(undefined) };
      await capturedOnOpen!(mockContext);
      await connectPromise;

      expect(ReliableWebSocket).toHaveBeenCalledWith(
        expect.objectContaining({
          label: '[Bybit] Trade stream',
          url,
          heartbeat: expect.objectContaining({
            buildPayload: expect.any(Function),
            isResponse: expect.any(Function),
          }),
        }),
      );
    });

    it('authenticates on open', async () => {
      const { authenticateBybitWebSocket } = require('../../src/ws/bybitWebSocketUtils');
      const stream = new BybitTradeStream({ url, logger: mockLogger, apiKey, secret });

      const connectPromise = stream.connect();
      const mockContext = { send: jest.fn(), waitForMessage: jest.fn().mockResolvedValue(undefined) };
      await capturedOnOpen!(mockContext);
      await connectPromise;

      expect(authenticateBybitWebSocket).toHaveBeenCalledWith(
        expect.objectContaining({
          context: mockContext,
          apiKey: 'testApiKey',
          secret: 'testSecret',
          label: '[Bybit] Trade stream',
        }),
      );
    });
  });

  describe('buildOrderRequest', () => {
    it('returns order request with op, args, header, and reqId', () => {
      jest.spyOn(Date, 'now').mockReturnValue(1700000000000);
      const stream = new BybitTradeStream({ url, logger: mockLogger, apiKey, secret });

      const request = (stream as any).buildOrderRequest(
        { category: 'linear', symbol: 'BTCUSDT', side: 'Buy', orderType: 'Market', qty: '0.001' },
        'req-456',
      );

      expect(request).toEqual({
        op: 'order.create',
        args: [{ category: 'linear', symbol: 'BTCUSDT', side: 'Buy', orderType: 'Market', qty: '0.001' }],
        header: { 'X-BAPI-TIMESTAMP': '1700000000000', 'X-BAPI-RECV-WINDOW': '7000' },
        reqId: 'req-456',
      });

      jest.restoreAllMocks();
    });
  });
});
