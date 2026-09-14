import { OkxPrivateStream } from '../../src/ws/OkxPrivateStream';
import type { OkxWebSocketMessage } from '../../src/ws/okxWebSocketUtils.types';
import type { OkxProbe, OkxProbeContext, OkxProbeOutcome } from './probe.types';
import { readFarOrderBasis } from './probeOrder';
import { snapPriceToTick } from './probeSupport';
import { describeError } from '../live-support/liveError';
import { waitForCondition } from '../live-support/liveWait';

const CLAIM = 'Условные заявки приходят каналом orders-algo на ДЕЛОВОМ адресе после входа';
const EXPECTATION = 'Деловой адрес подтверждает подписку orders-algo; поставленная условная заявка приходит событием в этот канал';
const PROBE_TIMEOUT_MS = 60000;
const SUBSCRIBE_WAIT_MS = 20000;
const EVENT_WAIT_MS = 25000;
const FAR_TRIGGER_RATIO = 0.5;
const SUBSCRIBE_LOG_MARKER = 'subscribed to';
const ERROR_LOG_MARKER = 'server error';
const LOGIN_FAILURE_LOG_MARKER = 'login failed';
const ALGO_CHANNEL = 'orders-algo';

async function placeFarConditionalOrder(context: OkxProbeContext): Promise<string> {
  const basis = await readFarOrderBasis(context);
  const params: Record<string, unknown> = {
    instId: context.settings.instId,
    tdMode: 'cross',
    side: 'sell',
    ordType: 'conditional',
    sz: basis.instrument.minSz,
    slTriggerPx: snapPriceToTick(basis.lastPrice * FAR_TRIGGER_RATIO, basis.instrument.tickSz),
    slOrdPx: '-1',
    algoClOrdId: context.buildClientOrderId(),
  };

  if (basis.isHedgeMode) {
    params.posSide = 'short';
  }

  context.showEvidence('условная заявка, уходящая на биржу (дословно)', params);

  const result = await context.httpClient.placeAlgoOrder(params);

  context.showEvidence('ответ /api/v5/trade/order-algo (дословно)', result);

  return result.algoId;
}

async function waitForAlgoEvent(context: OkxProbeContext, frameList: OkxWebSocketMessage[]): Promise<OkxProbeOutcome> {
  let algoId = '';

  try {
    algoId = await placeFarConditionalOrder(context);
  } catch (error) {
    context.showEvidence('постановка условной заявки не удалась (дословно)', describeError(error));

    return {
      status: 'failed',
      fact: `подписка подтверждена, но условную заявку поставить не удалось — ${describeError(error)}`,
      expectation: EXPECTATION,
    };
  }

  try {
    const hasEvent = await waitForCondition({
      isReady: () => frameList.some((frame) => frame.arg?.channel === ALGO_CHANNEL),
      timeoutMs: EVENT_WAIT_MS,
    });
    const eventFrameList = frameList.filter((frame) => frame.arg?.channel === ALGO_CHANNEL);

    context.showEvidence('кадры канала orders-algo (дословно)', eventFrameList);

    if (!hasEvent) {
      return {
        status: 'diverged',
        fact: `подписка подтверждена, но за ${EVENT_WAIT_MS / 1000} с события по заявке ${algoId} не пришло`,
        expectation: EXPECTATION,
      };
    }

    return {
      status: 'confirmed',
      fact: `подписка подтверждена и событие по условной заявке ${algoId} пришло на деловой адрес`,
      expectation: EXPECTATION,
    };
  } finally {
    await context.httpClient
      .cancelAlgoOrders([{ instId: context.settings.instId, algoId }])
      .then((result) => context.showEvidence('уборка: снятие условной заявки (дословно)', result))
      .catch((error: unknown) => context.showEvidence('уборка: снять условную заявку не удалось', describeError(error)));
  }
}

async function runBusinessAlgoOrdersChannelProbe(context: OkxProbeContext): Promise<OkxProbeOutcome> {
  const frameList: OkxWebSocketMessage[] = [];
  const logStartIndex = context.logRecordList.length;
  const stream = new OkxPrivateStream({
    label: '[OKX probe] Business algo',
    url: context.settings.businessWebSocketUrl,
    apiKey: context.credentials.apiKey,
    secret: context.credentials.secret,
    passphrase: context.credentials.passphrase,
    logger: context.logger,
    onMessage: (message) => {
      frameList.push(message);
    },
    subscriptionArgList: [{ channel: ALGO_CHANNEL, instType: 'SWAP' }],
  });

  context.cleanupList.push(() => stream.close());
  context.showEvidence('деловой адрес', context.settings.businessWebSocketUrl);
  stream.connect();

  const readNewLogTextList = (): string[] => context.logRecordList.slice(logStartIndex).map((record) => record.text);
  const findSubscribeLine = (): string | undefined =>
    readNewLogTextList().find((text) => text.includes(SUBSCRIBE_LOG_MARKER) && text.includes(ALGO_CHANNEL));
  const findErrorLine = (): string | undefined => readNewLogTextList().find((text) => text.includes(ERROR_LOG_MARKER));
  const findLoginFailureLine = (): string | undefined => readNewLogTextList().find((text) => text.includes(LOGIN_FAILURE_LOG_MARKER));

  await waitForCondition({
    isReady: () => findSubscribeLine() !== undefined || findErrorLine() !== undefined || findLoginFailureLine() !== undefined,
    timeoutMs: SUBSCRIBE_WAIT_MS,
  });

  const subscribeLine = findSubscribeLine();
  const errorLine = findErrorLine();
  const loginFailureLine = findLoginFailureLine();

  context.showEvidence('строки журнала потока (дословно)', readNewLogTextList());

  if (loginFailureLine !== undefined) {
    stream.close();

    return {
      status: 'failed',
      fact: `проба не состоялась: вход на деловой адрес не прошёл — ${loginFailureLine}`,
      expectation: EXPECTATION,
    };
  }

  if (subscribeLine === undefined) {
    stream.close();

    const reasonText = errorLine ?? `за ${SUBSCRIBE_WAIT_MS / 1000} с подтверждения подписки не пришло`;

    return { status: 'diverged', fact: `деловой адрес не подтвердил orders-algo: ${reasonText}`, expectation: EXPECTATION };
  }

  if (!context.settings.isOrderAllowed) {
    stream.close();

    return {
      status: 'confirmed',
      fact: `подписка orders-algo подтверждена: ${subscribeLine} (постановка заявки не проверялась — нет ключа --allow-orders)`,
      expectation: EXPECTATION,
    };
  }

  try {
    return await waitForAlgoEvent(context, frameList);
  } finally {
    stream.close();
  }
}

export const businessAlgoOrdersChannelProbe: OkxProbe = {
  claim: CLAIM,
  timeoutMs: PROBE_TIMEOUT_MS,
  isOrdersRequired: false,
  run: runBusinessAlgoOrdersChannelProbe,
};
