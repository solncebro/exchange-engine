import axios from 'axios';
import { BinanceFutures } from '../../src/exchanges/BinanceFutures';
import { createMockLogger } from '../fixtures/mockLogger';
import { BINANCE_RAW_POSITION_RISK } from '../fixtures/binanceRaw';
import { MarginMode, PositionSide } from '../../src/types/common';

jest.mock('axios');
jest.mock('../../src/ws/BinanceFuturesPublicStream');

const mockedAxios = axios as jest.Mocked<typeof axios>;

function createClient(isDemoMode = false) {
  const mockInstance: Record<string, jest.Mock> = {
    get: jest.fn().mockResolvedValue({ data: {} }),
    post: jest.fn().mockResolvedValue({ data: {} }),
    put: jest.fn().mockResolvedValue({ data: {} }),
    delete: jest.fn().mockResolvedValue({ data: {} }),
  };
  mockedAxios.create.mockReturnValue(mockInstance as any);

  const client = new BinanceFutures({
    config: { apiKey: 'testKey', secret: 'testSecret', isDemoMode },
    logger: createMockLogger(),
  });

  return { client, mockInstance };
}

describe('BinanceFutures', () => {
  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(1700000000000);
  });

  it('uses production URL by default', () => {
    createClient(false);

    expect(mockedAxios.create).toHaveBeenCalledWith(
      expect.objectContaining({ baseURL: 'https://fapi.binance.com' }),
    );
  });

  it('uses demo URL when isDemoMode is true', () => {
    createClient(true);

    expect(mockedAxios.create).toHaveBeenCalledWith(
      expect.objectContaining({ baseURL: 'https://demo-fapi.binance.com' }),
    );
  });

  describe('fetchPosition', () => {
    it('normalizes position from raw data', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({ data: [BINANCE_RAW_POSITION_RISK] });

      const position = await client.fetchPosition('BTCUSDT');

      expect(position.symbol).toBe('BTCUSDT');
      expect(position.side).toBe(PositionSide.Long);
      expect(position.contracts).toBe(0.1);
    });

    it('throws when symbol not found in response', async () => {
      const { client, mockInstance } = createClient();
      mockInstance.get.mockResolvedValue({ data: [] });

      await expect(client.fetchPosition('BTCUSDT')).rejects.toThrow('Position not found for BTCUSDT');
    });
  });

  describe('setLeverage', () => {
    it('calls httpClient.setLeverage with symbol and leverage', async () => {
      const { client, mockInstance } = createClient();

      await client.setLeverage(20, 'BTCUSDT');

      const [url, , options] = mockInstance.post.mock.calls[0];

      expect(url).toBe('/fapi/v1/leverage');
      expect(options.params.symbol).toBe('BTCUSDT');
      expect(options.params.leverage).toBe(20);
    });
  });

  describe('setMarginMode', () => {
    it('maps isolated to ISOLATED', async () => {
      const { client, mockInstance } = createClient();

      await client.setMarginMode(MarginMode.Isolated, 'BTCUSDT');

      const [, , options] = mockInstance.post.mock.calls[0];

      expect(options.params.marginType).toBe('ISOLATED');
    });

    it('maps cross to CROSSED', async () => {
      const { client, mockInstance } = createClient();

      await client.setMarginMode(MarginMode.Cross, 'BTCUSDT');

      const [, , options] = mockInstance.post.mock.calls[0];

      expect(options.params.marginType).toBe('CROSSED');
    });
  });
});
