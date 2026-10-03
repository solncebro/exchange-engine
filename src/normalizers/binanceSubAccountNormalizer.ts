import type {
  SubAccount,
  SubAccountBalance,
  SubAccountTransfer,
  SubAccountTransferResult,
} from '../types/common';
import { SubAccountStatusEnum, SubAccountTransferStatusEnum, WalletTypeEnum } from '../types/common';
import {
  BINANCE_SUB_ACCOUNT_TRANSFER_STATUS,
  BINANCE_SUB_ACCOUNT_WALLET_TYPE_REVERSE,
} from '../constants/mappings';
import { parseAmountOrZero } from './normalizerUtils';
import type {
  BinanceFuturesInternalTransferRaw,
  BinanceSubAccountFuturesAccountRaw,
  BinanceSubAccountRaw,
  BinanceSubAccountSpotAssetRaw,
  BinanceSubAccountSpotAssetsRaw,
  BinanceUniversalTransferHistoryRaw,
  BinanceUniversalTransferRecordRaw,
  BinanceUniversalTransferResponseRaw,
} from './binanceSubAccountNormalizer.types';

export function normalizeBinanceSubAccountList(rawList: BinanceSubAccountRaw[]): SubAccount[] {
  return rawList.map((raw) => ({
    subAccountId: raw.email,
    name: raw.email,
    note: raw.remark === undefined || raw.remark === '' ? null : raw.remark,
    status: raw.isFreeze ? SubAccountStatusEnum.Frozen : SubAccountStatusEnum.Active,
    createdAt: raw.createTime,
  }));
}

export function normalizeBinanceUniversalTransferResponse(
  raw: BinanceUniversalTransferResponseRaw,
  requestedTransferId: string,
): SubAccountTransferResult {
  return {
    transferId: raw.clientTranId ?? requestedTransferId,
    exchangeTransferId: String(raw.tranId),
  };
}

/**
 * Действующая документация отдаёт историю объектом `{ result, totalCount }`; старая спецификация
 * того же входа (binance-api-swagger) — голым списком. Понимаются оба вида: ошибиться здесь значит
 * не найти свой перевод и счесть деньги не дошедшими.
 */
export function extractBinanceUniversalTransferRecordList(
  raw: BinanceUniversalTransferHistoryRaw | BinanceUniversalTransferRecordRaw[],
): BinanceUniversalTransferRecordRaw[] {
  if (Array.isArray(raw)) {
    return raw;
  }

  return raw.result ?? [];
}

export function normalizeBinanceUniversalTransferRecord(raw: BinanceUniversalTransferRecordRaw): SubAccountTransfer {
  return {
    transferId: raw.clientTranId ?? String(raw.tranId),
    exchangeTransferId: String(raw.tranId),
    asset: raw.asset,
    amount: parseFloat(raw.amount),
    fromAccountId: raw.fromEmail,
    toAccountId: raw.toEmail,
    fromWalletType: BINANCE_SUB_ACCOUNT_WALLET_TYPE_REVERSE[raw.fromAccountType] ?? null,
    toWalletType: BINANCE_SUB_ACCOUNT_WALLET_TYPE_REVERSE[raw.toAccountType] ?? null,
    rawFromWalletType: raw.fromAccountType,
    rawToWalletType: raw.toAccountType,
    status: BINANCE_SUB_ACCOUNT_TRANSFER_STATUS[raw.status] ?? SubAccountTransferStatusEnum.Pending,
    rawStatus: raw.status,
    timestamp: raw.createTimeStamp,
  };
}

/** A futures-to-futures transfer has no caller id on Binance: it is the one matched by the caller, keeps his id. */
export function normalizeBinanceFuturesInternalTransfer(raw: BinanceFuturesInternalTransferRaw, transferId: string): SubAccountTransfer {
  return {
    transferId,
    exchangeTransferId: String(raw.tranId),
    asset: raw.asset,
    amount: parseFloat(raw.qty),
    fromAccountId: raw.from,
    toAccountId: raw.to,
    fromWalletType: WalletTypeEnum.UsdtFutures,
    toWalletType: WalletTypeEnum.UsdtFutures,
    rawFromWalletType: 'USDT_FUTURE',
    rawToWalletType: 'USDT_FUTURE',
    // The history lists done transfers only.
    status: SubAccountTransferStatusEnum.Success,
    rawStatus: 'FUTURES_INTERNAL_TRANSFER',
    timestamp: raw.time,
  };
}

function normalizeBinanceSubAccountSpotAsset(raw: BinanceSubAccountSpotAssetRaw): SubAccountBalance {
  const free = parseAmountOrZero(raw.free);

  return {
    asset: raw.asset,
    walletBalance: free + parseAmountOrZero(raw.locked) + parseAmountOrZero(raw.freeze) + parseAmountOrZero(raw.withdrawing),
    transferableBalance: free,
  };
}

export function normalizeBinanceSubAccountSpotAssets(raw: BinanceSubAccountSpotAssetsRaw): SubAccountBalance[] {
  return raw.balances.map(normalizeBinanceSubAccountSpotAsset);
}

export function normalizeBinanceSubAccountFuturesAccount(raw: BinanceSubAccountFuturesAccountRaw): SubAccountBalance[] {
  const assetList = raw.futureAccountResp?.assets ?? [];

  return assetList.map((asset) => ({
    asset: asset.asset,
    walletBalance: parseAmountOrZero(asset.walletBalance),
    transferableBalance: parseAmountOrZero(asset.maxWithdrawAmount),
  }));
}
