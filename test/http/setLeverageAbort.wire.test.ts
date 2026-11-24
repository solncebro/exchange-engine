import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { BinanceFuturesHttpClient } from '../../src/http/BinanceFuturesHttpClient';
import { BybitHttpClient } from '../../src/http/BybitHttpClient';
import { createMockLogger } from '../fixtures/mockLogger';

// Real axios on a real socket: a server that never answers stands in for a hanging exchange, and the
// test proves the caller's signal closes the connection — not merely stops waiting for it.
interface HangingServer {
  baseUrl: string;
  waitForRequest: () => Promise<void>;
  waitForClientClose: () => Promise<void>;
  close: () => Promise<void>;
}

async function startHangingServer(): Promise<HangingServer> {
  let markRequest: () => void = () => undefined;
  let markClientClose: () => void = () => undefined;
  const requestSeen = new Promise<void>((resolve) => { markRequest = resolve; });
  const clientClosed = new Promise<void>((resolve) => { markClientClose = resolve; });
  const server = http.createServer((request) => {
    request.socket.on('close', () => markClientClose());
    markRequest();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  const { port } = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    waitForRequest: () => requestSeen,
    waitForClientClose: () => clientClosed,
    close: () => {
      server.closeAllConnections();

      return new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

describe('setLeverage cancelled by the caller on a real socket', () => {
  let server: HangingServer;

  beforeEach(async () => {
    server = await startHangingServer();
  });

  afterEach(async () => {
    await server.close();
  });

  it('Binance: the hanging request is aborted and its connection closed', async () => {
    const client = new BinanceFuturesHttpClient({ baseUrl: server.baseUrl, apiKey: 'k', secret: 's', logger: createMockLogger() });
    const controller = new AbortController();
    const pending = client.setLeverage('BTCUSDT', 5, controller.signal).then(() => 'answered', (error: unknown) => error);

    await server.waitForRequest();
    const abortedAtMs = Date.now();
    controller.abort(new Error('caller deadline'));

    const outcome = await pending;

    expect(outcome).toBeInstanceOf(Error);
    expect(Date.now() - abortedAtMs).toBeLessThan(1000);
    await server.waitForClientClose();
  });

  it('Bybit: the hanging request is aborted and its connection closed', async () => {
    const client = new BybitHttpClient({ baseUrl: server.baseUrl, apiKey: 'k', secret: 's', logger: createMockLogger() });
    const controller = new AbortController();
    const pending = client
      .setLeverage({ category: 'linear', symbol: 'BTCUSDT', buyLeverage: 5, sellLeverage: 5, signal: controller.signal })
      .then(() => 'answered', (error: unknown) => error);

    await server.waitForRequest();
    const abortedAtMs = Date.now();
    controller.abort(new Error('caller deadline'));

    const outcome = await pending;

    expect(outcome).toBeInstanceOf(Error);
    expect(Date.now() - abortedAtMs).toBeLessThan(1000);
    await server.waitForClientClose();
  });
});
