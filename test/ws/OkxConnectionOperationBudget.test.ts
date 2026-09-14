import { OkxConnectionOperationBudget } from '../../src/ws/OkxConnectionOperationBudget';
import {
  OKX_CONNECTION_OPERATION_LIMIT_PER_HOUR,
  OKX_CONNECTION_OPERATION_WARN_RATIO,
  OKX_CONNECTION_OPERATION_WINDOW_MS,
} from '../../src/constants/okx';
import { createMockLogger } from '../fixtures/mockLogger';

describe('OkxConnectionOperationBudget', () => {
  const label = 'OKX Linear public #1';

  function createBudget(logger = createMockLogger()) {
    return {
      logger,
      budget: new OkxConnectionOperationBudget({
        label,
        logger,
        limitPerWindow: OKX_CONNECTION_OPERATION_LIMIT_PER_HOUR,
        windowMs: OKX_CONNECTION_OPERATION_WINDOW_MS,
        warnRatio: OKX_CONNECTION_OPERATION_WARN_RATIO,
      }),
    };
  }

  it('allows the documented number of operations and refuses the next one', () => {
    const { budget, logger } = createBudget();

    for (let i = 0; i < OKX_CONNECTION_OPERATION_LIMIT_PER_HOUR; i++) {
      expect(budget.registerOperation('subscribe')).toBe(true);
    }

    expect(budget.registerOperation('subscribe')).toBe(false);
    expect(budget.getUsedOperationCount()).toBe(OKX_CONNECTION_OPERATION_LIMIT_PER_HOUR);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining(label));
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('subscribe'));
  });

  it('warns once when the count crosses the warning ratio, not on every operation after it', () => {
    const { budget, logger } = createBudget();
    const warnThreshold = Math.floor(OKX_CONNECTION_OPERATION_LIMIT_PER_HOUR * OKX_CONNECTION_OPERATION_WARN_RATIO);

    for (let i = 0; i < warnThreshold - 1; i++) {
      budget.registerOperation('subscribe');
    }

    expect(logger.warn).not.toHaveBeenCalled();

    budget.registerOperation('subscribe');
    budget.registerOperation('subscribe');

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining(`${warnThreshold}/${OKX_CONNECTION_OPERATION_LIMIT_PER_HOUR}`));
  });

  it('lets operations through again once they slide out of the hour', () => {
    let nowMs = 1700000000000;
    const dateSpy = jest.spyOn(Date, 'now').mockImplementation(() => nowMs);
    const { budget } = createBudget();

    for (let i = 0; i < OKX_CONNECTION_OPERATION_LIMIT_PER_HOUR; i++) {
      budget.registerOperation('subscribe');
    }

    expect(budget.registerOperation('unsubscribe')).toBe(false);

    nowMs += OKX_CONNECTION_OPERATION_WINDOW_MS + 1;

    expect(budget.getUsedOperationCount()).toBe(0);
    expect(budget.registerOperation('unsubscribe')).toBe(true);

    dateSpy.mockRestore();
  });

  it('keeps counting operations that are still inside the hour', () => {
    let nowMs = 1700000000000;
    const dateSpy = jest.spyOn(Date, 'now').mockImplementation(() => nowMs);
    const { budget } = createBudget();

    budget.registerOperation('subscribe');
    nowMs += OKX_CONNECTION_OPERATION_WINDOW_MS / 2;
    budget.registerOperation('subscribe');
    nowMs += OKX_CONNECTION_OPERATION_WINDOW_MS / 2 + 1;

    expect(budget.getUsedOperationCount()).toBe(1);

    dateSpy.mockRestore();
  });
});
