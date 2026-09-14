import type { ExchangeLogger, FeeRate, OrderBookUpdateType } from '../types/common';
import type { OkxBillRaw } from './okxNormalizer';

/** Нога условной заявки OKX, на которой стоит её цена срабатывания. */
export type OkxAlgoTriggerLeg = 'trailing' | 'stopLoss' | 'takeProfit' | 'generic';

export interface NormalizeOkxOrderBookUpdateArgs {
  symbol: string;
  updateType: OrderBookUpdateType;
  receivedTimestamp: number;
  contractValue: string;
}

export interface ParseOkxOrderbookRawFrameArgs {
  raw: string;
  symbol: string;
  receivedTimestamp: number;
  contractValue: string;
}

export interface NormalizeOkxFeeRateArgs {
  symbol: string;
  groupId?: string;
  settle: string;
  isSwap: boolean;
}

/**
 * Ставка комиссии вместе с признаком, откуда она взята: `true` — из верхнеуровневых (устаревших)
 * полей ответа, а не из группы инструмента. Признак живёт в обёртке, чтобы не менять `FeeRate`.
 */
export interface OkxFeeRateOutcome {
  feeRate: FeeRate;
  isFromOutdatedField: boolean;
}

/**
 * Одна строка отчётного ответа (журнал начислений, история позиций), для которой нужен множитель
 * контракта. `logger` необязателен: без него строка по неизвестному инструменту просто
 * пропускается молча — предупредить некому.
 */
export interface TakeOkxRowContractValueArgs {
  contractValueBySymbol: Map<string, string>;
  symbol: string;
  instId: string;
  instType: string;
  index: number;
  methodName: string;
  logger?: ExchangeLogger;
}

/** Одна строка журнала начислений: множитель нужен только записям с количеством. */
export interface TakeOkxBillRowArgs {
  raw: OkxBillRaw;
  contractValueBySymbol: Map<string, string>;
  index: number;
  methodName: string;
  logger?: ExchangeLogger;
}
