export interface BybitSubMemberRaw {
  uid: string;
  username: string;
  memberType: number;
  status: number;
  accountMode?: number;
  remark: string;
}

export interface BybitSubMemberListRaw {
  subMembers: BybitSubMemberRaw[];
}

export interface BybitApiKeyInfoRaw {
  userID: number;
  isMaster: boolean;
  parentUid?: string;
}

export interface BybitUniversalTransferResponseRaw {
  transferId: string;
}

export interface BybitUniversalTransferRecordRaw {
  transferId: string;
  coin: string;
  amount: string;
  timestamp: string;
  status: string;
  fromAccountType: string;
  toAccountType: string;
  fromMemberId: string;
  toMemberId: string;
}

export interface BybitUniversalTransferListRaw {
  list: BybitUniversalTransferRecordRaw[];
  nextPageCursor?: string;
}

export interface BybitAccountCoinBalanceRaw {
  coin: string;
  walletBalance: string;
  transferBalance: string;
  bonus?: string;
}

export interface BybitAccountCoinsBalanceRaw {
  memberId: string;
  accountType: string;
  balance: BybitAccountCoinBalanceRaw[];
}
