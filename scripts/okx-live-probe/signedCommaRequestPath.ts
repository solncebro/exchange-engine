import { OKX_PENDING_ALGO_ORD_TYPE_FILTER } from '../../src/constants/okx';
import { serializeQueryParams } from '../../src/utils/serializeQueryParams';
import type { OkxProbe, OkxProbeContext, OkxProbeOutcome } from './probe.types';
import { isCredentialOrRateLimitFailure } from './probeSupport';
import { describeError } from '../live-support/liveError';

const CLAIM = 'Запятая в подписанной строке запроса (ordType=conditional,oco) принимается биржей';
const EXPECTATION = 'Запрос открытых условных заявок с перечислением через запятую проходит подпись и возвращает код 0';
const PROBE_TIMEOUT_MS = 30000;
const REQUEST_PATH = '/api/v5/trade/orders-algo-pending';

async function runSignedCommaRequestPathProbe(context: OkxProbeContext): Promise<OkxProbeOutcome> {
  const params = { ordType: OKX_PENDING_ALGO_ORD_TYPE_FILTER, instType: 'SWAP' };
  const signedRequestPath = `${REQUEST_PATH}?${serializeQueryParams(params)}`;

  context.showEvidence('строка запроса, которая подписывается (тем же сериализатором, что и в клиенте)', signedRequestPath);

  try {
    const algoOrderList = await context.httpClient.fetchPendingAlgoOrders({
      ordType: OKX_PENDING_ALGO_ORD_TYPE_FILTER,
      instType: 'SWAP',
    });

    context.showEvidence('ответ биржи (дословно)', algoOrderList);

    return {
      status: 'confirmed',
      fact: `биржа приняла подпись со строкой ${signedRequestPath} и вернула ${algoOrderList.length} записей`,
      expectation: EXPECTATION,
    };
  } catch (error) {
    context.showEvidence('отказ биржи (дословно)', describeError(error));

    if (isCredentialOrRateLimitFailure(error)) {
      return {
        status: 'failed',
        fact: `проба не состоялась: отказ про ключи или частоту запросов, а не про запятую — ${describeError(error)}`,
        expectation: EXPECTATION,
      };
    }

    return {
      status: 'diverged',
      fact: `биржа отвергла запрос с запятой — ${describeError(error)}`,
      expectation: EXPECTATION,
    };
  }
}

export const signedCommaRequestPathProbe: OkxProbe = {
  claim: CLAIM,
  timeoutMs: PROBE_TIMEOUT_MS,
  isOrdersRequired: false,
  run: runSignedCommaRequestPathProbe,
};
