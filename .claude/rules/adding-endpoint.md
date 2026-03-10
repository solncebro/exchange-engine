# Добавление нового эндпоинта — пошаговый гайд

## Порядок действий

### 1. Тип в common.ts

Добавить унифицированный интерфейс/enum в `src/types/common.ts`:
```typescript
export interface NewEntity {
  symbol: string;
  someField: number;
}
```

### 2. Метод в ExchangeClient

Добавить сигнатуру метода в интерфейс `ExchangeClient` в `src/types/exchange.ts`.
При необходимости добавить import нового типа.

### 3. Абстрактный метод в BaseExchangeClient

Добавить в `src/exchanges/BaseExchangeClient.ts`:
```typescript
abstract fetchNewEntity(...args: Parameters<ExchangeClient['fetchNewEntity']>): ReturnType<ExchangeClient['fetchNewEntity']>;
```

### 4. Raw-интерфейс + нормализатор

В `src/normalizers/binanceNormalizer.ts`:
1. Добавить `export interface BinanceNewEntityRaw { ... }` с точными полями API
2. Добавить функцию `export function normalizeBinanceNewEntity(rawList): NewEntity[]`
3. parseFloat для строковых чисел, маппинг через константы

### 5. HTTP-метод

В `src/http/BinanceFuturesHttpClient.ts`:
```typescript
async fetchNewEntity(symbol?: string): Promise<BinanceNewEntityRaw[]> {
  const params: Record<string, string | number | boolean> = {};

  if (symbol !== undefined) {
    params.symbol = symbol;
  }

  // Public endpoint:
  return this.get<BinanceNewEntityRaw[]>('/fapi/v1/newEndpoint', params);
  // Signed endpoint:
  return this.signedGet<BinanceNewEntityRaw[]>('/fapi/v1/newEndpoint', params);
}
```

### 6. Exchange-метод

В `src/exchanges/BinanceFutures.ts`:
```typescript
async fetchNewEntity(symbol?: string): Promise<NewEntity[]> {
  this.logger.debug('Fetching new entity');
  const raw = await this.httpClient.fetchNewEntity(symbol);

  return normalizeBinanceNewEntity(raw);
}
```

### 7. Заглушки в остальных классах

Во всех классах, которые не поддерживают этот метод:
- `BinanceSpot.ts` → `throw new Error('Not supported for spot market')`
- `BybitLinear.ts` → `throw new Error('Not implemented for Bybit')`
- `BybitSpot.ts` → `throw new Error('Not supported for spot market')`

### 8. Экспорты

1. `src/types/index.ts` — добавить новый тип в `export type { ... } from './common'`
2. `src/index.ts` — добавить в соответствующий блок export
3. Если новый enum — добавить в блок `export { ... }` (runtime), не `export type`

### 9. Фикстуры

В `test/fixtures/binanceRaw.ts`:
```typescript
import type { BinanceNewEntityRaw } from '../../src/normalizers/binanceNormalizer';

export const BINANCE_RAW_NEW_ENTITY: BinanceNewEntityRaw[] = [
  { symbol: 'BTCUSDT', someField: '0.123' },
];
```

### 10. Тесты нормализатора

В `test/normalizers/binanceNormalizer.test.ts`:
```typescript
describe('normalizeBinanceNewEntity', () => {
  it('returns array of NewEntity objects', () => { ... });
  it('parses someField as number', () => { ... });
});
```

### 11. Тесты HTTP-клиента

В `test/http/BinanceFuturesHttpClient.test.ts`:
```typescript
describe('fetchNewEntity', () => {
  it('calls GET /fapi/v1/newEndpoint without symbol', async () => {
    await client.fetchNewEntity();
    const [url, options] = mockInstance.get.mock.calls[0];
    expect(url).toBe('/fapi/v1/newEndpoint');
    expect(options.params.symbol).toBeUndefined();
  });

  it('includes symbol when provided', async () => {
    await client.fetchNewEntity('BTCUSDT');
    const [, options] = mockInstance.get.mock.calls[0];
    expect(options.params.symbol).toBe('BTCUSDT');
  });
});
```

### 12. Тесты exchange-клиента

В `test/exchanges/BinanceFutures.test.ts`:
```typescript
describe('fetchNewEntity', () => {
  it('returns normalized data', async () => {
    const { client, mockInstance } = createClient();
    mockInstance.get.mockResolvedValue({ data: BINANCE_RAW_NEW_ENTITY });

    const result = await client.fetchNewEntity();

    expect(result).toHaveLength(1);
    expect(result[0].symbol).toBe('BTCUSDT');
    expect(result[0].someField).toBe(0.123);
  });
});
```

## Верификация

```bash
yarn lint           # 0 ошибок
yarn test --coverage  # все тесты проходят
yarn test:smoke     # все клиенты реализуют ExchangeClient
yarn build          # компиляция без ошибок
```

## Чеклист

- [ ] Тип в `common.ts`
- [ ] Метод в `ExchangeClient` интерфейсе
- [ ] `abstract` в `BaseExchangeClient`
- [ ] Raw-интерфейс + нормализатор
- [ ] HTTP-метод
- [ ] Exchange-метод (BinanceFutures)
- [ ] Заглушки (BinanceSpot, BybitLinear, BybitSpot)
- [ ] Экспорт из `types/index.ts` и `src/index.ts`
- [ ] Фикстуры
- [ ] Тесты: нормализатор, HTTP, exchange
- [ ] Верификация: lint, test, smoke, build
