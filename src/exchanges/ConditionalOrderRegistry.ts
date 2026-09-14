import type { ConditionalOrderRegistryArgs } from './ConditionalOrderRegistry.types';

export type ConditionalOrderKind = 'conditional' | 'plain';

interface RegistryEntry {
  kind: ConditionalOrderKind;
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
export class ConditionalOrderRegistry {
  private readonly maxSize: number;
  private readonly ttlMs: number;
  private readonly entryByKey = new Map<string, RegistryEntry>();

  constructor(args: ConditionalOrderRegistryArgs) {
    this.maxSize = args.maxSize;
    this.ttlMs = args.ttlMs;
  }

  private buildKey(symbol: string, orderId: string): string {
    return `${symbol}|${orderId}`;
  }

  record(symbol: string, orderId: string, kind: ConditionalOrderKind): void {
    const key = this.buildKey(symbol, orderId);

    // Переставляем в конец: Map хранит порядок вставки, значит первым ключом всегда
    // оказывается самый давний — его и вытесняем при переполнении.
    this.entryByKey.delete(key);
    this.entryByKey.set(key, { kind, recordedAtMs: Date.now() });

    while (this.entryByKey.size > this.maxSize) {
      const oldestKey = this.entryByKey.keys().next().value;

      if (oldestKey === undefined) {
        break;
      }

      this.entryByKey.delete(oldestKey);
    }
  }

  lookup(symbol: string, orderId: string): ConditionalOrderKind | null {
    const key = this.buildKey(symbol, orderId);
    const entry = this.entryByKey.get(key);

    if (entry === undefined) {
      return null;
    }

    if (Date.now() - entry.recordedAtMs > this.ttlMs) {
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
