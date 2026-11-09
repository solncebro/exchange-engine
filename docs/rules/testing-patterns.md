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

Binance (test/fixtures/binanceRaw.ts):
- `BINANCE_RAW_EXCHANGE_INFO`, `BINANCE_RAW_TICKER_LIST`, `BINANCE_RAW_KLINE_LIST`
- `BINANCE_RAW_TICKER_FUTURES`, `BINANCE_RAW_TICKER_SPOT` — ЖИВЫЕ снимки суточной сводки обеих ручек (10.09.2026); на них стоит `test/normalizers/binanceTickerCompleteness.test.ts`
- `BINANCE_RAW_EXCHANGE_INFO_SETTLE_VARIANTS` — бессрочный контракт с расчётом в USDC и срочный контракт: держит чтение валюты расчёта из ответа биржи (`marginAsset`), а не из догадки «бессрочный значит USDT»
- `BINANCE_RAW_WEBSOCKET_KLINE`, `BINANCE_RAW_POSITION_RISK`, `BINANCE_RAW_ORDER_RESPONSE`
- `BINANCE_RAW_ACCOUNT`, `BINANCE_RAW_FUTURES_ACCOUNT`
- `BINANCE_RAW_FUNDING_RATE_HISTORY_LIST`, `BINANCE_RAW_FUNDING_INFO_LIST`
- `BINANCE_RAW_FUTURE_SYMBOL`, `BINANCE_RAW_SYMBOL_NO_FILTERS`
- `BINANCE_RAW_POSITION_MODE_HEDGE`, `BINANCE_RAW_POSITION_MODE_ONE_WAY`
- `BINANCE_RAW_ORDER_BOOK`, `BINANCE_RAW_PUBLIC_TRADE_LIST`
- `BINANCE_RAW_MARK_PRICE_LIST`, `BINANCE_RAW_OPEN_INTEREST`
- `BINANCE_RAW_COMMISSION_RATE`, `BINANCE_RAW_INCOME_LIST`
- `BINANCE_RAW_MODIFY_BATCH_RESPONSE_MIXED` — смесь success + error per-order для тестов `modifyBatchOrders` (используется в `BinanceFutures.modifyBatchOrders.test.ts`)
- `BINANCE_RAW_FUTURES_ACCOUNT_WITH_POSITION` — счёт с открытой позицией и всеми сводными полями (`totalInitialMargin`, `totalMarginBalance`, ...); держит случай, где занятая маржа не равна разности кошелька со свободными (свободные уже уменьшены на нереализованный итог)

Bybit (test/fixtures/bybitRaw.ts):
- `BYBIT_RAW_INSTRUMENT_LIST`, `BYBIT_RAW_TICKER_LIST`, `BYBIT_RAW_KLINE_LIST`
- `BYBIT_RAW_WEBSOCKET_KLINE`, `BYBIT_RAW_POSITION`, `BYBIT_RAW_ORDER_RESPONSE`
- `BYBIT_RAW_INSTRUMENT_FUTURES`, `BYBIT_RAW_INSTRUMENT_NO_FILTERS`
- `BYBIT_RAW_WALLET_BALANCE`, `BYBIT_RAW_ORDER_BOOK`, `BYBIT_RAW_PUBLIC_TRADE_LIST`
- `BYBIT_RAW_MARK_PRICE_TICKER_LIST`, `BYBIT_RAW_OPEN_INTEREST`, `BYBIT_RAW_FEE_RATE_LIST`
- `BYBIT_RAW_FUNDING_RATE_HISTORY_LIST`, `BYBIT_RAW_CLOSED_PNL_LIST`
- `BYBIT_RAW_TRANSACTION_LOG_LIST`
- `BYBIT_RAW_AMEND_BATCH_RESPONSE` — REST ответ `/v5/order/amend-batch` с `result.list[]` (orderId/orderLinkId) и `retExtInfo.list[]` (per-order success/error)
- `BYBIT_WS_RAW_CREATE_BATCH_RESPONSE` — WS-ответ `order.create-batch`
- `BYBIT_WS_RAW_AMEND_BATCH_RESPONSE` — WS-ответ `order.amend-batch`
- `BYBIT_WS_RAW_CANCEL_BATCH_RESPONSE` — WS-ответ `order.cancel-batch`
- `BYBIT_RAW_WALLET_BALANCE_NO_TOTALS` — живой счёт без сводных полей биржи (свободные/маржинальный баланс/начальная маржа пусты) и с пылью в 6 монетах помимо USDT — держит регресс «остатки разных монет сложены как одно число»
- `BYBIT_RAW_CLOSED_PNL_FLOCKUSDT`, `BYBIT_RAW_TRANSACTION_LOG_SETTLEMENT` — живая пара «закрытие + начисление фандинга» FLOCKUSDT 02.09.2026: держат тождество «валовой − closedPnl = комиссии» и чтение суммы фандинга из поля `funding`

OKX (test/fixtures/okxRaw.ts):
- Инструменты: `OKX_RAW_INSTRUMENT_SPOT`, `OKX_RAW_INSTRUMENT_SWAP` (`ctVal: '0.01'`, `lotSz: '1'` — 0.05 монеты = 5 контрактов), `OKX_RAW_INSTRUMENT_USDC_SWAP`, `OKX_RAW_INSTRUMENT_INVERSE` (должен отбрасываться), `OKX_RAW_INSTRUMENT_STOCK_SWAP` (признак TradFi)
- Рынок: `OKX_RAW_TICKER_LIST`, `OKX_RAW_KLINE_LIST`, `OKX_RAW_ORDER_BOOK`, `OKX_RAW_ORDER_BOOK_STREAM_SNAPSHOT`, `OKX_RAW_ORDER_BOOK_STREAM_UPDATE`, `OKX_RAW_PUBLIC_TRADE_LIST`, `OKX_RAW_MARK_PRICE_LIST`, `OKX_RAW_OPEN_INTEREST`, `OKX_RAW_FUNDING_RATE`, `OKX_RAW_FUNDING_RATE_HISTORY_LIST`, `OKX_RAW_FEE_RATE`
- Счёт: `OKX_RAW_BALANCE`, `OKX_RAW_BALANCE_FUTURES_MODE`, `OKX_RAW_POSITION_NET_LONG`/`_NET_SHORT`/`_HEDGE_SHORT`, `OKX_RAW_POSITION_HISTORY_LIST`
- Заявки: `OKX_RAW_ORDER_FILLED`, `OKX_RAW_ORDER_LIVE_POST_ONLY`, `OKX_RAW_ORDER_SPOT_MARKET_QUOTE`, `OKX_RAW_ALGO_ORDER_STOP_MARKET`, `OKX_RAW_ALGO_ORDER_SPOT_MARKET_QUOTE`, `OKX_RAW_ALGO_ORDER_TAKE_PROFIT_LIMIT`, `OKX_RAW_ALGO_ORDER_TRAILING`, `OKX_RAW_ALGO_ORDER_EFFECTIVE`, `OKX_RAW_ALGO_ORDER_FAILED`, `OKX_RAW_ORDER_RESULT_OK`, `OKX_RAW_ORDER_RESULT_REJECTED`
- Журнал счёта: `OKX_RAW_BILL_TRADE_OPEN`, `OKX_RAW_BILL_TRADE_CLOSE`, `OKX_RAW_BILL_FUNDING_EXPENSE`, `OKX_RAW_BILL_FUNDING_INCOME`, `OKX_RAW_BILL_FUNDING_EXPENSE_BALCHG_ONLY` (сумма фандинга только в `balChg` — запасной путь чтения)

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
- Отдельный скрипт (`ts-node`, не Jest), работает по СОБРАННОМУ `dist/index`
- Проверяет что все 6 клиентов (binance.futures, binance.spot, bybit.futures, bybit.spot, okx.futures, okx.spot) реализуют `ExchangeClient`
- OKX создаётся с отдельным набором аргументов — с кодовой фразой, иначе клиент не построится
- Проверяет что все нужные методы — функции, и что в `ExchangeNameEnum` три значения
- Запуск: `yarn test:smoke`

### test/exports.test.ts
- Jest тест
- Проверяет через `require('../src/index')` что все runtime-значения экспортированы (в т.ч. `parseBybitOrderbookRawFrame` и `parseOkxOrderbookRawFrame`) и что `ExchangeNameEnum` перечисляет ровно три биржи
- Отдельно проверяет подпуть `require('../src/public')`: три публичных потока и по три нормализатора на биржу выходят наружу, а `Exchange`, HTTP-клиенты и trade/private-потоки в него НЕ попадают
- Гарантирует стабильность публичного API

## Тесты полноты ответа биржи (completeness guard)

Паттерн для защиты от тихой потери поля, которое биржа добавила в ответ, но нормализатор не читает:

```typescript
const RAW_SAMPLE: Record<string, string> = { /* реальный снапшот ответа биржи, включая поля не в raw-типе */ };
const MODELED_KEYS = new Set<string>([/* поля, которые нормализатор читает */]);
const INTENTIONALLY_IGNORED_KEYS = new Set<string>([/* поля, осознанно не используемые */]);

it('every field in a real snapshot is either modeled or explicitly ignored', () => {
  const unaccounted = Object.keys(RAW_SAMPLE).filter(
    (key) => !MODELED_KEYS.has(key) && !INTENTIONALLY_IGNORED_KEYS.has(key)
  );
  expect(unaccounted).toEqual([]);
});
```

Тест падает, если в снапшоте появляется ключ, не учтённый ни в одном из двух множеств — сигнал, что нормализатор нужно обновить (либо явно проигнорировать поле). Файлы:
- `test/normalizers/bybitTickerCompleteness.test.ts` — снапшот `tickers.{symbol}`, покрывает регресс bid1/ask1/mark/index
- `test/normalizers/bybitResponseCompleteness.test.ts` — снапшоты `normalizeBybitOrder`, `normalizeBybitPosition`, `normalizeBybitBalances` (coin-level), `normalizeBybitOrderBook`/`normalizeBybitOrderBookUpdate` (проверяет и envelope-`ts` приоритет над `data.ts`)
- `test/normalizers/okxResponseCompleteness.test.ts` — снапшоты ответов OKX (инструмент, тикер, заявка, условная заявка, позиция, монета баланса, запись журнала счёта)
- `test/normalizers/binanceTickerCompleteness.test.ts` — снапшоты суточной сводки Binance (контракты и спот). Кроме обычного правила «каждое поле снимка учтено» держит ВСТРЕЧНОЕ: каждое поле, которое читает нормализатор, обязано быть в снимке — именно на нём валится выдуманное поле вроде `time`

`test/normalizers/binanceAggTrade.test.ts` — обычный unit-тест `normalizeBinanceAggTradeFromStream` (maker/taker маппинг в `side`/`isBuyerMaker`, `quoteQuantity`), без MODELED_KEYS-паттерна.

## Инварианты, общие для всех бирж (test/normalizers/accountBalanceInvariants.test.ts)

Паттерн для правил, которые обязаны держаться на результате нормализации НЕЗАВИСИМО от биржи и конкретных входных данных — не «поле присутствует», а «значение не противоречит себе»:

```typescript
const CASE_LIST: Array<{ name: string; balances: AccountBalances }> = [
  { name: 'bybit, сводные поля пришли', balances: normalizeBybitBalances(BYBIT_RAW_WALLET_BALANCE) },
  { name: 'binance, счёт с позицией', balances: normalizeBinanceFuturesBalances(BINANCE_RAW_FUTURES_ACCOUNT_WITH_POSITION) },
  // ...
];

it.each(CASE_LIST)('never reports more free money than the account holds ($name)', ({ balances }) => {
  expect(balances.totalAvailableBalance).toBeLessThanOrEqual(balances.totalWalletBalance);
});
```

`test/normalizers/accountBalanceInvariants.test.ts` держит три инварианта `AccountBalances` на фикстурах всех трёх бирж (у OKX — счёт с готовым полем свободных средств и счёт, где их приходится выводить по курсам монет) (в т.ч. `BYBIT_RAW_WALLET_BALANCE_NO_TOTALS` — счёт без сводных полей биржи): свободных средств не бывает больше кошелька, занятая маржа не бывает отрицательной, `availableBalanceSource` назван всегда (`'exchange'`/`'derived'`/`'unknown'`).

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

`BinanceBaseHttpClient.test.ts` (`describe('rate-limit awareness (REQUEST_WEIGHT / 418)')`) проверяет проактивный троттлинг: warn при приближении к весу (заголовок `x-mbx-used-weight-1m`), отсутствие warn на здоровом весе, лог + отсутствие ретрая на HTTP 418 (`mockInstance.get` вызван 1 раз), а с 07.09.2026 — что запись (`post`) тоже держит паузу до снятия бана, а не стучится дальше (`resetBinanceRequestGateRegistry()` в `beforeEach`, память сторожа общая на процесс). Чистые функции разбора ответа (`parseUsedWeight1m`, `parseRetryAfterMs`, `parseBinanceBanUntilMs`, `observeRateLimitResponse`) тестируются отдельно и без HTTP-мока в `test/http/binanceRateLimit.test.ts`; сам сторож с очередью ожидания и реестром по хосту — в `test/http/binanceRequestGate.test.ts`.

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

## Детальная документация

| Файл | Содержание |
|------|-----------|
| [testing-patterns-catalog.md](testing-patterns-catalog.md) | Каталог тест-файлов (Exchange, HTTP, WebSocket, OKX) и живые проверки: `exchange:live-check`, `okx:probe`, граница с trade-engine |
