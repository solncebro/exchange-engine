import axios from 'axios';
import { BinanceSpot } from '../../src/exchanges/BinanceSpot';
import { createMockLogger } from '../fixtures/mockLogger';
import { MarginMode } from '../../src/types/common';

jest.mock('axios');
jest.mock('../../src/ws/BinanceSpotPublicStream');

const mockedAxios = axios as jest.Mocked<typeof axios>;

function createClient() {
  const mockInstance: Record<string, jest.Mock> = {
    get: jest.fn().mockResolvedValue({ data: {} }),
    post: jest.fn().mockResolvedValue({ data: {} }),
    put: jest.fn().mockResolvedValue({ data: {} }),
    delete: jest.fn().mockResolvedValue({ data: {} }),
  };
  mockedAxios.create.mockReturnValue(mockInstance as any);

  const client = new BinanceSpot({
    config: { apiKey: 'testKey', secret: 'testSecret' },
    logger: createMockLogger(),
  });

  return { client, mockInstance };
}

describe('BinanceSpot', () => {
  it('throws "Not supported" for fetchFundingRateHistory', async () => {
    const { client } = createClient();

    await expect(client.fetchFundingRateHistory()).rejects.toThrow('Not supported for spot market');
  });

  it('throws "Not supported" for fetchPosition', async () => {
    const { client } = createClient();

    await expect(client.fetchPosition('BTCUSDT')).rejects.toThrow('Not supported for spot market');
  });

  it('throws "Not supported" for setLeverage', async () => {
    const { client } = createClient();

    await expect(client.setLeverage(10, 'BTCUSDT')).rejects.toThrow('Not supported for spot market');
  });

  it('throws "Not supported" for setMarginMode', async () => {
    const { client } = createClient();

    await expect(client.setMarginMode(MarginMode.Isolated, 'BTCUSDT')).rejects.toThrow('Not supported for spot market');
  });
});
