import type { ExchangeClient } from '../../src/types/exchange';
import { describeError } from '../live-support/liveError';
import { printNote } from '../live-support/liveOutput';

export async function cancelOwnOrders(client: ExchangeClient, symbol: string, clientOrderIdPrefix: string): Promise<number> {
  const openOrderList = await client.fetchOpenOrders(symbol);
  const ownOrderList = openOrderList.filter((order) => order.clientOrderId.startsWith(clientOrderIdPrefix));

  let cancelledCount = 0;

  for (const order of ownOrderList) {
    try {
      await client.cancelOrder(symbol, order.id);
      cancelledCount += 1;
    } catch (error) {
      printNote(`заявку ${order.id} снять не удалось — проверьте счёт руками: ${describeError(error)}`);
    }
  }

  return cancelledCount;
}
