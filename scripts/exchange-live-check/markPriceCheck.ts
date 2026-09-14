import { formatNumber, formatTimestamp, joinViolationSample } from './checkSupport';
import type { LiveCheck, LiveCheckContext, LiveCheckOutcome } from './liveCheck.types';

const TIMEOUT_MS = 60_000;
const MARK_PRICE_TOLERANCE_RATIO = 0.05;
const MAX_FUNDING_HORIZON_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_ABSOLUTE_FUNDING_RATE = 0.1;

async function checkMarkPriceContract(context: LiveCheckContext): Promise<LiveCheckOutcome> {
  const client = context.exchange.futures;
  const symbol = context.settings.futuresSymbol;

  await client.loadTradeSymbols();

  const markPriceList = await client.fetchMarkPrice(symbol);
  const entry = markPriceList.find((item) => item.symbol === symbol);

  if (entry === undefined) {
    return { status: 'diverged', fact: `${symbol}: в ответе о цене маркировки записей ${markPriceList.length}, нужного инструмента среди них нет` };
  }

  const tickerBySymbol = await context.readFuturesTickers();
  const ticker = tickerBySymbol.get(symbol);
  const violationList: string[] = [];

  if (!Number.isFinite(entry.markPrice) || entry.markPrice <= 0) {
    violationList.push(`цена маркировки ${formatNumber(entry.markPrice)}`);
  }

  if (ticker !== undefined && ticker.lastPrice > 0 && entry.markPrice > 0) {
    const driftRatio = Math.abs(entry.markPrice - ticker.lastPrice) / ticker.lastPrice;

    if (driftRatio > MARK_PRICE_TOLERANCE_RATIO) {
      violationList.push(`цена маркировки ${formatNumber(entry.markPrice)} отошла от последней ${formatNumber(ticker.lastPrice)} на ${formatNumber(driftRatio * 100)} %`);
    }
  }

  const nowMs = Date.now();

  if (entry.nextFundingTime <= nowMs || entry.nextFundingTime > nowMs + MAX_FUNDING_HORIZON_MS) {
    violationList.push(`ближайший фандинг назначен на ${formatTimestamp(entry.nextFundingTime)} — это не будущее в разумных пределах`);
  }

  if (entry.indexPrice !== undefined && !(Number.isFinite(entry.indexPrice) && entry.indexPrice > 0)) {
    violationList.push(`индексная цена ${formatNumber(entry.indexPrice)} — поле заполнено, но числом это не является`);
  }

  if (!Number.isFinite(entry.lastFundingRate) || Math.abs(entry.lastFundingRate) > MAX_ABSOLUTE_FUNDING_RATE) {
    violationList.push(`ставка фандинга ${formatNumber(entry.lastFundingRate)} — не доля`);
  }

  const indexText = entry.indexPrice === undefined ? 'биржа его не отдаёт' : formatNumber(entry.indexPrice);
  const summaryText =
    `${symbol}: цена маркировки ${formatNumber(entry.markPrice)}, последняя ${ticker === undefined ? 'неизвестна' : formatNumber(ticker.lastPrice)}, ` +
    `индекс — ${indexText}, ставка ${formatNumber(entry.lastFundingRate)}, ближайший фандинг ${formatTimestamp(entry.nextFundingTime)}`;

  if (violationList.length > 0) {
    return { status: 'diverged', fact: `${summaryText}; нарушений ${violationList.length}: ${joinViolationSample(violationList)}` };
  }

  return { status: 'confirmed', fact: summaryText };
}

export const markPriceCheck: LiveCheck = {
  title: 'Цена маркировки (контракты): близка к последней, фандинг в будущем, индекс не поддельный ноль',
  timeoutMs: TIMEOUT_MS,
  isCredentialsRequired: false,
  isOrdersRequired: false,
  run: checkMarkPriceContract,
};
