import {
  BINANCE_CONDITIONAL_ORDER_REGISTRY_MAX_SIZE,
  BINANCE_CONDITIONAL_ORDER_REGISTRY_TTL_MS,
} from '../constants/binance';

export type BinanceOrderKind = 'conditional' | 'plain';

interface RegistryEntry {
  kind: BinanceOrderKind;
  recordedAtMs: number;
}

/**
 * Помнит, из какой службы пришёл номер заявки.
 *
 * Зачем: обычное чтение по номеру условной заявки отвечает -2013 «заявки не существует» —
 * тем же кодом, что и для действительно отсутствующей. Отличить одно от другого по ответу
 * биржи НЕВОЗМОЖНО (проверено живым запросом 07.08.2026), а угадать нельзя: вернуть чужую
 * заявку хуже, чем не вернуть ничего — её цена уйдёт в журнал как цена закрытия чужой сделки.
 *
 * Ограничен по размеру и времени: процесс живёт неделями, а неограниченная память по каждому
 * когда-либо виденному номеру — медленная утечка.
 */
export class BinanceConditionalOrderRegistry {
  private readonly entryByKey = new Map<string, RegistryEntry>();

  private buildKey(symbol: string, orderId: string): string {
    return `${symbol}|${orderId}`;
  }

  record(symbol: string, orderId: string, kind: BinanceOrderKind): void {
    const key = this.buildKey(symbol, orderId);

    // Переставляем в конец: Map хранит порядок вставки, значит первым ключом всегда
    // оказывается самый давний — его и вытесняем при переполнении.
    this.entryByKey.delete(key);
    this.entryByKey.set(key, { kind, recordedAtMs: Date.now() });

    while (this.entryByKey.size > BINANCE_CONDITIONAL_ORDER_REGISTRY_MAX_SIZE) {
      const oldestKey = this.entryByKey.keys().next().value;

      if (oldestKey === undefined) {
        break;
      }

      this.entryByKey.delete(oldestKey);
    }
  }

  lookup(symbol: string, orderId: string): BinanceOrderKind | null {
    const key = this.buildKey(symbol, orderId);
    const entry = this.entryByKey.get(key);

    if (entry === undefined) {
      return null;
    }

    if (Date.now() - entry.recordedAtMs > BINANCE_CONDITIONAL_ORDER_REGISTRY_TTL_MS) {
      this.entryByKey.delete(key);

      return null;
    }

    return entry.kind;
  }

  /** Сколько прошло с момента, когда происхождение номера стало известно; null — не знаем. */
  ageMs(symbol: string, orderId: string): number | null {
    const entry = this.entryByKey.get(this.buildKey(symbol, orderId));

    return entry === undefined ? null : Date.now() - entry.recordedAtMs;
  }

  size(): number {
    return this.entryByKey.size;
  }
}
