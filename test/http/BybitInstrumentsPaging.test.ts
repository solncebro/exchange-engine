import axios from 'axios';
import { BybitHttpClient } from '../../src/http/BybitHttpClient';
import { BYBIT_INSTRUMENTS_MAX_PAGE_COUNT } from '../../src/constants/bybit';
import type { ExchangeLogger } from '../../src/types/common';
import { createMockLogger } from '../fixtures/mockLogger';
import { createMockAxiosInstance } from '../fixtures/mockAxios';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('BybitHttpClient — walking the instrument pages has a ceiling', () => {
  let client: BybitHttpClient;
  let mockInstance: Record<string, jest.Mock>;
  let logger: jest.Mocked<ExchangeLogger>;

  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(1700000000000);

    mockInstance = createMockAxiosInstance();
    mockedAxios.create.mockReturnValue(mockInstance as any);
    logger = createMockLogger();

    client = new BybitHttpClient({
      baseUrl: 'https://api.bybit.com',
      apiKey: 'testKey',
      secret: 'testSecret',
      logger,
    });
  });

  it('stops at the page ceiling instead of following an endless cursor', async () => {
    // Курсор, который биржа отдаёт бесконечно: без потолка цикл не закончится никогда.
    mockInstance.get.mockResolvedValue({
      data: { retCode: 0, result: { list: [{ symbol: 'BTCUSDT' }], nextPageCursor: 'more' } },
    });

    const result = await client.fetchAllInstrumentsInfo('spot');

    expect(mockInstance.get).toHaveBeenCalledTimes(BYBIT_INSTRUMENTS_MAX_PAGE_COUNT);
    expect(result).toHaveLength(BYBIT_INSTRUMENTS_MAX_PAGE_COUNT);
  });

  it('says out loud that the returned instrument list is partial', async () => {
    mockInstance.get.mockResolvedValue({
      data: { retCode: 0, result: { list: [{ symbol: 'BTCUSDT' }], nextPageCursor: 'more' } },
    });

    await client.fetchAllInstrumentsInfo('spot');

    const warnTextList = logger.warn.mock.calls.map((call) => String(call[call.length - 1]));

    expect(warnTextList.some((text) => text.includes('page count limit') && text.includes('partial'))).toBe(true);
  });

  it('keeps walking every real page and stays silent when the cursor runs out', async () => {
    mockInstance.get
      .mockResolvedValueOnce({
        data: { retCode: 0, result: { list: [{ symbol: 'BTCUSDT' }], nextPageCursor: 'second' } },
      })
      .mockResolvedValueOnce({
        data: { retCode: 0, result: { list: [{ symbol: 'ETHUSDT' }], nextPageCursor: '' } },
      });

    const result = await client.fetchAllInstrumentsInfo('spot');

    expect(mockInstance.get).toHaveBeenCalledTimes(2);
    expect(result.map((instrument) => instrument.symbol)).toEqual(['BTCUSDT', 'ETHUSDT']);
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
