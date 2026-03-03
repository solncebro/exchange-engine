import type { ExchangeLogger } from '../../src/types/common';

export function createMockLogger(): jest.Mocked<ExchangeLogger> {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    fatal: jest.fn(),
  };
}
