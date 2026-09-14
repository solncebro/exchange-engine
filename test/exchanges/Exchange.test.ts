import axios from 'axios';

import { Exchange } from '../../src/exchanges/Exchange';
import { OkxSwap } from '../../src/exchanges/OkxSwap';
import { OkxSpot } from '../../src/exchanges/OkxSpot';
import { createMockLogger } from '../fixtures/mockLogger';
import { createMockAxiosInstance } from '../fixtures/mockAxios';
import { ExchangeNameEnum } from '../../src/types/common';

jest.mock('axios');
jest.mock('../../src/exchanges/BinanceFutures');
jest.mock('../../src/exchanges/BinanceSpot');
jest.mock('../../src/exchanges/BybitLinear');
jest.mock('../../src/exchanges/BybitSpot');
jest.mock('../../src/ws/OkxPublicStream');
jest.mock('../../src/ws/OkxTradeStream');

const mockedAxios = axios as jest.Mocked<typeof axios>;

const mockArgs = {
  config: { apiKey: 'testKey', secret: 'testSecret' },
  logger: createMockLogger(),
};

const mockOkxArgs = {
  config: { apiKey: 'testKey', secret: 'testSecret', passphrase: 'testPassphrase' },
  logger: createMockLogger(),
};

beforeEach(() => {
  mockedAxios.create.mockReturnValue(createMockAxiosInstance() as never);
});

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

  it('creates OkxSwap and OkxSpot for okx', () => {
    const exchange = new Exchange(ExchangeNameEnum.Okx, mockOkxArgs);

    expect(exchange.futures).toBeInstanceOf(OkxSwap);
    expect(exchange.spot).toBeInstanceOf(OkxSpot);
  });

  it('rejects okx without a passphrase right at construction', () => {
    expect(() => new Exchange(ExchangeNameEnum.Okx, mockArgs)).toThrow(
      'OKX API requires a passphrase (ExchangeConfig.passphrase)',
    );
  });

  it('preserves exchange name', () => {
    const binance = new Exchange(ExchangeNameEnum.Binance, mockArgs);
    const bybit = new Exchange(ExchangeNameEnum.Bybit, mockArgs);
    const okx = new Exchange(ExchangeNameEnum.Okx, mockOkxArgs);

    expect(binance.name).toBe(ExchangeNameEnum.Binance);
    expect(bybit.name).toBe(ExchangeNameEnum.Bybit);
    expect(okx.name).toBe(ExchangeNameEnum.Okx);
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
