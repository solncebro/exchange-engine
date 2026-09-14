import { OKX_FUNDING_BILL_TYPE } from '../../src/constants/okx';
import type { OkxBillRaw } from '../../src/normalizers/okxNormalizer';
import type { OkxProbe, OkxProbeContext, OkxProbeOutcome } from './probe.types';

const CLAIM = 'В журнале счёта подтип 174 — приход фандинга, 173 — расход, а сумма лежит в pnl';
const EXPECTATION = 'У строк с subType 174 pnl положителен, у 173 — отрицателен, и pnl совпадает с balChg';
const PROBE_TIMEOUT_MS = 30000;
const PAGE_LIMIT = 20;
const INCOME_SUB_TYPE = '174';
const EXPENSE_SUB_TYPE = '173';
const AMOUNT_TOLERANCE = 1e-12;

interface FundingBillFact {
  subType: string;
  pnl: string;
  balChg: string;
  sz: string;
  isAmountInPnl: boolean;
  isSignExpected: boolean;
}

function buildFundingBillFact(bill: OkxBillRaw): FundingBillFact {
  const pnlAmount = Number(bill.pnl);
  const balanceChange = Number(bill.balChg);
  const isIncome = bill.subType === INCOME_SUB_TYPE;
  const isExpense = bill.subType === EXPENSE_SUB_TYPE;
  const isSignExpected = (isIncome && pnlAmount > 0) || (isExpense && pnlAmount < 0);

  return {
    subType: bill.subType,
    pnl: bill.pnl,
    balChg: bill.balChg,
    sz: bill.sz,
    isAmountInPnl: Math.abs(pnlAmount - balanceChange) <= AMOUNT_TOLERANCE,
    isSignExpected,
  };
}

async function runFundingBillSubTypeProbe(context: OkxProbeContext): Promise<OkxProbeOutcome> {
  const billList = await context.httpClient.fetchBills({
    type: OKX_FUNDING_BILL_TYPE,
    isArchive: false,
    limit: PAGE_LIMIT,
  });

  context.showEvidence(`ответ /api/v5/account/bills?type=${OKX_FUNDING_BILL_TYPE} (дословно)`, billList);

  if (billList.length === 0) {
    return {
      status: 'failed',
      fact: 'журнал счёта не содержит ни одной строки фандинга — проба неполная',
      expectation: EXPECTATION,
    };
  }

  const factList = billList.map(buildFundingBillFact);
  const relevantFactList = factList.filter((fact) => fact.subType === INCOME_SUB_TYPE || fact.subType === EXPENSE_SUB_TYPE);

  context.showEvidence('subType / pnl / balChg / sz по строкам', factList);

  if (relevantFactList.length === 0) {
    const subTypeList = Array.from(new Set(factList.map((fact) => fact.subType)));

    return {
      status: 'failed',
      fact: `строк с подтипом 173/174 нет, встретились подтипы: ${subTypeList.join(', ')}`,
      expectation: EXPECTATION,
    };
  }

  const wrongSignList = relevantFactList.filter((fact) => !fact.isSignExpected);
  const amountMismatchList = relevantFactList.filter((fact) => !fact.isAmountInPnl);

  if (wrongSignList.length === 0 && amountMismatchList.length === 0) {
    return {
      status: 'confirmed',
      fact: `на ${relevantFactList.length} строках знак pnl отвечает подтипу и совпадает с balChg`,
      expectation: EXPECTATION,
    };
  }

  return {
    status: 'diverged',
    fact: `строк с неожиданным знаком: ${wrongSignList.length}, строк с расхождением pnl и balChg: ${amountMismatchList.length}`,
    expectation: EXPECTATION,
  };
}

export const fundingBillSubTypeProbe: OkxProbe = {
  claim: CLAIM,
  timeoutMs: PROBE_TIMEOUT_MS,
  isOrdersRequired: false,
  run: runFundingBillSubTypeProbe,
};
