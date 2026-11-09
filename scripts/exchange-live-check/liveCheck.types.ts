import type { Exchange } from '../../src/exchanges/Exchange';
import type { BinanceFuturesHttpClient } from '../../src/http/BinanceFuturesHttpClient';
import type { BybitHttpClient } from '../../src/http/BybitHttpClient';
import type { ExchangeLogger, ExchangeNameEnum, Ticker, TickerBySymbol, TradeSymbolBySymbol } from '../../src/types/common';
import type { ExchangeClient } from '../../src/types/exchange';
import type { OwnPositionLedger } from '../live-support/liveOrder';
import type { LiveRunStatus } from '../live-support/liveOutput.types';

export interface LiveCheckOutcome {
  status: LiveRunStatus;
  fact: string;
}

export interface LiveCheckSettings {
  futuresSymbol: string;
  spotSymbol: string;
  executionSymbol: string;
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
  readTradeSymbols: (client: ExchangeClient) => Promise<TradeSymbolBySymbol>;
  createStreamExchange: () => Exchange;
  bybitDemoHttpClient: BybitHttpClient | null;
  binanceDemoHttpClient: BinanceFuturesHttpClient | null;
  ownPositionLedger: OwnPositionLedger;
}

export interface LiveCheck {
  title: string;
  timeoutMs: number;
  isCredentialsRequired: boolean;
  isOrdersRequired: boolean;
  run: (context: LiveCheckContext, signal: AbortSignal) => Promise<LiveCheckOutcome>;
}

export interface NumberedLiveCheck {
  check: LiveCheck;
  checkNumber: number;
}

export interface LiveCheckReportEntry {
  title: string;
  outcome: LiveCheckOutcome;
}

export interface ExchangeCheckReport {
  exchangeName: ExchangeNameEnum;
  entryList: LiveCheckReportEntry[];
}

export type TickerVerdictKind = 'verified' | 'exchangeData' | 'violation';

export interface TickerVerdict {
  kind: TickerVerdictKind;
  text: string;
}

export interface CheckTickerMapArgs {
  tickerBySymbol: TickerBySymbol;
  tradeSymbolBySymbol: TradeSymbolBySymbol;
  client: ExchangeClient;
  symbol: string;
  marketLabel: string;
}

export interface VerifyStaleTimestampArgs {
  client: ExchangeClient;
  symbol: string;
  ticker: Ticker;
  oldestAllowedMs: number;
  newestAllowedMs: number;
}
