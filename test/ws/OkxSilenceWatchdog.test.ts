import { OkxSilenceWatchdog } from '../../src/ws/OkxSilenceWatchdog';
import { OKX_SILENT_THRESHOLD_MS, OKX_STALE_CHECK_INTERVAL_MS } from '../../src/constants/okx';

describe('OkxSilenceWatchdog', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function createWatchdog(onSilent: jest.Mock): OkxSilenceWatchdog {
    return new OkxSilenceWatchdog({ silentThresholdMs: OKX_SILENT_THRESHOLD_MS, onSilent });
  }

  it('reports silence once the data threshold is passed and keeps reporting — the caller owns the cure', () => {
    const onSilent = jest.fn();
    const watchdog = createWatchdog(onSilent);

    watchdog.start();

    jest.advanceTimersByTime(OKX_SILENT_THRESHOLD_MS + OKX_STALE_CHECK_INTERVAL_MS);
    expect(onSilent).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(OKX_SILENT_THRESHOLD_MS + OKX_STALE_CHECK_INTERVAL_MS);
    expect(onSilent).toHaveBeenCalledTimes(2);

    watchdog.stop();
  });

  it('stays quiet while content keeps arriving', () => {
    const onSilent = jest.fn();
    const watchdog = createWatchdog(onSilent);

    watchdog.start();

    for (let i = 0; i < 10; i++) {
      jest.advanceTimersByTime(OKX_SILENT_THRESHOLD_MS / 2);
      watchdog.noteContentMessage();
    }

    expect(onSilent).not.toHaveBeenCalled();

    watchdog.stop();
  });

  it('stays quiet just under the threshold and fires just over it', () => {
    const onSilent = jest.fn();
    const watchdog = createWatchdog(onSilent);

    watchdog.start();

    jest.advanceTimersByTime(OKX_SILENT_THRESHOLD_MS);
    expect(onSilent).not.toHaveBeenCalled();

    jest.advanceTimersByTime(OKX_STALE_CHECK_INTERVAL_MS);
    expect(onSilent).toHaveBeenCalledTimes(1);

    watchdog.stop();
  });

  it('stop clears the timer so nothing fires afterwards', () => {
    const onSilent = jest.fn();
    const watchdog = createWatchdog(onSilent);

    watchdog.start();
    watchdog.stop();

    jest.advanceTimersByTime(OKX_SILENT_THRESHOLD_MS * 3);

    expect(onSilent).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('start is idempotent — calling it twice leaves a single timer, not two', () => {
    const onSilent = jest.fn();
    const watchdog = createWatchdog(onSilent);

    watchdog.start();
    watchdog.start();

    expect(jest.getTimerCount()).toBe(1);

    jest.advanceTimersByTime(OKX_SILENT_THRESHOLD_MS + OKX_STALE_CHECK_INTERVAL_MS);
    expect(onSilent).toHaveBeenCalledTimes(1);

    watchdog.stop();
  });

  it('start resets the clock, so a restart does not inherit the silence that came before it', () => {
    const onSilent = jest.fn();
    const watchdog = createWatchdog(onSilent);

    watchdog.start();

    jest.advanceTimersByTime(OKX_SILENT_THRESHOLD_MS);
    watchdog.start();
    jest.advanceTimersByTime(OKX_SILENT_THRESHOLD_MS);

    expect(onSilent).not.toHaveBeenCalled();

    watchdog.stop();
  });
});
