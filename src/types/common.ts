export enum ExchangeNameEnum {
  Binance = 'binance',
  Bybit = 'bybit',
  Okx = 'okx',
}

export enum OrderSideEnum {
  Buy = 'buy',
  Sell = 'sell',
}

export enum OrderTypeEnum {
  Market = 'market',
  Limit = 'limit',
  StopMarket = 'stopMarket',
  StopLimit = 'stopLimit',
  TakeProfitMarket = 'takeProfitMarket',
  TakeProfitLimit = 'takeProfitLimit',
  Stop = 'stop',
  TakeProfit = 'takeProfit',
  TrailingStop = 'trailingStop',
}

export enum MarginModeEnum {
  Isolated = 'isolated',
  Cross = 'cross',
}

export enum PositionSideEnum {
  Long = 'long',
  Short = 'short',
  Both = 'both',
}

export enum TradeSymbolTypeEnum {
  Spot = 'spot',
  Swap = 'swap',
  Future = 'future',
}

export enum TimeInForceEnum {
  Gtc = 'GTC',
  Ioc = 'IOC',
  Fok = 'FOK',
  PostOnly = 'PostOnly',
}

export type KlineInterval =
  | '1s'
  | '1m'
  | '3m'
  | '5m'
  | '15m'
  | '30m'
  | '1h'
  | '2h'
  | '4h'
  | '6h'
  | '12h'
  | '1d'
  | '3d'
  | '1w'
  | '1M';

// Semantic topic categories for the Bybit V5 public stream. Each category is a
// distinct message-rate profile (tickers ~1s, klines per-interval, orderbook/trades
// event-driven), which is why they can be packed onto dedicated connections.
export type BybitPublicTopicType = 'tickers' | 'kline' | 'orderbook' | 'publicTrade';

// Controls how public-stream topics are distributed across physical WebSocket
// connections. Default (undefined) preserves the legacy behaviour: a flat fill of
// up to maxTopicsPerConnection topics regardless of type.
export interface PublicStreamConnectionPacking {
  // When true, each connection carries exactly ONE topic type — never mixing
  // tickers/klines/orderbook/trades. A partial last connection of a type is left
  // partial, not back-filled with another type. This isolates a churning stream
  // (e.g. orderbook) from dragging unrelated streams (e.g. klines) on reconnect.
  // Bybit-only: Binance packs by interval group regardless of this flag.
  separateByTopicType?: boolean;
  // Per-connection topic cap. Bybit: default 200. Binance futures: caps kline
  // streams per connection (default 900); each interval group is sharded into
  // several connections when it exceeds the cap — under peak load the exchange
  // starves and resets oversized connections while small ones keep flowing
  // (prod evidence 2026-08-11: a 523-stream connection lost 471 streams at once
  // while a 30-stream connection on the same host stayed perfectly clean).
  maxTopicsPerConnection?: number;
  // Per-type cap override, e.g. { orderbook: 100, publicTrade: 100 } shrinks the
  // blast radius of the high-churn streams without fragmenting the stable ones.
  maxTopicsPerConnectionByType?: Partial<Record<BybitPublicTopicType, number>>;
}

export interface ExchangeConfig {
  apiKey: string;
  secret: string;
  passphrase?: string;
  recvWindow?: number;
  isDemoMode?: boolean;
  httpsAgent?: unknown;
  publicStreamConnectionPacking?: PublicStreamConnectionPacking;
  lazyOrderbookParse?: boolean;
}

/**
 * Что известно о расходе лимита запросов на АДРЕС и о запрете биржи. Считает это биржа по адресу
 * целиком, поэтому число общее для всех приложений на сервере, и по нему нельзя судить, кто налил;
 * зато по нему видно, есть ли ещё запас — этого хватает, чтобы не начинать тяжёлое чтение.
 *
 * `null` везде значит «не знаем»: у бирж без такого счётчика (Bybit, OKX) он таким и остаётся.
 */
export interface ExchangeRateLimitState {
  /** Израсходованный вес за текущую минуту по последнему ответу биржи. */
  usedWeight: number | null;
  /** Потолок веса на минуту. */
  weightLimit: number | null;
  /** Когда это было замечено: наблюдение стареет, и старое ни о чём не говорит. */
  observedAtMs: number | null;
  /** До какого момента биржа закрыла доступ адресу; `null` — дверь открыта. */
  bannedUntilMs: number | null;
}

export interface ExchangeLogger {
  debug(obj: Record<string, unknown>, message: string): void;
  debug(message: string, ...args: unknown[]): void;
  info(obj: Record<string, unknown>, message: string): void;
  info(message: string, ...args: unknown[]): void;
  warn(obj: Record<string, unknown>, message: string): void;
  warn(message: string, ...args: unknown[]): void;
  error(obj: Record<string, unknown>, message: string): void;
  error(message: string, ...args: unknown[]): void;
  fatal(obj: Record<string, unknown>, message: string): void;
  fatal(message: string, ...args: unknown[]): void;
}

export interface Ticker {
  symbol: string;
  lastPrice: number;
  openPrice: number;
  highPrice: number;
  lowPrice: number;
  priceChangePercent: number;
  volume: number;
  /**
   * Оборот за сутки в котируемой валюте. У Binance и Bybit это ФАКТ, посчитанный биржей по каждой
   * сделке. **У бессрочного контракта OKX это ОЦЕНКА** «объём в монетах × ПОСЛЕДНЯЯ цена»: оборота
   * в котируемой валюте OKX для контрактов не отдаёт вовсе. У монеты, выросшей за сутки втрое,
   * такая оценка завышена примерно вдвое — отбор с порогом «оборот больше N» на OKX пропустит
   * неликвид ровно на разгоне. У спота OKX поле — факт биржи.
   */
  quoteVolume: number;
  timestamp: number;
  /** OKX не отдаёт цену маркировки в ответе тикеров — на OKX поле пусто всегда, см. `fetchMarkPrice`. */
  markPrice?: number;
  /** OKX не отдаёт индексную цену в ответе тикеров — на OKX поле пусто всегда, см. `fetchMarkPrice`. */
  indexPrice?: number;
  bid1Price?: number;
  bid1Size?: number;
  ask1Price?: number;
  ask1Size?: number;
  /** OKX не отдаёт ставку фандинга в ответе тикеров — на OKX поле пусто всегда, см. `fetchMarkPrice`. */
  fundingRate?: number;
  /** OKX не отдаёт время следующего фандинга в ответе тикеров — на OKX поле пусто всегда, см. `fetchMarkPrice`. */
  nextFundingTime?: number;
}

export type TickerBySymbol = Map<string, Ticker>;

export interface Kline {
  openTimestamp: number;
  openPrice: number;
  highPrice: number;
  lowPrice: number;
  closePrice: number;
  volume: number;
  closeTimestamp: number;
  quoteAssetVolume: number;
  numberOfTrades: number;
  takerBuyBaseAssetVolume: number;
  takerBuyQuoteAssetVolume: number;
  isClosed?: boolean;
}

export interface TradeSymbolFilter {
  tickSize: string;
  stepSize: string;
  minQty: string;
  maxQty: string;
  minNotional: string;
  minPrice?: string;
  maxPrice?: string;
  maxNotional?: string;
  marketMinQty?: string;
  marketMaxQty?: string;
  marketStepSize?: string;
  postOnlyMaxQty?: string;
}

export interface LeverageFilter {
  minLeverage: string;
  maxLeverage: string;
  leverageStep: string;
}

export type PriceLimitRisk =
  | {
      source: 'binancePercentPrice';
      multiplierUp: string;
      multiplierDown: string;
      multiplierDecimal: string;
    }
  | {
      source: 'binancePercentPriceBySide';
      bidMultiplierUp: string;
      bidMultiplierDown: string;
      askMultiplierUp: string;
      askMultiplierDown: string;
      avgPriceMins: number;
    }
  | {
      source: 'bybitRiskParameters';
      priceLimitRatioX: string;
      priceLimitRatioY: string;
    }
  /**
   * OKX отдаёт границу цены ПРОЦЕНТАМИ в том же ответе списка инструментов. Наружу все три
   * величины идут в процентах: биржевое `0.03` — это 3, а не 0.03 (доли в библиотеке не
   * используются нигде).
   */
  | {
      source: 'okxPriceLimitPct';
      /** Начальная граница, первые десять минут после листинга («0.05 represents 5%»). */
      initialPriceLimitPercent: string;
      /** Плавающая граница обычной торговли («0.03 represents 3%»). */
      floatPriceLimitPercent: string;
      /** Потолок отклонения цены заявки от индекса («0.15 represents 15%»). */
      maxPriceLimitPercent: string;
    };

export interface TradingFunding {
  fundingIntervalMinutes?: number;
  upperFundingRate?: string;
  lowerFundingRate?: string;
}

export interface TradeSymbol {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  settle: string;
  isActive: boolean;
  type: TradeSymbolTypeEnum;
  isLinear: boolean;
  contractSize: number;
  contractType: string;
  // Tokenized traditional-finance perpetual (equities, commodities/metals) rather than a crypto
  // asset. Binance marks these with contractType TRADIFI_PERPETUAL; Bybit keeps an ordinary
  // LinearPerpetual contractType and marks them with symbolType 'stock' / 'commodity'.
  isTradifi: boolean;
  filter: TradeSymbolFilter;
  leverageFilter?: LeverageFilter;
  priceLimitRisk?: PriceLimitRisk;
  pricePrecision?: number;
  quantityPrecision?: number;
  funding?: TradingFunding;
  launchTimestamp?: number;
  triggerProtect?: string;
  liquidationFee?: string;
  orderTypeList?: string[];
  timeInForceList?: string[];
  info?: Record<string, unknown>;
}

export type TradeSymbolBySymbol = Map<string, TradeSymbol>;

export interface Position {
  symbol: string;
  side: PositionSideEnum;
  direction: 'long' | 'short' | null;
  contracts: number;
  entryPrice: number;
  markPrice: number;
  unrealizedPnl: number;
  leverage: number;
  marginMode: MarginModeEnum;
  liquidationPrice: number;
  positionIdx?: number;
  info: Record<string, unknown>;
}

export interface OrderRateLimitSnapshot {
  limit: number;
  remaining: number;
  resetMs: number;
}

export interface Order {
  id: string;
  clientOrderId: string;
  symbol: string;
  side: OrderSideEnum;
  type: OrderTypeEnum;
  timeInForce: TimeInForceEnum;
  price: number;
  avgPrice: number;
  stopPrice: number;
  amount: number;
  filledAmount: number;
  filledQuoteAmount: number;
  status: string;
  reduceOnly: boolean;
  timestamp: number;
  updatedTimestamp: number;
  rateLimit?: OrderRateLimitSnapshot;
  /** Заявка ждёт срабатывания по цене. До появления этого поля условность приходилось
   *  угадывать по признаку «цена срабатывания больше нуля». */
  isConditional?: boolean;
  /** Номер обычной заявки, которую породило срабатывание условной. Пусто, пока не сработала.
   *  Обратной ссылки у порождённой заявки нет — связь только отсюда. */
  triggeredOrderId?: string;
  /** Заявка закрывает позицию целиком; объём при этом биржа возвращает нулевым. */
  closePosition?: boolean;
}

export interface Balance {
  asset: string;
  /** Остаток и маржа — В ЕДИНИЦАХ САМОЙ МОНЕТЫ. Складывать их между монетами нельзя: так биткойн
   *  оказывается равен доллару (инцидент экрана баланса 29.08.2026). Для свода — только usdValue. */
  free: number;
  locked: number;
  total: number;
  walletBalance?: number;
  availableToWithdraw?: number;
  totalOrderInitialMargin?: number;
  totalPositionInitialMargin?: number;
  /** Долларовая оценка остатка монеты по курсу биржи. Единственная величина, которую допустимо
   *  складывать по разным монетам. */
  usdValue?: number;
}

export type BalanceByAsset = Map<string, Balance>;

export interface AccountBalances {
  totalWalletBalance: number;
  totalAvailableBalance: number;
  balanceByAsset: BalanceByAsset;
  accountType?: string;
  totalMarginBalance?: number;
  totalInitialMargin?: number;
  /** Откуда взяты свободные средства: готовое поле биржи, выведение из остатка и маржи, либо
   *  посчитать было нечем. Потребитель обязан различать факт и расчёт — число, помеченное
   *  'unknown', фактом не является и показывать его как остаток счёта нельзя. */
  availableBalanceSource?: 'exchange' | 'derived' | 'unknown';
}

export interface FundingRateHistory {
  symbol: string;
  fundingRate: number;
  fundingTime: number;
  markPrice: number | null;
}

export interface FundingInfo {
  symbol: string;
  fundingIntervalHours: number;
  adjustedFundingRateCap: number;
  adjustedFundingRateFloor: number;
}

export enum PositionModeEnum {
  Hedge = 'hedge',
  OneWay = 'oneWay',
}

export enum WorkingTypeEnum {
  MarkPrice = 'markPrice',
  ContractPrice = 'contractPrice',
}

export enum TriggerByEnum {
  MarkPrice = 'MarkPrice',
  LastPrice = 'LastPrice',
  IndexPrice = 'IndexPrice',
}

export enum OrderFilterEnum {
  Order = 'Order',
  TpslOrder = 'tpslOrder',
  StopOrder = 'StopOrder',
}

export enum MarketUnitEnum {
  BaseCoin = 'baseCoin',
  QuoteCoin = 'quoteCoin',
}

export enum MarketTypeEnum {
  Futures = 'futures',
  Spot = 'spot',
}

export const MARKET_TYPE_LIST: MarketTypeEnum[] = Object.values(MarketTypeEnum);

export enum WebSocketConnectionTypeEnum {
  Public = 'public',
  Trade = 'trade',
  UserData = 'userData',
}

export interface WebSocketConnectionInfo {
  label: string;
  // Compact, context-free identifier (`${type} #N`, e.g. "orderbook #9", or just
  // "#N" in legacy mixed mode). A substring of `label` from the same source — use it
  // in grouped per-connection listings where the stream prefix is already implied by
  // the surrounding header, so it is not repeated on every line.
  shortLabel?: string;
  url: string;
  isConnected: boolean;
  type: WebSocketConnectionTypeEnum;
  subscriptionList: string[];
  messageCount?: number;
  lastMessageTimestamp?: number;
  reconnectCount?: number;
  pendingCommandCount?: number;
  maxCommandsPerSecond?: number;
}

export interface OrderBookLevel {
  price: number;
  quantity: number;
}

export interface OrderBook {
  symbol: string;
  askList: OrderBookLevel[];
  bidList: OrderBookLevel[];
  timestamp: number;
  updateId?: number;
  eventTimestamp?: number;
}

export type OrderBookUpdateType = 'snapshot' | 'delta';

export type OrderBookRawLevel = [string, string];

export interface OrderBookUpdate {
  symbol: string;
  updateType: OrderBookUpdateType;
  bidList: OrderBookRawLevel[];
  askList: OrderBookRawLevel[];
  updateId: number;
  eventTimestamp: number;
  receivedTimestamp: number;
}

export type OrderBookHandler = (symbol: string, update: OrderBookUpdate) => void;

export interface RawOrderbookFrame {
  symbol: string;
  raw: string;
  receivedTimestamp: number;
}

export type RawOrderbookHandler = (frame: RawOrderbookFrame) => void;

export interface PublicTrade {
  id: string;
  symbol: string;
  price: number;
  quantity: number;
  quoteQuantity: number;
  timestamp: number;
  isBuyerMaker: boolean;
  isBlockTrade?: boolean;
  side?: OrderSideEnum;
}

export type PublicTradeHandler = (symbol: string, tradeList: PublicTrade[]) => void;

export interface MarkPrice {
  symbol: string;
  markPrice: number;
  /** Index price. `undefined` = not present in the exchange payload (never a fake 0). */
  indexPrice?: number;
  lastFundingRate: number;
  nextFundingTime: number;
  timestamp: number;
}

export interface MarkPriceUpdate {
  symbol: string;
  markPrice: number;
  /**
   * Index price. `undefined` = not known (never received for this symbol yet).
   * NEVER a zero placeholder: a fake 0 silently disabled the Max(Index, …) component
   * of the price-limit boundary math downstream (OPGUSDT 2026-07-07).
   */
  indexPrice?: number;
  timestamp: number;
}

export type MarkPriceHandler = (markPriceList: MarkPriceUpdate[]) => void;

export interface OpenInterest {
  symbol: string;
  openInterest: number;
  timestamp: number;
}

export interface FeeRate {
  symbol: string;
  makerRate: number;
  takerRate: number;
}

/**
 * Вид дохода, приведённый к общему смыслу. Сырое название своё у каждой биржи (`REALIZED_PNL`,
 * `TRADE`, `SETTLEMENT`…), и разбирать его у потребителя значило бы держать биржевые знания вне
 * биржевого слоя. `other` — всё, что к трём торговым потокам не относится (переводы, начисления).
 */
export type IncomeKind = 'realizedPnl' | 'commission' | 'funding' | 'other';

export interface Income {
  symbol: string;
  incomeType: string;
  /** Тот же вид, но общими словами: по нему потребитель раскладывает ОДИН ответ на три потока. */
  kind: IncomeKind;
  income: number;
  asset: string;
  timestamp: number;
  info: Record<string, unknown>;
  quantity?: number;
}

/**
 * Итог одного закрытия по записям биржи. `closedPnl` — ЧИСТЫЙ после торговых комиссий
 * (открытия и закрытия), но БЕЗ фандинга: на обеих биржах выполняется
 * «(entryPrice − exitPrice) × quantity − closedPnl = комиссии» (для закрытия шорта; для
 * лонга разность цен наоборот). Фандинг — отдельный поток начислений (`fetchIncome`,
 * `incomeType: 'funding'`); потребитель складывает их сам. У Binance итог собирается из
 * исполнений, у Bybit — из полей записи закрытия, потому что биржевое поле там уже включает
 * фандинг (02.09.2026).
 *
 * ⚠️ OKX отличается СМЫСЛОМ строки. У Binance и Bybit строка — это ОДНО закрытие, строки разных
 * окон не пересекаются, и посуточное суммирование даёт верный итог за период. У OKX строка одна
 * на ВСЮ ЖИЗНЬ позиции и обновляется при каждом частичном закрытии («Position's cumulative closed
 * volume», «Accumulated fee», «It is the latest type if there are several types for the same
 * position», страницы адресуются `uTime` — временем ОБНОВЛЕНИЯ). Одна и та же позиция попадёт в
 * ответ и за понедельник (итог 10), и за вторник (итог уже 25 — накопительно), поэтому складывать
 * итоги OKX по окнам НЕЛЬЗЯ: получится 35 вместо 25. Строка OKX может относиться и к ещё открытой
 * позиции (частичное закрытие), то есть итог там не окончателен.
 */
export interface ClosedPnl {
  symbol: string;
  /**
   * Binance — номер ЗАКРЫВАЮЩЕЙ заявки, Bybit — тоже номер заявки. **OKX — номер ПОЗИЦИИ**
   * (`posId`): у истории позиций номера заявки нет вовсе. Сшивать итоги закрытия с историей
   * заявок по этому полю на OKX не получится.
   */
  orderId: string;
  side: OrderSideEnum;
  quantity: number;
  entryPrice: number;
  exitPrice: number;
  closedPnl: number;
  timestamp: number;
}

export interface OrderUpdateEvent {
  symbol: string;
  orderId: string;
  clientOrderId: string;
  side: OrderSideEnum;
  status: string;
  price: number;
  avgPrice: number;
  amount: number;
  filledAmount: number;
  timestamp: number;
  cancelType?: string;
  /** Почему заявка отвергнута. У условной заявки это причина отказа при СРАБАТЫВАНИИ —
   *  позиция в этот момент остаётся без защиты, событие требует внимания человека. */
  rejectReason?: string;
  /** Событие пришло по условной заявке; orderId — её собственный номер, не порождённой. */
  isConditional?: boolean;
  /** Номер обычной заявки, порождённой срабатыванием. Пусто, пока не сработала. */
  triggeredOrderId?: string;
}

export interface PositionUpdateEvent {
  symbol: string;
  side: string;
  size: number;
  entryPrice: number;
  unrealisedPnl: number;
  positionSide: string;
  timestamp: number;
  /**
   * Ниже — то, что сообщает не всякая биржа. `null` значит «в этом событии не пришло», и это
   * ВАЖНО отличать от настоящего нуля: раньше здесь стояли жёсткие нули, из-за чего сторож
   * ликвидации сравнивал с нулём и не срабатывал никогда. Нужно точное значение — читать
   * позицию отдельным запросом.
   */
  markPrice: number | null;
  leverage: number | null;
  liquidationPrice: number | null;
}

/**
 * Средства по одному активу. Биржи сообщают РАЗНОЕ: спот называет свободное и заблокированное,
 * фьючерсы — остаток кошелька. `null` означает «эта биржа в этом событии такого не говорит»,
 * а не ноль.
 */
export interface BalanceUpdateItem {
  asset: string;
  free: number | null;
  locked: number | null;
  total: number | null;
}

export interface BalanceUpdateEvent {
  balanceList: BalanceUpdateItem[];
  timestamp: number;
}

export type OrderUpdateHandler = (event: OrderUpdateEvent) => void;
export type PositionUpdateHandler = (event: PositionUpdateEvent) => void;
export type BalanceUpdateHandler = (event: BalanceUpdateEvent) => void;

export interface UserDataStreamHandlerArgs {
  onOrderUpdate: OrderUpdateHandler;
  onPositionUpdate: PositionUpdateHandler;
  onBalanceUpdate?: BalanceUpdateHandler;
}
