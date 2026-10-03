import axios from 'axios';
import { BinanceSubAccount } from '../../src/exchanges/BinanceSubAccount';
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
  BINANCE_RAW_SUB_ACCOUNT_LIST,
  BINANCE_RAW_SUB_ACCOUNT_SPOT_ASSETS,
  BINANCE_RAW_SUB_ACCOUNT_USDT_FUTURES_ACCOUNT,
  BINANCE_RAW_UNIVERSAL_TRANSFER_HISTORY,
  BINANCE_RAW_UNIVERSAL_TRANSFER_RESPONSE,
} from '../fixtures/binanceSubAccountRaw';

jest.mock('axios');

const mockedAxios = axios as jest.Mocked<typeof axios>;

function createClient() {
  const mockInstance = createMockAxiosInstance();
  mockedAxios.create.mockReturnValue(mockInstance as never);

  const client = new BinanceSubAccount({
    config: { apiKey: 'masterKey', secret: 'masterSecret' },
    logger: createMockLogger(),
  });

  return { client, mockInstance };
}

function createRefusal(status: number, code: number, message: string) {
  return { message: `Request failed with status code ${status}`, response: { status, data: { code, msg: message }, headers: {} } };
}

const MASTER_TO_SUB_ARGS = {
  subAccountId: 'provider1@test.com',
  direction: SubAccountTransferDirectionEnum.MasterToSub,
  asset: 'USDT',
  amount: 150.5,
  fromWalletType: WalletTypeEnum.Spot,
  toWalletType: WalletTypeEnum.UsdtFutures,
  transferId: 'be7a2462-1138-4e27-80b1-62653f24925e',
};

describe('BinanceSubAccount', () => {
  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(1700000000000);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('fetchSubAccountList', () => {
    it('reads the list with the master key, signed, and normalizes the documented example', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({ data: BINANCE_RAW_SUB_ACCOUNT_LIST });

      const result = await client.fetchSubAccountList();

      const [url, options] = mockInstance.get.mock.calls[0];
      expect(url).toBe('/sapi/v1/sub-account/list');
      expect(options.params).toMatchObject({ page: 1, limit: 200, timestamp: 1700000000000 });
      expect(options.params.signature).toEqual(expect.any(String));
      expect(options.headers['X-MBX-APIKEY']).toBe('masterKey');
      expect(result).toEqual([
        {
          subAccountId: 'testsub@gmail.com',
          name: 'testsub@gmail.com',
          note: 'remark',
          status: SubAccountStatusEnum.Active,
          createdAt: 1544433328000,
        },
      ]);
    });

    it('pages until a short page and marks frozen sub-accounts', async () => {
      const { client, mockInstance } = createClient();
      const fullPage = {
        subAccounts: Array.from({ length: 200 }, (_, index) => ({ email: `sub${index}@test.com`, isFreeze: false, createTime: 1 })),
      };
      const lastPage = { subAccounts: [{ email: 'frozen@test.com', isFreeze: true, createTime: 2 }] };
      mockInstance.get.mockResolvedValueOnce({ data: fullPage }).mockResolvedValueOnce({ data: lastPage });

      const result = await client.fetchSubAccountList();

      expect(mockInstance.get).toHaveBeenCalledTimes(2);
      expect(mockInstance.get.mock.calls[1][1].params.page).toBe(2);
      expect(result).toHaveLength(201);
      expect(result[200].status).toBe(SubAccountStatusEnum.Frozen);
      expect(result[200].note).toBeNull();
    });
  });

  describe('transferSubAccountAsset', () => {
    it('sends a master-to-sub universal transfer with the caller id as clientTranId', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.post.mockResolvedValue({ data: BINANCE_RAW_UNIVERSAL_TRANSFER_RESPONSE });

      const result = await client.transferSubAccountAsset(MASTER_TO_SUB_ARGS);

      const [url, body, options] = mockInstance.post.mock.calls[0];
      expect(url).toBe('/sapi/v1/sub-account/universalTransfer');
      expect(body).toBeNull();
      expect(options.params).toMatchObject({
        toEmail: 'provider1@test.com',
        fromAccountType: 'SPOT',
        toAccountType: 'USDT_FUTURE',
        asset: 'USDT',
        amount: '150.5',
        // Binance refuses the dashed UUID (-9000 Wrong clientTranId format, live 26.09.2026).
        clientTranId: 'be7a246211384e2780b162653f24925e',
      });
      expect(options.params.fromEmail).toBeUndefined();
      expect(options.params.signature).toEqual(expect.any(String));
      expect(result).toEqual({ transferId: 'test', exchangeTransferId: '11945860693' });
    });

    it('sends sub-to-master with fromEmail only', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.post.mockResolvedValue({ data: { tranId: 5 } });

      const result = await client.transferSubAccountAsset({
        ...MASTER_TO_SUB_ARGS,
        direction: SubAccountTransferDirectionEnum.SubToMaster,
        fromWalletType: WalletTypeEnum.UsdtFutures,
        toWalletType: WalletTypeEnum.Spot,
      });

      const { params } = mockInstance.post.mock.calls[0][2];
      expect(params.fromEmail).toBe('provider1@test.com');
      expect(params.toEmail).toBeUndefined();
      expect(params.fromAccountType).toBe('USDT_FUTURE');
      expect(params.toAccountType).toBe('SPOT');
      expect(result).toEqual({ transferId: MASTER_TO_SUB_ARGS.transferId, exchangeTransferId: '5' });
    });

    it('writes a tiny amount in decimal, never in exponent form', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.post.mockResolvedValue({ data: BINANCE_RAW_UNIVERSAL_TRANSFER_RESPONSE });

      await client.transferSubAccountAsset({ ...MASTER_TO_SUB_ARGS, amount: 0.0000001 });

      expect(mockInstance.post.mock.calls[0][2].params.amount).toBe('0.0000001');
    });

    it('refuses the funding wallet before any request', async () => {
      const { client, mockInstance } = createClient();

      await expect(client.transferSubAccountAsset({ ...MASTER_TO_SUB_ARGS, toWalletType: WalletTypeEnum.Funding }))
        .rejects.toMatchObject({ code: 'WALLET_TYPE_NOT_SUPPORTED', exchange: 'binance' });
      expect(mockInstance.post).not.toHaveBeenCalled();
    });

    it.each([0, -1, Number.NaN])('refuses amount %p before any request', async (amount) => {
      const { client, mockInstance } = createClient();

      await expect(client.transferSubAccountAsset({ ...MASTER_TO_SUB_ARGS, amount })).rejects.toMatchObject({ code: 'INVALID_TRANSFER_AMOUNT' });
      expect(mockInstance.post).not.toHaveBeenCalled();
    });

    it('refuses an empty transfer id', async () => {
      const { client } = createClient();

      await expect(client.transferSubAccountAsset({ ...MASTER_TO_SUB_ARGS, transferId: ' ' })).rejects.toMatchObject({ code: 'INVALID_TRANSFER_ID' });
    });

    it('hands over an exchange refusal as ExchangeError with the exchange code', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.post.mockRejectedValue(createRefusal(400, -1102, 'Mandatory parameter was not sent.'));

      const error = await client.transferSubAccountAsset(MASTER_TO_SUB_ARGS).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ExchangeError);
      expect(error).toMatchObject({ code: -1102, exchange: 'binance' });
      expect(mockInstance.post).toHaveBeenCalledTimes(1);
    });
  });

  describe('fetchSubAccountTransfer', () => {
    // The live shape of 26.09.2026 (master e-mail and sub e-mail replaced).
    const FUTURES_HISTORY = {
      success: true,
      futuresType: 1,
      transfers: [
        { from: 'deftest@gmail.com', to: 'master@test.com', asset: 'USDT', qty: '2.00000000', time: 1790425761000, tranId: 415144652741 },
        { from: 'master@test.com', to: 'deftest@gmail.com', asset: 'USDT', qty: '2.00000000', time: 1790425757000, tranId: 415136740031 },
      ],
    };

    it('a futures-to-futures transfer (no caller id at Binance) is found by direction, amount and time', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValueOnce({ data: { result: [], totalCount: 0 } }).mockResolvedValueOnce({ data: FUTURES_HISTORY });

      const result = await client.fetchSubAccountTransfer({
        subAccountId: 'deftest@gmail.com',
        direction: SubAccountTransferDirectionEnum.MasterToSub,
        transferId: 'be7a2462-1138-4e27-80b1-62653f24925e',
        amount: 2,
        sinceMs: 1790425750000,
      });

      expect(mockInstance.get.mock.calls[1][0]).toBe('/sapi/v1/sub-account/futures/internalTransfer');
      expect(mockInstance.get.mock.calls[1][1].params).toMatchObject({ email: 'deftest@gmail.com', futuresType: 1, startTime: 1790425690000 });
      expect(result).toMatchObject({ transferId: 'be7a2462-1138-4e27-80b1-62653f24925e', exchangeTransferId: '415136740031', amount: 2, status: SubAccountTransferStatusEnum.Success });
    });

    it('two equal transfers in the window cannot be told apart; none — not there', async () => {
      const { client, mockInstance } = createClient();
      const twice = { ...FUTURES_HISTORY, transfers: [FUTURES_HISTORY.transfers[1], { ...FUTURES_HISTORY.transfers[1], tranId: 1 }] };

      mockInstance.get.mockResolvedValueOnce({ data: { result: [], totalCount: 0 } }).mockResolvedValueOnce({ data: twice });
      await expect(client.fetchSubAccountTransfer({ subAccountId: 'deftest@gmail.com', direction: SubAccountTransferDirectionEnum.MasterToSub, transferId: 'x', amount: 2, sinceMs: 1790425750000 }))
        .rejects.toThrow('cannot tell which is ours');

      mockInstance.get.mockResolvedValueOnce({ data: { result: [], totalCount: 0 } }).mockResolvedValueOnce({ data: FUTURES_HISTORY });
      expect(await client.fetchSubAccountTransfer({ subAccountId: 'deftest@gmail.com', direction: SubAccountTransferDirectionEnum.SubToMaster, transferId: 'x', amount: 3, sinceMs: 1790425750000 })).toBeNull();
    });

    it('looks a UUID transfer up by the same id without dashes', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({ data: { result: [{ ...BINANCE_RAW_UNIVERSAL_TRANSFER_HISTORY.result?.[0], clientTranId: 'be7a246211384e2780b162653f24925e' }], totalCount: 1 } });

      const result = await client.fetchSubAccountTransfer({
        subAccountId: 'deftest@gmail.com',
        direction: SubAccountTransferDirectionEnum.MasterToSub,
        transferId: 'be7a2462-1138-4e27-80b1-62653f24925e',
      });

      expect(mockInstance.get.mock.calls[0][1].params.clientTranId).toBe('be7a246211384e2780b162653f24925e');
      expect(result).not.toBeNull();
    });

    it('looks up a master-to-sub transfer by clientTranId and toEmail', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({ data: BINANCE_RAW_UNIVERSAL_TRANSFER_HISTORY });

      const result = await client.fetchSubAccountTransfer({
        subAccountId: 'deftest@gmail.com',
        direction: SubAccountTransferDirectionEnum.MasterToSub,
        transferId: 'test',
      });

      const [url, options] = mockInstance.get.mock.calls[0];
      expect(url).toBe('/sapi/v1/sub-account/universalTransfer');
      expect(options.params).toMatchObject({ toEmail: 'deftest@gmail.com', clientTranId: 'test' });
      expect(options.params.fromEmail).toBeUndefined();
      expect(result).toEqual({
        transferId: 'test',
        exchangeTransferId: '92275823339',
        asset: 'BNB',
        amount: 0.01,
        fromAccountId: 'abctest@gmail.com',
        toAccountId: 'deftest@gmail.com',
        fromWalletType: WalletTypeEnum.UsdtFutures,
        toWalletType: WalletTypeEnum.Spot,
        rawFromWalletType: 'USDT_FUTURE',
        rawToWalletType: 'SPOT',
        status: SubAccountTransferStatusEnum.Success,
        rawStatus: 'SUCCESS',
        timestamp: 1640317374000,
      });
    });

    it('looks up a sub-to-master transfer by fromEmail', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({ data: BINANCE_RAW_UNIVERSAL_TRANSFER_HISTORY });

      await client.fetchSubAccountTransfer({
        subAccountId: 'abctest@gmail.com',
        direction: SubAccountTransferDirectionEnum.SubToMaster,
        transferId: 'test',
      });

      const { params } = mockInstance.get.mock.calls[0][1];
      expect(params.fromEmail).toBe('abctest@gmail.com');
      expect(params.toEmail).toBeUndefined();
    });

    it('understands the older plain-list answer too', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({ data: BINANCE_RAW_UNIVERSAL_TRANSFER_HISTORY.result });

      const result = await client.fetchSubAccountTransfer({
        subAccountId: 'deftest@gmail.com',
        direction: SubAccountTransferDirectionEnum.MasterToSub,
        transferId: 'test',
      });

      expect(result?.exchangeTransferId).toBe('92275823339');
    });

    it('returns null when the exchange does not know the transfer', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({ data: { result: [], totalCount: 0 } });

      const result = await client.fetchSubAccountTransfer({
        subAccountId: 'deftest@gmail.com',
        direction: SubAccountTransferDirectionEnum.MasterToSub,
        transferId: 'missing',
      });

      expect(result).toBeNull();
    });

    it('reads an unknown status as still pending, never as success', async () => {
      const { client, mockInstance } = createClient();
      const record = { ...BINANCE_RAW_UNIVERSAL_TRANSFER_HISTORY.result![0], status: 'SOMETHING_NEW' };
      mockInstance.get.mockResolvedValue({ data: { result: [record], totalCount: 1 } });

      const result = await client.fetchSubAccountTransfer({
        subAccountId: 'deftest@gmail.com',
        direction: SubAccountTransferDirectionEnum.MasterToSub,
        transferId: 'test',
      });

      expect(result?.status).toBe(SubAccountTransferStatusEnum.Pending);
      expect(result?.rawStatus).toBe('SOMETHING_NEW');
    });
  });

  describe('fetchSubAccountBalances', () => {
    it('reads the spot wallet from the sub-account assets endpoint', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({ data: BINANCE_RAW_SUB_ACCOUNT_SPOT_ASSETS });

      const result = await client.fetchSubAccountBalances({ subAccountId: '123@test.com', walletType: WalletTypeEnum.Spot });

      const [url, options] = mockInstance.get.mock.calls[0];
      expect(url).toBe('/sapi/v4/sub-account/assets');
      expect(options.params.email).toBe('123@test.com');
      expect(result).toEqual([{ asset: 'ADA', walletBalance: 10000, transferableBalance: 10000 }]);
    });

    it('counts locked, frozen and withdrawing coins into the wallet but not into the transferable part', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({
        data: { balances: [{ asset: 'USDT', free: '10', locked: '2', freeze: '3', withdrawing: '4' }] },
      });

      const result = await client.fetchSubAccountBalances({ subAccountId: '123@test.com', walletType: WalletTypeEnum.Spot });

      expect(result).toEqual([{ asset: 'USDT', walletBalance: 19, transferableBalance: 10 }]);
    });

    it('reads the USDT futures wallet with futuresType 1', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({ data: BINANCE_RAW_SUB_ACCOUNT_USDT_FUTURES_ACCOUNT });

      const result = await client.fetchSubAccountBalances({ subAccountId: 'abc@test.com', walletType: WalletTypeEnum.UsdtFutures });

      const [url, options] = mockInstance.get.mock.calls[0];
      expect(url).toBe('/sapi/v2/sub-account/futures/account');
      expect(options.params).toMatchObject({ email: 'abc@test.com', futuresType: 1 });
      expect(result).toEqual([{ asset: 'USDT', walletBalance: 0.88308, transferableBalance: 0.88308 }]);
    });

    it('refuses the funding wallet', async () => {
      const { client, mockInstance } = createClient();

      await expect(client.fetchSubAccountBalances({ subAccountId: 'abc@test.com', walletType: WalletTypeEnum.Funding }))
        .rejects.toMatchObject({ code: 'WALLET_TYPE_NOT_SUPPORTED' });
      expect(mockInstance.get).not.toHaveBeenCalled();
    });
  });
});
