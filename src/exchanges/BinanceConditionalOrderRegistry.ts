import {
  BINANCE_CONDITIONAL_ORDER_REGISTRY_MAX_SIZE,
  BINANCE_CONDITIONAL_ORDER_REGISTRY_TTL_MS,
} from '../constants/binance';
import { ConditionalOrderRegistry } from './ConditionalOrderRegistry';
import type { ConditionalOrderKind } from './ConditionalOrderRegistry';

export type BinanceOrderKind = ConditionalOrderKind;

export class BinanceConditionalOrderRegistry extends ConditionalOrderRegistry {
  constructor() {
    super({ maxSize: BINANCE_CONDITIONAL_ORDER_REGISTRY_MAX_SIZE, ttlMs: BINANCE_CONDITIONAL_ORDER_REGISTRY_TTL_MS });
  }
}
