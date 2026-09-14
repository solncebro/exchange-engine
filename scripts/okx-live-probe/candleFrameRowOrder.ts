import { ReliableWebSocket } from '@solncebro/websocket-engine';
import type { RawData } from '@solncebro/websocket-engine';

import type { OkxProbe, OkxProbeContext, OkxProbeOutcome } from './probe.types';
import { toFieldMap } from './probeSupport';
import { waitForCondition } from '../live-support/liveWait';

const CLAIM = 'Строки многострочного кадра candle1m приходят от СТАРОЙ свечи к новой';
const EXPECTATION = 'В кадре с несколькими строками отметки времени возрастают в порядке прихода';
const PROBE_TIMEOUT_MS = 70000;
const FRAME_WAIT_MS = 60000;
const CANDLE_CHANNEL = 'candle1m';

function rawDataToText(rawData: RawData): string {
  if (typeof rawData === 'string') {
    return rawData;
  }

  if (rawData instanceof ArrayBuffer) {
    return Buffer.from(rawData).toString('utf8');
  }

  return Buffer.from(rawData.buffer, rawData.byteOffset, rawData.byteLength).toString('utf8');
}

function readCandleRowTimestampList(text: string): string[] {
  let parsed: unknown = null;

  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return [];
  }

  const dataValue = toFieldMap(parsed).data;

  if (!Array.isArray(dataValue)) {
    return [];
  }

  return dataValue.map((row) => (Array.isArray(row) && typeof row[0] === 'string' ? row[0] : ''));
}

function describeRowOrder(timestampList: string[]): string {
  const numberList = timestampList.map(Number);
  const isAscending = numberList.every((value, index) => index === 0 || numberList[index - 1] < value);
  const isDescending = numberList.every((value, index) => index === 0 || numberList[index - 1] > value);

  if (isAscending) {
    return 'от старой к новой';
  }

  if (isDescending) {
    return 'от новой к старой';
  }

  return 'без единого порядка';
}

async function runCandleFrameRowOrderProbe(context: OkxProbeContext): Promise<OkxProbeOutcome> {
  const frameTextList: string[] = [];
  const webSocket = new ReliableWebSocket<string>({
    label: '[OKX probe] candle1m',
    url: context.settings.businessWebSocketUrl,
    logger: context.logger,
    parseMessage: rawDataToText,
    onMessage: (text) => {
      frameTextList.push(text);
    },
    onOpen: async (streamContext) => {
      streamContext.send({ op: 'subscribe', args: [{ channel: CANDLE_CHANNEL, instId: context.settings.instId }] });
    },
  });

  context.cleanupList.push(() => webSocket.close());
  context.showEvidence('деловой адрес и тема', { url: context.settings.businessWebSocketUrl, channel: CANDLE_CHANNEL, instId: context.settings.instId });

  const findMultiRowFrame = (): string | undefined => frameTextList.find((text) => readCandleRowTimestampList(text).length > 1);

  try {
    await waitForCondition({ isReady: () => findMultiRowFrame() !== undefined, timeoutMs: FRAME_WAIT_MS });

    const multiRowFrame = findMultiRowFrame();

    context.showEvidence('получено кадров всего', frameTextList.length);

    if (multiRowFrame === undefined) {
      context.showEvidence('последний кадр (дословно)', frameTextList[frameTextList.length - 1] ?? 'кадров не было');

      return {
        status: 'incomplete',
        fact: `за ${FRAME_WAIT_MS / 1000} секунд пришло ${frameTextList.length} однострочных кадров — многострочных не было; порядок не проверен`,
        expectation: EXPECTATION,
      };
    }

    const timestampList = readCandleRowTimestampList(multiRowFrame);
    const orderText = describeRowOrder(timestampList);

    context.showEvidence('многострочный кадр (дословно)', multiRowFrame);
    context.showEvidence('отметки времени в порядке прихода', timestampList);

    if (orderText === 'от старой к новой') {
      return { status: 'confirmed', fact: `строки идут от старой к новой: ${timestampList.join(', ')}`, expectation: EXPECTATION };
    }

    return { status: 'diverged', fact: `строки идут ${orderText}: ${timestampList.join(', ')}`, expectation: EXPECTATION };
  } finally {
    webSocket.close();
  }
}

export const candleFrameRowOrderProbe: OkxProbe = {
  claim: CLAIM,
  timeoutMs: PROBE_TIMEOUT_MS,
  isOrdersRequired: false,
  run: runCandleFrameRowOrderProbe,
};
