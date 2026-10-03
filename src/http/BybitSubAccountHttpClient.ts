import {
  BYBIT_ACCOUNT_COINS_BALANCE_PATH,
  BYBIT_API_KEY_INFO_PATH,
  BYBIT_SUB_MEMBER_LIST_PATH,
  BYBIT_UNIVERSAL_TRANSFER_LIST_PATH,
  BYBIT_UNIVERSAL_TRANSFER_PATH,
} from '../constants/bybit';
import type {
  BybitAccountCoinsBalanceRaw,
  BybitApiKeyInfoRaw,
  BybitSubMemberListRaw,
  BybitUniversalTransferListRaw,
  BybitUniversalTransferResponseRaw,
} from '../normalizers/bybitSubAccountNormalizer.types';
import { BybitHttpClient } from './BybitHttpClient';
import type { BybitResponse } from './BybitHttpClient.types';
import type {
  BybitAccountCoinsBalanceParams,
  BybitUniversalTransferParams,
} from './BybitSubAccountHttpClient.types';

class BybitSubAccountHttpClient extends BybitHttpClient {
  async fetchSubMemberList(): Promise<BybitResponse<BybitSubMemberListRaw>> {
    return this.authenticatedGet(BYBIT_SUB_MEMBER_LIST_PATH, {});
  }

  async fetchApiKeyInfo(): Promise<BybitResponse<BybitApiKeyInfoRaw>> {
    return this.authenticatedGet(BYBIT_API_KEY_INFO_PATH, {});
  }

  async createUniversalTransfer(params: BybitUniversalTransferParams): Promise<BybitResponse<BybitUniversalTransferResponseRaw>> {
    return this.authenticatedPost(BYBIT_UNIVERSAL_TRANSFER_PATH, {
      transferId: params.transferId,
      coin: params.coin,
      amount: params.amount,
      fromMemberId: params.fromMemberId,
      toMemberId: params.toMemberId,
      fromAccountType: params.fromAccountType,
      toAccountType: params.toAccountType,
    });
  }

  async fetchUniversalTransferList(transferId: string): Promise<BybitResponse<BybitUniversalTransferListRaw>> {
    return this.authenticatedGet(BYBIT_UNIVERSAL_TRANSFER_LIST_PATH, { transferId });
  }

  async fetchAccountCoinsBalance(params: BybitAccountCoinsBalanceParams): Promise<BybitResponse<BybitAccountCoinsBalanceRaw>> {
    return this.authenticatedGet(BYBIT_ACCOUNT_COINS_BALANCE_PATH, {
      memberId: params.memberId,
      accountType: params.accountType,
      ...(params.coin === undefined ? {} : { coin: params.coin }),
    });
  }
}

export { BybitSubAccountHttpClient };
