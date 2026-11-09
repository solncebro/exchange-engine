import { BYBIT_ISOLATED_MARGIN_MODE } from '../../src/constants/bybit';
import type { BybitHttpClient } from '../../src/http/BybitHttpClient';
import { ExchangeNameEnum, PositionModeEnum } from '../../src/types/common';
import type { Position } from '../../src/types/common';
import { describeError } from '../live-support/liveError';
import { printNote } from '../live-support/liveOutput';
import { formatNumber, joinViolationSample } from './checkSupport';
import type { CheckSymbolHedgeLeverageArgs } from './directionalLeverageCheck.types';
import { checkExecutionSymbolIsFree } from './executionSymbolGuard';
import type { LiveCheck, LiveCheckContext, LiveCheckOutcome } from './liveCheck.types';

const TIMEOUT_MS = 120_000;
const DIRECTION = 'long';
const DIRECTIONAL_LEVERAGE_EXCHANGE_LIST: ExchangeNameEnum[] = [ExchangeNameEnum.Bybit];
const BYBIT_LINEAR_CATEGORY = 'linear';
const BYBIT_ONE_WAY_MODE = 0;
const BYBIT_HEDGE_MODE = 3;
const ONE_WAY_POSITION_IDX = 0;
const HEDGE_LONG_POSITION_IDX = 1;
const HEDGE_SHORT_POSITION_IDX = 2;

function describeSlotLeverage(slotList: Position[]): string {
  return slotList.map((slot) => `ячейка ${String(slot.positionIdx)}: ${formatNumber(slot.leverage)}`).join(', ');
}

function findLeverageMismatchList(slotList: Position[], expectedLeverage: number): string[] {
  return slotList
    .filter((slot) => slot.leverage !== expectedLeverage)
    .map((slot) => `ячейка ${String(slot.positionIdx)}: плечо ${formatNumber(slot.leverage)}, ждали ${formatNumber(expectedLeverage)}`);
}

function findSlotLeverage(slotList: Position[], positionIdx: number): number {
  return slotList.find((slot) => slot.positionIdx === positionIdx)?.leverage ?? Number.NaN;
}

function isHedgeSlotList(slotList: Position[]): boolean {
  return slotList.length === 2 &&
    slotList.some((slot) => slot.positionIdx === HEDGE_LONG_POSITION_IDX) &&
    slotList.some((slot) => slot.positionIdx === HEDGE_SHORT_POSITION_IDX);
}

function isOneWaySlotList(slotList: Position[]): boolean {
  return slotList.length === 1 && slotList[0].positionIdx === ONE_WAY_POSITION_IDX;
}

async function switchSymbolPositionMode(httpClient: BybitHttpClient, symbol: string, mode: number): Promise<void> {
  await httpClient.setPositionMode({ category: BYBIT_LINEAR_CATEGORY, symbol, mode });
}

async function checkSymbolHedgeLeverage(args: CheckSymbolHedgeLeverageArgs): Promise<string> {
  const { context, signal, httpClient, originalLeverage, violationList } = args;
  const client = context.exchange.futures;
  const symbol = context.settings.executionSymbol;
  const neighbourSymbol = context.settings.futuresSymbol;
  const accountInfo = await httpClient.fetchAccountInfo();
  const accountMarginMode = String(accountInfo.result.marginMode ?? '');
  const isIsolatedAccount = accountMarginMode === BYBIT_ISOLATED_MARGIN_MODE;
  const neighbourBefore = describeSlotLeverage(await client.fetchPositionList(neighbourSymbol));

  let isSymbolSwitched = false;
  let isHedgeLeverageChanged = false;
  let longLeverage = Number.NaN;

  try {
    signal.throwIfAborted();
    await switchSymbolPositionMode(httpClient, symbol, BYBIT_HEDGE_MODE);
    isSymbolSwitched = true;

    const hedgeSlotList = await client.fetchPositionList(symbol);
    const neighbourDuringHedge = describeSlotLeverage(await client.fetchPositionList(neighbourSymbol));

    context.showEvidence(`ячейки ${symbol} после переключения только этого символа в двусторонний режим`, hedgeSlotList);

    if (neighbourDuringHedge !== neighbourBefore) {
      violationList.push(`соседний ${neighbourSymbol} изменился при переключении ${symbol}: было «${neighbourBefore}», стало «${neighbourDuringHedge}»`);
    }

    if (!isHedgeSlotList(hedgeSlotList)) {
      violationList.push(`после переключения ${symbol} в двусторонний режим ячейки не 1 и 2: ${describeSlotLeverage(hedgeSlotList)}`);

      return `${symbol} переключён в двусторонний режим, но ячейки не 1 и 2 (${describeSlotLeverage(hedgeSlotList)})`;
    }

    longLeverage = findSlotLeverage(hedgeSlotList, HEDGE_LONG_POSITION_IDX);

    const shortLeverage = findSlotLeverage(hedgeSlotList, HEDGE_SHORT_POSITION_IDX);
    const targetLeverage = longLeverage > 1 ? longLeverage - 1 : longLeverage + 1;
    const expectedShortLeverage = isIsolatedAccount ? shortLeverage : targetLeverage;

    signal.throwIfAborted();

    const setResult = await client.setLeverage(targetLeverage, symbol, { direction: DIRECTION });

    isHedgeLeverageChanged = true;

    if (setResult.confirmedLeverage !== targetLeverage) {
      violationList.push(`двусторонний режим: установка подтвердила ${String(setResult.confirmedLeverage)}, а просили ${formatNumber(targetLeverage)}`);
    }

    const changedSlotList = await client.fetchPositionList(symbol);
    const changedLongLeverage = findSlotLeverage(changedSlotList, HEDGE_LONG_POSITION_IDX);
    const changedShortLeverage = findSlotLeverage(changedSlotList, HEDGE_SHORT_POSITION_IDX);

    if (changedLongLeverage !== targetLeverage) {
      violationList.push(`двусторонний режим: плечо длинной стороны ${formatNumber(changedLongLeverage)}, ждали ${formatNumber(targetLeverage)}`);
    }

    if (changedShortLeverage !== expectedShortLeverage) {
      violationList.push(`двусторонний режим: плечо короткой стороны ${formatNumber(changedShortLeverage)}, ждали ${formatNumber(expectedShortLeverage)}`);
    }

    await client.setLeverage(longLeverage, symbol, { direction: DIRECTION });
    isHedgeLeverageChanged = false;

    const restoredHedgeSlotList = await client.fetchPositionList(symbol);

    if (findSlotLeverage(restoredHedgeSlotList, HEDGE_LONG_POSITION_IDX) !== longLeverage || findSlotLeverage(restoredHedgeSlotList, HEDGE_SHORT_POSITION_IDX) !== shortLeverage) {
      violationList.push(`двусторонний режим: после возврата плечи ${describeSlotLeverage(restoredHedgeSlotList)}, ждали ${formatNumber(longLeverage)} и ${formatNumber(shortLeverage)}`);
    }

    await switchSymbolPositionMode(httpClient, symbol, BYBIT_ONE_WAY_MODE);
    isSymbolSwitched = false;

    const oneWaySlotList = await client.fetchPositionList(symbol);
    const neighbourAfter = describeSlotLeverage(await client.fetchPositionList(neighbourSymbol));

    if (!isOneWaySlotList(oneWaySlotList)) {
      violationList.push(`после возврата ${symbol} в односторонний режим ячейки: ${describeSlotLeverage(oneWaySlotList)}`);
    }

    violationList.push(...findLeverageMismatchList(oneWaySlotList, originalLeverage));

    if (neighbourAfter !== neighbourBefore) {
      violationList.push(`соседний ${neighbourSymbol} после пробы «${neighbourAfter}», до неё «${neighbourBefore}»`);
    }

    return (
      `${symbol} отдельно переключён в двусторонний режим (счёт в '${accountMarginMode}'): плечи ячеек 1 и 2 были ${formatNumber(longLeverage)} и ${formatNumber(shortLeverage)}, ` +
      `с направлением '${DIRECTION}' поставлено ${formatNumber(targetLeverage)} (подтверждено ${String(setResult.confirmedLeverage)}), прочитано ${describeSlotLeverage(changedSlotList)}; ` +
      `возвращено, прочитано ${describeSlotLeverage(restoredHedgeSlotList)}; символ возвращён в односторонний режим, прочитано ${describeSlotLeverage(oneWaySlotList)}; ` +
      `${neighbourSymbol} до «${neighbourBefore}», во время «${neighbourDuringHedge}», после «${neighbourAfter}»`
    );
  } finally {
    try {
      if (isHedgeLeverageChanged) {
        await client.setLeverage(longLeverage, symbol, { direction: DIRECTION });
        printNote(`уборка после обещания: плечо длинной стороны ${symbol} возвращено в ${formatNumber(longLeverage)}`);
      }

      if (isSymbolSwitched) {
        await switchSymbolPositionMode(httpClient, symbol, BYBIT_ONE_WAY_MODE);
        printNote(`уборка после обещания: ${symbol} возвращён в односторонний режим`);
      }
    } catch (error) {
      printNote(`уборка после обещания не удалась — верните ${symbol} в односторонний режим и плечо ${formatNumber(originalLeverage)} руками: ${describeError(error)}`);
    }
  }
}

async function checkDirectionalLeverage(context: LiveCheckContext, signal: AbortSignal): Promise<LiveCheckOutcome> {
  if (!DIRECTIONAL_LEVERAGE_EXCHANGE_LIST.includes(context.exchangeName) || context.bybitDemoHttpClient === null) {
    return {
      status: 'notApplicable',
      fact: 'направление плеча библиотека у этой биржи принимает и в запрос не передаёт — проверять на бирже нечего, запросов не было',
    };
  }

  const client = context.exchange.futures;
  const symbol = context.settings.executionSymbol;

  await client.loadTradeSymbols();

  const occupiedOutcome = await checkExecutionSymbolIsFree(context);

  if (occupiedOutcome !== null) {
    return occupiedOutcome;
  }

  const positionMode = await client.fetchPositionMode();

  if (positionMode !== PositionModeEnum.OneWay) {
    return {
      status: 'incomplete',
      fact: `${symbol}: режим позиции '${String(positionMode)}' — ожидаемое плечо каждой ячейки зависит от режима маржи счёта, который проба не читает; плечо не менялось`,
    };
  }

  const slotList = await client.fetchPositionList(symbol);

  if (slotList.length === 0) {
    return { status: 'diverged', fact: `${symbol}: биржа не отдала ни одной ячейки позиции — исходное плечо неизвестно, проба его не меняет` };
  }

  const originalLeverage = slotList[0].leverage;

  if (slotList.some((slot) => slot.leverage !== originalLeverage) || !(originalLeverage >= 1) || !isOneWaySlotList(slotList)) {
    return { status: 'incomplete', fact: `${symbol}: ячейки не одна нулевая или плечи не числа (${describeSlotLeverage(slotList)}) — проба их не трогает` };
  }

  const targetLeverage = originalLeverage > 1 ? originalLeverage - 1 : originalLeverage + 1;
  const violationList: string[] = [];

  let isLeverageChanged = false;
  let restoredText = 'не менялось';

  try {
    signal.throwIfAborted();

    const setResult = await client.setLeverage(targetLeverage, symbol, { direction: DIRECTION });

    isLeverageChanged = true;

    if (setResult.confirmedLeverage !== targetLeverage) {
      violationList.push(`установка подтвердила ${String(setResult.confirmedLeverage)}, а просили ${formatNumber(targetLeverage)}`);
    }

    const changedSlotList = await client.fetchPositionList(symbol);

    violationList.push(...findLeverageMismatchList(changedSlotList, targetLeverage));

    const restoreResult = await client.setLeverage(originalLeverage, symbol, { direction: DIRECTION });

    isLeverageChanged = false;

    if (restoreResult.confirmedLeverage !== originalLeverage) {
      violationList.push(`возврат подтвердил ${String(restoreResult.confirmedLeverage)}, а просили ${formatNumber(originalLeverage)}`);
    }

    const restoredSlotList = await client.fetchPositionList(symbol);

    violationList.push(...findLeverageMismatchList(restoredSlotList, originalLeverage));
    restoredText = describeSlotLeverage(restoredSlotList);

    const hedgeText = await checkSymbolHedgeLeverage({ context, signal, httpClient: context.bybitDemoHttpClient, originalLeverage, violationList });
    const summaryText =
      `${symbol}: режим позиции односторонний, ячеек ${slotList.length}; плечо было ${formatNumber(originalLeverage)}, ` +
      `с направлением '${DIRECTION}' поставлено ${formatNumber(targetLeverage)} (подтверждено ${String(setResult.confirmedLeverage)}), ` +
      `прочитано ${describeSlotLeverage(changedSlotList)}; возвращено ${formatNumber(originalLeverage)} (подтверждено ${String(restoreResult.confirmedLeverage)}), ` +
      `прочитано ${restoredText}; ${hedgeText}`;

    if (violationList.length > 0) {
      return { status: 'diverged', fact: `${summaryText}; нарушений ${violationList.length}: ${joinViolationSample(violationList)}` };
    }

    return { status: 'confirmed', fact: summaryText };
  } finally {
    if (isLeverageChanged) {
      try {
        await client.setLeverage(originalLeverage, symbol, { direction: DIRECTION });
        printNote(`уборка после обещания: плечо ${symbol} возвращено в ${formatNumber(originalLeverage)}`);
      } catch (error) {
        printNote(`уборка после обещания не удалась — верните плечо ${symbol} в ${formatNumber(originalLeverage)} руками: ${describeError(error)}`);
      }
    }
  }
}

export const directionalLeverageCheck: LiveCheck = {
  title: 'Плечо с направлением (контракты): установка подтверждается чтением ячеек позиции и возвращается назад',
  timeoutMs: TIMEOUT_MS,
  isCredentialsRequired: true,
  isOrdersRequired: true,
  run: checkDirectionalLeverage,
};
