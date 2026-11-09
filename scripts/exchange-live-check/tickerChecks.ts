import type { PublicTrade, Ticker, TickerBySymbol } from '../../src/types/common';
import { describeError } from '../live-support/liveError';
import { formatNumber, formatTimestamp, isPositiveFiniteNumber, joinViolationSample } from './checkSupport';
import type { CheckTickerMapArgs, LiveCheck, LiveCheckOutcome, TickerVerdict, VerifyStaleTimestampArgs } from './liveCheck.types';

/**
 * Демо-вход спота Binance отдаёт список тикеров так же неровно, как список инструментов. Если
 * инструменты ещё не прочитаны (запуск с --only), проверка читает их сама: к сроку тикеров (180 с)
 * добавлен срок списка инструментов (300 с).
 */
const TIMEOUT_MS = 480_000;
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
const LAST_TRADE_READ_LIMIT = 1;
const STALE_TRADE_LOOKUP_LIMIT = 10;

/**
 * У процента изменения сверяется НЕ величина, а арифметика: он обязан совпадать с ростом от цены на
 * начало суток к последней. Порог правдоподобия (было «не больше 1000 %») сваливал в одну кучу
 * настоящую беду — величина не число — и подлинные числа демо-стенда: учебная пара OKX, чья цена
 * ушла со ста до 5·10^14, даёт полтриллиона процентов и при этом арифметически безупречна.
 * Инструмент, по которому за сутки не было ни одной сделки или нет цены на начало суток, сверять
 * не с чем: это данные биржи, а не расхождение библиотеки, и статус они не портят.
 */
function verifyPriceChangePercent(symbol: string, ticker: Ticker): TickerVerdict {
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

function describeTickerWindowInconsistency(ticker: Ticker, newestAllowedMs: number): string {
  if (!Number.isFinite(ticker.timestamp) || ticker.timestamp < MILLISECOND_TIMESTAMP_FLOOR) {
    return `конец окна суток ${String(ticker.timestamp)} — не миллисекунды`;
  }

  if (ticker.timestamp > newestAllowedMs) {
    return `конец окна суток ${formatTimestamp(ticker.timestamp)} в будущем`;
  }

  return '';
}

function describeTradeTimestampViolation(tradeList: PublicTrade[]): string {
  const brokenList = tradeList.filter((trade) => !Number.isFinite(trade.timestamp) || trade.timestamp < MILLISECOND_TIMESTAMP_FLOOR);

  if (brokenList.length === 0) {
    return '';
  }

  return `время сделки ${brokenList.map((trade) => String(trade.timestamp)).join(', ')} — не миллисекунды больше нуля`;
}

async function verifyStaleTimestampByLastTrade(args: VerifyStaleTimestampArgs): Promise<TickerVerdict> {
  const { client, symbol, ticker, oldestAllowedMs, newestAllowedMs } = args;
  const tickerText = `${symbol}: отметка ${formatTimestamp(ticker.timestamp)}`;

  let tradeList: PublicTrade[];

  try {
    tradeList = await client.fetchTrades(symbol, LAST_TRADE_READ_LIMIT);
  } catch (error) {
    return { kind: 'violation', text: `${tickerText} вне разумного окна, а последнюю сделку для сверки прочитать не удалось: ${describeError(error)}` };
  }

  if (tradeList.length === 0) {
    const inconsistencyText = describeTickerWindowInconsistency(ticker, newestAllowedMs);

    if (inconsistencyText !== '') {
      return { kind: 'violation', text: `${tickerText} вне разумного окна, сделок биржа не отдала, а собственные поля тикера не согласованы: ${inconsistencyText}` };
    }

    return {
      kind: 'exchangeData',
      text: `${tickerText} вне разумного окна, сделок биржа не отдала — сверить не с чем; конец окна суток в миллисекундах и не в будущем`,
    };
  }

  const tradeTimestampViolationText = describeTradeTimestampViolation(tradeList);

  if (tradeTimestampViolationText !== '') {
    return { kind: 'violation', text: `${tickerText} вне разумного окна, а ${tradeTimestampViolationText}` };
  }

  const lastTradeTimestamp = Math.max(...tradeList.map((trade) => trade.timestamp));

  if (lastTradeTimestamp >= oldestAllowedMs) {
    return { kind: 'violation', text: `${tickerText} вне разумного окна, хотя последняя сделка ${formatTimestamp(lastTradeTimestamp)}` };
  }

  if (ticker.timestamp < lastTradeTimestamp) {
    return { kind: 'violation', text: `${tickerText} старше последней сделки ${formatTimestamp(lastTradeTimestamp)} — сводка не может отставать от сделки` };
  }

  return {
    kind: 'exchangeData',
    text: `${tickerText}, последняя сделка ${formatTimestamp(lastTradeTimestamp)} — инструмент числится торгуемым, но сделок по нему нет`,
  };
}

async function checkTickerMap(args: CheckTickerMapArgs): Promise<LiveCheckOutcome> {
  const { tickerBySymbol, tradeSymbolBySymbol, client, symbol, marketLabel } = args;

  if (tickerBySymbol.size === 0) {
    return { status: 'diverged', fact: `${marketLabel}: биржа не отдала ни одного тикера` };
  }

  const nowMs = Date.now();
  const oldestAllowedMs = nowMs - TIMESTAMP_PAST_TOLERANCE_MS;
  const newestAllowedMs = nowMs + TIMESTAMP_FUTURE_TOLERANCE_MS;
  const violationList: string[] = [];
  const frozenDayList: string[] = [];
  const unverifiablePercentList: string[] = [];
  const staleTickerBySymbol: TickerBySymbol = new Map();
  const idleTradableList: string[] = [];
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
    } else if (ticker.timestamp > newestAllowedMs) {
      violationList.push(`${currentSymbol}: отметка времени ${formatTimestamp(ticker.timestamp)} в будущем`);
    } else if (ticker.timestamp < oldestAllowedMs && isTradable) {
      staleTickerBySymbol.set(currentSymbol, ticker);
    } else if (ticker.timestamp < oldestAllowedMs) {
      frozenDayList.push(`${currentSymbol}: отметка ${formatTimestamp(ticker.timestamp)} — биржа заморозила сутки, торгов по инструменту нет`);
    }
  }

  let lookupCount = 0;

  for (const [staleSymbol, staleTicker] of staleTickerBySymbol) {
    if (lookupCount >= STALE_TRADE_LOOKUP_LIMIT) {
      violationList.push(
        `${staleSymbol}: отметка времени ${formatTimestamp(staleTicker.timestamp)} вне разумного окна; со сделками не сверялась — ` +
        `таких торгуемых инструментов ${staleTickerBySymbol.size}, сверяются первые ${STALE_TRADE_LOOKUP_LIMIT}`,
      );
      continue;
    }

    lookupCount += 1;

    const staleVerdict = await verifyStaleTimestampByLastTrade({ client, symbol: staleSymbol, ticker: staleTicker, oldestAllowedMs, newestAllowedMs });

    if (staleVerdict.kind === 'violation') {
      violationList.push(staleVerdict.text);
    } else {
      idleTradableList.push(staleVerdict.text);
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

  if (idleTradableList.length > 0) {
    quirkPartList.push(`торгуемых без сделок дольше окна ${idleTradableList.length}: ${joinViolationSample(idleTradableList)}`);
  }

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
      tradeSymbolBySymbol: await context.readTradeSymbols(context.exchange.futures),
      client: context.exchange.futures,
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
      tradeSymbolBySymbol: await context.readTradeSymbols(context.exchange.spot),
      client: context.exchange.spot,
      symbol: context.settings.spotSymbol,
      marketLabel: 'спот',
    }),
};
