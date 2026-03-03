import { Exchange } from '../../src/exchanges/Exchange';
import { createMockLogger } from '../fixtures/mockLogger';
import { ExchangeName } from '../../src/types/common';

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
    const exchange = new Exchange(ExchangeName.Binance, mockArgs);

    expect(exchange.futures).toBeDefined();
    expect(exchange.spot).toBeDefined();
  });

  it('creates BybitLinear and BybitSpot for bybit', () => {
    const exchange = new Exchange(ExchangeName.Bybit, mockArgs);

    expect(exchange.futures).toBeDefined();
    expect(exchange.spot).toBeDefined();
  });

  it('preserves exchange name', () => {
    const binance = new Exchange(ExchangeName.Binance, mockArgs);
    const bybit = new Exchange(ExchangeName.Bybit, mockArgs);

    expect(binance.name).toBe(ExchangeName.Binance);
    expect(bybit.name).toBe(ExchangeName.Bybit);
  });

  it('close() calls close on both futures and spot', async () => {
    const exchange = new Exchange(ExchangeName.Binance, mockArgs);
    (exchange.futures.close as jest.Mock).mockResolvedValue(undefined);
    (exchange.spot.close as jest.Mock).mockResolvedValue(undefined);

    await exchange.close();

    expect(exchange.futures.close).toHaveBeenCalled();
    expect(exchange.spot.close).toHaveBeenCalled();
  });
});
