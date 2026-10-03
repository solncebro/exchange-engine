import { formatNumber, joinViolationSample } from './checkSupport';
import type { LiveCheck, LiveCheckContext, LiveCheckOutcome } from './liveCheck.types';

const TIMEOUT_MS = 120_000;

async function checkLeverageTierContract(context: LiveCheckContext): Promise<LiveCheckOutcome> {
  const client = context.exchange.futures;
  const symbol = context.settings.futuresSymbol;

  await client.loadTradeSymbols();

  const tierList = await client.fetchLeverageTierList(symbol);
  const violationList: string[] = [];

  context.showEvidence('leverageTierList', tierList);

  if (tierList.length === 0) {
    violationList.push('список ступеней пуст');
  }

  for (const tier of tierList) {
    if (!Number.isFinite(tier.maxLeverage) || tier.maxLeverage <= 0) {
      violationList.push(`плечо ${formatNumber(tier.maxLeverage)} — не положительное число`);
    }

    if (!((tier.maxNotional ?? 0) > 0) && !((tier.maxBaseAmount ?? 0) > 0)) {
      violationList.push(`ни потолок в деньгах, ни потолок в монетах не заданы у ступени с плечом ${formatNumber(tier.maxLeverage)}`);
    }
  }

  for (let i = 1; i < tierList.length; i++) {
    const previousCap = tierList[i - 1].maxNotional ?? tierList[i - 1].maxBaseAmount ?? 0;
    const currentCap = tierList[i].maxNotional ?? tierList[i].maxBaseAmount ?? 0;

    if (currentCap <= previousCap) {
      violationList.push(`потолок ступени ${i + 1} (${formatNumber(currentCap)}) не выше потолка предыдущей (${formatNumber(previousCap)})`);
    }

    if (tierList[i].maxLeverage >= tierList[i - 1].maxLeverage) {
      violationList.push(`плечо ступени ${i + 1} (${formatNumber(tierList[i].maxLeverage)}) не ниже плеча предыдущей (${formatNumber(tierList[i - 1].maxLeverage)})`);
    }
  }

  const tradeSymbol = client.tradeSymbols.get(symbol);
  const configuredMaxLeverage = Number(tradeSymbol?.leverageFilter?.maxLeverage);

  if (tierList.length > 0 && Number.isFinite(configuredMaxLeverage) && configuredMaxLeverage > 0) {
    if (tierList[0].maxLeverage > configuredMaxLeverage) {
      violationList.push(`первая ступень даёт плечо ${formatNumber(tierList[0].maxLeverage)}, а инструмент называет потолок ${formatNumber(configuredMaxLeverage)}`);
    }
  }

  const allBySymbol = await client.fetchAllLeverageTierList();
  const allTierList = allBySymbol.get(symbol);

  if (allTierList === undefined) {
    violationList.push(`в ответе по всей бирже символа ${symbol} нет`);
  } else if (allTierList.length !== tierList.length) {
    violationList.push(`по символу отдельно ${tierList.length} ступеней, а в ответе по всей бирже ${allTierList.length}`);
  }

  const firstTier = tierList[0];
  const lastTier = tierList[tierList.length - 1];
  const capText = (tier: typeof firstTier) => formatNumber(tier.maxNotional ?? tier.maxBaseAmount ?? 0);
  const summaryText = tierList.length === 0
    ? `${symbol}: ступеней 0`
    : `${symbol}: ступеней ${tierList.length}, первая ×${formatNumber(firstTier.maxLeverage)} потолок ${capText(firstTier)}, ` +
      `последняя ×${formatNumber(lastTier.maxLeverage)} потолок ${capText(lastTier)}; по всей бирже символов ${allBySymbol.size}`;

  if (violationList.length > 0) {
    return { status: 'diverged', fact: `${summaryText}; нарушений ${violationList.length}: ${joinViolationSample(violationList)}` };
  }

  return { status: 'confirmed', fact: summaryText };
}

export const leverageTierCheck: LiveCheck = {
  title: 'Ступени плеча (контракты): список не пуст, потолки растут, плечо падает, вся биржа содержит символ',
  timeoutMs: TIMEOUT_MS,
  isCredentialsRequired: true,
  isOrdersRequired: false,
  run: checkLeverageTierContract,
};
