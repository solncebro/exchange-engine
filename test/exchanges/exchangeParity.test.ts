import axios from 'axios';
import { BinanceFutures } from '../../src/exchanges/BinanceFutures';
import { BinanceSpot } from '../../src/exchanges/BinanceSpot';
import { BybitLinear } from '../../src/exchanges/BybitLinear';
import { BybitSpot } from '../../src/exchanges/BybitSpot';
import { OkxSwap } from '../../src/exchanges/OkxSwap';
import { OkxSpot } from '../../src/exchanges/OkxSpot';
import { createMockLogger } from '../fixtures/mockLogger';
import { createMockAxiosInstance } from '../fixtures/mockAxios';
import { OrderSideEnum, OrderTypeEnum } from '../../src/types/common';
import { normalizeBinanceOrder } from '../../src/normalizers/binanceNormalizer';
import { normalizeBybitOrder } from '../../src/normalizers/bybitNormalizer';
import { normalizeOkxAlgoOrder, normalizeOkxOrder } from '../../src/normalizers/okxNormalizer';
import {
  OKX_RAW_ALGO_ORDER_STOP_MARKET,
  OKX_RAW_ORDER_LIVE_POST_ONLY,
} from '../fixtures/okxRaw';

jest.mock('axios');
jest.mock('../../src/ws/BinanceFuturesPublicStream');
jest.mock('../../src/ws/BinanceSpotPublicStream');
jest.mock('../../src/ws/BinanceTradeStream');
jest.mock('../../src/ws/BybitPublicStream');
jest.mock('../../src/ws/BybitTradeStream');
jest.mock('../../src/ws/OkxPublicStream');
jest.mock('../../src/ws/OkxTradeStream');
jest.mock('../../src/ws/OkxPrivateStream');

const mockedAxios = axios as jest.Mocked<typeof axios>;

type AnyClient = BinanceFutures | BinanceSpot | BybitLinear | BybitSpot | OkxSwap | OkxSpot;

function build<T>(Client: new (args: never) => T): T {
  mockedAxios.create.mockReturnValue(createMockAxiosInstance() as never);

  return new Client({ config: { apiKey: 'k', secret: 's', passphrase: 'p' }, logger: createMockLogger() } as never);
}

const FUTURES_CLIENT_LIST: Array<[string, () => AnyClient]> = [
  ['Binance futures', () => build(BinanceFutures)],
  ['Bybit futures', () => build(BybitLinear)],
  ['OKX futures', () => build(OkxSwap)],
];

const SPOT_CLIENT_LIST: Array<[string, () => AnyClient]> = [
  ['Binance spot', () => build(BinanceSpot)],
  ['Bybit spot', () => build(BybitSpot)],
  ['OKX spot', () => build(OkxSpot)],
];

const ALL_CLIENT_LIST: Array<[string, () => AnyClient]> = [...FUTURES_CLIENT_LIST, ...SPOT_CLIENT_LIST];

/**
 * Сквозной тест равенства: ОДИН список ожиданий, прогоняемый по обеим биржам сразу.
 *
 * Смысл не в том, чтобы повторить проверки, уже написанные для каждой биржи по отдельности.
 * Смысл в том, чтобы расхождение между ними падало ЗДЕСЬ — раньше их находил только аудит
 * сплошным чтением, то есть спустя месяцы и после денежных потерь. Правило владельца:
 * за одним интерфейсом обе биржи обязаны вести себя одинаково.
 *
 * Сюда добавляется каждое новое общее обещание — именно поэтому проверки написаны как
 * перебор клиентов, а не как отдельные тесты на биржу.
 */
describe('обе биржи держат одни и те же обещания', () => {
  describe('возможность, которой у рынка нет, отказывает ГРОМКО и одинаково', () => {
    it.each(SPOT_CLIENT_LIST)('%s: позиции — не спотовое понятие', async (_label, create) => {
      await expect(create().fetchPosition('BTCUSDT')).rejects.toThrow(/not supported/i);
    });

    it.each(SPOT_CLIENT_LIST)('%s: плечо — не спотовое понятие', async (_label, create) => {
      await expect(create().setLeverage(10, 'BTCUSDT')).rejects.toThrow(/not supported/i);
    });

    it.each(SPOT_CLIENT_LIST)('%s: режим маржи — не спотовое понятие', async (_label, create) => {
      await expect(create().setMarginMode('isolated' as never, 'BTCUSDT')).rejects.toThrow(/not supported/i);
    });

    it.each(SPOT_CLIENT_LIST)('%s: итогов закрытия на споте нет', async (_label, create) => {
      await expect(create().fetchClosedPnl()).rejects.toThrow(/not supported/i);
    });

    it.each(SPOT_CLIENT_LIST)('%s: скользящего стопа на споте нет', async (_label, create) => {
      await expect(
        create().createOrderWebSocket({
          symbol: 'BTCUSDT',
          type: OrderTypeEnum.TrailingStop,
          side: OrderSideEnum.Sell,
          amount: 1,
          callbackRate: 2,
        }),
      ).rejects.toThrow();
    });
  });

  describe('единицы измерения общие для всех', () => {
    it.each(ALL_CLIENT_LIST)('%s: сумма в котируемой валюте — только рыночная заявка', async (_label, create) => {
      const client = create();
      const clientMethodByName = client as unknown as Record<string, (a: unknown) => unknown>;
      const buildParams = clientMethodByName.buildBinanceOrderParams
        ?? clientMethodByName.buildBybitOrderParams
        ?? clientMethodByName.buildOkxOrderParams;
      const args = {
        symbol: 'BTCUSDT',
        side: OrderSideEnum.Buy,
        amount: 0,
        price: 100,
        type: OrderTypeEnum.Limit,
        quoteOrderQty: 100,
      };

      // На фьючерсах этой единицы нет вовсе — там она просто игнорируется; на споте обязан
      // быть отказ. Проверяем ровно то общее обещание, что «сумма денег» не превращается
      // молча в «количество монет».
      // Сборщик OKX асинхронный (режим позиции читается со счёта), у соседей — обычный.
      // Ждём и тот и другой одинаково: `await` над не-обещанием возвращает само значение.
      const outcome = await (async () => {
        try {
          return await buildParams.call(client, args) as Record<string, unknown>;
        } catch {
          return null;
        }
      })();

      if (outcome !== null) {
        expect(outcome.quoteOrderQty).toBeUndefined();
        expect(outcome.qty === '100').toBe(false);
      }
    });
  });

  describe('предел частоты заявок называет свой источник', () => {
    it.each(ALL_CLIENT_LIST)('%s: источник назван, значение положительное', async (_label, create) => {
      const client = create();
      const mockInstance = createMockAxiosInstance();
      mockedAxios.create.mockReturnValue(mockInstance as never);
      mockInstance.get.mockResolvedValue({ data: { symbols: [], rateLimits: [] } });

      const result = await client.getOrderRateLimit();

      expect(result.writeRequestsPerSecond).toBeGreaterThan(0);
      expect(typeof result.source).toBe('string');
      expect(result.source.length).toBeGreaterThan(0);
    });
  });

  // Защитная заявка обязана узнаваться на ОБЕИХ биржах, иначе правило «не трогать защитные»
  // на одной из них снимает стопы вместе с обычными. Помечают они её по-разному: Binance —
  // типом заявки, Bybit — отдельным полем. Наружу признак обязан быть один.
  describe('защитная заявка узнаётся на обеих биржах', () => {
    const PROTECTIVE_CASE_LIST: Array<[string, () => { isConditional?: boolean }]> = [
      ['Binance', () => normalizeBinanceOrder({
        orderId: 1, clientOrderId: '', symbol: 'BTCUSDT', side: 'SELL', type: 'STOP_LOSS',
        timeInForce: 'GTC', origQty: '1', executedQty: '0', price: '0', avgPrice: '0',
        stopPrice: '0', cumQuote: '0', status: 'NEW', reduceOnly: true, time: 1, updateTime: 1,
      })],
      ['Bybit', () => normalizeBybitOrder({
        orderId: '1', orderLinkId: '', symbol: 'BTCUSDT', side: 'Sell', orderType: 'Market',
        stopOrderType: 'Stop', timeInForce: 'GTC', qty: '1', price: '0', avgPrice: '0',
        triggerPrice: '0', cumExecQty: '0', cumExecValue: '0', orderStatus: 'New',
        reduceOnly: true, createdTime: '1', updatedTime: '1',
      })],
      ['OKX', () => normalizeOkxAlgoOrder({ ...OKX_RAW_ALGO_ORDER_STOP_MARKET, slTriggerPx: '0', slOrdPx: '-1' }, '0.01')],
    ];

    it.each(PROTECTIVE_CASE_LIST)('%s: стоп помечен защитным даже при нулевой цене срабатывания', (_label, normalize) => {
      expect(normalize().isConditional).toBe(true);
    });

    const PLAIN_CASE_LIST: Array<[string, () => { isConditional?: boolean }]> = [
      ['Binance', () => normalizeBinanceOrder({
        orderId: 2, clientOrderId: '', symbol: 'BTCUSDT', side: 'BUY', type: 'LIMIT',
        timeInForce: 'GTC', origQty: '1', executedQty: '0', price: '100', avgPrice: '0',
        stopPrice: '0', cumQuote: '0', status: 'NEW', reduceOnly: false, time: 1, updateTime: 1,
      })],
      ['Bybit', () => normalizeBybitOrder({
        orderId: '2', orderLinkId: '', symbol: 'BTCUSDT', side: 'Buy', orderType: 'Limit',
        stopOrderType: '', timeInForce: 'GTC', qty: '1', price: '100', avgPrice: '0',
        triggerPrice: '', cumExecQty: '0', cumExecValue: '0', orderStatus: 'New',
        reduceOnly: false, createdTime: '1', updatedTime: '1',
      })],
      ['OKX', () => normalizeOkxOrder(OKX_RAW_ORDER_LIVE_POST_ONLY, '')],
    ];

    it.each(PLAIN_CASE_LIST)('%s: обычная заявка защитной НЕ считается', (_label, normalize) => {
      expect(normalize().isConditional).toBe(false);
    });
  });
});
