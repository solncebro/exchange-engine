import type { Ticker } from '../../src/types/common';
import { formatNumber, formatTimestamp, isPositiveFiniteNumber, joinViolationSample } from './checkSupport';
import type { CheckTickerMapArgs, LiveCheck, LiveCheckOutcome, PercentVerdict } from './liveCheck.types';

/** Демо-вход спота Binance отдаёт список тикеров так же неровно, как список инструментов. */
const TIMEOUT_MS = 180_000;
/** Допуск сверки процента изменения — сотая доля процентного пункта. */
const PERCENT_ABSOLUTE_TOLERANCE = 0.01;
/**
 * У величин порядка 10^14 (учебная пара демо-стенда, ушедшая с цены 100) сам шаг двоичной дроби
 * крупнее сотой доли пункта, поэтому у больших значений допуск берётся долей от величины.
 */
const PERCENT_RELATIVE_TOLERANCE = 0.000001;
const MILLISECOND_TIMESTAMP_FLOOR = 1_000_000_000_000;
const TIMESTAMP_PAST_TOLERANCE_MS = 7 * 24 * 60 * 60 * 1000;
const TIMESTAMP_FUTURE_TOLERANCE_MS = 60 * 1000;

/**
 * У процента изменения сверяется НЕ величина, а арифметика: он обязан совпадать с ростом от цены на
 * начало суток к последней. Порог правдоподобия (было «не больше 1000 %») сваливал в одну кучу
 * настоящую беду — величина не число — и подлинные числа демо-стенда: учебная пара OKX, чья цена
 * ушла со ста до 5·10^14, даёт полтриллиона процентов и при этом арифметически безупречна.
 * Инструмент, по которому за сутки не было ни одной сделки или нет цены на начало суток, сверять
 * не с чем: это данные биржи, а не расхождение библиотеки, и статус они не портят.
 */
function verifyPriceChangePercent(symbol: string, ticker: Ticker): PercentVerdict {
  const { priceChangePercent, lastPrice, openPrice, volume } = ticker;

  if (!Number.isFinite(priceChangePercent)) {
    return {
      kind: 'violation',
      text: `${symbol}: изменение цены '${String(priceChangePercent)}' — вообще не число, хотя договор обещает проценты`,
    };
  }

  if (volume === 0 || !isPositiveFiniteNumber(openPrice) || !isPositiveFiniteNumber(lastPrice)) {
    return {
      kind: 'exchangeData',
      text:
        `${symbol}: изменение ${formatNumber(priceChangePercent)} % сверять не с чем — суточный объём ` +
        `${formatNumber(volume)}, цена на начало суток ${formatNumber(openPrice)}, последняя ${formatNumber(lastPrice)}`,
    };
  }

  const expectedPercent = ((lastPrice - openPrice) / openPrice) * 100;
  const allowedGap = Math.max(PERCENT_ABSOLUTE_TOLERANCE, Math.abs(expectedPercent) * PERCENT_RELATIVE_TOLERANCE);

  if (Math.abs(priceChangePercent - expectedPercent) > allowedGap) {
    return {
      kind: 'violation',
      text:
        `${symbol}: изменение ${formatNumber(priceChangePercent)} % не сходится с ростом цены с ` +
        `${formatNumber(openPrice)} до ${formatNumber(lastPrice)} — это ${formatNumber(expectedPercent)} %`,
    };
  }

  return { kind: 'verified', text: '' };
}

function checkTickerMap(args: CheckTickerMapArgs): LiveCheckOutcome {
  const { tickerBySymbol, tradeSymbolBySymbol, symbol, marketLabel } = args;

  if (tickerBySymbol.size === 0) {
    return { status: 'diverged', fact: `${marketLabel}: биржа не отдала ни одного тикера` };
  }

  const nowMs = Date.now();
  const oldestAllowedMs = nowMs - TIMESTAMP_PAST_TOLERANCE_MS;
  const newestAllowedMs = nowMs + TIMESTAMP_FUTURE_TOLERANCE_MS;
  const violationList: string[] = [];
  const frozenDayList: string[] = [];
  const unverifiablePercentList: string[] = [];
  let deadPriceCount = 0;
  let maxAbsolutePercent = 0;

  for (const [currentSymbol, ticker] of tickerBySymbol) {
    const isTradable = tradeSymbolBySymbol.size === 0 || (tradeSymbolBySymbol.get(currentSymbol)?.isActive ?? false);

    if (!Number.isFinite(ticker.lastPrice) || ticker.lastPrice < 0) {
      violationList.push(`${currentSymbol}: последняя цена ${formatNumber(ticker.lastPrice)}`);
    } else if (ticker.lastPrice === 0) {
      deadPriceCount += 1;
    }

    if (!Number.isFinite(ticker.volume) || !Number.isFinite(ticker.quoteVolume)) {
      violationList.push(`${currentSymbol}: объём ${formatNumber(ticker.volume)} / оборот ${formatNumber(ticker.quoteVolume)}`);
    }

    const percentVerdict = verifyPriceChangePercent(currentSymbol, ticker);

    if (percentVerdict.kind === 'violation') {
      violationList.push(percentVerdict.text);
    } else if (percentVerdict.kind === 'exchangeData') {
      unverifiablePercentList.push(percentVerdict.text);
    } else {
      maxAbsolutePercent = Math.max(maxAbsolutePercent, Math.abs(ticker.priceChangePercent));
    }

    if (!Number.isFinite(ticker.timestamp)) {
      violationList.push(`${currentSymbol}: отметка времени '${String(ticker.timestamp)}' — вообще не число, хотя договор обещает миллисекунды`);
    } else if (ticker.timestamp < MILLISECOND_TIMESTAMP_FLOOR) {
      violationList.push(`${currentSymbol}: отметка времени ${ticker.timestamp} — не миллисекунды`);
    } else if ((ticker.timestamp < oldestAllowedMs || ticker.timestamp > newestAllowedMs) && isTradable) {
      violationList.push(`${currentSymbol}: отметка времени ${formatTimestamp(ticker.timestamp)} вне разумного окна`);
    } else if (ticker.timestamp < oldestAllowedMs || ticker.timestamp > newestAllowedMs) {
      frozenDayList.push(`${currentSymbol}: отметка ${formatTimestamp(ticker.timestamp)} — биржа заморозила сутки, торгов по инструменту нет`);
    }
  }

  const reference = tickerBySymbol.get(symbol);

  if (reference === undefined) {
    return { status: 'incomplete', fact: `${marketLabel}: тикеров ${tickerBySymbol.size}, но ${symbol} среди них нет` };
  }

  if (reference.lastPrice <= 0) {
    violationList.push(`${symbol}: последняя цена ${formatNumber(reference.lastPrice)} — не больше нуля`);
  }

  const quirkPartList: string[] = [];

  if (frozenDayList.length > 0) {
    quirkPartList.push(`замороженных суток ${frozenDayList.length}: ${joinViolationSample(frozenDayList)}`);
  }

  if (unverifiablePercentList.length > 0) {
    quirkPartList.push(`процент изменения сверять не с чем у ${unverifiablePercentList.length}: ${joinViolationSample(unverifiablePercentList)}`);
  }

  const quirkText = quirkPartList.length === 0 ? '' : `; данные биржи (не расхождение библиотеки): ${quirkPartList.join('; ')}`;
  const summaryText =
    `${marketLabel}: тикеров ${tickerBySymbol.size}, ${symbol} цена ${formatNumber(reference.lastPrice)}, ` +
    `изменение ${formatNumber(reference.priceChangePercent)} %, оборот ${formatNumber(reference.quoteVolume)}, ` +
    `отметка ${formatTimestamp(reference.timestamp)}; наибольшее изменение по рынку ${formatNumber(maxAbsolutePercent)} %, ` +
    `с нулевой ценой ${deadPriceCount}${quirkText}`;

  if (violationList.length > 0) {
    return { status: 'diverged', fact: `${summaryText}; нарушений ${violationList.length}: ${joinViolationSample(violationList)}` };
  }

  return { status: 'confirmed', fact: summaryText };
}

export const futuresTickerCheck: LiveCheck = {
  title: 'Тикеры (контракты): цена больше нуля, изменение в процентах, отметка в миллисекундах',
  timeoutMs: TIMEOUT_MS,
  isCredentialsRequired: false,
  isOrdersRequired: false,
  run: async (context) =>
    checkTickerMap({
      tickerBySymbol: await context.readFuturesTickers(),
      tradeSymbolBySymbol: context.exchange.futures.tradeSymbols,
      symbol: context.settings.futuresSymbol,
      marketLabel: 'контракты',
    }),
};

export const spotTickerCheck: LiveCheck = {
  title: 'Тикеры (спот): цена больше нуля, изменение в процентах, отметка в миллисекундах',
  timeoutMs: TIMEOUT_MS,
  isCredentialsRequired: false,
  isOrdersRequired: false,
  run: async (context) =>
    checkTickerMap({
      tickerBySymbol: await context.exchange.spot.fetchTickers(),
      tradeSymbolBySymbol: context.exchange.spot.tradeSymbols,
      symbol: context.settings.spotSymbol,
      marketLabel: 'спот',
    }),
};
