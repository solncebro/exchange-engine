import { BaseExchangeClient } from '../../src/exchanges/BaseExchangeClient';

describe('BaseExchangeClient', () => {
  describe('createNotifyHandler', () => {
    it('forwards non-critical messages to onNotify', () => {
      const onNotify = jest.fn();
      const handler = (BaseExchangeClient as any).createNotifyHandler(onNotify);

      handler('Connection closed (code 1006), consecutive failures: 1');

      expect(onNotify).toHaveBeenCalledWith('Connection closed (code 1006), consecutive failures: 1');
    });

    it('does not call process.exit for non-critical messages', () => {
      const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => undefined as never);
      const handler = (BaseExchangeClient as any).createNotifyHandler(undefined);

      handler('Connection error: timeout');

      expect(mockExit).not.toHaveBeenCalled();
      mockExit.mockRestore();
    });

    it('forwards CRITICAL messages to onNotify', () => {
      const onNotify = jest.fn();
      const handler = (BaseExchangeClient as any).createNotifyHandler(onNotify);

      handler('[TestStream] CRITICAL: max retries (15) exceeded after 16 consecutive failures');

      expect(onNotify).toHaveBeenCalledWith(
        '[TestStream] CRITICAL: max retries (15) exceeded after 16 consecutive failures',
      );
    });

    it('does not call process.exit for CRITICAL messages', () => {
      const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => undefined as never);
      const handler = (BaseExchangeClient as any).createNotifyHandler(undefined);

      handler('[TestStream] CRITICAL: max retries (15) exceeded after 16 consecutive failures');

      expect(mockExit).not.toHaveBeenCalled();
      mockExit.mockRestore();
    });

    it('works when onNotify is not provided', () => {
      const handler = (BaseExchangeClient as any).createNotifyHandler(undefined);

      expect(() => handler('some message')).not.toThrow();
    });

    it('forwards async onNotify return value', async () => {
      const onNotify = jest.fn(async () => {});
      const handler = (BaseExchangeClient as any).createNotifyHandler(onNotify);

      await handler('[TestStream] CRITICAL: max retries (15) exceeded after 16 consecutive failures');

      expect(onNotify).toHaveBeenCalled();
    });
  });
  // Раньше эти два метода звались через необязательный доступ: если поток их не умеет, код
  // отрабатывал молча — данных нет, ошибки нет. Худший вид отказа: о нём узнаёшь только по
  // отсутствию торговли.
  describe('capabilities the stream does not have refuse loudly', () => {
    const buildClientWithBareStream = () => {
      const client = Object.create(BaseExchangeClient.prototype) as Record<string, unknown>;
      client.marketLabel = 'futures';
      (client as { getPublicStream: () => unknown }).getPublicStream = () => ({});

      return client as unknown as {
        setOrderbookLiveSymbol: (args: { symbol: string; isLive: boolean }) => void;
        subscribeRawOrderbook: (handler: () => void) => void;
        unsubscribeRawOrderbook: (handler: () => void) => void;
      };
    };

    it('refuses to mark a live orderbook symbol', () => {
      const client = buildClientWithBareStream();

      expect(() => client.setOrderbookLiveSymbol({ symbol: 'BTCUSDT', isLive: true })).toThrow(/not supported/i);
    });

    it('refuses a raw orderbook subscription', () => {
      const client = buildClientWithBareStream();

      expect(() => client.subscribeRawOrderbook(() => undefined)).toThrow(/not supported/i);
    });

    it('stays quiet on unsubscribe: tidying up promises no data', () => {
      const client = buildClientWithBareStream();

      expect(() => client.unsubscribeRawOrderbook(() => undefined)).not.toThrow();
    });
  });
});
