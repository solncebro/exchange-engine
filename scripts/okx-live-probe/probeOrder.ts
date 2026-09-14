import type { OkxProbeContext } from './probe.types';
import type { FarOrderBasis } from './probeOrder.types';

export async function readFarOrderBasis(context: OkxProbeContext): Promise<FarOrderBasis> {
  const instrument = await context.getInstrument();
  const accountConfigList = await context.httpClient.fetchAccountConfig();
  const tradeList = await context.httpClient.fetchTrades(context.settings.instId, 1);
  const lastPrice = Number(tradeList[0]?.px ?? '0');

  if (!Number.isFinite(lastPrice) || lastPrice <= 0) {
    throw new Error(`OKX не отдала последнюю цену по ${context.settings.instId} — не от чего считать цену вдали от рынка`);
  }

  return {
    instrument,
    lastPrice,
    isHedgeMode: accountConfigList[0]?.posMode === 'long_short_mode',
  };
}
