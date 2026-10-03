import axios from 'axios';
import { BybitSubAccount } from '../../src/exchanges/BybitSubAccount';
import { ExchangeError } from '../../src/errors/ExchangeError';
import {
  SubAccountStatusEnum,
  SubAccountTransferDirectionEnum,
  SubAccountTransferStatusEnum,
  WalletTypeEnum,
} from '../../src/types/common';
import { createMockLogger } from '../fixtures/mockLogger';
import { createMockAxiosInstance } from '../fixtures/mockAxios';
import {
  BYBIT_RAW_ACCOUNT_COINS_BALANCE_RESPONSE,
  BYBIT_RAW_API_KEY_INFO_RESPONSE,
  BYBIT_RAW_SUB_MEMBER_LIST_RESPONSE,
  BYBIT_RAW_UNIVERSAL_TRANSFER_LIST_RESPONSE,
  BYBIT_RAW_UNIVERSAL_TRANSFER_RESPONSE,
} from '../fixtures/bybitSubAccountRaw';

jest.mock('axios');

const mockedAxios = axios as jest.Mocked<typeof axios>;

function createClient() {
  const mockInstance = createMockAxiosInstance();
  mockedAxios.create.mockReturnValue(mockInstance as never);

  const client = new BybitSubAccount({
    config: { apiKey: 'masterKey', secret: 'masterSecret' },
    logger: createMockLogger(),
  });

  return { client, mockInstance };
}

const TRANSFER_ID = 'be7a2462-1138-4e27-80b1-62653f24925e';

const MASTER_TO_SUB_ARGS = {
  subAccountId: '592334',
  direction: SubAccountTransferDirectionEnum.MasterToSub,
  asset: 'USDT',
  amount: 0.5,
  fromWalletType: WalletTypeEnum.Spot,
  toWalletType: WalletTypeEnum.UsdtFutures,
  transferId: TRANSFER_ID,
};

describe('BybitSubAccount', () => {
  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(1700000000000);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('fetchSubAccountList', () => {
    it('reads query-sub-members with signed headers and normalizes the documented example', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({ data: BYBIT_RAW_SUB_MEMBER_LIST_RESPONSE });

      const result = await client.fetchSubAccountList();

      const [url, options] = mockInstance.get.mock.calls[0];
      expect(url).toBe('/v5/user/query-sub-members');
      expect(options.headers['X-BAPI-API-KEY']).toBe('masterKey');
      expect(options.headers['X-BAPI-SIGN']).toEqual(expect.any(String));
      expect(result).toEqual([
        { subAccountId: '53888001', name: 'xxx001', note: 'test', status: SubAccountStatusEnum.Active, createdAt: null },
        { subAccountId: '53888002', name: 'xxx002', note: null, status: SubAccountStatusEnum.Active, createdAt: null },
      ]);
    });

    it.each([
      [2, SubAccountStatusEnum.LoginBanned],
      [4, SubAccountStatusEnum.Frozen],
      [9, SubAccountStatusEnum.Unknown],
    ])('maps member status %p', async (status, expected) => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({
        data: { retCode: 0, retMsg: '', result: { subMembers: [{ uid: '1', username: 'a', memberType: 1, status, remark: '' }] } },
      });

      const [subAccount] = await client.fetchSubAccountList();

      expect(subAccount.status).toBe(expected);
    });
  });

  describe('transferSubAccountAsset', () => {
    it('learns the master UID once and sends master UNIFIED to sub UNIFIED', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({ data: BYBIT_RAW_API_KEY_INFO_RESPONSE });
      mockInstance.post.mockResolvedValue({ data: BYBIT_RAW_UNIVERSAL_TRANSFER_RESPONSE });

      const result = await client.transferSubAccountAsset(MASTER_TO_SUB_ARGS);
      await client.transferSubAccountAsset(MASTER_TO_SUB_ARGS);

      expect(mockInstance.get).toHaveBeenCalledTimes(1);
      expect(mockInstance.get.mock.calls[0][0]).toBe('/v5/user/query-api');

      const [url, body, options] = mockInstance.post.mock.calls[0];
      expect(url).toBe('/v5/asset/transfer/universal-transfer');
      expect(body).toEqual({
        transferId: TRANSFER_ID,
        coin: 'USDT',
        amount: '0.5',
        fromMemberId: 24617703,
        toMemberId: 592334,
        fromAccountType: 'UNIFIED',
        toAccountType: 'UNIFIED',
      });
      expect(options.headers['X-BAPI-SIGN']).toEqual(expect.any(String));
      expect(result).toEqual({ transferId: TRANSFER_ID, exchangeTransferId: null });
    });

    it('swaps members for sub-to-master and maps the funding wallet to FUND', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({ data: BYBIT_RAW_API_KEY_INFO_RESPONSE });
      mockInstance.post.mockResolvedValue({ data: BYBIT_RAW_UNIVERSAL_TRANSFER_RESPONSE });

      await client.transferSubAccountAsset({
        ...MASTER_TO_SUB_ARGS,
        direction: SubAccountTransferDirectionEnum.SubToMaster,
        fromWalletType: WalletTypeEnum.UsdtFutures,
        toWalletType: WalletTypeEnum.Funding,
      });

      const body = mockInstance.post.mock.calls[0][1];
      expect(body.fromMemberId).toBe(592334);
      expect(body.toMemberId).toBe(24617703);
      expect(body.fromAccountType).toBe('UNIFIED');
      expect(body.toAccountType).toBe('FUND');
    });

    it('refuses a transfer id that is not a UUID before any request', async () => {
      const { client, mockInstance } = createClient();

      await expect(client.transferSubAccountAsset({ ...MASTER_TO_SUB_ARGS, transferId: 'order-42' }))
        .rejects.toMatchObject({ code: 'INVALID_TRANSFER_ID', exchange: 'bybit' });
      expect(mockInstance.get).not.toHaveBeenCalled();
      expect(mockInstance.post).not.toHaveBeenCalled();
    });

    it('refuses a sub-account id that is not a numeric UID', async () => {
      const { client, mockInstance } = createClient();

      await expect(client.transferSubAccountAsset({ ...MASTER_TO_SUB_ARGS, subAccountId: 'provider@test.com' }))
        .rejects.toMatchObject({ code: 'INVALID_SUB_ACCOUNT_ID' });
      expect(mockInstance.post).not.toHaveBeenCalled();
    });

    it('refuses to transfer with a sub-account key and asks again next time', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({
        data: { ...BYBIT_RAW_API_KEY_INFO_RESPONSE, result: { userID: 1, isMaster: false, parentUid: '24617703' } },
      });

      await expect(client.transferSubAccountAsset(MASTER_TO_SUB_ARGS)).rejects.toMatchObject({ code: 'NOT_MASTER_ACCOUNT_KEY' });
      await expect(client.transferSubAccountAsset(MASTER_TO_SUB_ARGS)).rejects.toMatchObject({ code: 'NOT_MASTER_ACCOUNT_KEY' });
      expect(mockInstance.get).toHaveBeenCalledTimes(2);
      expect(mockInstance.post).not.toHaveBeenCalled();
    });

    it('hands over a repeated transfer id (131214) as ExchangeError with that code', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({ data: BYBIT_RAW_API_KEY_INFO_RESPONSE });
      mockInstance.post.mockResolvedValue({ data: { retCode: 131214, retMsg: 'TransferId exist', result: {}, retExtInfo: {} } });

      const error = await client.transferSubAccountAsset(MASTER_TO_SUB_ARGS).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ExchangeError);
      expect(error).toMatchObject({ code: 131214, exchange: 'bybit' });
    });

    it('hands over an insufficient balance refusal (131228)', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({ data: BYBIT_RAW_API_KEY_INFO_RESPONSE });
      mockInstance.post.mockResolvedValue({
        data: { retCode: 131228, retMsg: 'your balance is not enough. Please check transfer safe amount', result: {}, retExtInfo: {} },
      });

      await expect(client.transferSubAccountAsset(MASTER_TO_SUB_ARGS)).rejects.toMatchObject({ code: 131228 });
    });
  });

  describe('fetchSubAccountTransfer', () => {
    it('finds a transfer whose id the exchange wrapped, and normalizes the documented record', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({ data: BYBIT_RAW_UNIVERSAL_TRANSFER_LIST_RESPONSE });

      const result = await client.fetchSubAccountTransfer({
        subAccountId: '592324',
        direction: SubAccountTransferDirectionEnum.MasterToSub,
        transferId: '4c3cfe2f-85cb-11ed-ac09-9e37823c81cd',
      });

      const [url, options] = mockInstance.get.mock.calls[0];
      expect(url).toBe('/v5/asset/transfer/query-universal-transfer-list');
      expect(options.params).toEqual({ transferId: '4c3cfe2f-85cb-11ed-ac09-9e37823c81cd' });
      expect(result).toEqual({
        transferId: '4c3cfe2f-85cb-11ed-ac09-9e37823c81cd',
        exchangeTransferId: 'universalTransfer_4c3cfe2f-85cb-11ed-ac09-9e37823c81cd_533285',
        asset: 'USDC',
        amount: 1000,
        fromAccountId: '533285',
        toAccountId: '592324',
        fromWalletType: WalletTypeEnum.Spot,
        toWalletType: WalletTypeEnum.Spot,
        rawFromWalletType: 'UNIFIED',
        rawToWalletType: 'UNIFIED',
        status: SubAccountTransferStatusEnum.Success,
        rawStatus: 'SUCCESS',
        timestamp: 1672134373000,
      });
    });

    it.each([
      ['PENDING', SubAccountTransferStatusEnum.Pending],
      ['FAILED', SubAccountTransferStatusEnum.Failed],
    ])('maps status %p', async (status, expected) => {
      const { client, mockInstance } = createClient();
      const record = { ...BYBIT_RAW_UNIVERSAL_TRANSFER_LIST_RESPONSE.result.list[0], transferId: TRANSFER_ID, status };
      mockInstance.get.mockResolvedValue({ data: { retCode: 0, retMsg: 'success', result: { list: [record] } } });

      const result = await client.fetchSubAccountTransfer({
        subAccountId: '592324',
        direction: SubAccountTransferDirectionEnum.MasterToSub,
        transferId: TRANSFER_ID,
      });

      expect(result?.status).toBe(expected);
      expect(result?.exchangeTransferId).toBeNull();
    });

    it('returns null when the list is empty', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({ data: { retCode: 0, retMsg: 'success', result: { list: [], nextPageCursor: '' } } });

      const result = await client.fetchSubAccountTransfer({
        subAccountId: '592324',
        direction: SubAccountTransferDirectionEnum.MasterToSub,
        transferId: TRANSFER_ID,
      });

      expect(result).toBeNull();
    });
  });

  describe('fetchSubAccountBalances', () => {
    it('reads all coins of the sub-account by memberId and account type', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({ data: BYBIT_RAW_ACCOUNT_COINS_BALANCE_RESPONSE });

      const result = await client.fetchSubAccountBalances({ subAccountId: '592334', walletType: WalletTypeEnum.Funding });

      const [url, options] = mockInstance.get.mock.calls[0];
      expect(url).toBe('/v5/asset/transfer/query-account-coins-balance');
      expect(options.params).toEqual({ memberId: '592334', accountType: 'FUND' });
      expect(result).toEqual([{ asset: 'USDC', walletBalance: 0, transferableBalance: 0 }]);
    });

    it.each([WalletTypeEnum.Spot, WalletTypeEnum.UsdtFutures])('reads the unified wallet for %p', async (walletType) => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({
        data: {
          retCode: 0,
          retMsg: 'success',
          result: { memberId: '592334', accountType: 'UNIFIED', balance: [{ coin: 'USDT', walletBalance: '120.5', transferBalance: '100' }] },
        },
      });

      const result = await client.fetchSubAccountBalances({ subAccountId: '592334', walletType });

      expect(mockInstance.get.mock.calls[0][1].params).toEqual({ memberId: '592334', accountType: 'UNIFIED', coin: 'USDT' });
      expect(result).toEqual([{ asset: 'USDT', walletBalance: 120.5, transferableBalance: 100 }]);
    });

    it('asks the unified wallet for the coins given (live 26.09.2026: without coins Bybit answers 131203), at most 10', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({ data: BYBIT_RAW_ACCOUNT_COINS_BALANCE_RESPONSE });

      await client.fetchSubAccountBalances({ subAccountId: '592334', walletType: WalletTypeEnum.UsdtFutures, assetList: ['usdt', 'USDC'] });
      expect(mockInstance.get.mock.calls[0][1].params.coin).toBe('USDT,USDC');

      await expect(client.fetchSubAccountBalances({ subAccountId: '592334', walletType: WalletTypeEnum.UsdtFutures, assetList: Array.from({ length: 11 }, (_, index) => `C${index}`) }))
        .rejects.toThrow('at most 10 coins');
    });
  });
});
