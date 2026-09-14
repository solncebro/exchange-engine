import type { Kline } from '../../src/types/common';
import { formatTimestamp, joinViolationSample } from './checkSupport';
import type { LiveCheck, LiveCheckContext, LiveCheckOutcome } from './liveCheck.types';

const TIMEOUT_MS = 60_000;
const RECENT_KLINE_LIMIT = 50;
const MINUTE_MS = 60_000;
const WINDOW_MINUTE_COUNT = 60;
const WINDOW_OFFSET_MS = 2 * 60 * 60 * 1000;

function collectOrderViolations(klineList: Kline[]): string[] {
  const violationList: string[] = [];
  let zeroCloseTimestampCount = 0;

  for (const [index, kline] of klineList.entries()) {
    const previous = index === 0 ? null : klineList[index - 1];

    if (previous !== null && kline.openTimestamp <= previous.openTimestamp) {
      violationList.push(`свеча ${index}: открытие ${kline.openTimestamp} не позже предыдущего ${previous.openTimestamp}`);
    }

    if (kline.closeTimestamp === 0) {
      zeroCloseTimestampCount += 1;
    } else if (kline.closeTimestamp <= kline.openTimestamp) {
      violationList.push(`свеча ${index}: закрытие ${kline.closeTimestamp} не позже открытия ${kline.openTimestamp}`);
    }
  }

  if (zeroCloseTimestampCount > 0) {
    violationList.push(`у ${zeroCloseTimestampCount} свечей время закрытия нулевое — биржа его не отдаёт, а библиотека не досчитывает`);
  }

  return violationList;
}

async function checkKlineContract(context: LiveCheckContext): Promise<LiveCheckOutcome> {
  const client = context.exchange.futures;
  const symbol = context.settings.futuresSymbol;

  await client.loadTradeSymbols();

  const recentList = await client.fetchKlines(symbol, '1m', { limit: RECENT_KLINE_LIMIT });

  if (recentList.length === 0) {
    return { status: 'diverged', fact: `${symbol}: биржа не отдала ни одной минутной свечи` };
  }

  const violationList = collectOrderViolations(recentList);
  const lastKline = recentList[recentList.length - 1];

  if (lastKline.isClosed === true) {
    violationList.push('последняя свеча помечена закрытой, хотя минута ещё идёт');
  }

  const endTime = Date.now() - WINDOW_OFFSET_MS;
  const startTime = endTime - WINDOW_MINUTE_COUNT * MINUTE_MS;
  const windowList = await client.fetchKlines(symbol, '1m', { startTime, endTime, limit: WINDOW_MINUTE_COUNT });
  const outsideList = windowList.filter((kline) => kline.openTimestamp < startTime || kline.openTimestamp > endTime);

  if (windowList.length === 0) {
    violationList.push('запрос окном по времени вернул пустой список');
  }

  if (outsideList.length > 0) {
    violationList.push(`вне запрошенного окна ${outsideList.length} свечей, первая на ${formatTimestamp(outsideList[0].openTimestamp)}`);
  }

  const summaryText =
    `${symbol}: свежих свечей ${recentList.length}, последняя открыта ${formatTimestamp(lastKline.openTimestamp)}, ` +
    `признак закрытия ${String(lastKline.isClosed)}, время закрытия ${lastKline.closeTimestamp} ` +
    `(длина свечи по отметкам ${lastKline.closeTimestamp - lastKline.openTimestamp} мс при интервале ${MINUTE_MS} мс); ` +
    `окном по времени пришло ${windowList.length} свечей, все внутри окна: ${outsideList.length === 0}`;

  if (violationList.length > 0) {
    return { status: 'diverged', fact: `${summaryText}; нарушений ${violationList.length}: ${joinViolationSample(violationList)}` };
  }

  return { status: 'confirmed', fact: summaryText };
}

export const klineCheck: LiveCheck = {
  title: 'Свечи (контракты): время по возрастанию, закрытие позже открытия, окно соблюдается',
  timeoutMs: TIMEOUT_MS,
  isCredentialsRequired: false,
  isOrdersRequired: false,
  run: checkKlineContract,
};
