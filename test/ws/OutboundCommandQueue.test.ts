import { OutboundCommandQueue } from '../../src/ws/OutboundCommandQueue';
import { createMockLogger } from '../fixtures/mockLogger';

describe('OutboundCommandQueue', () => {
  const mockLogger = createMockLogger();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('never sends faster than maxCommandsPerSecond in any 1000ms window', async () => {
    jest.useFakeTimers();

    try {
      const maxCommandsPerSecond = 8;
      const sendTimestampList: number[] = [];
      const send = jest.fn(() => {
        sendTimestampList.push(Date.now());
      });
      const queue = new OutboundCommandQueue({
        label: 'test',
        logger: mockLogger,
        maxCommandsPerSecond,
        send,
        onSendFailure: jest.fn(),
      });

      const commandList = Array.from({ length: 100 }, (_unused, index) => ({ id: index }));
      queue.enqueueList(commandList);

      await jest.advanceTimersByTimeAsync(15000);

      expect(sendTimestampList).toHaveLength(commandList.length);

      for (const windowStart of sendTimestampList) {
        const windowEnd = windowStart + 1000;
        const countInWindow = sendTimestampList.filter(
          (timestamp) => timestamp >= windowStart && timestamp < windowEnd,
        ).length;

        expect(countInWindow).toBeLessThanOrEqual(maxCommandsPerSecond);
      }
    } finally {
      jest.useRealTimers();
    }
  });

  it('awaitDrained() resolves only after the last command was sent', async () => {
    jest.useFakeTimers();

    try {
      const sentCommandList: unknown[] = [];
      const queue = new OutboundCommandQueue({
        label: 'test',
        logger: mockLogger,
        maxCommandsPerSecond: 8,
        send: (command) => {
          sentCommandList.push(command);
        },
        onSendFailure: jest.fn(),
      });

      queue.enqueueList([{ id: 1 }, { id: 2 }, { id: 3 }]);

      let isDrained = false;
      const drainedPromise = queue.awaitDrained().then(() => {
        isDrained = true;
      });

      expect(isDrained).toBe(false);
      expect(sentCommandList).toHaveLength(0);

      await jest.advanceTimersByTimeAsync(1000);
      await drainedPromise;

      expect(isDrained).toBe(true);
      expect(sentCommandList).toHaveLength(3);
    } finally {
      jest.useRealTimers();
    }
  });

  it('clear() drops everything pending, resolves waiters, and reports the dropped count in getSnapshot().clearedCommandCount', async () => {
    const sentCommandList: unknown[] = [];
    const queue = new OutboundCommandQueue({
      label: 'test',
      logger: mockLogger,
      maxCommandsPerSecond: 8,
      send: (command) => {
        sentCommandList.push(command);
      },
      onSendFailure: jest.fn(),
    });

    queue.enqueueList([{ id: 1 }, { id: 2 }, { id: 3 }]);

    let isDrained = false;
    const drainedPromise = queue.awaitDrained().then(() => {
      isDrained = true;
    });

    queue.clear('test clear');

    await drainedPromise;

    expect(isDrained).toBe(true);
    expect(sentCommandList).toHaveLength(0);
    expect(queue.getSnapshot()).toMatchObject({
      pendingCommandCount: 0,
      clearedCommandCount: 3,
    });
  });

  it('calls onSendFailure exactly once and stops the drain when send throws', async () => {
    jest.useFakeTimers();

    try {
      const sentCommandList: unknown[] = [];
      const onSendFailure = jest.fn();
      const queue = new OutboundCommandQueue({
        label: 'test',
        logger: mockLogger,
        maxCommandsPerSecond: 8,
        send: (command) => {
          if (sentCommandList.length === 1) {
            throw new Error('send failed');
          }

          sentCommandList.push(command);
        },
        onSendFailure,
      });

      queue.enqueueList([{ id: 1 }, { id: 2 }, { id: 3 }]);

      await jest.advanceTimersByTimeAsync(1000);

      expect(sentCommandList).toHaveLength(1);
      expect(onSendFailure).toHaveBeenCalledTimes(1);
      expect(queue.getSnapshot().pendingCommandCount).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('dispose() makes subsequent enqueue a no-op', () => {
    const send = jest.fn();
    const queue = new OutboundCommandQueue({
      label: 'test',
      logger: mockLogger,
      maxCommandsPerSecond: 8,
      send,
      onSendFailure: jest.fn(),
    });

    queue.dispose();
    queue.enqueue({ id: 1 });
    queue.enqueueList([{ id: 2 }, { id: 3 }]);

    expect(queue.getSnapshot().pendingCommandCount).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });
});
