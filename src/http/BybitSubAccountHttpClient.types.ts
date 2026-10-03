export interface BybitUniversalTransferParams {
  transferId: string;
  coin: string;
  amount: string;
  fromMemberId: number;
  toMemberId: number;
  fromAccountType: string;
  toAccountType: string;
}

export interface BybitAccountCoinsBalanceParams {
  memberId: string;
  accountType: string;
  /** Через запятую, не больше 10; у UNIFIED обязателен. */
  coin?: string;
}
