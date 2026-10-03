import axios from 'axios';

import { Exchange } from '../../src/exchanges/Exchange';
import { OkxSwap } from '../../src/exchanges/OkxSwap';
import { OkxSpot } from '../../src/exchanges/OkxSpot';
import { createMockLogger } from '../fixtures/mockLogger';
import { createMockAxiosInstance } from '../fixtures/mockAxios';
import { ExchangeNameEnum, SubAccountTransferDirectionEnum, WalletTypeEnum } from '../../src/types/common';
import { BinanceSubAccount } from '../../src/exchanges/BinanceSubAccount';
import { BybitSubAccount } from '../../src/exchanges/BybitSubAccount';
import { UnsupportedSubAccount } from '../../src/exchanges/UnsupportedSubAccount';
import { ExchangeError } from '../../src/errors/ExchangeError';

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

  describe('subAccount', () => {
    it.each([
      [ExchangeNameEnum.Binance, BinanceSubAccount],
      [ExchangeNameEnum.Bybit, BybitSubAccount],
    ])('gives %p a live sub-account client', (name, expectedClass) => {
      const exchange = new Exchange(name, mockArgs);

      expect(exchange.subAccount).toBeInstanceOf(expectedClass);
    });

    it.each([ExchangeNameEnum.Binance, ExchangeNameEnum.Bybit])('refuses sub-accounts of %p in demo mode without going to the network', async (name) => {
      const mockInstance = createMockAxiosInstance();
      mockedAxios.create.mockReturnValue(mockInstance as never);
      const exchange = new Exchange(name, { ...mockArgs, config: { ...mockArgs.config, isDemoMode: true } });

      expect(exchange.subAccount).toBeInstanceOf(UnsupportedSubAccount);
      await expect(exchange.subAccount.fetchSubAccountList()).rejects.toMatchObject({ code: 'SUB_ACCOUNT_NOT_SUPPORTED', exchange: name });
      expect(mockInstance.get).not.toHaveBeenCalled();
    });

    it('refuses every sub-account operation on okx', async () => {
      const exchange = new Exchange(ExchangeNameEnum.Okx, mockOkxArgs);
      const transferArgs = {
        subAccountId: '1',
        direction: SubAccountTransferDirectionEnum.MasterToSub,
        asset: 'USDT',
        amount: 1,
        fromWalletType: WalletTypeEnum.Spot,
        toWalletType: WalletTypeEnum.Spot,
        transferId: 'be7a2462-1138-4e27-80b1-62653f24925e',
      };

      await expect(exchange.subAccount.fetchSubAccountList()).rejects.toThrow(ExchangeError);
      await expect(exchange.subAccount.transferSubAccountAsset(transferArgs)).rejects.toMatchObject({ code: 'SUB_ACCOUNT_NOT_SUPPORTED', exchange: 'okx' });
      await expect(exchange.subAccount.fetchSubAccountTransfer(transferArgs)).rejects.toMatchObject({ code: 'SUB_ACCOUNT_NOT_SUPPORTED' });
      await expect(exchange.subAccount.fetchSubAccountBalances({ subAccountId: '1', walletType: WalletTypeEnum.Spot }))
        .rejects.toMatchObject({ code: 'SUB_ACCOUNT_NOT_SUPPORTED' });
    });
  });
});
