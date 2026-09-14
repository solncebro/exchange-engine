import axios from 'axios';
import { BinanceFutures } from '../../src/exchanges/BinanceFutures';
import type { ExchangeLogger } from '../../src/types/common';
import { createMockLogger } from '../fixtures/mockLogger';
import { createMockAxiosInstance } from '../fixtures/mockAxios';

jest.mock('axios');
jest.mock('../../src/ws/BinanceTradeStream');
jest.mock('../../src/ws/BinanceFuturesPublicStream');
jest.mock('../../src/ws/BinanceUserDataStream');

const mockedAxios = axios as jest.Mocked<typeof axios>;

const PLAIN_ORDER_PATH = '/fapi/v1/order';
const ALGO_ORDER_PATH = '/fapi/v1/algoOrder';

function createFutures() {
  const mockInstance = createMockAxiosInstance();
  mockedAxios.create.mockReturnValue(mockInstance as any);
  const logger = createMockLogger();

  const client = new BinanceFutures({
    config: { apiKey: 'testKey', secret: 'testSecret', isDemoMode: false },
    logger,
  });

  return { client, mockInstance, logger };
}

function buildMissingOrderError(): unknown {
  return {
    isAxiosError: true,
    message: 'Request failed with status code 400',
    response: { status: 400, data: { code: -2013, msg: 'Order does not exist.' } },
  };
}

/** Отказ, который «заявки нет» не означает: упор в предел частоты. Ответ есть, повтора не будет. */
function buildRateLimitError(): unknown {
  return {
    isAxiosError: true,
    message: 'Request failed with status code 403',
    response: { status: 403, data: { code: -1003, msg: 'Too many requests; IP banned.' } },
  };
}

/** Обрыв связи в том виде, в каком его отдаёт транспорт: настоящая ошибка без ответа биржи. */
function buildConnectionDropError(): unknown {
  return Object.assign(new Error('socket hang up'), { isAxiosError: true });
}

function collectWarnTextList(logger: jest.Mocked<ExchangeLogger>): string[] {
  return logger.warn.mock.calls.map((call) => String(call[call.length - 1]));
}

function collectInfoTextList(logger: jest.Mocked<ExchangeLogger>): string[] {
  return logger.info.mock.calls.map((call) => String(call[call.length - 1]));
}

describe('BinanceFutures — a service that could not be asked is not "no such order"', () => {
  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(1700000000000);
  });

  describe('getOrder', () => {
    it('reports the conditional service failure instead of the plain book "order does not exist"', async () => {
      const { client, mockInstance } = createFutures();

      mockInstance.get.mockImplementation(async (url: string) => {
        if (url === ALGO_ORDER_PATH) {
          throw buildRateLimitError();
        }

        throw buildMissingOrderError();
      });

      // Ответить «заявки нет» здесь — значит сказать вызывающему, что защитная заявка снята,
      // тогда как её судьба неизвестна: условную службу просто не удалось спросить.
      await expect(client.getOrder('BTCUSDT', '999')).rejects.toThrow('[-1003] Too many requests; IP banned.');
    });

    it('writes both service reasons to the log so the dropped one is not lost', async () => {
      const { client, mockInstance, logger } = createFutures();

      mockInstance.get.mockImplementation(async (url: string) => {
        if (url === ALGO_ORDER_PATH) {
          throw buildRateLimitError();
        }

        throw buildMissingOrderError();
      });

      await expect(client.getOrder('BTCUSDT', '999')).rejects.toThrow();

      // Оба ответа записаны, но разными уровнями: ожидаемое «заявки нет» — сведения, отказ
      // службы, из-за которого судьба заявки неизвестна, — предупреждение.
      expect(collectInfoTextList(logger).some((text) => text.includes('reading order 999') && text.includes('-2013'))).toBe(true);
      expect(collectWarnTextList(logger).some((text) => text.includes('reading order 999') && text.includes('-1003'))).toBe(true);
      expect(collectWarnTextList(logger).some((text) => text.includes('-2013'))).toBe(false);
    });

    it('keeps the plain book answer when BOTH services say the order does not exist', async () => {
      const { client, mockInstance } = createFutures();

      mockInstance.get.mockImplementation(async () => {
        throw buildMissingOrderError();
      });

      await expect(client.getOrder('BTCUSDT', '999')).rejects.toThrow('[-2013] Order does not exist.');
    });

    it('says nothing alarming on the most ordinary path: both services answer that the order is gone', async () => {
      const { client, mockInstance, logger } = createFutures();

      mockInstance.get.mockImplementation(async () => {
        throw buildMissingOrderError();
      });

      await expect(client.getOrder('BTCUSDT', '999')).rejects.toThrow();

      expect(collectWarnTextList(logger)).toEqual([]);
      expect(collectInfoTextList(logger).filter((text) => text.includes('reading order 999'))).toHaveLength(2);
    });
  });

  describe('getOrderByClientOrderId', () => {
    it('reports the conditional service failure instead of the plain book "order does not exist"', async () => {
      const { client, mockInstance } = createFutures();

      mockInstance.get.mockImplementation(async (url: string) => {
        if (url === ALGO_ORDER_PATH) {
          throw buildRateLimitError();
        }

        throw buildMissingOrderError();
      });

      // Наша собственная пометка спрашивается в обеих службах. Ответить «заявки нет» здесь —
      // сказать вызывающему, что защитная заявка снята, хотя условную службу не удалось спросить.
      await expect(client.getOrderByClientOrderId('BTCUSDT', 'my-stop-1'))
        .rejects.toThrow('[-1003] Too many requests; IP banned.');
    });

    it('keeps the plain book answer when BOTH services say the order does not exist', async () => {
      const { client, mockInstance, logger } = createFutures();

      mockInstance.get.mockImplementation(async () => {
        throw buildMissingOrderError();
      });

      await expect(client.getOrderByClientOrderId('BTCUSDT', 'my-stop-1'))
        .rejects.toThrow('[-2013] Order does not exist.');
      expect(collectWarnTextList(logger)).toEqual([]);
    });

    it('writes the dropped service reason to the log as a warning and the expected answer as information', async () => {
      const { client, mockInstance, logger } = createFutures();

      mockInstance.get.mockImplementation(async (url: string) => {
        if (url === ALGO_ORDER_PATH) {
          throw buildRateLimitError();
        }

        throw buildMissingOrderError();
      });

      await expect(client.getOrderByClientOrderId('BTCUSDT', 'my-stop-1')).rejects.toThrow();

      expect(collectWarnTextList(logger).some(
        (text) => text.includes('reading order my-stop-1') && text.includes('-1003'),
      )).toBe(true);
      expect(collectInfoTextList(logger).some(
        (text) => text.includes('reading order my-stop-1') && text.includes('-2013'),
      )).toBe(true);
    });
  });

  describe('cancelOrder', () => {
    it('reports the conditional service connection drop instead of "order is already gone"', async () => {
      const { client, mockInstance, logger } = createFutures();

      mockInstance.delete.mockImplementation(async (url: string) => {
        if (url === ALGO_ORDER_PATH) {
          throw buildConnectionDropError();
        }

        throw buildMissingOrderError();
      });

      await expect(client.cancelOrder('BTCUSDT', '999')).rejects.toThrow('socket hang up');

      const warnTextList = collectWarnTextList(logger);

      expect(collectInfoTextList(logger).some((text) => text.includes('cancelling order 999') && text.includes('-2013'))).toBe(true);
      expect(warnTextList.some((text) => text.includes('cancelling order 999') && text.includes('socket hang up'))).toBe(true);
      expect(warnTextList.some((text) => text.includes('-2013'))).toBe(false);
    });

    it('keeps the original "order is already gone" answer when BOTH services say so', async () => {
      const { client, mockInstance } = createFutures();

      mockInstance.delete.mockImplementation(async () => {
        throw buildMissingOrderError();
      });

      await expect(client.cancelOrder('BTCUSDT', '999')).rejects.toThrow('[-2013] Order does not exist.');
      expect(mockInstance.delete.mock.calls.map(([url]: [string]) => url)).toEqual([
        PLAIN_ORDER_PATH,
        ALGO_ORDER_PATH,
      ]);
    });
  });
});
