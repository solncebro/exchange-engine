import type { BybitHttpClient } from '../../src/http/BybitHttpClient';
import type { LiveCheckContext } from './liveCheck.types';

export interface CheckSymbolHedgeLeverageArgs {
  context: LiveCheckContext;
  signal: AbortSignal;
  httpClient: BybitHttpClient;
  originalLeverage: number;
  violationList: string[];
}
