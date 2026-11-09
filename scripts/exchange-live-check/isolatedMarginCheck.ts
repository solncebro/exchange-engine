import { BYBIT_ISOLATED_MARGIN_MODE } from '../../src/constants/bybit';
import { buildBinanceSymbolConfigSettingsBySymbol } from '../../src/normalizers/binanceNormalizer';
import type { BinancePositionSettings } from '../../src/normalizers/binanceNormalizer.types';
import { ExchangeNameEnum, MarginModeEnum, OrderSideEnum, PositionModeEnum, PositionSideEnum } from '../../src/types/common';
import type { Position } from '../../src/types/common';
import { sleep } from '../../src/utils/sleep';
import { describeError } from '../live-support/liveError';
import { closeOwnPosition, openOwnMarketPosition, readFreshLastPrice, readOpenPositionList, resolveMinimalOrderAmount } from '../live-support/liveOrder';
import { printNote } from '../live-support/liveOutput';
import { describeLibraryRefusal, formatNumber, joinViolationSample } from './checkSupport';
import { checkExecutionSymbolIsFree } from './executionSymbolGuard';
import type { LiveCheck, LiveCheckContext, LiveCheckOutcome } from './liveCheck.types';
import type { MarginModeOriginRead, OpenPositionPhaseReport, ReadOpenSnapshotArgs, RunOpenPositionPhaseArgs } from './isolatedMarginCheck.types';

const TIMEOUT_MS = 240_000;
const ADDED_MARGIN_AMOUNT = 1;
const MARGIN_TOLERANCE = 0.0001;
const SNAPSHOT_POLL_INTERVAL_MS = 1_000;
const SNAPSHOT_POLL_ATTEMPT_COUNT = 5;
const HEDGE_LONG_POSITION_IDX = 1;
const ISOLATED_MARGIN_FIELD_NAME_BY_EXCHANGE: Partial<Record<ExchangeNameEnum, string>> = {
  [ExchangeNameEnum.Binance]: 'isolatedWallet',
  [ExchangeNameEnum.Bybit]: 'positionIM',
};
const BINANCE_PHASE_MARGIN_MODE_LIST: MarginModeEnum[] = [MarginModeEnum.Cross, MarginModeEnum.Isolated];

function readMarginField(position: Position, marginFieldName: string): number {
  return Number(position.info[marginFieldName] ?? Number.NaN);
}

async function readOpenSnapshot(args: ReadOpenSnapshotArgs): Promise<Position | null> {
  const { client, symbol, positionIdx } = args;

  let snapshot = await client.fetchPositionSnapshot(symbol, positionIdx);

  for (let attempt = 1; attempt < SNAPSHOT_POLL_ATTEMPT_COUNT && (snapshot === null || snapshot.contracts === 0); attempt++) {
    await sleep(SNAPSHOT_POLL_INTERVAL_MS);
    snapshot = await client.fetchPositionSnapshot(symbol, positionIdx);
  }

  return snapshot;
}

async function runOpenPositionPhase(args: RunOpenPositionPhaseArgs): Promise<OpenPositionPhaseReport> {
  const { context, signal, amount, positionMode, positionIdx, positionSide, expectedMarginMode, isMarginAdded, marginFieldName, violationList } = args;
  const client = context.exchange.futures;
  const symbol = context.settings.executionSymbol;
  const ledger = context.ownPositionLedger;

  signal.throwIfAborted();

  const opening = await openOwnMarketPosition({ client, ledger, side: OrderSideEnum.Buy, amount, positionMode, clientOrderId: context.buildClientOrderId() });
  const snapshotBefore = await readOpenSnapshot({ client, symbol, positionIdx });

  if (snapshotBefore === null || snapshotBefore.contracts === 0) {
    violationList.push(`в режиме '${expectedMarginMode}' после рыночной заявки на ${formatNumber(amount)} монет позиция не прочиталась открытой`);

    return { text: `режим '${expectedMarginMode}': позиция не прочиталась открытой`, isForeignPositionFound: false };
  }

  context.showEvidence(`открытая позиция в режиме '${expectedMarginMode}'`, snapshotBefore.info);

  if (snapshotBefore.marginMode === null) {
    violationList.push(`позиция открыта в режиме '${expectedMarginMode}', а библиотека не прочитала режим маржи открытой позиции (null)`);
  } else if (snapshotBefore.marginMode !== expectedMarginMode) {
    violationList.push(`позиция открыта в режиме '${expectedMarginMode}', а библиотека читает её режим как '${snapshotBefore.marginMode}'`);
  }

  let marginText = 'маржу не добавляли';

  if (isMarginAdded) {
    signal.throwIfAborted();
    await client.addIsolatedPositionMargin({ symbol, positionSide, amount: ADDED_MARGIN_AMOUNT });

    const snapshotAfter = await client.fetchPositionSnapshot(symbol, positionIdx);

    context.showEvidence('изолированная позиция после добавления маржи', snapshotAfter?.info ?? null);

    const marginBefore = readMarginField(snapshotBefore, marginFieldName);
    const marginAfter = snapshotAfter === null ? Number.NaN : readMarginField(snapshotAfter, marginFieldName);
    const marginGrowth = marginAfter - marginBefore;

    if (!Number.isFinite(marginGrowth) || Math.abs(marginGrowth - ADDED_MARGIN_AMOUNT) > MARGIN_TOLERANCE) {
      violationList.push(`маржа позиции (${marginFieldName}) выросла на ${formatNumber(marginGrowth)}, а добавляли ${ADDED_MARGIN_AMOUNT}`);
    }

    marginText = `маржа позиции (${marginFieldName}) ${formatNumber(marginBefore)} → ${formatNumber(marginAfter)} (добавляли ${ADDED_MARGIN_AMOUNT})`;
  }

  const closeReport = await closeOwnPosition({ client, ledger, buildClientOrderId: context.buildClientOrderId });
  const remainingList = await readOpenPositionList(client, symbol);
  const isForeignPositionFound = remainingList.length > 0 && !closeReport.hasOwnRemainder;

  violationList.push(...closeReport.failureList);

  if (isForeignPositionFound) {
    violationList.push(
      `режим '${expectedMarginMode}': свой объём закрыт, а на счёте позиция ${remainingList.map((position) => formatNumber(position.contracts)).join(', ')} монет — появилась чужая позиция, проба её не трогает`,
    );
  }

  return {
    text:
      `режим '${expectedMarginMode}': открыто ${formatNumber(opening.filledAmount)} монет (по чтению позиции ${formatNumber(snapshotBefore.contracts)}), ` +
      `режим по чтению '${String(snapshotBefore.marginMode)}', ${marginText}, закрывающих заявок своим объёмом ${closeReport.closingOrderList.length}, ` +
      `своего объёма после ${closeReport.remainingOwnText}, открытых позиций на счёте ${remainingList.length}`,
    isForeignPositionFound,
  };
}

async function readBybitAccountMarginMode(context: LiveCheckContext): Promise<string> {
  if (context.bybitDemoHttpClient === null) {
    return '';
  }

  const accountInfo = await context.bybitDemoHttpClient.fetchAccountInfo();

  context.showEvidence('сведения о счёте Bybit (/v5/account/info)', accountInfo.result);

  return String(accountInfo.result.marginMode ?? '');
}

async function readBinanceSymbolSettings(context: LiveCheckContext, symbol: string): Promise<BinancePositionSettings | null> {
  if (context.binanceDemoHttpClient === null) {
    return null;
  }

  const rawList = await context.binanceDemoHttpClient.fetchSymbolConfig(symbol);

  context.showEvidence('настройка символа /fapi/v1/symbolConfig', rawList);

  return buildBinanceSymbolConfigSettingsBySymbol(rawList).get(symbol) ?? null;
}

// У Binance пустой позиции в снимке нет (третья версия списка риска отдаёт только символы с позицией или заявками),
// поэтому исходный режим берётся из настройки символа напрямую; у Bybit пустая ячейка приходит обычным снимком всегда.
async function readMarginModeOrigin(
  context: LiveCheckContext,
  positionIdx: number | undefined,
  violationList: string[],
): Promise<MarginModeOriginRead | LiveCheckOutcome> {
  const client = context.exchange.futures;
  const symbol = context.settings.executionSymbol;

  if (context.exchangeName === ExchangeNameEnum.Bybit) {
    const emptySnapshot = await client.fetchPositionSnapshot(symbol, positionIdx);

    context.showEvidence('пустая ячейка Bybit обычным снимком', emptySnapshot);

    if (emptySnapshot === null) {
      return { status: 'diverged', fact: `${symbol}: пустая ячейка не вернулась — исходный режим маржи неизвестен, проба его не переключает` };
    }

    if (emptySnapshot.contracts !== 0) {
      violationList.push(`пустая позиция пришла с объёмом ${formatNumber(emptySnapshot.contracts)}`);
    }

    if (emptySnapshot.marginMode !== MarginModeEnum.Isolated) {
      violationList.push(`счёт в '${BYBIT_ISOLATED_MARGIN_MODE}', а пустая ячейка прочитана в режиме '${String(emptySnapshot.marginMode)}'`);
    }

    return {
      originalMarginMode: MarginModeEnum.Isolated,
      originText: `пустая ячейка прочитана в режиме '${String(emptySnapshot.marginMode)}', плечо ${formatNumber(emptySnapshot.leverage)}`,
    };
  }

  const symbolSettings = await readBinanceSymbolSettings(context, symbol);

  if (symbolSettings === null) {
    return { status: 'incomplete', fact: `${symbol}: настройка символа не вернула режим маржи — исходный режим неизвестен, проба его не переключает` };
  }

  const openOrderList = await client.fetchOpenOrders(symbol);
  let plainSnapshotText = `не проверялось: у символа ${openOrderList.length} открытых заявок, пустая ячейка тогда видна`;

  if (openOrderList.length === 0) {
    const plainSnapshot = await client.fetchPositionSnapshot(symbol, positionIdx);

    plainSnapshotText = plainSnapshot === null ? 'null' : 'позиция';
    context.showEvidence('пустая позиция Binance обычным снимком', plainSnapshot);

    if (plainSnapshot !== null) {
      violationList.push('пустая позиция Binance вернулась обычным снимком, а обещан null');
    }
  }

  return {
    originalMarginMode: symbolSettings.marginMode,
    originText:
      `исходный режим по настройке символа '${symbolSettings.marginMode}', плечо ${formatNumber(symbolSettings.leverage)}; ` +
      `пустая позиция обычным снимком — ${plainSnapshotText}`,
  };
}

async function readCurrentMarginMode(context: LiveCheckContext, positionIdx: number | undefined): Promise<MarginModeEnum | null> {
  const symbol = context.settings.executionSymbol;

  if (context.exchangeName === ExchangeNameEnum.Bybit) {
    const snapshot = await context.exchange.futures.fetchPositionSnapshot(symbol, positionIdx);

    return snapshot?.marginMode ?? null;
  }

  const symbolSettings = await readBinanceSymbolSettings(context, symbol);

  return symbolSettings?.marginMode ?? null;
}

async function checkIsolatedMarginAddition(context: LiveCheckContext, signal: AbortSignal): Promise<LiveCheckOutcome> {
  const client = context.exchange.futures;
  const symbol = context.settings.executionSymbol;
  const marginFieldName = ISOLATED_MARGIN_FIELD_NAME_BY_EXCHANGE[context.exchangeName];

  if (marginFieldName === undefined) {
    return describeLibraryRefusal(
      () => client.addIsolatedPositionMargin({ symbol, positionSide: PositionSideEnum.Both, amount: ADDED_MARGIN_AMOUNT }),
      'добавление изолированной маржи',
    );
  }

  await client.loadTradeSymbols();

  const occupiedOutcome = await checkExecutionSymbolIsFree(context);

  if (occupiedOutcome !== null) {
    return occupiedOutcome;
  }

  const isBybit = context.exchangeName === ExchangeNameEnum.Bybit;
  const accountMarginMode = isBybit ? await readBybitAccountMarginMode(context) : '';

  if (isBybit && accountMarginMode !== BYBIT_ISOLATED_MARGIN_MODE) {
    return {
      status: 'incomplete',
      fact: `${symbol}: режим маржи у Bybit один на весь счёт, а счёт сейчас в '${accountMarginMode}' — проба его не переключает, потому что это задело бы все позиции счёта`,
    };
  }

  const referencePrice = await readFreshLastPrice(client, symbol);

  if (!(referencePrice > 0)) {
    return { status: 'incomplete', fact: `${symbol}: нет последней цены — не от чего считать наименьший объём` };
  }

  const positionMode = await client.fetchPositionMode();
  const isHedge = positionMode === PositionModeEnum.Hedge;
  const positionIdx = isHedge ? HEDGE_LONG_POSITION_IDX : undefined;
  const positionSide = isHedge ? PositionSideEnum.Long : PositionSideEnum.Both;
  const violationList: string[] = [];
  const originRead = await readMarginModeOrigin(context, positionIdx, violationList);

  if ('status' in originRead) {
    return originRead;
  }

  const { originalMarginMode, originText } = originRead;
  const phaseMarginModeList = isBybit ? [MarginModeEnum.Isolated] : BINANCE_PHASE_MARGIN_MODE_LIST;
  const amount = resolveMinimalOrderAmount({ client, symbol, notionalPrice: referencePrice });
  const phaseTextList: string[] = [];

  const marginModePathList: MarginModeEnum[] = [originalMarginMode];

  let currentMarginMode = originalMarginMode;

  try {
    for (const phaseMarginMode of phaseMarginModeList) {
      if (!isBybit && currentMarginMode !== phaseMarginMode) {
        signal.throwIfAborted();
        await client.setMarginMode(phaseMarginMode, symbol);
        currentMarginMode = phaseMarginMode;
        marginModePathList.push(phaseMarginMode);
      }

      const phaseReport = await runOpenPositionPhase({
        context,
        signal,
        amount,
        positionMode,
        positionIdx,
        positionSide,
        expectedMarginMode: phaseMarginMode,
        isMarginAdded: phaseMarginMode === MarginModeEnum.Isolated,
        marginFieldName,
        violationList,
      });

      phaseTextList.push(phaseReport.text);

      if (phaseReport.isForeignPositionFound) {
        phaseTextList.push('следующие режимы не проверялись: под чужой позицией проба режим маржи не переключает');
        break;
      }
    }

    if (currentMarginMode !== originalMarginMode) {
      await client.setMarginMode(originalMarginMode, symbol);
      currentMarginMode = originalMarginMode;
      marginModePathList.push(originalMarginMode);
    }

    const marginModePathText = marginModePathList.length > 1 ? `переключался ${marginModePathList.join(' → ')}` : 'не переключался';

    const finalMarginMode = await readCurrentMarginMode(context, positionIdx);

    if (finalMarginMode !== originalMarginMode) {
      violationList.push(`режим маржи после пробы '${String(finalMarginMode)}', а до неё был '${originalMarginMode}'`);
    }

    const accountText = isBybit ? `счёт в '${accountMarginMode}' (режим общий на весь счёт, не переключался); ` : '';
    const summaryText =
      `${symbol}: ${accountText}${originText}; ` +
      `${phaseTextList.join('; ')}; режим маржи ${marginModePathText}, по чтению после пробы '${String(finalMarginMode)}'`;

    if (violationList.length > 0) {
      return { status: 'diverged', fact: `${summaryText}; нарушений ${violationList.length}: ${joinViolationSample(violationList)}` };
    }

    return { status: 'confirmed', fact: summaryText };
  } finally {
    try {
      const closeReport = await closeOwnPosition({ client, ledger: context.ownPositionLedger, buildClientOrderId: context.buildClientOrderId });

      printNote(`уборка после обещания: своим объёмом закрывающих заявок ${closeReport.closingOrderList.length}; в реестре: ${closeReport.remainingOwnText}`);

      for (const failureText of closeReport.failureList) {
        printNote(`уборка после обещания: ${failureText} — проверьте счёт руками`);
      }

      if (currentMarginMode !== originalMarginMode) {
        await client.setMarginMode(originalMarginMode, symbol);
        printNote(`уборка после обещания: режим маржи ${symbol} возвращён в '${originalMarginMode}'`);
      }
    } catch (error) {
      printNote(`уборка после обещания не удалась — проверьте счёт руками (позиция ${symbol}, режим маржи '${originalMarginMode}'): ${describeError(error)}`);
    }
  }
}

export const isolatedMarginCheck: LiveCheck = {
  title: 'Режим маржи и изолированная маржа (контракты): режим открытой позиции читается верно, добавление увеличивает маржу, режим возвращается',
  timeoutMs: TIMEOUT_MS,
  isCredentialsRequired: true,
  isOrdersRequired: true,
  run: checkIsolatedMarginAddition,
};
