export interface BinanceSubAccountRaw {
  subUserId?: number;
  email: string;
  remark?: string;
  isFreeze: boolean;
  createTime: number;
  isManagedSubAccount?: boolean;
  isAssetManagementSubAccount?: boolean;
}

export interface BinanceSubAccountListRaw {
  subAccounts: BinanceSubAccountRaw[];
}

export interface BinanceUniversalTransferResponseRaw {
  tranId: number;
  clientTranId?: string;
}

export interface BinanceUniversalTransferRecordRaw {
  tranId: number;
  fromEmail: string;
  toEmail: string;
  asset: string;
  amount: string;
  createTimeStamp: number;
  fromAccountType: string;
  toAccountType: string;
  status: string;
  clientTranId?: string;
}

export interface BinanceUniversalTransferHistoryRaw {
  result?: BinanceUniversalTransferRecordRaw[];
  totalCount?: number;
}

export interface BinanceSubAccountSpotAssetRaw {
  asset: string;
  free: string;
  locked: string;
  freeze?: string;
  withdrawing?: string;
}

export interface BinanceSubAccountSpotAssetsRaw {
  balances: BinanceSubAccountSpotAssetRaw[];
}

export interface BinanceSubAccountFuturesAssetRaw {
  asset: string;
  initialMargin: string;
  maintenanceMargin: string;
  marginBalance: string;
  maxWithdrawAmount: string;
  openOrderInitialMargin: string;
  positionInitialMargin: string;
  unrealizedProfit: string;
  walletBalance: string;
}

export interface BinanceSubAccountFuturesAccountDetailRaw {
  email: string;
  assets: BinanceSubAccountFuturesAssetRaw[];
}

export interface BinanceSubAccountFuturesAccountRaw {
  futureAccountResp?: BinanceSubAccountFuturesAccountDetailRaw;
}

/** Живой ответ 26.09.2026: `{ success, futuresType, transfers: [{ from, to, asset, qty, time, tranId }] }`. */
export interface BinanceFuturesInternalTransferRaw {
  from: string;
  to: string;
  asset: string;
  qty: string;
  time: number;
  tranId: number;
}

export interface BinanceFuturesInternalTransferHistoryRaw {
  success?: boolean;
  futuresType?: number;
  transfers?: BinanceFuturesInternalTransferRaw[];
}
