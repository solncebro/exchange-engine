import type { Exchange } from '../../src/exchanges/Exchange';
import type { ExchangeLogger, ExchangeNameEnum, TickerBySymbol, TradeSymbolBySymbol } from '../../src/types/common';
import type { LiveRunStatus } from '../live-support/liveOutput.types';

export interface LiveCheckOutcome {
  status: LiveRunStatus;
  fact: string;
}

export interface LiveCheckSettings {
  futuresSymbol: string;
  spotSymbol: string;
  orderBookDepth: number;
  isOrderAllowed: boolean;
  clientOrderIdPrefix: string;
}

export interface LiveCheckContext {
  exchangeName: ExchangeNameEnum;
  exchange: Exchange;
  settings: LiveCheckSettings;
  logger: ExchangeLogger;
  showEvidence: (label: string, payload: unknown) => void;
  buildClientOrderId: () => string;
  readFuturesTickers: () => Promise<TickerBySymbol>;
  createStreamExchange: () => Exchange;
}

export interface LiveCheck {
  title: string;
  timeoutMs: number;
  isCredentialsRequired: boolean;
  isOrdersRequired: boolean;
  run: (context: LiveCheckContext) => Promise<LiveCheckOutcome>;
}

export interface LiveCheckReportEntry {
  title: string;
  outcome: LiveCheckOutcome;
}

export interface ExchangeCheckReport {
  exchangeName: ExchangeNameEnum;
  entryList: LiveCheckReportEntry[];
}

export type PercentVerdictKind = 'verified' | 'exchangeData' | 'violation';

export interface PercentVerdict {
  kind: PercentVerdictKind;
  text: string;
}

export interface CheckTickerMapArgs {
  tickerBySymbol: TickerBySymbol;
  tradeSymbolBySymbol: TradeSymbolBySymbol;
  symbol: string;
  marketLabel: string;
}
