# Паттерны тестирования

## Мокирование axios

Единый паттерн во всех HTTP- и exchange-тестах:

```typescript
import axios from 'axios';
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

// В beforeEach или createClient()
const mockInstance: Record<string, jest.Mock> = {
  get: jest.fn().mockResolvedValue({ data: {} }),
  post: jest.fn().mockResolvedValue({ data: {} }),
  put: jest.fn().mockResolvedValue({ data: {} }),
  delete: jest.fn().mockResolvedValue({ data: {} }),
};
mockedAxios.create.mockReturnValue(mockInstance as any);
```

Для подстановки конкретных данных:
```typescript
mockInstance.get.mockResolvedValue({ data: BINANCE_RAW_TICKER_LIST });
```

## MockLogger (test/fixtures/mockLogger.ts)

```typescript
export function createMockLogger(): jest.Mocked<ExchangeLogger> {
  return { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), fatal: jest.fn() };
}
```

## Паттерн createClient

Функция, возвращающая `{ client, mockInstance }`:

```typescript
function createClient(isDemoMode = false) {
  const mockInstance: Record<string, jest.Mock> = { /* ... */ };
  mockedAxios.create.mockReturnValue(mockInstance as any);

  const client = new BinanceFutures({
    config: { apiKey: 'testKey', secret: 'testSecret', isDemoMode },
    logger: createMockLogger(),
  });

  return { client, mockInstance };
}
```

Стандартные credentials: `apiKey: 'testKey'`, `secret: 'testSecret'`.

## Мокирование Date.now

```typescript
beforeEach(() => {
  jest.spyOn(Date, 'now').mockReturnValue(1700000000000);
});
```

Стандартный timestamp для всех тестов: `1700000000000`.

## Мокирование WebSocket стримов

```typescript
jest.mock('../../src/ws/BinanceFuturesPublicStream');

// Получить мокнутый инстанс
const MockedStream = BinanceFuturesPublicStream as jest.MockedClass<typeof BinanceFuturesPublicStream>;
const streamInstance = MockedStream.mock.instances[0];

expect(streamInstance.subscribeKlines).toHaveBeenCalledWith('BTCUSDT', '1m', handler);
```

## Верификация HTTP-вызовов

Через `mockInstance.method.mock.calls[index]`:

```typescript
// GET: [url, options]
const [url, options] = mockInstance.get.mock.calls[0];
expect(url).toBe('/fapi/v1/fundingInfo');
expect(options.params.symbol).toBe('BTCUSDT');
expect(options.params.signature).toBeDefined(); // signed request

// POST: [url, body, options] — body обычно null для postWithParams
const [url, , options] = mockInstance.post.mock.calls[0];
expect(url).toBe('/fapi/v1/leverage');
expect(options.params.symbol).toBe('BTCUSDT');

// DELETE: [url, options]
const [url, options] = mockInstance.delete.mock.calls[0];
expect(options.params.signature).toBeDefined();
```

## Shared test utilities (test/fixtures/)

### mockAxios.ts

Общий хелпер для мокирования axios во всех HTTP- и exchange-тестах:
```typescript
import { createMockAxiosInstance, setupMockAxios } from '../fixtures/mockAxios';
```

### mockTradeSymbol.ts

Готовые TradeSymbol фикстуры для тестирования precision и order methods.

## Фикстуры (test/fixtures/)

Константы с raw API-данными, именование: `EXCHANGE_RAW_ENTITY`:
- `BINANCE_RAW_EXCHANGE_INFO`, `BINANCE_RAW_TICKER_LIST`, `BINANCE_RAW_KLINE_LIST`
- `BINANCE_RAW_POSITION_RISK`, `BINANCE_RAW_ORDER_RESPONSE`, `BINANCE_RAW_ACCOUNT`
- `BINANCE_RAW_FUNDING_RATE_HISTORY_LIST`, `BINANCE_RAW_FUNDING_INFO_LIST`
- `BINANCE_RAW_POSITION_MODE_HEDGE`, `BINANCE_RAW_POSITION_MODE_ONE_WAY`
- `BYBIT_RAW_INSTRUMENT_LIST`, `BYBIT_RAW_TICKER_LIST`, etc.

Типизированы через raw-интерфейсы из нормализаторов:
```typescript
import type { BinancePositionRiskRaw } from '../../src/normalizers/binanceNormalizer';
export const BINANCE_RAW_POSITION_RISK: BinancePositionRiskRaw = { ... };
```

## Именование тестов

```
describe('ClassName', () => {
  describe('methodName', () => {
    it('описание поведения', () => { ... });
  });
});
```

Описание начинается с глагола:
- `'normalizes position from raw data'`
- `'calls signedGet /fapi/v1/positionSide/dual'`
- `'returns Hedge when dualSidePosition is true'`
- `'throws when symbol not found in response'`
- `'maps ISOLATED marginType'`
- `'skips zero balances'`
- `'preserves timestamp'`
- `'parses fundingRate as number'`

## Специальные тесты

### test/smoke.test.ts
- Отдельный скрипт (`ts-node`, не Jest)
- Проверяет что все 4 клиента (binance.futures, binance.spot, bybit.futures, bybit.spot) реализуют `ExchangeClient`
- Проверяет что все нужные методы — функции
- Запуск: `yarn test:smoke`

### test/exports.test.ts
- Jest тест
- Проверяет через `require('../src/index')` что все runtime-значения экспортированы
- Гарантирует стабильность публичного API

## Тестирование retry (BaseHttpClient.test.ts)

Используются fake timers:
```typescript
jest.useFakeTimers();
mockInstance.get
  .mockRejectedValueOnce(error429)
  .mockResolvedValueOnce({ data: 'ok' });

const promise = client.testGet('/test');
await jest.advanceTimersByTimeAsync(2000);
const result = await promise;

expect(mockInstance.get).toHaveBeenCalledTimes(2);
jest.useRealTimers();
```

## Assertions для Map

```typescript
expect(result).toBeInstanceOf(Map);
expect(result.size).toBe(2);
expect(result.has('BTCUSDT')).toBe(true);

const btc = result.get('BTCUSDT')!; // non-null assertion после проверки
expect(btc.symbol).toBe('BTCUSDT');
```

## Jest конфигурация (jest.config.ts)

- `preset: 'ts-jest'`, `testEnvironment: 'node'`
- Тесты в `test/`, smoke test исключён из основного прогона
- Coverage собирается из `src/**/*.ts`, исключая: `index.ts`, `types/**`, `constants/**`, `ws/**`
- `clearMocks: true`, `restoreMocks: true`

## Мокирование ReliableWebSocket

Паттерн мокирования для WebSocket стримов:

```typescript
let capturedOnMessage: ((message: any) => void) | undefined;
let capturedOnOpen: ((context: any) => Promise<void>) | undefined;
let capturedOnReconnectSuccess: (() => void) | undefined;

const mockWebSocket = {
  close: jest.fn(),
  sendToConnectedSocket: jest.fn(),
};

jest.mock('@solncebro/websocket-engine', () => {
  const actual = jest.requireActual('@solncebro/websocket-engine');
  return {
    ...actual,
    ReliableWebSocket: jest.fn().mockImplementation((args: any) => {
      capturedOnMessage = args.onMessage;
      capturedOnOpen = args.onOpen;
      capturedOnReconnectSuccess = args.onReconnectSuccess;
      return mockWebSocket;
    }),
  };
});
```

### Тестирование абстрактных классов

Создать TestStream подкласс в тест-файле:

```typescript
class TestTradeStream extends BaseTradeStream<any> {
  protected readonly label = 'TestTradeStream';
  protected async initConnection(): Promise<void> { /* mock */ }
  protected buildOrderRequest(params, requestId): unknown { return {}; }
}
```

## Тест-файлы WebSocket

| Файл | Покрытие |
|------|----------|
| BaseTradeStream.test.ts | connect, disconnect, isConnected, createOrder, takePendingRequest |
| BinanceFuturesPublicStream.test.ts | tickers, klines, dynamic subscribe, chunking, close |
| BinanceSpotPublicStream.test.ts | tickers, klines, resubscribeAll, handleMessage, close |
| BybitPublicStream.test.ts | tickers (linear/spot), klines, resubscribeAll, close |
| BinanceUserDataStream.test.ts | connect, onMessage, close, isConnected |
| BybitPrivateStream.test.ts | connect, auth, handleMessage filtering, close |
| BinanceTradeStream.handleMessage.test.ts | request-response matching, ExchangeError |
| BinanceTradeStream.initConnection.test.ts | connection creation, buildOrderRequest signing |
| BybitTradeStream.handleMessage.test.ts | dual format responses, auth filtering |
| BybitTradeStream.initConnection.test.ts | connection with auth, buildOrderRequest format |
| parseWebSocketMessage.test.ts | JSON parsing, error handling |
| bybitWebSocketUtils.test.ts | pong detection, HMAC authentication |
