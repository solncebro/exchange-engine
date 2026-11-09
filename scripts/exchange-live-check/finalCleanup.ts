import { closeOwnPosition } from '../live-support/liveOrder';
import { describeError } from '../live-support/liveError';
import { printNote } from '../live-support/liveOutput';
import type { LiveCheckContext } from './liveCheck.types';
import { cancelOwnOrders } from './orderCleanup';

export async function runFinalCleanup(context: LiveCheckContext, label: string): Promise<void> {
  const client = context.exchange.futures;
  const { ownPositionLedger } = context;
  const symbolList = [...new Set([context.settings.futuresSymbol, context.settings.executionSymbol])];

  let cancelledCount = 0;

  for (const symbol of symbolList) {
    try {
      cancelledCount += await cancelOwnOrders(client, symbol, context.settings.clientOrderIdPrefix);
    } catch (error) {
      printNote(`${label}: свои заявки по ${symbol} снять не удалось — проверьте счёт руками: ${describeError(error)}`);
    }
  }

  let positionText = `своего объёма по ${ownPositionLedger.symbol} в реестре нет`;

  if (ownPositionLedger.readOpenEntryList().length > 0) {
    try {
      await context.readTradeSymbols(client);

      const closeReport = await closeOwnPosition({ client, ledger: ownPositionLedger, buildClientOrderId: context.buildClientOrderId });

      positionText =
        `свой объём по ${ownPositionLedger.symbol} закрывался заявками ${closeReport.closingOrderList.length}, ` +
        `в реестре осталось: ${closeReport.remainingOwnText}`;

      for (const failureText of closeReport.failureList) {
        printNote(`${label}: ${failureText} — проверьте счёт руками`);
      }
    } catch (error) {
      positionText = `свой объём по ${ownPositionLedger.symbol} (${ownPositionLedger.describe()}) закрыть не удалось — проверьте счёт руками: ${describeError(error)}`;
    }
  }

  printNote(`${label}: снято своих заявок ${cancelledCount} (${symbolList.join(', ')}); ${positionText}; чужие позиции и заявки не трогались`);
}
