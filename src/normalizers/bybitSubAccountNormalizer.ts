import type { SubAccount, SubAccountBalance, SubAccountTransfer } from '../types/common';
import { SubAccountStatusEnum, SubAccountTransferStatusEnum } from '../types/common';
import {
  BYBIT_SUB_ACCOUNT_TRANSFER_STATUS,
  BYBIT_SUB_ACCOUNT_WALLET_TYPE_REVERSE,
  BYBIT_SUB_MEMBER_STATUS,
} from '../constants/mappings';
import { parseAmountOrZero } from './normalizerUtils';
import type {
  BybitAccountCoinsBalanceRaw,
  BybitSubMemberRaw,
  BybitUniversalTransferRecordRaw,
} from './bybitSubAccountNormalizer.types';

export function normalizeBybitSubMemberList(rawList: BybitSubMemberRaw[]): SubAccount[] {
  return rawList.map((raw) => ({
    subAccountId: raw.uid,
    name: raw.username,
    note: raw.remark === '' ? null : raw.remark,
    status: BYBIT_SUB_MEMBER_STATUS[raw.status] ?? SubAccountStatusEnum.Unknown,
    createdAt: null,
  }));
}

export function normalizeBybitUniversalTransferRecord(
  raw: BybitUniversalTransferRecordRaw,
  requestedTransferId: string,
): SubAccountTransfer {
  return {
    transferId: requestedTransferId,
    exchangeTransferId: raw.transferId === requestedTransferId ? null : raw.transferId,
    asset: raw.coin,
    amount: parseFloat(raw.amount),
    fromAccountId: raw.fromMemberId,
    toAccountId: raw.toMemberId,
    fromWalletType: BYBIT_SUB_ACCOUNT_WALLET_TYPE_REVERSE[raw.fromAccountType] ?? null,
    toWalletType: BYBIT_SUB_ACCOUNT_WALLET_TYPE_REVERSE[raw.toAccountType] ?? null,
    rawFromWalletType: raw.fromAccountType,
    rawToWalletType: raw.toAccountType,
    status: BYBIT_SUB_ACCOUNT_TRANSFER_STATUS[raw.status] ?? SubAccountTransferStatusEnum.Pending,
    rawStatus: raw.status,
    timestamp: Number(raw.timestamp),
  };
}

export function normalizeBybitAccountCoinsBalance(raw: BybitAccountCoinsBalanceRaw): SubAccountBalance[] {
  return raw.balance.map((balance) => ({
    asset: balance.coin,
    walletBalance: parseAmountOrZero(balance.walletBalance),
    transferableBalance: parseAmountOrZero(balance.transferBalance),
  }));
}
