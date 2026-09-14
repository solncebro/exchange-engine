import { OkxSwap } from '../../src/exchanges/OkxSwap';
import { parseOkxInstId } from '../../src/exchanges/okxSymbol';
import { toOkxIndexInstId } from '../../src/normalizers/okxNormalizer';
import type { OkxProbe, OkxProbeContext, OkxProbeOutcome } from './probe.types';
import { isCredentialOrRateLimitFailure, readTextField } from './probeSupport';
import { describeError } from '../live-support/liveError';

const CLAIM = 'groupId инструмента совпадает с groupId внутри feeGroup ответа о комиссии';
const EXPECTATION =
  'В /api/v5/account/trade-fee есть запись feeGroup с тем же groupId, что у инструмента, и fetchFeeRate() библиотеки возвращает по этой группе ненулевые ставки';
const PROBE_TIMEOUT_MS = 30000;

async function runTradeFeeGroupIdProbe(context: OkxProbeContext): Promise<OkxProbeOutcome> {
  const instrument = await context.getInstrument();
  const instFamily = toOkxIndexInstId(context.settings.instId);
  const feeRateList = await context.httpClient.fetchTradeFee({ instType: 'SWAP', instFamily });

  context.showEvidence('инструмент (дословно)', instrument);
  context.showEvidence('ответ /api/v5/account/trade-fee — путь библиотеки, instFamily (дословно)', feeRateList);

  const instrumentGroupId = instrument.groupId ?? '';
  const feeRate = feeRateList[0];

  if (feeRate === undefined) {
    return { status: 'failed', fact: 'биржа вернула пустой ответ о комиссии', expectation: EXPECTATION };
  }

  const feeGroupList = feeRate.feeGroup ?? [];
  const feeGroupIdList = feeGroupList.map((group) => readTextField(group, 'groupId'));

  context.showEvidence('groupId инструмента / groupId в feeGroup', { instrument: instrumentGroupId, feeGroup: feeGroupIdList });

  if (instrumentGroupId === '') {
    return {
      status: 'failed',
      fact: `инструмент ${context.settings.instId} не несёт поля groupId — сравнивать не с чем`,
      expectation: EXPECTATION,
    };
  }

  if (feeGroupIdList.length === 0) {
    return { status: 'diverged', fact: 'ответ о комиссии не содержит feeGroup вовсе', expectation: EXPECTATION };
  }

  const isGroupIdFound = feeGroupIdList.includes(instrumentGroupId);
  const symbol = parseOkxInstId(context.settings.instId)?.symbol ?? '';

  try {
    const libraryClient = new OkxSwap({
      config: {
        apiKey: context.credentials.apiKey,
        secret: context.credentials.secret,
        passphrase: context.credentials.passphrase,
        isDemoMode: true,
      },
      logger: context.logger,
    });

    await libraryClient.loadTradeSymbols();
    const libraryFeeRateList = await libraryClient.fetchFeeRate(symbol);
    const libraryFeeRate = libraryFeeRateList[0];
    const makerRate = libraryFeeRate?.makerRate ?? 0;
    const takerRate = libraryFeeRate?.takerRate ?? 0;
    const isRateNonZero = makerRate !== 0 && takerRate !== 0;

    context.showEvidence('публичный путь библиотеки fetchFeeRate() — makerRate / takerRate', { symbol, makerRate, takerRate });

    if (isGroupIdFound && isRateNonZero) {
      return {
        status: 'confirmed',
        fact: `groupId ${instrumentGroupId} найден в feeGroup ответа о комиссии, fetchFeeRate(${symbol}) вернул ту же группу: maker ${makerRate}, taker ${takerRate}`,
        expectation: EXPECTATION,
      };
    }

    if (!isGroupIdFound) {
      return {
        status: 'diverged',
        fact: `groupId инструмента ${instrumentGroupId} отсутствует среди ${feeGroupIdList.join(', ')}`,
        expectation: EXPECTATION,
      };
    }

    return {
      status: 'diverged',
      fact: `groupId инструмента ${instrumentGroupId} найден, но fetchFeeRate(${symbol}) вернул нулевую ставку: maker ${makerRate}, taker ${takerRate}`,
      expectation: EXPECTATION,
    };
  } catch (error) {
    context.showEvidence('отказ публичного пути библиотеки (дословно)', describeError(error));

    if (isCredentialOrRateLimitFailure(error)) {
      return {
        status: 'failed',
        fact: `проба не состоялась: отказ про ключи или частоту запросов, а не про groupId — ${describeError(error)}`,
        expectation: EXPECTATION,
      };
    }

    return {
      status: 'diverged',
      fact: `публичный путь библиотеки fetchFeeRate(${symbol}) отказал — ${describeError(error)}`,
      expectation: EXPECTATION,
    };
  }
}

export const tradeFeeGroupIdProbe: OkxProbe = {
  claim: CLAIM,
  timeoutMs: PROBE_TIMEOUT_MS,
  isOrdersRequired: false,
  run: runTradeFeeGroupIdProbe,
};
