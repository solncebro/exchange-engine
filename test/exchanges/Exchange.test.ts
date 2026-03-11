import { Exchange } from '../../src/exchanges/Exchange';
import { createMockLogger } from '../fixtures/mockLogger';
import { ExchangeNameEnum } from '../../src/types/common';

jest.mock('../../src/exchanges/BinanceFutures');
jest.mock('../../src/exchanges/BinanceSpot');
jest.mock('../../src/exchanges/BybitLinear');
jest.mock('../../src/exchanges/BybitSpot');

const mockArgs = {
  config: { apiKey: 'testKey', secret: 'testSecret' },
  logger: createMockLogger(),
};

describe('Exchange', () => {
  it('creates BinanceFutures and BinanceSpot for binance', () => {
    const exchange = new Exchange(ExchangeNameEnum.Binance, mockArgs);

    expect(exchange.futures).toBeDefined();
    expect(exchange.spot).toBeDefined();
  });

  it('creates BybitLinear and BybitSpot for bybit', () => {
    const exchange = new Exchange(ExchangeNameEnum.Bybit, mockArgs);

    expect(exchange.futures).toBeDefined();
    expect(exchange.spot).toBeDefined();
  });

  it('preserves exchange name', () => {
    const binance = new Exchange(ExchangeNameEnum.Binance, mockArgs);
    const bybit = new Exchange(ExchangeNameEnum.Bybit, mockArgs);

    expect(binance.name).toBe(ExchangeNameEnum.Binance);
    expect(bybit.name).toBe(ExchangeNameEnum.Bybit);
  });

  it('throws on unknown exchange name', () => {
    expect(() => new Exchange('unknown' as any, mockArgs)).toThrow('Unknown exchange: unknown');
  });

  it('close() calls close on both futures and spot', async () => {
    const exchange = new Exchange(ExchangeNameEnum.Binance, mockArgs);
    (exchange.futures.close as jest.Mock).mockResolvedValue(undefined);
    (exchange.spot.close as jest.Mock).mockResolvedValue(undefined);

    await exchange.close();

    expect(exchange.futures.close).toHaveBeenCalled();
    expect(exchange.spot.close).toHaveBeenCalled();
  });
});
