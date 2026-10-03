import { sleep } from '../../src/utils/sleep';

describe('sleep', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('resolves only after the given number of milliseconds has elapsed', async () => {
    let isResolved = false;

    sleep(1000).then(() => {
      isResolved = true;
    });

    await jest.advanceTimersByTimeAsync(999);
    expect(isResolved).toBe(false);

    await jest.advanceTimersByTimeAsync(1);
    expect(isResolved).toBe(true);
  });

  it('keeps the process alive while it is awaited — an unref-ed pause let the bot exit silently mid-start', async () => {
    jest.useRealTimers();

    const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
    const pause = sleep(5);
    const timer = setTimeoutSpy.mock.results[0].value as NodeJS.Timeout;

    expect(timer.hasRef()).toBe(true);

    await pause;
    setTimeoutSpy.mockRestore();
  });
});
