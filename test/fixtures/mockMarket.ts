import type { Market, MarketBySymbol } from '../../src/types/common';
import { MarketType } from '../../src/types/common';

export const BTCUSDT_MARKET: Market = {
  symbol: 'BTCUSDT',
  baseAsset: 'BTC',
  quoteAsset: 'USDT',
  settle: 'USDT',
  isActive: true,
  type: MarketType.Swap,
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

export const ETHUSDT_MARKET: Market = {
  symbol: 'ETHUSDT',
  baseAsset: 'ETH',
  quoteAsset: 'USDT',
  settle: 'USDT',
  isActive: true,
  type: MarketType.Swap,
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

export function createMockMarkets(): MarketBySymbol {
  const markets = new Map<string, Market>();
  markets.set('BTCUSDT', BTCUSDT_MARKET);
  markets.set('ETHUSDT', ETHUSDT_MARKET);

  return markets;
}
