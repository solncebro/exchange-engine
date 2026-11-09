export interface BybitOrderExecutionRaw {
  execId: string;
  orderId: string;
  symbol: string;
  execQty: string;
  execPrice: string;
  execValue: string;
  execFee?: string;
  feeCurrency?: string;
  execTime: string;
  execType: string;
}
