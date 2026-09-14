import { ExchangeError } from '../../src/errors/ExchangeError';
import { ExchangeNameEnum } from '../../src/types/common';
import { formatNumber, joinViolationSample } from './checkSupport';
import type { LiveCheck, LiveCheckContext, LiveCheckOutcome } from './liveCheck.types';

const TIMEOUT_MS = 60_000;
const MAX_FEE_RATE = 0.01;
/**
 * Демо-счёт Bybit ручку ставок комиссии не обслуживает: в перечне доступных демо-торговле ручек
 * (документация «Demo Trading») её нет, а живой ответ — код 10001 с пустым текстом. Это не
 * расхождение библиотеки и не сбой связи, а предел демо-стенда.
 */
const BYBIT_DEMO_UNSUPPORTED_ERROR_CODE = 10001;

function isBybitDemoFeeRateRefusal(context: LiveCheckContext, error: unknown): boolean {
  return (
    context.exchangeName === ExchangeNameEnum.Bybit &&
    error instanceof ExchangeError &&
    error.code === BYBIT_DEMO_UNSUPPORTED_ERROR_CODE
  );
}

async function checkFeeRateContract(context: LiveCheckContext): Promise<LiveCheckOutcome> {
  const client = context.exchange.futures;
  const symbol = context.settings.futuresSymbol;

  await client.loadTradeSymbols();

  let feeRateList;

  try {
    feeRateList = await client.fetchFeeRate(symbol);
  } catch (error) {
    if (isBybitDemoFeeRateRefusal(context, error)) {
      return {
        status: 'notApplicable',
        fact: `${symbol}: демо-счёт Bybit ручку ставок комиссии не обслуживает (код ${BYBIT_DEMO_UNSUPPORTED_ERROR_CODE}); на боевом счёте обещание проверяется как у соседей`,
      };
    }

    throw error;
  }

  if (feeRateList.length === 0) {
    return { status: 'diverged', fact: `${symbol}: биржа не отдала ни одной ставки комиссии` };
  }

  const entry = feeRateList.find((item) => item.symbol === symbol) ?? feeRateList[0];
  const violationList: string[] = [];

  if (!Number.isFinite(entry.takerRate) || entry.takerRate <= 0 || entry.takerRate >= MAX_FEE_RATE) {
    violationList.push(`ставка тейкера ${formatNumber(entry.takerRate)} — вне доли от нуля до ${MAX_FEE_RATE}, знак «списание — положительное» не держится`);
  }

  if (!Number.isFinite(entry.makerRate) || entry.makerRate >= MAX_FEE_RATE) {
    violationList.push(`ставка мейкера ${formatNumber(entry.makerRate)} — вне доли меньше ${MAX_FEE_RATE}`);
  }

  const makerNoteText = entry.makerRate < 0 ? ' (отрицательная — биржа платит мейкеру)' : '';
  const summaryText =
    `${symbol}: записей ${feeRateList.length}, символ ответа '${entry.symbol}', мейкер ${formatNumber(entry.makerRate)}${makerNoteText}, ` +
    `тейкер ${formatNumber(entry.takerRate)}`;

  if (violationList.length > 0) {
    return { status: 'diverged', fact: `${summaryText}; нарушений ${violationList.length}: ${joinViolationSample(violationList)}` };
  }

  return { status: 'confirmed', fact: summaryText };
}

export const feeRateCheck: LiveCheck = {
  title: 'Комиссия (контракты): доли меньше процента, списание выражено положительным числом',
  timeoutMs: TIMEOUT_MS,
  isCredentialsRequired: true,
  isOrdersRequired: false,
  run: checkFeeRateContract,
};
