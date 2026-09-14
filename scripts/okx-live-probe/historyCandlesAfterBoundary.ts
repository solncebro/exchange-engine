import type { OkxProbe, OkxProbeContext, OkxProbeOutcome } from './probe.types';

const CLAIM = 'В history-candles параметр after ИСКЛЮЧАЕТ свечу с такой же отметкой времени';
const EXPECTATION = 'При after = ts граничная свеча не приходит; при after = ts + 1 — приходит';
const PROBE_TIMEOUT_MS = 30000;
const PAGE_LIMIT = 3;

function takeTimestampList(rowList: string[][]): string[] {
  return rowList.map((row) => row[0]);
}

async function runHistoryCandlesAfterBoundaryProbe(context: OkxProbeContext): Promise<OkxProbeOutcome> {
  const baseRowList = await context.httpClient.fetchHistoryCandles({
    instId: context.settings.instId,
    bar: '1m',
    limit: PAGE_LIMIT,
  });

  context.showEvidence('исходная страница history-candles (дословно)', baseRowList);

  const boundaryTimestamp = baseRowList[0]?.[0] ?? '';

  if (boundaryTimestamp === '') {
    return { status: 'failed', fact: 'биржа не отдала ни одной свечи — границу не от чего отсчитывать', expectation: EXPECTATION };
  }

  const atBoundaryRowList = await context.httpClient.fetchHistoryCandles({
    instId: context.settings.instId,
    bar: '1m',
    limit: PAGE_LIMIT,
    after: boundaryTimestamp,
  });
  const pastBoundaryRowList = await context.httpClient.fetchHistoryCandles({
    instId: context.settings.instId,
    bar: '1m',
    limit: PAGE_LIMIT,
    after: String(Number(boundaryTimestamp) + 1),
  });

  const atBoundaryTimestampList = takeTimestampList(atBoundaryRowList);
  const pastBoundaryTimestampList = takeTimestampList(pastBoundaryRowList);

  context.showEvidence(`ответ при after = ${boundaryTimestamp} (дословно)`, atBoundaryRowList);
  context.showEvidence(`ответ при after = ${Number(boundaryTimestamp) + 1} (дословно)`, pastBoundaryRowList);
  context.showEvidence('отметки времени: at / past', { at: atBoundaryTimestampList, past: pastBoundaryTimestampList });

  const isBoundaryExcluded = !atBoundaryTimestampList.includes(boundaryTimestamp);
  const isBoundaryIncludedPastIt = pastBoundaryTimestampList.includes(boundaryTimestamp);

  if (isBoundaryExcluded && isBoundaryIncludedPastIt) {
    return {
      status: 'confirmed',
      fact: `при after = ${boundaryTimestamp} границы нет, при after = ${Number(boundaryTimestamp) + 1} она есть`,
      expectation: EXPECTATION,
    };
  }

  return {
    status: 'diverged',
    fact: `граница ${boundaryTimestamp}: при after = ts ${isBoundaryExcluded ? 'исключена' : 'включена'}, при after = ts + 1 ${isBoundaryIncludedPastIt ? 'включена' : 'исключена'}`,
    expectation: EXPECTATION,
  };
}

export const historyCandlesAfterBoundaryProbe: OkxProbe = {
  claim: CLAIM,
  timeoutMs: PROBE_TIMEOUT_MS,
  isOrdersRequired: false,
  run: runHistoryCandlesAfterBoundaryProbe,
};
