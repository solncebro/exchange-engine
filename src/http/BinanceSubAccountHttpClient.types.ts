export interface BinanceUniversalTransferParams {
  fromEmail?: string;
  toEmail?: string;
  fromAccountType: string;
  toAccountType: string;
  asset: string;
  amount: string;
  clientTranId: string;
}

export interface BinanceFuturesInternalTransferHistoryParams {
  email: string;
  startTime: number;
}

export interface BinanceUniversalTransferHistoryParams {
  fromEmail?: string;
  toEmail?: string;
  clientTranId: string;
}
