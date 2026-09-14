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
});
