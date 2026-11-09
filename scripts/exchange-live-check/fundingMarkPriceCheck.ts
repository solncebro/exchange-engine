import { formatNumber, formatTimestamp, joinViolationSample } from './checkSupport';
import type { LiveCheck, LiveCheckContext, LiveCheckOutcome } from './liveCheck.types';

const TIMEOUT_MS = 60_000;
const FUNDING_RECORD_LIMIT = 3;
const MAX_MARK_TO_KLINE_DEVIATION_RATIO = 0.01;

async function checkFundingMarkPrice(context: LiveCheckContext): Promise<LiveCheckOutcome> {
  const client = context.exchange.futures;
  const symbol = context.settings.futuresSymbol;

  await client.loadTradeSymbols();

  const fundingList = await client.fetchFundingRateHistory(symbol, { limit: FUNDING_RECORD_LIMIT, shouldIncludeMarkPrices: true });

  context.showEvidence('история ставок фандинга с признаком shouldIncludeMarkPrices', fundingList);

  if (fundingList.length === 0) {
    return { status: 'diverged', fact: `${symbol}: история ставок фандинга пуста` };
  }

  const pricedList = fundingList.filter((funding) => funding.markPrice !== null);

  if (pricedList.length === 0) {
    return {
      status: 'notApplicable',
      fact: `${symbol}: записей ${fundingList.length}, цену маркировки библиотека у этой биржи в истории фандинга не заполняет (markPrice: null у всех)`,
    };
  }

  const violationList: string[] = [];
  const comparisonTextList: string[] = [];

  if (pricedList.length !== fundingList.length) {
    violationList.push(`цена маркировки пуста у ${fundingList.length - pricedList.length} записей из ${fundingList.length}`);
  }

  for (const funding of pricedList) {
    const markPrice = funding.markPrice ?? Number.NaN;
    const klineList = await client.fetchKlines(symbol, '1m', { startTime: funding.fundingTime, limit: 1 });
    const kline = klineList.find((entry) => entry.openTimestamp === funding.fundingTime);

    if (kline === undefined) {
      violationList.push(`${formatTimestamp(funding.fundingTime)}: минутной свечи с этим началом нет — сверить не с чем`);

      continue;
    }

    const deviationRatio = Math.abs(markPrice - kline.openPrice) / kline.openPrice;
    const markPriceText = Number.isFinite(markPrice) ? formatNumber(client.priceToPrecision(symbol, markPrice)) : String(markPrice);
    const klineOpenText = formatNumber(client.priceToPrecision(symbol, kline.openPrice));

    comparisonTextList.push(`${formatTimestamp(funding.fundingTime)}: маркировка ${markPriceText}, открытие свечи ${klineOpenText}`);

    if (!(markPrice > 0) || !(deviationRatio <= MAX_MARK_TO_KLINE_DEVIATION_RATIO)) {
      violationList.push(`${formatTimestamp(funding.fundingTime)}: цена маркировки ${markPriceText} отходит от открытия минутной свечи ${klineOpenText} больше чем на ${MAX_MARK_TO_KLINE_DEVIATION_RATIO * 100}%`);
    }
  }

  const summaryText = `${symbol}: записей ${fundingList.length}, с ценой маркировки ${pricedList.length}; ${comparisonTextList.join('; ')}`;

  if (violationList.length > 0) {
    return { status: 'diverged', fact: `${summaryText}; нарушений ${violationList.length}: ${joinViolationSample(violationList)}` };
  }

  return { status: 'confirmed', fact: summaryText };
}

export const fundingMarkPriceCheck: LiveCheck = {
  title: 'История фандинга с ценой маркировки (контракты): цена на время начисления близка к открытию минутной свечи',
  timeoutMs: TIMEOUT_MS,
  isCredentialsRequired: false,
  isOrdersRequired: false,
  run: checkFundingMarkPrice,
};
