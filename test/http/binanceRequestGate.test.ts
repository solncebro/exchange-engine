import {
  BINANCE_BAN_MAX_WAIT_MS,
  BINANCE_BAN_RELEASE_SPACING_MS,
} from '../../src/http/binanceRateLimit';
import { getBinanceRequestGate, resetBinanceRequestGateRegistry } from '../../src/http/binanceRequestGate';
import { createMockLogger } from '../fixtures/mockLogger';

const BASE_URL = 'https://fapi.binance.com';
const OTHER_URL = 'https://fapi.binance.com/fapi/v1';

function banBody(untilMs: number): Record<string, unknown> {
  return { code: -1003, msg: `Way too many requests; IP(51.79.167.222) banned until ${untilMs}. Please use the websocket for live updates to avoid bans.` };
}

describe('BinanceRequestGate', () => {
  let logger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    jest.useFakeTimers();
    resetBinanceRequestGateRegistry();
    logger = createMockLogger();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('lets a request through instantly while the door is open', async () => {
    const gate = getBinanceRequestGate(BASE_URL);
    let hasPassed = false;

    await gate.waitForTurn(logger).then(() => {
      hasPassed = true;
    });

    expect(hasPassed).toBe(true);
  });

  it('holds the request for the WHOLE ban the exchange named, not for a minute', async () => {
    const gate = getBinanceRequestGate(BASE_URL);
    const banMs = 8 * 60 * 1000;
    gate.observe({ status: 418, headers: {}, body: banBody(Date.now() + banMs), logger });

    let hasPassed = false;
    const turn = gate.waitForTurn(logger).then(() => {
      hasPassed = true;
    });

    await jest.advanceTimersByTimeAsync(60_000);
    expect(hasPassed).toBe(false); // старая обрезка до минуты выпустила бы его здесь

    await jest.advanceTimersByTimeAsync(banMs);
    await turn;
    expect(hasPassed).toBe(true);
  });

  it('is shared by every connection to the same host — one ban stops them all', async () => {
    const seen = getBinanceRequestGate(BASE_URL);
    const other = getBinanceRequestGate(OTHER_URL);
    seen.observe({ status: 418, headers: {}, body: banBody(Date.now() + 120_000), logger });

    let hasPassed = false;
    const turn = other.waitForTurn(logger).then(() => {
      hasPassed = true;
    });

    await jest.advanceTimersByTimeAsync(1000);
    expect(hasPassed).toBe(false);

    await jest.advanceTimersByTimeAsync(120_000);
    await turn;
    expect(hasPassed).toBe(true);
  });

  it('releases what piled up ONE BY ONE, never as the burst that earned the ban', async () => {
    const gate = getBinanceRequestGate(BASE_URL);
    gate.observe({ status: 418, headers: {}, body: banBody(Date.now() + 60_000), logger });

    const passedList: number[] = [];
    const turnList = [0, 1, 2, 3].map((index) =>
      gate.waitForTurn(logger).then(() => {
        passedList.push(index);
      }),
    );

    await jest.advanceTimersByTimeAsync(60_000);
    expect(passedList).toEqual([0]);

    await jest.advanceTimersByTimeAsync(BINANCE_BAN_RELEASE_SPACING_MS);
    expect(passedList).toEqual([0, 1]);

    await jest.advanceTimersByTimeAsync(BINANCE_BAN_RELEASE_SPACING_MS * 2);
    await Promise.all(turnList);
    expect(passedList).toEqual([0, 1, 2, 3]);
  });

  it('refuses without sending when the ban outlasts the waiting ceiling', async () => {
    const gate = getBinanceRequestGate(BASE_URL);
    const bannedUntilMs = Date.now() + BINANCE_BAN_MAX_WAIT_MS + 60_000;
    gate.observe({ status: 418, headers: {}, body: banBody(bannedUntilMs), logger });

    await expect(gate.waitForTurn(logger)).rejects.toThrow(new Date(bannedUntilMs).toISOString());
  });

  it('says it once, with the real deadline, and says when the door opens again', async () => {
    const gate = getBinanceRequestGate(BASE_URL);
    const bannedUntilMs = Date.now() + 120_000;
    gate.observe({ status: 418, headers: {}, body: banBody(bannedUntilMs), logger });
    gate.observe({ status: 418, headers: {}, body: banBody(bannedUntilMs), logger });

    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining(new Date(bannedUntilMs).toISOString()));

    const turn = gate.waitForTurn(logger);
    await jest.advanceTimersByTimeAsync(120_000);
    await turn;

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('lifted'));
  });

  it('reports what is left of the address budget, and says nothing until the exchange has spoken', () => {
    const gate = getBinanceRequestGate(BASE_URL);

    expect(gate.readState()).toEqual({ usedWeight: null, weightLimit: 2400, observedAtMs: null, bannedUntilMs: null });

    gate.observe({ status: 200, headers: { 'x-mbx-used-weight-1m': '1500' }, body: [], logger });

    expect(gate.readState()).toEqual({ usedWeight: 1500, weightLimit: 2400, observedAtMs: Date.now(), bannedUntilMs: null });
  });
});
