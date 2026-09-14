import { WebSocketStatus } from '@solncebro/websocket-engine';

import { OkxTradeStream } from '../../src/ws/OkxTradeStream';
import { OkxSymbolMap } from '../../src/exchanges/okxSymbol';
import { OrderSideEnum, OrderTypeEnum } from '../../src/types/common';
import type { CreateOrderWebSocketArgs } from '../../src/types/exchange';
import { createMockLogger } from '../fixtures/mockLogger';
import { createOkxSwapSymbolMap, OKX_BTC_SWAP_INST_ID_CODE } from '../fixtures/okxSymbolMap';

let capturedOnOpen: ((context: any) => Promise<void>) | undefined;

const mockWebSocket = {
  getStatus: jest.fn().mockReturnValue(WebSocketStatus.CONNECTED),
  close: jest.fn(),
  sendToConnectedSocket: jest.fn(),
};

jest.mock('@solncebro/websocket-engine', () => {
  const actual = jest.requireActual('@solncebro/websocket-engine');

  return {
    ...actual,
    ReliableWebSocket: jest.fn().mockImplementation((args: any) => {
      capturedOnOpen = args.onOpen;

      return mockWebSocket;
    }),
  };
});

jest.mock('../../src/ws/okxWebSocketAuth', () => ({
  authenticateOkxWebSocket: jest.fn().mockResolvedValue(undefined),
}));

const CREATE_ARGS: CreateOrderWebSocketArgs = {
  symbol: 'BTCUSDT',
  type: OrderTypeEnum.Market,
  side: OrderSideEnum.Buy,
  amount: 1,
};

const OPERATION_LIST: Array<{ op: string; send: (stream: OkxTradeStream) => Promise<unknown> }> = [
  {
    op: 'order',
    send: (stream) => stream.createOrder({ instId: 'BTC-USDT-SWAP', side: 'buy', ordType: 'market', sz: '1' }),
  },
  {
    op: 'cancel-order',
    send: (stream) => stream.cancelOrder({ instId: 'BTC-USDT-SWAP', ordId: 'o-1' }),
  },
  {
    op: 'amend-order',
    send: (stream) => stream.amendOrder({ instId: 'BTC-USDT-SWAP', ordId: 'o-1', newPx: '30000' }),
  },
  {
    op: 'batch-orders',
    send: (stream) => stream.createBatchOrders(
      [CREATE_ARGS],
      [{ instId: 'BTC-USDT-SWAP', side: 'buy', ordType: 'market', sz: '1' }],
      [1],
    ),
  },
  {
    op: 'batch-amend-orders',
    send: (stream) => stream.modifyBatchOrders(['o-1'], [{ instId: 'BTC-USDT-SWAP', ordId: 'o-1', newPx: '30000' }]),
  },
  {
    op: 'batch-cancel-orders',
    send: (stream) => stream.cancelBatchOrders(['o-1'], [{ instId: 'BTC-USDT-SWAP', ordId: 'o-1' }]),
  },
];

describe('OkxTradeStream instrument addressing', () => {
  const mockLogger = createMockLogger();

  function createStream(symbolMap: OkxSymbolMap): OkxTradeStream {
    return new OkxTradeStream({
      url: 'wss://ws.okx.com:8443/ws/v5/private',
      label: '[OKX] Trade stream',
      logger: mockLogger,
      apiKey: 'testApiKey',
      secret: 'testSecret',
      passphrase: 'testPassphrase',
      symbolMap,
    });
  }

  async function connectStream(stream: OkxTradeStream): Promise<void> {
    const connectPromise = stream.connect();
    await capturedOnOpen!({ send: jest.fn(), waitForMessage: jest.fn().mockResolvedValue(undefined) });
    await connectPromise;
  }

  beforeEach(() => {
    jest.useFakeTimers();
    mockWebSocket.getStatus.mockReturnValue(WebSocketStatus.CONNECTED);
    mockWebSocket.sendToConnectedSocket.mockClear();
    capturedOnOpen = undefined;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it.each(OPERATION_LIST)('addresses the instrument by a numeric instIdCode in $op', async ({ op, send }) => {
    const stream = createStream(createOkxSwapSymbolMap());
    await connectStream(stream);

    send(stream).catch(() => undefined);
    await jest.advanceTimersByTimeAsync(0);

    const sentFrame = mockWebSocket.sendToConnectedSocket.mock.calls[0][0];
    const [firstArgs] = sentFrame.args as Array<Record<string, unknown>>;

    expect(sentFrame.op).toBe(op);
    expect(firstArgs.instIdCode).toBe(OKX_BTC_SWAP_INST_ID_CODE);
    expect(typeof firstArgs.instIdCode).toBe('number');
    expect('instId' in firstArgs).toBe(false);
  });

  it.each(OPERATION_LIST)('sends nothing and reports unloaded instruments in $op when no code is known', async ({ send }) => {
    const stream = createStream(new OkxSymbolMap({ isSwap: true }));
    await connectStream(stream);

    await expect(send(stream)).rejects.toMatchObject({ code: 'OKX_INSTRUMENTS_NOT_LOADED' });
    expect(mockWebSocket.sendToConnectedSocket).not.toHaveBeenCalled();
  });

  it('sends nothing and reports an unresolved symbol when the instrument is missing from a loaded map', async () => {
    const stream = createStream(createOkxSwapSymbolMap());
    await connectStream(stream);

    await expect(
      stream.createOrder({ instId: 'SOL-USDT-SWAP', side: 'buy', ordType: 'market', sz: '1' }),
    ).rejects.toMatchObject({ code: 'OKX_SYMBOL_UNRESOLVED' });
    expect(mockWebSocket.sendToConnectedSocket).not.toHaveBeenCalled();
  });

  it('keeps the caller order params untouched so the same set can go over REST', async () => {
    const stream = createStream(createOkxSwapSymbolMap());
    await connectStream(stream);
    const params = { instId: 'BTC-USDT-SWAP', side: 'buy', ordType: 'market', sz: '1' };

    stream.createOrder(params).catch(() => undefined);
    await jest.advanceTimersByTimeAsync(0);

    expect(params).toEqual({ instId: 'BTC-USDT-SWAP', side: 'buy', ordType: 'market', sz: '1' });
  });
});
