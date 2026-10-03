import type {
  ExchangeArgs,
  FetchSubAccountBalancesArgs,
  FetchSubAccountTransferArgs,
  SubAccountClient,
  SubAccountTransferArgs,
} from '../types/exchange';
import type {
  ExchangeLogger,
  SubAccount,
  SubAccountBalance,
  SubAccountTransfer,
  SubAccountTransferResult,
} from '../types/common';
import { SubAccountTransferDirectionEnum } from '../types/common';
import { BYBIT_BASE_URL } from '../constants/bybit';
import { BYBIT_SUB_ACCOUNT_WALLET_TYPE } from '../constants/mappings';
import { ExchangeError } from '../errors/ExchangeError';
import { BybitSubAccountHttpClient } from '../http/BybitSubAccountHttpClient';
import {
  normalizeBybitAccountCoinsBalance,
  normalizeBybitSubMemberList,
  normalizeBybitUniversalTransferRecord,
} from '../normalizers/bybitSubAccountNormalizer';
import { toDecimalNumberString } from '../utils/decimalString';
import { assertSubAccountTransferArgs, assertUuidTransferId } from './subAccountTransferValidation';

// Живой ответ Bybit 26.09.2026: у единого счёта запрос баланса без монет — ошибка 131203, монет не больше 10.
const BYBIT_UNIFIED_ACCOUNT_TYPE = 'UNIFIED';
const BYBIT_UNIFIED_DEFAULT_ASSET_LIST = ['USDT'];
const BYBIT_COINS_BALANCE_MAX_ASSET_COUNT = 10;

/**
 * Подсчёты Bybit ключом главного счёта. Ключу нужно право «Subaccount Transfer» (в ответе
 * сведений о ключе — `SubMemberTransfer`). Перевод на бирже требует ОБА номера пользователя,
 * поэтому номер главного счёта узнаётся один раз из сведений о самом ключе.
 */
class BybitSubAccount implements SubAccountClient {
  private readonly httpClient: BybitSubAccountHttpClient;
  private readonly logger: ExchangeLogger;
  private masterMemberIdPromise: Promise<number> | null = null;

  constructor(args: ExchangeArgs) {
    this.logger = args.logger;
    this.httpClient = new BybitSubAccountHttpClient({
      baseUrl: BYBIT_BASE_URL,
      apiKey: args.config.apiKey,
      secret: args.config.secret,
      logger: args.logger,
      httpsAgent: args.config.httpsAgent,
    });
  }

  async fetchSubAccountList(): Promise<SubAccount[]> {
    const response = await this.httpClient.fetchSubMemberList();

    return normalizeBybitSubMemberList(response.result.subMembers);
  }

  async transferSubAccountAsset(args: SubAccountTransferArgs): Promise<SubAccountTransferResult> {
    assertSubAccountTransferArgs(args, 'bybit');
    assertUuidTransferId(args.transferId, 'bybit');
    const subMemberId = this.parseMemberId(args.subAccountId);
    const masterMemberId = await this.fetchMasterMemberId();
    const isMasterToSub = args.direction === SubAccountTransferDirectionEnum.MasterToSub;

    this.logger.info(
      { transferId: args.transferId, direction: args.direction, asset: args.asset, amount: args.amount },
      `[Bybit] Sub-account transfer ${args.direction} ${args.subAccountId}`,
    );

    const response = await this.httpClient.createUniversalTransfer({
      transferId: args.transferId,
      coin: args.asset,
      amount: toDecimalNumberString(args.amount),
      fromMemberId: isMasterToSub ? masterMemberId : subMemberId,
      toMemberId: isMasterToSub ? subMemberId : masterMemberId,
      fromAccountType: BYBIT_SUB_ACCOUNT_WALLET_TYPE[args.fromWalletType],
      toAccountType: BYBIT_SUB_ACCOUNT_WALLET_TYPE[args.toWalletType],
    });

    return {
      transferId: response.result.transferId,
      exchangeTransferId: null,
    };
  }

  async fetchSubAccountTransfer(args: FetchSubAccountTransferArgs): Promise<SubAccountTransfer | null> {
    const response = await this.httpClient.fetchUniversalTransferList(args.transferId);
    const recordList = response.result.list;

    // Пример из документации отдаёт номер в оправе («universalTransfer_<uuid>_<uid>»), поэтому
    // совпадение ищется и точное, и по вхождению.
    const record = recordList.find((item) => item.transferId === args.transferId)
      ?? recordList.find((item) => item.transferId.includes(args.transferId));

    return record === undefined ? null : normalizeBybitUniversalTransferRecord(record, args.transferId);
  }

  async fetchSubAccountBalances(args: FetchSubAccountBalancesArgs): Promise<SubAccountBalance[]> {
    const accountType = BYBIT_SUB_ACCOUNT_WALLET_TYPE[args.walletType];
    const assetList = args.assetList ?? (accountType === BYBIT_UNIFIED_ACCOUNT_TYPE ? BYBIT_UNIFIED_DEFAULT_ASSET_LIST : []);

    if (assetList.length > BYBIT_COINS_BALANCE_MAX_ASSET_COUNT) {
      throw new ExchangeError(`Bybit reads at most ${BYBIT_COINS_BALANCE_MAX_ASSET_COUNT} coins per request, got ${assetList.length}`, 'INVALID_ASSET_LIST', 'bybit');
    }

    const response = await this.httpClient.fetchAccountCoinsBalance({
      memberId: args.subAccountId,
      accountType,
      ...(assetList.length === 0 ? {} : { coin: assetList.map(asset => asset.toUpperCase()).join(',') }),
    });

    return normalizeBybitAccountCoinsBalance(response.result);
  }

  private parseMemberId(subAccountId: string): number {
    const memberId = Number(subAccountId);

    if (!Number.isSafeInteger(memberId) || memberId <= 0) {
      throw new ExchangeError(`Bybit sub-account id must be a numeric UID, got "${subAccountId}"`, 'INVALID_SUB_ACCOUNT_ID', 'bybit');
    }

    return memberId;
  }

  private fetchMasterMemberId(): Promise<number> {
    if (this.masterMemberIdPromise === null) {
      this.masterMemberIdPromise = this.requestMasterMemberId().catch((error: unknown) => {
        this.masterMemberIdPromise = null;

        throw error;
      });
    }

    return this.masterMemberIdPromise;
  }

  private async requestMasterMemberId(): Promise<number> {
    const response = await this.httpClient.fetchApiKeyInfo();

    if (!response.result.isMaster) {
      throw new ExchangeError(
        'Bybit sub-account operations need the MASTER account API key; this key belongs to a sub-account',
        'NOT_MASTER_ACCOUNT_KEY',
        'bybit',
      );
    }

    return response.result.userID;
  }
}

export { BybitSubAccount };
