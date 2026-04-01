import { BaseExchangeClient } from '../../src/exchanges/BaseExchangeClient';

describe('BaseExchangeClient', () => {
  describe('createNotifyHandler', () => {
    let mockExit: jest.SpyInstance;

    beforeEach(() => {
      mockExit = jest.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    });

    afterEach(() => {
      mockExit.mockRestore();
    });

    it('forwards non-critical messages to onNotify', () => {
      const onNotify = jest.fn();
      const handler = (BaseExchangeClient as any).createNotifyHandler(onNotify);

      handler('Connection closed (code 1006), consecutive failures: 1');

      expect(onNotify).toHaveBeenCalledWith('Connection closed (code 1006), consecutive failures: 1');
      expect(mockExit).not.toHaveBeenCalled();
    });

    it('does not call process.exit for non-critical messages', () => {
      const handler = (BaseExchangeClient as any).createNotifyHandler(undefined);

      handler('Connection error: timeout');

      expect(mockExit).not.toHaveBeenCalled();
    });

    it('calls process.exit(1) for CRITICAL messages', () => {
      const handler = (BaseExchangeClient as any).createNotifyHandler(undefined);

      handler('[TestStream] CRITICAL: max retries (15) exceeded after 16 consecutive failures');

      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it('calls onNotify before process.exit for CRITICAL messages', () => {
      const callOrderList: string[] = [];

      const onNotify = jest.fn(() => {
        callOrderList.push('onNotify');
      });
      mockExit.mockImplementation(() => {
        callOrderList.push('exit');
        return undefined as never;
      });

      const handler = (BaseExchangeClient as any).createNotifyHandler(onNotify);

      handler('[TestStream] CRITICAL: max retries (15) exceeded after 16 consecutive failures');

      expect(callOrderList).toEqual(['onNotify', 'exit']);
    });

    it('waits for async onNotify before process.exit on CRITICAL', async () => {
      const callOrderList: string[] = [];

      const onNotify = jest.fn(async () => {
        callOrderList.push('onNotify');
      });
      mockExit.mockImplementation(() => {
        callOrderList.push('exit');
        return undefined as never;
      });

      const handler = (BaseExchangeClient as any).createNotifyHandler(onNotify);
      await handler('[TestStream] CRITICAL: max retries (15) exceeded after 16 consecutive failures');

      expect(callOrderList).toEqual(['onNotify', 'exit']);
    });

    it('calls process.exit even when onNotify is not provided', () => {
      const handler = (BaseExchangeClient as any).createNotifyHandler(undefined);

      handler('[TestStream] CRITICAL: max retries (15) exceeded after 16 consecutive failures');

      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it('calls process.exit even when onNotify throws', () => {
      const onNotify = jest.fn(() => {
        throw new Error('handler error');
      });

      const handler = (BaseExchangeClient as any).createNotifyHandler(onNotify);

      handler('[TestStream] CRITICAL: max retries (15) exceeded after 16 consecutive failures');

      expect(onNotify).toHaveBeenCalled();
      expect(mockExit).toHaveBeenCalledWith(1);
    });
  });
});
