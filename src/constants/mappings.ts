import { PositionSideEnum, OrderSideEnum, OrderTypeEnum, TimeInForceEnum, WorkingTypeEnum, TriggerByEnum } from '../types/common';
import type { IncomeKind } from '../types/common';
import type { IncomeTypeFilter } from '../types/exchange';

export const BINANCE_POSITION_SIDE: Record<string, PositionSideEnum> = {
  LONG: PositionSideEnum.Long,
  SHORT: PositionSideEnum.Short,
  BOTH: PositionSideEnum.Both,
};

/**
 * Номер стороны позиции в нумерации Bybit: 0 — односторонний режим, 1 — лонг, 2 — шорт.
 * Binance называет то же самое словами, но наружу обе биржи обязаны отдавать одно число.
 */
export const BINANCE_POSITION_IDX: Record<string, number> = {
  BOTH: 0,
  LONG: 1,
  SHORT: 2,
};

export const BYBIT_POSITION_SIDE: Record<string, PositionSideEnum> = {
  Buy: PositionSideEnum.Long,
  Sell: PositionSideEnum.Short,
};

export const BYBIT_ORDER_STATUS: Record<string, string> = {
  New: 'open',
  PartiallyFilled: 'open',
  Untriggered: 'open',
  Triggered: 'open',
  Filled: 'closed',
  Cancelled: 'canceled',
  PartiallyFilledCanceled: 'canceled',
  Rejected: 'rejected',
  Deactivated: 'canceled',
};

export const BINANCE_ORDER_STATUS: Record<string, string> = {
  NEW: 'open',
  PARTIALLY_FILLED: 'open',
  FILLED: 'closed',
  CANCELED: 'canceled',
  REJECTED: 'rejected',
  EXPIRED: 'canceled',
  EXPIRED_IN_MATCH: 'canceled',
};

/**
 * Состояния условной заявки Algo-службы Binance USDⓈ-M, сведённые к общему словарю.
 *
 * TRIGGERING и TRIGGERED — НЕ терминальны: триггер сработал, но заявка ещё исполняется
 * в стакане, и из TRIGGERING она может уйти в REJECTED (маржа проверяется только в момент
 * срабатывания). Пометить их закрытыми — значит завершить сделку раньше времени.
 *
 * FINISHED означает «исполнена ИЛИ отменена в стакане», а не «исполнена»: фактический
 * объём смотреть отдельно.
 *
 * REJECTED — стоп не встал в момент срабатывания, позиция осталась без защиты.
 */
export const BINANCE_ALGO_STATUS: Record<string, string> = {
  NEW: 'open',
  TRIGGERING: 'open',
  TRIGGERED: 'open',
  FINISHED: 'closed',
  CANCELED: 'canceled',
  EXPIRED: 'canceled',
  REJECTED: 'rejected',
};

export const BINANCE_ORDER_SIDE: Record<string, OrderSideEnum> = {
  BUY: OrderSideEnum.Buy,
  SELL: OrderSideEnum.Sell,
};

export const BINANCE_ORDER_SIDE_REVERSE: Record<OrderSideEnum, string> = {
  [OrderSideEnum.Buy]: 'BUY',
  [OrderSideEnum.Sell]: 'SELL',
};

export const BINANCE_ORDER_TYPE: Record<string, OrderTypeEnum> = {
  MARKET: OrderTypeEnum.Market,
  LIMIT: OrderTypeEnum.Limit,
  STOP_MARKET: OrderTypeEnum.StopMarket,
  TAKE_PROFIT_MARKET: OrderTypeEnum.TakeProfitMarket,
  STOP: OrderTypeEnum.StopLimit,
  TAKE_PROFIT: OrderTypeEnum.TakeProfit,
  STOP_LOSS: OrderTypeEnum.StopMarket,
  STOP_LOSS_LIMIT: OrderTypeEnum.StopLimit,
  TAKE_PROFIT_LIMIT: OrderTypeEnum.TakeProfitLimit,
  TRAILING_STOP_MARKET: OrderTypeEnum.TrailingStop,
};

/**
 * Обычные заявки фьючерсов Binance. Условных типов здесь НЕТ намеренно: с 09.12.2025 они
 * живут в отдельной службе (см. BINANCE_ALGO_ORDER_TYPE_REVERSE), а старый вход отбивает их
 * кодом -4120. Отсутствие строк — структурная гарантия, что собрать такой запрос нельзя.
 */
export const BINANCE_FUTURES_ORDER_TYPE_REVERSE: Record<string, string> = {
  [OrderTypeEnum.Market]: 'MARKET',
  [OrderTypeEnum.Limit]: 'LIMIT',
};

/**
 * Условные типы для Algo-службы Binance USDⓈ-M. Отдельная таблица, а не строки в общей:
 * старый вход создания заявки эти типы отбивает кодом -4120, и отсутствие их в общей
 * таблице — структурная гарантия, что туда они не уйдут даже по ошибке.
 */
export const BINANCE_ALGO_ORDER_TYPE_REVERSE: Record<string, string> = {
  [OrderTypeEnum.StopMarket]: 'STOP_MARKET',
  [OrderTypeEnum.StopLimit]: 'STOP',
  [OrderTypeEnum.TakeProfitMarket]: 'TAKE_PROFIT_MARKET',
  [OrderTypeEnum.TakeProfitLimit]: 'TAKE_PROFIT',
  [OrderTypeEnum.Stop]: 'STOP',
  [OrderTypeEnum.TakeProfit]: 'TAKE_PROFIT',
  [OrderTypeEnum.TrailingStop]: 'TRAILING_STOP_MARKET',
};

export const BINANCE_SPOT_ORDER_TYPE_REVERSE: Record<string, string> = {
  [OrderTypeEnum.Market]: 'MARKET',
  [OrderTypeEnum.Limit]: 'LIMIT',
  [OrderTypeEnum.StopMarket]: 'STOP_LOSS',
  [OrderTypeEnum.StopLimit]: 'STOP_LOSS_LIMIT',
  [OrderTypeEnum.TakeProfitMarket]: 'TAKE_PROFIT',
  [OrderTypeEnum.TakeProfitLimit]: 'TAKE_PROFIT_LIMIT',
  [OrderTypeEnum.Stop]: 'STOP_LOSS_LIMIT',
  [OrderTypeEnum.TakeProfit]: 'TAKE_PROFIT_LIMIT',
};

export const BINANCE_ORDER_TYPE_REVERSE = BINANCE_FUTURES_ORDER_TYPE_REVERSE;

export const BINANCE_TIME_IN_FORCE: Record<string, TimeInForceEnum> = {
  GTC: TimeInForceEnum.Gtc,
  IOC: TimeInForceEnum.Ioc,
  FOK: TimeInForceEnum.Fok,
  GTX: TimeInForceEnum.PostOnly,
  // Algo-служба возвращает GTE_GTC у заявок, привязанных к позиции (closePosition,
  // стоп-рынок, тейк-рынок). На вход это значение не принимается ни одним перечнем —
  // только читается. Замерено на живом ответе биржи 07.08.2026.
  GTE_GTC: TimeInForceEnum.Gtc,
};

export const BINANCE_FUTURES_TIME_IN_FORCE_REVERSE: Record<TimeInForceEnum, string> = {
  [TimeInForceEnum.Gtc]: 'GTC',
  [TimeInForceEnum.Ioc]: 'IOC',
  [TimeInForceEnum.Fok]: 'FOK',
  [TimeInForceEnum.PostOnly]: 'GTX',
};

export const BINANCE_WORKING_TYPE: Record<string, string> = {
  [WorkingTypeEnum.MarkPrice]: 'MARK_PRICE',
  [WorkingTypeEnum.ContractPrice]: 'CONTRACT_PRICE',
};

/**
 * По какой цене Binance сверяет срабатывание. Перевод живёт ЗДЕСЬ, а не у потребителя:
 * снаружи говорят «сверять по цене последней сделки», а какое поле и какое слово этому
 * соответствует на конкретной бирже — дело биржевого слоя.
 *
 * Цены индекса у Binance в качестве триггера нет; такое намерение сводится к цене контракта
 * (так было и раньше), и об этом пишется предупреждение.
 */
export const BINANCE_TRIGGER_BY_WORKING_TYPE: Record<string, WorkingTypeEnum> = {
  [TriggerByEnum.MarkPrice]: WorkingTypeEnum.MarkPrice,
  [TriggerByEnum.LastPrice]: WorkingTypeEnum.ContractPrice,
  [TriggerByEnum.IndexPrice]: WorkingTypeEnum.ContractPrice,
};

/**
 * То же намерение, прочитанное с другой стороны: потребитель может выразить «по какой цене
 * сверять срабатывание» любым из двух полей, и обе биржи обязаны понять оба. Без этого
 * заданный по-биржевому workingType на Bybit терялся молча, и стоп срабатывал по умолчанию
 * биржи — по цене маркировки (инцидент ESPORTSUSDT 19.07.2026).
 */
/**
 * Как называется у Binance то, что снаружи спрашивают по смыслу. Перевод живёт здесь, а не у
 * потребителя: наружу мы говорим «реализованный итог», а каким словом это зовёт биржа — дело
 * биржевого слоя.
 */
export const BINANCE_INCOME_TYPE: Record<IncomeTypeFilter, string> = {
  funding: 'FUNDING_FEE',
  realizedPnl: 'REALIZED_PNL',
  commission: 'COMMISSION',
};

/**
 * Обратный перевод: как назвала биржа — что это значит. Нужен, когда доход спрашивают ОДНИМ
 * запросом сразу всех видов и раскладывают уже дома (07.09.2026: три отдельных запроса на то же
 * самое — самый дорогой залп, каким приложение способно подвести адрес под запрет).
 */
const INCOME_KIND_BY_BINANCE_TYPE = new Map<string, IncomeKind>(
  (Object.entries(BINANCE_INCOME_TYPE) as [IncomeTypeFilter, string][]).map(([kind, rawType]) => [rawType, kind]),
);

export function resolveBinanceIncomeKind(rawType: string): IncomeKind {
  return INCOME_KIND_BY_BINANCE_TYPE.get(rawType) ?? 'other';
}

export const BYBIT_WORKING_TYPE_TRIGGER_BY: Record<string, TriggerByEnum> = {
  [WorkingTypeEnum.MarkPrice]: TriggerByEnum.MarkPrice,
  [WorkingTypeEnum.ContractPrice]: TriggerByEnum.LastPrice,
};

export const BYBIT_ORDER_SIDE: Record<string, OrderSideEnum> = {
  Buy: OrderSideEnum.Buy,
  Sell: OrderSideEnum.Sell,
};

export const BYBIT_ORDER_TYPE: Record<string, OrderTypeEnum> = {
  Market: OrderTypeEnum.Market,
  Limit: OrderTypeEnum.Limit,
};

export const BYBIT_TIME_IN_FORCE: Record<string, TimeInForceEnum> = {
  GTC: TimeInForceEnum.Gtc,
  IOC: TimeInForceEnum.Ioc,
  FOK: TimeInForceEnum.Fok,
  PostOnly: TimeInForceEnum.PostOnly,
};

export const OKX_ORDER_SIDE: Record<string, OrderSideEnum> = {
  buy: OrderSideEnum.Buy,
  sell: OrderSideEnum.Sell,
};

export const OKX_ORDER_SIDE_REVERSE: Record<OrderSideEnum, string> = {
  [OrderSideEnum.Buy]: 'buy',
  [OrderSideEnum.Sell]: 'sell',
};

export const OKX_POSITION_SIDE: Record<string, PositionSideEnum> = {
  long: PositionSideEnum.Long,
  short: PositionSideEnum.Short,
  net: PositionSideEnum.Both,
};

export const OKX_POSITION_IDX: Record<string, number> = {
  net: 0,
  long: 1,
  short: 2,
};

export const OKX_ORDER_STATUS: Record<string, string> = {
  live: 'open',
  partially_filled: 'open',
  filled: 'closed',
  canceled: 'canceled',
  mmp_canceled: 'canceled',
};

/**
 * Сработавшая условная заявка («effective») — это ОТКРЫТАЯ заявка, а не закрытая: срабатывание
 * лишь порождает обычную заявку, и та ещё может исполниться частично или получить отказ.
 * Настоящее исполнение дочитывается из порождённой заявки (`mergeOkxTriggeredOrder`). Тот же
 * смысл у соседей: Binance переводит `TRIGGERED` в «открыта», Bybit — `Triggered` в «открыта».
 */
export const OKX_ALGO_STATUS: Record<string, string> = {
  live: 'open',
  pause: 'open',
  partially_effective: 'open',
  effective: 'open',
  canceled: 'canceled',
  order_failed: 'rejected',
  partially_failed: 'rejected',
};

/**
 * Срок действия заявки у OKX закодирован в типе заявки (`ordType`): одна таблица ведёт из
 * пары тип+срок на провод, две другие возвращают обратно.
 */
export const OKX_ORDER_TYPE_BY_TIME_IN_FORCE: Record<TimeInForceEnum, string> = {
  [TimeInForceEnum.Gtc]: 'limit',
  [TimeInForceEnum.PostOnly]: 'post_only',
  [TimeInForceEnum.Ioc]: 'ioc',
  [TimeInForceEnum.Fok]: 'fok',
};

export const OKX_ORD_TYPE_TO_ORDER_TYPE: Record<string, OrderTypeEnum> = {
  market: OrderTypeEnum.Market,
  limit: OrderTypeEnum.Limit,
  post_only: OrderTypeEnum.Limit,
  ioc: OrderTypeEnum.Limit,
  fok: OrderTypeEnum.Limit,
  optimal_limit_ioc: OrderTypeEnum.Market,
};

export const OKX_ORD_TYPE_TO_TIME_IN_FORCE: Record<string, TimeInForceEnum> = {
  limit: TimeInForceEnum.Gtc,
  post_only: TimeInForceEnum.PostOnly,
  ioc: TimeInForceEnum.Ioc,
  fok: TimeInForceEnum.Fok,
  market: TimeInForceEnum.Gtc,
  optimal_limit_ioc: TimeInForceEnum.Ioc,
};

export const OKX_TRIGGER_PX_TYPE: Record<TriggerByEnum, string> = {
  [TriggerByEnum.MarkPrice]: 'mark',
  [TriggerByEnum.LastPrice]: 'last',
  [TriggerByEnum.IndexPrice]: 'index',
};

export const OKX_WORKING_TYPE_TRIGGER_PX_TYPE: Record<WorkingTypeEnum, string> = {
  [WorkingTypeEnum.MarkPrice]: 'mark',
  [WorkingTypeEnum.ContractPrice]: 'last',
};

export const OKX_INCOME_BILL_TYPE: Record<IncomeTypeFilter, string> = {
  funding: '8',
  realizedPnl: '2',
  commission: '2',
};
