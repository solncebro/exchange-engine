import type { Kline, Ticker } from '../../src/types/common';
import { sleep } from '../../src/utils/sleep';
import { describeError } from '../live-support/liveError';
import { printNote } from '../live-support/liveOutput';
import { waitForCondition } from '../live-support/liveWait';
import { joinViolationSample } from './checkSupport';
import type { LiveCheck, LiveCheckContext, LiveCheckOutcome } from './liveCheck.types';

const TIMEOUT_MS = 240_000;
const READY_WAIT_MS = 60_000;
const TICKER_WAIT_MS = 30_000;
const KLINE_WAIT_MS = 90_000;
const ORDER_BOOK_WAIT_MS = 30_000;
const CLOSE_SETTLE_MS = 2_000;
/**
 * Отказ подписки на стакан бывает двух разных пород, и путать их нельзя: у Binance биржевой слой
 * честно говорит «этот рынок стакан потоком не отдаёт» (`Orderbook subscription not supported for
 * … market`) — чинить нечего; любой другой отказ означает, что стакан НЕ заработал по настоящей
 * причине, и обещание обязано это показать, а не молча остаться подтверждённым.
 */
const ORDER_BOOK_UNSUPPORTED_ERROR_TEXT = 'not supported';

async function checkPublicStreamContract(context: LiveCheckContext): Promise<LiveCheckOutcome> {
  const streamExchange = context.createStreamExchange();
  const client = streamExchange.futures;
  const symbol = context.settings.futuresSymbol;
  const violationList: string[] = [];

  let isClosed = false;

  try {
    await client.loadTradeSymbols();

    let tickerFrameCount = 0;
    let klineFrameCount = 0;
    let orderBookFrameCount = 0;
    let isReadySettled = false;
    let streamTicker: Ticker | undefined;
    let streamKline: Kline | undefined;

    client.subscribeAllTickers((tickerBySymbol) => {
      tickerFrameCount += 1;
      streamTicker = tickerBySymbol.get(symbol) ?? streamTicker;
    }, [symbol]);
    client.subscribeKlines({
      symbol,
      interval: '1m',
      handler: (_symbol, kline) => {
        klineFrameCount += 1;
        streamKline = kline;
      },
    });

    let orderBookNoteText = 'подписан';

    try {
      client.subscribeOrderbook({
        symbol,
        depth: context.settings.orderBookDepth,
        handler: () => {
          orderBookFrameCount += 1;
        },
      });
    } catch (error) {
      const errorText = describeError(error);
      const isOrderBookUnsupported = errorText.includes(ORDER_BOOK_UNSUPPORTED_ERROR_TEXT);

      orderBookNoteText = isOrderBookUnsupported
        ? `биржевой слой стакан потоком не отдаёт (${errorText})`
        : `подписка на стакан отказала (${errorText})`;

      if (!isOrderBookUnsupported) {
        violationList.push(`подписка на стакан отказала, и не отсутствием поддержки: ${errorText}`);
      }
    }

    const readyPromise = client
      .awaitWebSocketConnectionsReady()
      .then(() => {
        isReadySettled = true;
      })
      .catch((error: unknown) => {
        violationList.push(`ожидание готовности соединений отказало: ${describeError(error)}`);
      });

    await Promise.race([readyPromise, sleep(READY_WAIT_MS)]);

    if (!isReadySettled) {
      violationList.push(`ожидание готовности соединений не завершилось за ${READY_WAIT_MS / 1000} с`);
    }

    // Ждём САМ инструмент, а не первый попавшийся кадр: кадр тикеров Binance несёт только те
    // инструменты, что изменились за последнюю секунду, и на демо-стенде BTCUSDT в первые кадры
    // может не попасть. Пока ожидание кончалось на первом кадре, здоровый поток получал
    // «расх.» из-за одной тихой секунды.
    const hasSymbolTicker = await waitForCondition({ isReady: () => streamTicker !== undefined, timeoutMs: TICKER_WAIT_MS });

    if (tickerFrameCount === 0) {
      violationList.push(`кадр тикеров не пришёл за ${TICKER_WAIT_MS / 1000} с`);
    }

    if (tickerFrameCount > 0 && !hasSymbolTicker) {
      violationList.push(
        `кадров тикеров ${tickerFrameCount}, но ${symbol} за ${TICKER_WAIT_MS / 1000} с в них не встретился — ` +
          'поток отдаёт записи без имени инструмента или не по тому инструменту',
      );
    }

    if (streamTicker !== undefined && !(streamTicker.lastPrice > 0)) {
      violationList.push(`${symbol} пришёл из потока с ценой ${String(streamTicker.lastPrice)} — величины кадра не разобраны`);
    }

    const hasKlineFrame = await waitForCondition({ isReady: () => klineFrameCount > 0, timeoutMs: KLINE_WAIT_MS });

    if (!hasKlineFrame) {
      violationList.push(`кадр минутной свечи не пришёл за ${KLINE_WAIT_MS / 1000} с`);
    }

    if (streamKline !== undefined && !(streamKline.closePrice > 0)) {
      violationList.push(`свеча из потока пришла с ценой закрытия ${String(streamKline.closePrice)} — величины кадра не разобраны`);
    }

    if (orderBookNoteText === 'подписан') {
      const hasOrderBookFrame = await waitForCondition({ isReady: () => orderBookFrameCount > 0, timeoutMs: ORDER_BOOK_WAIT_MS });

      orderBookNoteText = hasOrderBookFrame ? `кадров ${orderBookFrameCount}` : `подписка принята, но за ${ORDER_BOOK_WAIT_MS / 1000} с не пришло ни кадра`;

      if (!hasOrderBookFrame) {
        violationList.push('стакан подписан, а кадров по нему нет');
      }
    }

    const connectionInfoList = client.getWebSocketConnectionInfoList();
    const subscribedConnectionList = connectionInfoList.filter((info) => info.subscriptionList.length > 0);

    if (subscribedConnectionList.length === 0) {
      violationList.push('реестр соединений не показывает ни одной подписки');
    }

    await streamExchange.close();
    isClosed = true;

    await sleep(CLOSE_SETTLE_MS);

    const stillConnectedList = client.getWebSocketConnectionInfoList().filter((info) => info.isConnected);

    if (stillConnectedList.length > 0) {
      violationList.push(`после close() остались подключёнными: ${stillConnectedList.map((info) => info.label).join(', ')}`);
    }

    const summaryText =
      `${symbol}: кадров тикеров ${tickerFrameCount} (цена из потока ${streamTicker === undefined ? 'инструмент в кадрах не найден' : String(streamTicker.lastPrice)}), ` +
      `кадров свечей ${klineFrameCount} (закрытие ${streamKline === undefined ? 'нет' : String(streamKline.closePrice)}), стакан — ${orderBookNoteText}; ` +
      `соединений ${connectionInfoList.length}, с подписками ${subscribedConnectionList.length} ` +
      `(${subscribedConnectionList.map((info) => info.subscriptionList.length).join('/')} тем); ` +
      `после close() подключённых ${stillConnectedList.length}`;

    if (violationList.length > 0) {
      return { status: 'diverged', fact: `${summaryText}; нарушений ${violationList.length}: ${joinViolationSample(violationList)}` };
    }

    return { status: 'confirmed', fact: summaryText };
  } finally {
    if (!isClosed) {
      // Аварийная уборка: сам сбой обещания дойдёт до отчёта своим путём, а вот неудача закрытия
      // не дошла бы никуда — повисший сокет остался бы висеть без единой строки о нём.
      await streamExchange.close().catch((error: unknown) => {
        printNote(`аварийное закрытие потоков не удалось: ${describeError(error)}`);
      });
    }
  }
}

export const publicStreamCheck: LiveCheck = {
  title: 'Публичные потоки: кадры тикеров и свечей, готовность соединений, реестр подписок, закрытие',
  timeoutMs: TIMEOUT_MS,
  isCredentialsRequired: false,
  isOrdersRequired: false,
  run: checkPublicStreamContract,
};
