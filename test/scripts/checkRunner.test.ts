import { runCheck } from '../../scripts/exchange-live-check/checkRunner';
import type { ExchangeRunState } from '../../scripts/exchange-live-check/checkRunner.types';
import type { LiveCheck, LiveCheckContext, LiveCheckOutcome } from '../../scripts/exchange-live-check/liveCheck.types';

function createContext(): LiveCheckContext {
  return {
    exchangeName: 'bybit',
    settings: { isOrderAllowed: true },
    exchange: { futures: { getRateLimitState: () => ({ bannedUntilMs: null }) } },
  } as unknown as LiveCheckContext;
}

function createRunState(): ExchangeRunState {
  return { context: null, currentAbortController: null, unsettledOrderProbe: null, isTotalDeadlineReached: false, isCleanupRequired: true };
}

function createCheck(run: LiveCheck['run'], isOrdersRequired = true): LiveCheck {
  return { title: 'probe', timeoutMs: 1_000, isCredentialsRequired: true, isOrdersRequired, run };
}

function waitForAbort(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => signal.addEventListener('abort', () => resolve()));
}

describe('runCheck deadline handling', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('signals the probe to stop on its deadline and waits for its cleanup', async () => {
    const runState = createRunState();
    const cleanupList: string[] = [];
    const check = createCheck(async (_context, signal): Promise<LiveCheckOutcome> => {
      try {
        await waitForAbort(signal);
        signal.throwIfAborted();

        return { status: 'confirmed', fact: 'never' };
      } finally {
        await new Promise((resolve) => setTimeout(resolve, 5_000));
        cleanupList.push('cleaned');
      }
    });

    const pendingEntry = runCheck({ check, context: createContext(), checkNumber: 15, hasCredentials: true, runState });

    await jest.advanceTimersByTimeAsync(7_000);

    const entry = await pendingEntry;

    expect(cleanupList).toEqual(['cleaned']);
    expect(entry.outcome.status).toBe('failed');
    expect(entry.outcome.fact).toContain('свою уборку завершила');
    expect(runState.unsettledOrderProbe).toBeNull();
  });

  it('does not start the next order probe while a timed-out order probe still cleans up', async () => {
    const runState = createRunState();
    let finishCleanup: () => void = () => undefined;
    const stuckCheck = createCheck(async (): Promise<LiveCheckOutcome> => {
      await new Promise<void>((resolve) => {
        finishCleanup = resolve;
      });

      return { status: 'confirmed', fact: 'late' };
    });
    const nextRun = jest.fn(async (): Promise<LiveCheckOutcome> => ({ status: 'confirmed', fact: 'ok' }));

    const pendingEntry = runCheck({ check: stuckCheck, context: createContext(), checkNumber: 15, hasCredentials: true, runState });

    await jest.advanceTimersByTimeAsync(92_000);

    const stuckEntry = await pendingEntry;
    const blockedEntry = await runCheck({ check: createCheck(nextRun), context: createContext(), checkNumber: 16, hasCredentials: true, runState });

    expect(stuckEntry.outcome.fact).toContain('пробы с заявками не запускаются');
    expect(blockedEntry.outcome.status).toBe('incomplete');
    expect(nextRun).not.toHaveBeenCalled();

    finishCleanup();
    await jest.advanceTimersByTimeAsync(0);

    const allowedEntry = await runCheck({ check: createCheck(nextRun), context: createContext(), checkNumber: 16, hasCredentials: true, runState });

    expect(allowedEntry.outcome.status).toBe('confirmed');
    expect(nextRun).toHaveBeenCalledTimes(1);
  });

  it('prints the original check number', async () => {
    const runState = createRunState();
    const logSpy = jest.spyOn(console, 'log');

    await runCheck({ check: createCheck(async () => ({ status: 'confirmed', fact: 'ok' }), false), context: createContext(), checkNumber: 17, hasCredentials: true, runState });

    expect(logSpy.mock.calls.map((call) => String(call[0])).some((line) => line.includes('обещание 17.'))).toBe(true);
  });
});
