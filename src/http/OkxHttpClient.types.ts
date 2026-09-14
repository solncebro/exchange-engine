import type { ExchangeLogger } from '../types/common';

export interface OkxHttpClientArgs {
  baseUrl: string;
  apiKey: string;
  secret: string;
  passphrase: string;
  isDemoMode: boolean;
  logger: ExchangeLogger;
  httpsAgent?: unknown;
}

export interface OkxApiResponse<T> {
  code: string;
  msg: string;
  data: T[];
}

export type OkxInstrumentType = 'SWAP' | 'SPOT';

export interface OkxTimeRangeArgs {
  after?: string;
  before?: string;
  limit?: number;
}

export interface FetchOkxCandlesArgs extends OkxTimeRangeArgs {
  instId: string;
  bar: string;
}

export interface FetchOkxFundingRateHistoryArgs extends OkxTimeRangeArgs {
  instId: string;
}

export interface FetchOkxPositionsArgs {
  instType?: OkxInstrumentType;
  instId?: string;
}

export interface FetchOkxPositionsHistoryArgs extends OkxTimeRangeArgs {
  instType?: OkxInstrumentType;
  instId?: string;
}

export interface FetchAllOkxPositionsHistoryArgs extends FetchOkxPositionsHistoryArgs {
  maxRecordCount: number;
}

export interface SetOkxLeverageArgs {
  instId: string;
  lever: string;
  mgnMode: 'cross' | 'isolated';
  posSide?: 'long' | 'short';
}

export interface FetchOkxTradeFeeArgs {
  instType: OkxInstrumentType;
  instId?: string;
  instFamily?: string;
}

export interface FetchOkxBillsArgs extends OkxTimeRangeArgs {
  instType?: OkxInstrumentType;
  instId?: string;
  type?: string;
  subType?: string;
  begin?: string;
  end?: string;
  isArchive: boolean;
}

export interface FetchOkxOrderArgs {
  instId: string;
  ordId?: string;
  clOrdId?: string;
}

export interface FetchOkxPendingOrdersArgs extends OkxTimeRangeArgs {
  instType: OkxInstrumentType;
  instId?: string;
}

export interface FetchOkxOrderHistoryArgs extends OkxTimeRangeArgs {
  instType: OkxInstrumentType;
  instId?: string;
  begin?: string;
  end?: string;
  isArchive: boolean;
}

export interface FetchAllOkxOrderHistoryArgs extends FetchOkxOrderHistoryArgs {
  maxRecordCount: number;
}

export interface CancelOkxOrderParams {
  instId: string;
  ordId?: string;
  clOrdId?: string;
}

export interface CancelOkxAlgoOrderParams {
  instId: string;
  algoId: string;
}

export interface FetchOkxAlgoOrderArgs {
  algoId?: string;
  algoClOrdId?: string;
}

export interface FetchOkxPendingAlgoOrdersArgs extends OkxTimeRangeArgs {
  ordType: string;
  instType?: OkxInstrumentType;
  instId?: string;
}

export interface FetchOkxAlgoOrderHistoryArgs extends OkxTimeRangeArgs {
  ordType: string;
  state?: string;
  algoId?: string;
  instType?: OkxInstrumentType;
  instId?: string;
}

export interface FetchAllOkxAlgoOrderHistoryArgs extends FetchOkxAlgoOrderHistoryArgs {
  maxRecordCount: number;
}

export interface FetchOkxAllPagesArgs<T> {
  label: string;
  pageLimit: number;
  maxRecordCount?: number;
  after?: string;
  fetchPage: (after?: string) => Promise<T[]>;
  resolveCursor: (entry: T) => string;
}

/** «Either quoteCcy or instId is required» — индекс адресуется одним из двух. */
export interface FetchOkxIndexTickersArgs {
  instId?: string;
  quoteCcy?: string;
}
