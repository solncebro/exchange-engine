import type { OkxBalanceRaw } from '../../src/normalizers/okxNormalizer';
import type { OkxProbe, OkxProbeContext, OkxProbeOutcome } from './probe.types';
import { readFarOrderBasis } from './probeOrder';
import { readTextField, snapPriceToTick } from './probeSupport';
import { describeError } from '../live-support/liveError';

const CLAIM = 'Маржа под ВИСЯЩЕЙ заявкой входит в details[].imr на уровне монеты, а не только в ordFrozen';
const EXPECTATION = 'После постановки своей лимитной заявки details[].imr монеты вырастет вместе с details[].ordFrozen; если вырос только ordFrozen — coin-level imr считает одни позиции';
const PROBE_TIMEOUT_MS = 30000;
const FAR_FROM_MARKET_RATIO = 0.5;
const CHANGE_TOLERANCE = 1e-9;

interface CoinMarginSnapshot {
  ccy: string;
  imr: string;
  mmr: string;
  ordFrozen: string;
  isoEq: string;
}

interface CoinMarginChange {
  ccy: string;
  imrBefore: string;
  imrAfter: string;
  imrDelta: number;
  ordFrozenBefore: string;
  ordFrozenAfter: string;
  ordFrozenDelta: number;
  isoEqBefore: string;
  isoEqAfter: string;
  isoEqDelta: number;
}

function readCoinMarginSnapshotList(balance: OkxBalanceRaw | undefined): CoinMarginSnapshot[] {
  return (balance?.details ?? []).map((detail) => ({
    ccy: detail.ccy,
    imr: readTextField(detail, 'imr'),
    mmr: readTextField(detail, 'mmr'),
    ordFrozen: readTextField(detail, 'ordFrozen'),
    isoEq: readTextField(detail, 'isoEq'),
  }));
}

function toAmount(text: string): number {
  const amount = Number(text);

  return Number.isFinite(amount) ? amount : 0;
}

function findSnapshot(snapshotList: CoinMarginSnapshot[], ccy: string): CoinMarginSnapshot {
  return snapshotList.find((snapshot) => snapshot.ccy === ccy) ?? { ccy, imr: '', mmr: '', ordFrozen: '', isoEq: '' };
}

function buildCoinMarginChangeList(beforeList: CoinMarginSnapshot[], afterList: CoinMarginSnapshot[]): CoinMarginChange[] {
  const currencyList = Array.from(new Set([...beforeList, ...afterList].map((snapshot) => snapshot.ccy)));

  return currencyList.map((ccy) => {
    const before = findSnapshot(beforeList, ccy);
    const after = findSnapshot(afterList, ccy);

    return {
      ccy,
      imrBefore: before.imr,
      imrAfter: after.imr,
      imrDelta: toAmount(after.imr) - toAmount(before.imr),
      ordFrozenBefore: before.ordFrozen,
      ordFrozenAfter: after.ordFrozen,
      ordFrozenDelta: toAmount(after.ordFrozen) - toAmount(before.ordFrozen),
      isoEqBefore: before.isoEq,
      isoEqAfter: after.isoEq,
      isoEqDelta: toAmount(after.isoEq) - toAmount(before.isoEq),
    };
  });
}

function hasGrown(delta: number): boolean {
  return delta > CHANGE_TOLERANCE;
}

async function readBalance(context: OkxProbeContext, label: string): Promise<OkxBalanceRaw | undefined> {
  const balanceList = await context.httpClient.fetchBalance();

  context.showEvidence(label, balanceList[0]?.details ?? 'ответ пуст');

  return balanceList[0];
}

async function placeFarLimitOrder(context: OkxProbeContext): Promise<string> {
  const basis = await readFarOrderBasis(context);
  const params: Record<string, unknown> = {
    instId: context.settings.instId,
    tdMode: 'cross',
    side: 'buy',
    ordType: 'limit',
    sz: basis.instrument.minSz,
    px: snapPriceToTick(basis.lastPrice * FAR_FROM_MARKET_RATIO, basis.instrument.tickSz),
    clOrdId: context.buildClientOrderId(),
  };

  if (basis.isHedgeMode) {
    params.posSide = 'long';
  }

  context.showEvidence('заявка, уходящая на биржу (дословно)', params);

  const result = await context.httpClient.placeOrder(params);

  context.showEvidence('ответ /api/v5/trade/order (дословно)', result);

  return result.ordId;
}

function describeChange(change: CoinMarginChange): string {
  return `${change.ccy}: imr с ${change.imrBefore} до ${change.imrAfter}, ordFrozen с ${change.ordFrozenBefore} до ${change.ordFrozenAfter}`;
}

function buildChangeOutcome(changeList: CoinMarginChange[]): OkxProbeOutcome {
  const ordFrozenGrownList = changeList.filter((change) => hasGrown(change.ordFrozenDelta));
  const imrGrownList = changeList.filter((change) => hasGrown(change.imrDelta));

  if (ordFrozenGrownList.length === 0) {
    const imrOnlyText = imrGrownList.length === 0
      ? 'и details[].imr тоже не изменился — биржа не показала заморозку под заявку'
      : `а details[].imr вырос (${imrGrownList.map(describeChange).join('; ')}) — рост мог прийти не от заявки, а от переоценки позиций`;

    return {
      status: 'incomplete',
      fact: `после постановки заявки details[].ordFrozen не вырос ни по одной монете, ${imrOnlyText}; связать рост imr с заявкой нечем`,
      expectation: EXPECTATION,
    };
  }

  const bothGrownList = ordFrozenGrownList.filter((change) => hasGrown(change.imrDelta));

  if (bothGrownList.length > 0) {
    return {
      status: 'confirmed',
      fact: `заявка заморозила средства и подняла coin-level imr — ${bothGrownList.map(describeChange).join('; ')}: маржа висящей заявки входит в details[].imr`,
      expectation: EXPECTATION,
    };
  }

  return {
    status: 'diverged',
    fact: `заявка подняла только details[].ordFrozen, details[].imr остался прежним — ${ordFrozenGrownList.map(describeChange).join('; ')}: coin-level imr считает одни позиции`,
    expectation: EXPECTATION,
  };
}

async function measureMarginUnderOwnOrder(context: OkxProbeContext): Promise<OkxProbeOutcome> {
  const beforeBalance = await readBalance(context, 'details[] ДО постановки заявки (дословно)');
  const beforeList = readCoinMarginSnapshotList(beforeBalance);
  let placedOrderId = '';

  try {
    placedOrderId = await placeFarLimitOrder(context);

    const afterBalance = await readBalance(context, 'details[] ПОСЛЕ постановки заявки (дословно)');
    const afterList = readCoinMarginSnapshotList(afterBalance);
    const changeList = buildCoinMarginChangeList(beforeList, afterList);

    context.showEvidence('изменение imr / ordFrozen / isoEq по монетам', changeList);
    context.showEvidence('isoEq на уровне счёта до и после', {
      before: beforeBalance === undefined ? '' : readTextField(beforeBalance, 'isoEq'),
      after: afterBalance === undefined ? '' : readTextField(afterBalance, 'isoEq'),
    });
    context.showEvidence('imr и ordFroz на уровне счёта до и после', {
      imrBefore: beforeBalance === undefined ? '' : readTextField(beforeBalance, 'imr'),
      imrAfter: afterBalance === undefined ? '' : readTextField(afterBalance, 'imr'),
      ordFrozBefore: beforeBalance === undefined ? '' : readTextField(beforeBalance, 'ordFroz'),
      ordFrozAfter: afterBalance === undefined ? '' : readTextField(afterBalance, 'ordFroz'),
    });

    return buildChangeOutcome(changeList);
  } finally {
    if (placedOrderId !== '') {
      await context.httpClient
        .cancelOrder({ instId: context.settings.instId, ordId: placedOrderId })
        .then((result) => context.showEvidence('уборка: снятие заявки (дословно)', result))
        .catch((error: unknown) => context.showEvidence('уборка: снять заявку не удалось', describeError(error)));
    }
  }
}

async function runCoinLevelMarginFieldsProbe(context: OkxProbeContext): Promise<OkxProbeOutcome> {
  if (!context.settings.isOrderAllowed) {
    const balance = await readBalance(context, 'details[] из /api/v5/account/balance (дословно)');
    const positionList = await context.httpClient.fetchPositions({ instType: 'SWAP' });

    context.showEvidence('ответ /api/v5/account/positions (дословно)', positionList);
    context.showEvidence('isoEq на уровне счёта', balance === undefined ? 'ответ пуст' : readTextField(balance, 'isoEq'));

    return {
      status: 'incomplete',
      fact: 'неполная: чтобы узнать, входит ли в details[].imr маржа висящей заявки, нужна своя заявка — запустите с ключом --allow-orders',
      expectation: EXPECTATION,
    };
  }

  return measureMarginUnderOwnOrder(context);
}

export const coinLevelMarginFieldsProbe: OkxProbe = {
  claim: CLAIM,
  timeoutMs: PROBE_TIMEOUT_MS,
  isOrdersRequired: false,
  run: runCoinLevelMarginFieldsProbe,
};
