import type { CreateOrderWebSocketArgs, ExchangeArgs } from '../types/exchange';
import type { Order } from '../types/common';
import type { OkxAlgoOrderRaw } from '../normalizers/okxNormalizer';
import type { OkxAlgoTriggerLeg } from '../normalizers/okxNormalizer.types';
import type { OkxInstrumentType } from '../http/OkxHttpClient.types';
import type { ConditionalOrderKind } from './ConditionalOrderRegistry';

export interface OkxBaseClientArgs {
  exchangeArgs: ExchangeArgs;
  instType: OkxInstrumentType;
  publicStreamLabel: string;
  tradeStreamLabel: string;
  privateStreamLabel: string;
  algoPrivateStreamLabel: string;
}

/** Заявка вместе со службой, которой она принадлежит: обычной книгой или условной. */
export interface OkxOwnedOrder {
  order: Order;
  kind: ConditionalOrderKind;
}

/**
 * Отказ по одному номеру заявки сразу в обеих службах OKX — обычной книге и условной.
 * `action` — что именно делали («reading», «cancelling», «amending») для записи в журнал;
 * `missingOrderError` — что отдать наружу, когда обе службы ответили «такой заявки нет».
 */
export interface OkxTwoServiceFailure {
  symbol: string;
  orderId: string;
  action: string;
  errorList: unknown[];
  missingOrderError: unknown;
}

/** Условная заявка, которую правим, вместе с выбранной ногой. */
export interface OkxAlgoAmendTarget {
  leg: OkxAlgoTriggerLeg;
  raw: OkxAlgoOrderRaw;
}

/** Собранная заявка пачки вместе с её местом во входном списке. */
export interface OkxPlannedOrder {
  index: number;
  params: Record<string, unknown>;
  amount: number;
}

/** Кусок пачки заявок: аргументы, тело запроса и фактически отправленный размер — по местам. */
export interface OkxOrderChunk {
  argsList: CreateOrderWebSocketArgs[];
  paramsList: Array<Record<string, unknown>>;
  amountList: number[];
}

/** Отказ биржи по одному виду условных заявок при обходе всех видов. */
export interface OkxAlgoSweepFailure {
  ordType: string;
  reason: string;
}

/**
 * Итог обхода всех видов условных заявок: что прочитано и по каким видам биржа отказала.
 * Отказы возвращаются, а не бросаются, чтобы обход дошёл до конца, — решает вызывающий.
 */
export interface OkxAlgoSweep {
  rawList: OkxAlgoOrderRaw[];
  failureList: OkxAlgoSweepFailure[];
}

/** Инструмент, разобранный из обозначения биржи: общее имя и множитель контракта. */
export interface OkxResolvedInstrument {
  symbol: string;
  contractValue: string;
}
