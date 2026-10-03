import axios from 'axios';
import { BybitLinear } from '../../src/exchanges/BybitLinear';
import { BybitSpot } from '../../src/exchanges/BybitSpot';
import { PendingRequestKind } from '../../src/ws/BaseTradeStream.types';
import { createMockLogger } from '../fixtures/mockLogger';
import { createMockAxiosInstance } from '../fixtures/mockAxios';

jest.mock('axios');
jest.mock('../../src/ws/BybitPublicStream');

jest.mock('@solncebro/websocket-engine', () => {
  const actual = jest.requireActual('@solncebro/websocket-engine');

  return {
    ...actual,
    ReliableWebSocket: jest.fn().mockImplementation(() => ({
      getStatus: jest.fn().mockReturnValue(1),
      close: jest.fn(),
      sendToConnectedSocket: jest.fn(),
    })),
  };
});

const mockedAxios = axios as jest.Mocked<typeof axios>;

const BYBIT_SINGLE_ORDER_RESPONSE_HEADER = {
  'X-Bapi-Limit': '17',
  'X-Bapi-Limit-Status': '16',
  'X-Bapi-Limit-Reset-Timestamp': '1700000001000',
};

function createLinear() {
  const mockInstance = createMockAxiosInstance();
  mockedAxios.create.mockReturnValue(mockInstance as any);

  const client = new BybitLinear({
    config: { apiKey: 'testKey', secret: 'testSecret', isDemoMode: false },
    logger: createMockLogger(),
  });

  return client;
}

/** Проигрывает ответ биржи на ОДИНОЧНУЮ постановку через настоящий торговый канал клиента. */
function replaySingleOrderResponse(client: BybitLinear, header?: Record<string, string>): void {
  const tradeStream = (client as any).tradeStream;
  const requestId = 'single-order-req';

  tradeStream.pendingRequestByRequestId.set(requestId, {
    kind: PendingRequestKind.SingleOrder,
    resolve: jest.fn(),
    reject: jest.fn(),
    timeout: setTimeout(() => {}, 0),
  });

  tradeStream.handleMessage({
    op: 'order.create',
    reqId: requestId,
    retCode: 0,
    data: { orderId: 'order-1', orderLinkId: 'link-1' },
    header,
  });
}

describe('Bybit — the order rate limit named by the exchange itself', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  // Verbatim production answers, 17.09.2026 (one BTCUSDT limit at half the market, cancelled at once).
  it('reads the limit from the LIVE order.create header', async () => {
    const client = createLinear();
    replaySingleOrderResponse(client, {
      'X-Bapi-Limit': '10',
      'X-Bapi-Limit-Status': '9',
      'X-Bapi-Limit-Reset-Timestamp': '1789625407001',
      Traceid: '05ace6f48cf92466532f0f0f468b69ca',
      Timenow: '1789625407046',
    });

    await expect(client.getOrderRateLimit()).resolves.toEqual({ writeRequestsPerSecond: 10, source: 'bybit-exchange-header' });
  });

  it('keeps the documented limit when a live refusal carries only Traceid and Timenow', async () => {
    const client = createLinear();
    const tradeStream = (client as any).tradeStream;
    const reject = jest.fn();

    tradeStream.pendingRequestByRequestId.set('refused-req', { kind: PendingRequestKind.SingleOrder, resolve: jest.fn(), reject, timeout: setTimeout(() => {}, 0) });
    tradeStream.handleMessage({
      reqId: 'refused-req',
      retCode: 10010,
      retMsg: "Unmatched IP, please check your API key's bound IP addresses.",
      op: 'order.create',
      data: {},
      retExtInfo: {},
      header: { Traceid: '2a84eb8c07b43a52045c6379a0632924', Timenow: '1789625381957' },
    });

    expect(reject).toHaveBeenCalledTimes(1);
    await expect(client.getOrderRateLimit()).resolves.toEqual({ writeRequestsPerSecond: 10, source: 'bybit-documented' });
  });

  it('reports the limit from the single-order response header, not the documented constant', async () => {
    const client = createLinear();
    replaySingleOrderResponse(client, BYBIT_SINGLE_ORDER_RESPONSE_HEADER);

    // Счёт, торгующий одиночными заявками, до этой правки вечно жил на зашитой цифре.
    await expect(client.getOrderRateLimit()).resolves.toEqual({
      writeRequestsPerSecond: 17,
      source: 'bybit-exchange-header',
    });
  });

  it('falls back to the documented limit while the exchange has named none', async () => {
    const client = createLinear();

    await expect(client.getOrderRateLimit()).resolves.toEqual({
      writeRequestsPerSecond: 10,
      source: 'bybit-documented',
    });
  });

  it('keeps the documented limit when the response carries no rate-limit header', async () => {
    const client = createLinear();
    replaySingleOrderResponse(client, undefined);

    await expect(client.getOrderRateLimit()).resolves.toEqual({
      writeRequestsPerSecond: 10,
      source: 'bybit-documented',
    });
  });

  it('keeps the documented spot limit untouched', async () => {
    const mockInstance = createMockAxiosInstance();
    mockedAxios.create.mockReturnValue(mockInstance as any);

    const client = new BybitSpot({
      config: { apiKey: 'testKey', secret: 'testSecret', isDemoMode: false },
      logger: createMockLogger(),
    });

    await expect(client.getOrderRateLimit()).resolves.toEqual({
      writeRequestsPerSecond: 20,
      source: 'bybit-documented',
    });
  });
});
