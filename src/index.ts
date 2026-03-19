export { ExchangeError } from './errors/ExchangeError';
export { Exchange } from './exchanges/Exchange';

export type {
  ExchangeClient,
  ExchangeArgs,
  CreateOrderWebSocketArgs,
  FetchAllKlinesOptions,
  FetchPageWithLimitArgs,
  SubscribeKlinesArgs,
  KlineHandler,
} from './types/exchange';

export {
  ExchangeNameEnum,
  MARKET_TYPE_LIST,
  OrderSideEnum,
  OrderTypeEnum,
  MarginModeEnum,
  PositionSideEnum,
  PositionModeEnum,
  TradeSymbolTypeEnum,
  TimeInForceEnum,
  WorkingTypeEnum,
  MarketTypeEnum,
  WebSocketConnectionTypeEnum,
} from './types/common';

export type {
  KlineInterval,
  ExchangeConfig,
  ExchangeLogger,
  Ticker,
  TickerBySymbol,
  Kline,
  TradeSymbol,
  TradeSymbolBySymbol,
  TradeSymbolFilter,
  Position,
  Order,
  Balance,
  BalanceByAsset,
  FundingRateHistory,
  FundingInfo,
  WebSocketConnectionInfo,
} from './types/common';

export type {
  BybitWebSocketKlineRaw,
  BybitPublicTradeDataRaw,
  BybitWebSocketMessageRaw,
  BybitKlineMessageRaw,
  BybitTradeMessageRaw,
} from './normalizers/bybitNormalizer';

export {
  normalizeBybitKlineWebSocketMessage,
} from './normalizers/bybitNormalizer';

export type {
  BinanceWebSocketKlineRaw,
  BinanceContinuousKlineMessageRaw,
} from './normalizers/binanceNormalizer';

export {
  normalizeBinanceKlineWebSocketMessage,
} from './normalizers/binanceNormalizer';
