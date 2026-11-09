import { futuresTickerCheck } from '../../scripts/exchange-live-check/tickerChecks';
import type { LiveCheckContext } from '../../scripts/exchange-live-check/liveCheck.types';
import type { PublicTrade, Ticker, TradeSymbol } from '../../src/types/common';

const NOW_MS = 1793883954764;
const DAY_MS = 86_400_000;
const STALE_MS = NOW_MS - 20 * DAY_MS;

function makeTicker(symbol: string, timestamp: number): Ticker {
  return { symbol, lastPrice: 100, openPrice: 100, highPrice: 100, lowPrice: 100, priceChangePercent: 0, volume: 1, quoteVolume: 100, timestamp };
}

function makeTradeSymbol(isActive: boolean): TradeSymbol {
  return { isActive } as TradeSymbol;
}

function createContext(args: { idleTimestamp: number; tradeList: PublicTrade[] | null; isIdleActive: boolean; isLoaded: boolean }) {
  const tickerBySymbol = new Map([
    ['BTCUSDT', makeTicker('BTCUSDT', NOW_MS)],
    ['IDLEUSDT', makeTicker('IDLEUSDT', args.idleTimestamp)],
  ]);
  const loadedTradeSymbolBySymbol = new Map([
    ['BTCUSDT', makeTradeSymbol(true)],
    ['IDLEUSDT', makeTradeSymbol(args.isIdleActive)],
  ]);
  const client = {
    tradeSymbols: args.isLoaded ? loadedTradeSymbolBySymbol : new Map(),
    fetchTrades: jest.fn(async () => {
      if (args.tradeList === null) {
        throw new Error('trades unavailable');
      }

      return args.tradeList;
    }),
  };
  const readTradeSymbols = jest.fn(async () => loadedTradeSymbolBySymbol);
  const context = {
    readFuturesTickers: async () => tickerBySymbol,
    readTradeSymbols,
    exchange: { futures: client },
    settings: { futuresSymbol: 'BTCUSDT' },
  } as unknown as LiveCheckContext;

  return { context, client, readTradeSymbols };
}

function makeTrade(timestamp: number): PublicTrade {
  return { timestamp } as PublicTrade;
}

describe('futuresTickerCheck', () => {
  const abortSignal = new AbortController().signal;

  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW_MS);
  });

  it.each([
    ['seconds', Math.floor(STALE_MS / 1000)],
    ['zero', 0],
    ['negative', -5],
  ])('treats a last trade time in %s as a violation, not as exchange data', async (_label, tradeTimestamp) => {
    const { context } = createContext({ idleTimestamp: STALE_MS, tradeList: [makeTrade(tradeTimestamp)], isIdleActive: true, isLoaded: true });

    const outcome = await futuresTickerCheck.run(context, abortSignal);

    expect(outcome.status).toBe('diverged');
    expect(outcome.fact).toContain('не миллисекунды больше нуля');
  });

  it('keeps a real idle tradable instrument as exchange data', async () => {
    const { context } = createContext({ idleTimestamp: STALE_MS, tradeList: [makeTrade(STALE_MS)], isIdleActive: true, isLoaded: true });

    const outcome = await futuresTickerCheck.run(context, abortSignal);

    expect(outcome.status).toBe('confirmed');
    expect(outcome.fact).toContain('инструмент числится торгуемым, но сделок по нему нет');
  });

  it('keeps a fresh last trade of a stale ticker as a violation', async () => {
    const { context } = createContext({ idleTimestamp: STALE_MS, tradeList: [makeTrade(NOW_MS - 1000)], isIdleActive: true, isLoaded: true });

    const outcome = await futuresTickerCheck.run(context, abortSignal);

    expect(outcome.status).toBe('diverged');
  });

  it('reads an empty trade list of a stale tradable instrument with consistent own fields as exchange data', async () => {
    const { context } = createContext({ idleTimestamp: STALE_MS, tradeList: [], isIdleActive: true, isLoaded: true });

    const outcome = await futuresTickerCheck.run(context, abortSignal);

    expect(outcome.status).toBe('confirmed');
    expect(outcome.fact).toContain('сделок биржа не отдала — сверить не с чем');
  });

  it('treats a future timestamp as a violation even when the instrument is not tradable', async () => {
    const { context } = createContext({ idleTimestamp: NOW_MS + 10 * DAY_MS, tradeList: [], isIdleActive: false, isLoaded: true });

    const outcome = await futuresTickerCheck.run(context, abortSignal);

    expect(outcome.status).toBe('diverged');
    expect(outcome.fact).toContain('в будущем');
    expect(outcome.fact).not.toContain('заморозила сутки');
  });

  it('keeps a stale non-tradable instrument as frozen day', async () => {
    const { context } = createContext({ idleTimestamp: STALE_MS, tradeList: [], isIdleActive: false, isLoaded: true });

    const outcome = await futuresTickerCheck.run(context, abortSignal);

    expect(outcome.status).toBe('confirmed');
    expect(outcome.fact).toContain('заморозила сутки');
  });

  it('loads instruments through the context cache when none are loaded instead of treating everything as tradable', async () => {
    const { context, client, readTradeSymbols } = createContext({ idleTimestamp: STALE_MS, tradeList: null, isIdleActive: false, isLoaded: false });

    const outcome = await futuresTickerCheck.run(context, abortSignal);

    expect(readTradeSymbols).toHaveBeenCalledWith(client);
    expect(client.fetchTrades).not.toHaveBeenCalled();
    expect(outcome.status).toBe('confirmed');
    expect(outcome.fact).toContain('заморозила сутки');
  });
});
