import type { TradeSymbol, TradeSymbolBySymbol } from '../../src/types/common';
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

export function createMockTradeSymbols(): TradeSymbolBySymbol {
  const tradeSymbols = new Map<string, TradeSymbol>();
  tradeSymbols.set('BTCUSDT', BTCUSDT_TRADE_SYMBOL);
  tradeSymbols.set('ETHUSDT', ETHUSDT_TRADE_SYMBOL);

  return tradeSymbols;
}
