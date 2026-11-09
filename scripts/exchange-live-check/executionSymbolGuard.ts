import { readOpenPositionList } from '../live-support/liveOrder';
import { formatNumber } from './checkSupport';
import type { LiveCheckContext, LiveCheckOutcome } from './liveCheck.types';

export async function checkExecutionSymbolIsFree(context: LiveCheckContext): Promise<LiveCheckOutcome | null> {
  const client = context.exchange.futures;
  const symbol = context.settings.executionSymbol;
  const [openPositionList, openOrderList] = await Promise.all([readOpenPositionList(client, symbol), client.fetchOpenOrders(symbol)]);
  const foreignOrderList = openOrderList.filter((order) => !order.clientOrderId.startsWith(context.settings.clientOrderIdPrefix));
  const reasonList: string[] = [];

  if (openPositionList.length > 0) {
    reasonList.push(`на счёте открыта позиция ${openPositionList.map((position) => `${position.side} ${formatNumber(position.contracts)}`).join(', ')} монет`);
  }

  if (foreignOrderList.length > 0) {
    reasonList.push(`висят заявки без метки этого запуска: ${foreignOrderList.map((order) => order.id).join(', ')}`);
  }

  if (reasonList.length === 0) {
    return null;
  }

  return {
    status: 'notApplicable',
    fact: `${symbol}: ${reasonList.join('; ')} — проба заявок не ставит и настроек не меняет, чтобы не задеть чужое`,
  };
}
