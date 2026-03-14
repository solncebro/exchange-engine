import type { ExchangeArgs } from '../types/exchange';

export interface BybitBaseClientArgs {
  exchangeArgs: ExchangeArgs;
  category: string;
  publicWebSocketUrl: string;
}
