import type { TradeSymbol } from '../../src/types/common';
import { TradeSymbolTypeEnum } from '../../src/types/common';

export const BTCUSDT_TRADE_SYMBOL: TradeSymbol = {
  symbol: 'BTCUSDT',
  baseAsset: 'BTC',
  quoteAsset: 'USDT',
  settle: 'USDT',
  isActive: true,
  type: TradeSymbolTypeEnum.Swap,
  isLinear: true,
  contractSize: 1,
  filter: {
    tickSize: '0.10',
    stepSize: '0.001',
    minQty: '0.001',
    maxQty: '1000',
    minNotional: '5',
  },
};

export const ETHUSDT_TRADE_SYMBOL: TradeSymbol = {
  symbol: 'ETHUSDT',
  baseAsset: 'ETH',
  quoteAsset: 'USDT',
  settle: 'USDT',
  isActive: true,
  type: TradeSymbolTypeEnum.Swap,
  isLinear: true,
  contractSize: 1,
  filter: {
    tickSize: '0.01',
    stepSize: '0.01',
    minQty: '0.01',
    maxQty: '10000',
    minNotional: '5',
  },
};

export const BTCUSDT_SPOT_TRADE_SYMBOL: TradeSymbol = {
  symbol: 'BTCUSDT',
  baseAsset: 'BTC',
  quoteAsset: 'USDT',
  settle: '',
  isActive: true,
  type: TradeSymbolTypeEnum.Spot,
  isLinear: false,
  contractSize: 1,
  filter: {
    tickSize: '0.01',
    stepSize: '0.001',
    minQty: '0.001',
    maxQty: '1000',
    minNotional: '5',
  },
};

export const MISSING_FILTER_TRADE_SYMBOL: TradeSymbol = {
  symbol: 'NEWUSDT',
  baseAsset: 'NEW',
  quoteAsset: 'USDT',
  settle: 'USDT',
  isActive: true,
  type: TradeSymbolTypeEnum.Swap,
  isLinear: true,
  contractSize: 1,
  filter: {
    tickSize: '0',
    stepSize: '0',
    minQty: '0',
    maxQty: '0',
    minNotional: '0',
  },
};

