import { OKX_ORDER_CHANNEL_INSTID_ISSUE_CODE_LIST, OKX_ORDER_CHANNEL_INSTID_ISSUE_TEXT } from '../../src/constants/okx';
import { OkxSymbolMap, parseOkxInstId } from '../../src/exchanges/okxSymbol';
import { OkxTradeStream } from '../../src/ws/OkxTradeStream';
import type { OkxInstrumentRaw } from '../../src/normalizers/okxNormalizer';
import type { OkxProbe, OkxProbeContext, OkxProbeOutcome } from './probe.types';
import { readFarOrderBasis } from './probeOrder';
import { snapPriceToTick } from './probeSupport';
import { describeError, toErrorCode } from '../live-support/liveError';

const CLAIM = 'Торговый канал (WebSocket) принимает заявку с числовым instIdCode, а не со строковым instId';
const EXPECTATION = 'Заявка с числовым instIdCode принята каналом; отказ 50014/51000/51001 со словом instIdCode означал бы обратное';
const FAR_FROM_MARKET_RATIO = 0.5;
const PROBE_TIMEOUT_MS = 30000;

function buildSymbolMap(instrument: OkxInstrumentRaw): OkxSymbolMap {
  const identity = parseOkxInstId(instrument.instId);

  if (identity === null) {
    throw new Error(`Инструмент ${instrument.instId} не разбирается на составляющие — карту имён не собрать`);
  }

  const symbolMap = new OkxSymbolMap({ isSwap: identity.isSwap });
  symbolMap.register(identity, instrument.instIdCode);

  return symbolMap;
}

async function buildFarLimitOrderParams(context: OkxProbeContext): Promise<Record<string, unknown>> {
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

  return params;
}

function buildInstIdCodeOutcome(error: unknown): OkxProbeOutcome | null {
  const code = toErrorCode(error);
  const isKnownCode = OKX_ORDER_CHANNEL_INSTID_ISSUE_CODE_LIST.includes(code);
  const mentionsInstIdCode = error instanceof Error && error.message.includes(OKX_ORDER_CHANNEL_INSTID_ISSUE_TEXT);

  if (!isKnownCode && !mentionsInstIdCode) {
    return null;
  }

  return {
    status: 'diverged',
    fact: `канал отверг числовой instIdCode — ${describeError(error)}`,
    expectation: EXPECTATION,
  };
}

async function runTradeChannelInstIdProbe(context: OkxProbeContext): Promise<OkxProbeOutcome> {
  const instrument = await context.getInstrument();
  const params = await buildFarLimitOrderParams(context);
  const stream = new OkxTradeStream({
    url: context.settings.privateWebSocketUrl,
    label: '[OKX probe] Trade',
    apiKey: context.credentials.apiKey,
    secret: context.credentials.secret,
    passphrase: context.credentials.passphrase,
    logger: context.logger,
    symbolMap: buildSymbolMap(instrument),
  });

  context.cleanupList.push(() => stream.disconnect());
  context.showEvidence('адрес торгового канала', context.settings.privateWebSocketUrl);
  context.showEvidence('числовой код инструмента из /api/v5/public/instruments', {
    instId: instrument.instId,
    instIdCode: instrument.instIdCode,
  });
  context.showEvidence('заявка до подмены адреса (имя инструмента — так её понимает обычный запрос)', params);

  await stream.connect();

  let placedOrderId = '';

  try {
    const order = await stream.createOrder(params);

    placedOrderId = order.id;
    context.showEvidence('ответ канала (номер заявки)', { ordId: order.id, clOrdId: order.clientOrderId });

    return {
      status: 'confirmed',
      fact: `канал принял числовой instIdCode ${String(instrument.instIdCode)}, заявка ${order.id} поставлена`,
      expectation: EXPECTATION,
    };
  } catch (error) {
    context.showEvidence('ответ канала (отказ, дословно)', describeError(error));

    return (
      buildInstIdCodeOutcome(error) ?? {
        status: 'failed',
        fact: `канал ответил отказом не про instIdCode — ${describeError(error)}`,
        expectation: EXPECTATION,
      }
    );
  } finally {
    if (placedOrderId !== '') {
      await context.httpClient
        .cancelOrder({ instId: context.settings.instId, ordId: placedOrderId })
        .then((result) => context.showEvidence('уборка: снятие заявки (дословно)', result))
        .catch((error: unknown) => context.showEvidence('уборка: снять заявку не удалось', describeError(error)));
    }

    stream.disconnect();
  }
}

export const tradeChannelInstIdProbe: OkxProbe = {
  claim: CLAIM,
  timeoutMs: PROBE_TIMEOUT_MS,
  isOrdersRequired: true,
  run: runTradeChannelInstIdProbe,
};
