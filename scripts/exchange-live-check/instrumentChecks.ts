import type { ExchangeClient } from '../../src/types/exchange';
import { isPositiveFiniteText, joinViolationSample } from './checkSupport';
import type { LiveCheck, LiveCheckOutcome } from './liveCheck.types';

/**
 * Список инструментов — самый тяжёлый ответ биржи, и срок здесь должен быть длиннее внутреннего
 * срока запроса библиотеки (30 с) вместе со всеми её повторами. Иначе вместо честной причины отказа
 * («биржа не отдала ответ») в вывод попадает наша собственная нетерпеливость. Пять минут — под
 * демо-вход спота Binance: боевой отдаёт этот ответ за 11 с, демо — за 150–180 с и очень неровно
 * (замер 10.09.2026). Сколько ждали на самом деле, печатается рядом со статусом.
 */
const TIMEOUT_MS = 300_000;

async function checkTradeSymbolContract(client: ExchangeClient, symbol: string, isFutures: boolean): Promise<LiveCheckOutcome> {
  const marketLabel = isFutures ? 'контракты' : 'спот';
  const tradeSymbolBySymbol = await client.loadTradeSymbols();

  if (tradeSymbolBySymbol.size === 0) {
    return { status: 'diverged', fact: `${marketLabel}: биржа не отдала ни одного инструмента` };
  }

  const violationList: string[] = [];
  const exchangeQuirkList: string[] = [];
  let tradableCount = 0;

  for (const [currentSymbol, tradeSymbol] of tradeSymbolBySymbol) {
    const { tickSize, stepSize, minQty } = tradeSymbol.filter;
    const hasStepSize = isPositiveFiniteText(stepSize);
    const problemList: string[] = [];

    if (!hasStepSize) {
      problemList.push(`${currentSymbol}: шаг объёма '${stepSize}'`);
    }

    if (!isPositiveFiniteText(tickSize)) {
      problemList.push(`${currentSymbol}: шаг цены '${tickSize}'`);
    }

    if (typeof tradeSymbol.isActive !== 'boolean') {
      violationList.push(`${currentSymbol}: нет признака торгуемости`);
    }

    if (isFutures && tradeSymbol.settle === '') {
      violationList.push(`${currentSymbol}: пустая валюта расчёта`);
    }

    if (!isPositiveFiniteText(minQty) && hasStepSize) {
      exchangeQuirkList.push(`${currentSymbol}: наименьшего объёма нет ('${minQty}'), но шаг ${stepSize} задан — он и есть настоящий пол`);
    }

    if (!isPositiveFiniteText(minQty) && !hasStepSize) {
      problemList.push(`${currentSymbol}: наименьший объём '${minQty}'`);
    }

    if (tradeSymbol.isActive) {
      tradableCount += 1;
      violationList.push(...problemList);
    } else {
      exchangeQuirkList.push(...problemList.map((text) => `${text} — инструмент ещё не торгуется`));
    }
  }

  const reference = tradeSymbolBySymbol.get(symbol);
  const referenceText =
    reference === undefined
      ? `${symbol} в списке не найден`
      : `${symbol}: шаг цены ${reference.filter.tickSize}, шаг объёма ${reference.filter.stepSize}, минимум ${reference.filter.minQty}, расчёт '${reference.settle}'`;
  const quirkText =
    exchangeQuirkList.length === 0
      ? ''
      : `; данные биржи (не расхождение библиотеки), таких инструментов ${exchangeQuirkList.length}: ${joinViolationSample(exchangeQuirkList)}`;
  const summaryText = `${marketLabel}: инструментов ${tradeSymbolBySymbol.size}, торгуемых ${tradableCount}; ${referenceText}${quirkText}`;

  if (violationList.length > 0) {
    return { status: 'diverged', fact: `${summaryText}; нарушений ${violationList.length}: ${joinViolationSample(violationList)}` };
  }

  if (reference === undefined) {
    return { status: 'incomplete', fact: summaryText };
  }

  return { status: 'confirmed', fact: summaryText };
}

export const futuresTradeSymbolCheck: LiveCheck = {
  title: 'Инструменты (контракты): шаги и минимумы положительны, есть торгуемость и валюта расчёта',
  timeoutMs: TIMEOUT_MS,
  isCredentialsRequired: false,
  isOrdersRequired: false,
  run: (context) => checkTradeSymbolContract(context.exchange.futures, context.settings.futuresSymbol, true),
};

export const spotTradeSymbolCheck: LiveCheck = {
  title: 'Инструменты (спот): шаги и минимумы положительны, есть признак торгуемости',
  timeoutMs: TIMEOUT_MS,
  isCredentialsRequired: false,
  isOrdersRequired: false,
  run: (context) => checkTradeSymbolContract(context.exchange.spot, context.settings.spotSymbol, false),
};
