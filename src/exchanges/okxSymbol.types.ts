export interface OkxInstrumentIdentity {
  symbol: string;
  instId: string;
  baseAsset: string;
  quoteAsset: string;
  isSwap: boolean;
}

export interface OkxSymbolMapArgs {
  isSwap: boolean;
}

export interface BuildOkxInstIdFallbackArgs {
  symbol: string;
  isSwap: boolean;
}
