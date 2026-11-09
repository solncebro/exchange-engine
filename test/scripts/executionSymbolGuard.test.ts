import { checkExecutionSymbolIsFree } from '../../scripts/exchange-live-check/executionSymbolGuard';
import type { LiveCheckContext } from '../../scripts/exchange-live-check/liveCheck.types';
import { PositionSideEnum } from '../../src/types/common';
import type { Order, Position } from '../../src/types/common';

function createContext(positionList: Partial<Position>[], orderList: Partial<Order>[]): LiveCheckContext {
  return {
    settings: { executionSymbol: 'ETHUSDT', clientOrderIdPrefix: 'elcrun' },
    exchange: {
      futures: {
        fetchPositionList: async () => positionList,
        fetchOpenOrders: async () => orderList,
      },
    },
  } as unknown as LiveCheckContext;
}

describe('checkExecutionSymbolIsFree', () => {
  it('lets the probe run when there is no position and only own orders', async () => {
    const context = createContext([{ symbol: 'ETHUSDT', contracts: 0, side: PositionSideEnum.Both }], [{ id: '1', clientOrderId: 'elcrun3' }]);

    await expect(checkExecutionSymbolIsFree(context)).resolves.toBeNull();
  });

  it('marks the probe not applicable with the reason when a position is open', async () => {
    const context = createContext([{ symbol: 'ETHUSDT', contracts: 0.02, side: PositionSideEnum.Both }], []);

    const outcome = await checkExecutionSymbolIsFree(context);

    expect(outcome?.status).toBe('notApplicable');
    expect(outcome?.fact).toContain('открыта позиция');
  });

  it('marks the probe not applicable when an order without the run label is resting', async () => {
    const context = createContext([], [{ id: '77', clientOrderId: 'manual-order' }, { id: '78', clientOrderId: 'elcrun1' }]);

    const outcome = await checkExecutionSymbolIsFree(context);

    expect(outcome?.status).toBe('notApplicable');
    expect(outcome?.fact).toContain('77');
    expect(outcome?.fact).not.toContain('78');
  });
});
