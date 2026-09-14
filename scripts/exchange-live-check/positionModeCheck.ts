import { PositionModeEnum } from '../../src/types/common';
import { describeError } from '../live-support/liveError';
import { formatNumber, joinViolationSample } from './checkSupport';
import type { LiveCheck, LiveCheckContext, LiveCheckOutcome } from './liveCheck.types';

const TIMEOUT_MS = 60_000;
const KNOWN_MODE_LIST: readonly string[] = Object.values(PositionModeEnum);

async function checkPositionModeAndFunding(context: LiveCheckContext): Promise<LiveCheckOutcome> {
  const client = context.exchange.futures;
  const symbol = context.settings.futuresSymbol;

  await client.loadTradeSymbols();

  const violationList: string[] = [];
  const positionMode = await client.fetchPositionMode();

  if (positionMode !== undefined && !KNOWN_MODE_LIST.includes(positionMode)) {
    violationList.push(`режим позиции '${String(positionMode)}' не из перечисления`);
  }

  let fundingInfoText = '';

  try {
    const fundingInfoList = await client.fetchFundingInfo(symbol);
    const referenceList = fundingInfoList.filter((item) => item.symbol === symbol);
    const reference = referenceList.length > 0 ? referenceList[0] : fundingInfoList[0];

    if (fundingInfoList.length === 0) {
      violationList.push('сведений о фандинге не пришло ни одной записи');
      fundingInfoText = 'записей 0';
    } else {
      fundingInfoText =
        `записей ${fundingInfoList.length}, '${reference.symbol}': интервал ${formatNumber(reference.fundingIntervalHours)} ч, ` +
        `потолок ${formatNumber(reference.adjustedFundingRateCap)}, пол ${formatNumber(reference.adjustedFundingRateFloor)}`;

      if (!Number.isFinite(reference.fundingIntervalHours) || reference.fundingIntervalHours <= 0) {
        violationList.push(`интервал фандинга ${formatNumber(reference.fundingIntervalHours)} часов`);
      }

      if (reference.adjustedFundingRateCap < reference.adjustedFundingRateFloor) {
        violationList.push('потолок ставки фандинга ниже пола');
      }
    }
  } catch (error) {
    violationList.push(`сведения о фандинге не читаются: ${describeError(error)}`);
    fundingInfoText = 'отказ';
  }

  const summaryText = `режим позиции '${String(positionMode)}'; сведения о фандинге: ${fundingInfoText}`;

  if (violationList.length > 0) {
    return { status: 'diverged', fact: `${summaryText}; нарушений ${violationList.length}: ${joinViolationSample(violationList)}` };
  }

  return { status: 'confirmed', fact: summaryText };
}

export const positionModeCheck: LiveCheck = {
  title: 'Режим позиции и сведения о фандинге (контракты): читаются без исключения, значения из перечисления',
  timeoutMs: TIMEOUT_MS,
  isCredentialsRequired: true,
  isOrdersRequired: false,
  run: checkPositionModeAndFunding,
};
