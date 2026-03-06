import axios from 'axios';
import { BaseHttpClient } from '../../src/http/BaseHttpClient';
import { createMockLogger } from '../fixtures/mockLogger';

const actualAxios = jest.requireActual<typeof import('axios')>('axios');
const { AxiosError, AxiosHeaders } = actualAxios;

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

class TestHttpClient extends BaseHttpClient {
  testGet<T>(url: string, params?: Record<string, string | number | boolean>, headers?: Record<string, string>) {
    return this.get<T>(url, params, headers);
  }

  testPost<T>(url: string, data?: Record<string, unknown>, headers?: Record<string, string>) {
    return this.post<T>(url, data, headers);
  }

  testPostWithParams<T>(url: string, params?: Record<string, string | number | boolean>, headers?: Record<string, string>) {
    return this.postWithParams<T>(url, params, headers);
  }

  testPut<T>(url: string, data?: Record<string, unknown>, headers?: Record<string, string>) {
    return this.put<T>(url, data, headers);
  }

  testPutWithParams<T>(url: string, params?: Record<string, string | number | boolean>, headers?: Record<string, string>) {
    return this.putWithParams<T>(url, params, headers);
  }

  testDelete<T>(url: string, params?: Record<string, string | number | boolean>, headers?: Record<string, string>) {
    return this.delete<T>(url, params, headers);
  }
}

function createMockAxiosInstance() {
  return {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
    patch: jest.fn(),
    head: jest.fn(),
    options: jest.fn(),
    request: jest.fn(),
    getUri: jest.fn(),
    defaults: { headers: { common: {} } },
    interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } },
  } as unknown as jest.Mocked<ReturnType<typeof axios.create>>;
}

function createAxiosError(status: number, headers: Record<string, string> = {}) {
  const axiosHeaders = new AxiosHeaders(headers);

  return new AxiosError('Request failed', 'ERR_BAD_REQUEST', undefined, {}, {
    status,
    data: { code: -1, msg: 'error' },
    statusText: 'Error',
    headers: axiosHeaders,
    config: { headers: axiosHeaders },
  } as any);
}

function createNetworkError() {
  const error = new AxiosError('Network Error', 'ERR_NETWORK');
  error.request = {};

  return error;
}

describe('BaseHttpClient', () => {
  let client: TestHttpClient;
  let mockInstance: jest.Mocked<ReturnType<typeof axios.create>>;
  let logger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    logger = createMockLogger();
    mockInstance = createMockAxiosInstance();
    mockedAxios.create.mockReturnValue(mockInstance);
    client = new TestHttpClient({ baseUrl: 'https://api.test.com', apiKey: 'key', logger });
  });

  describe('get', () => {
    it('returns response.data on success', async () => {
      mockInstance.get.mockResolvedValue({ data: { result: 'ok' } });

      const result = await client.testGet('/test');

      expect(result).toEqual({ result: 'ok' });
    });

    it('passes params and headers', async () => {
      mockInstance.get.mockResolvedValue({ data: 'ok' });

      await client.testGet('/test', { symbol: 'BTCUSDT' }, { 'X-Key': 'val' });

      expect(mockInstance.get).toHaveBeenCalledWith('/test', {
        params: { symbol: 'BTCUSDT' },
        headers: { 'X-Key': 'val' },
      });
    });

    it('retries on 429 with retry-after header', async () => {
      jest.useFakeTimers();

      const error429 = createAxiosError(429, { 'retry-after': '2' });
      mockInstance.get
        .mockRejectedValueOnce(error429)
        .mockResolvedValueOnce({ data: 'ok' });

      const promise = client.testGet('/test');
      await jest.advanceTimersByTimeAsync(2000);
      const result = await promise;

      expect(result).toBe('ok');
      expect(mockInstance.get).toHaveBeenCalledTimes(2);

      jest.useRealTimers();
    });

    it('retries on 500 with exponential backoff', async () => {
      jest.useFakeTimers();

      const error500 = createAxiosError(500);
      mockInstance.get
        .mockRejectedValueOnce(error500)
        .mockResolvedValueOnce({ data: 'ok' });

      const promise = client.testGet('/test');
      await jest.advanceTimersByTimeAsync(1000);
      const result = await promise;

      expect(result).toBe('ok');
      expect(mockInstance.get).toHaveBeenCalledTimes(2);

      jest.useRealTimers();
    });

    it('does not retry on 400', async () => {
      const error400 = createAxiosError(400);
      mockInstance.get.mockRejectedValue(error400);

      await expect(client.testGet('/test')).rejects.toThrow();
      expect(mockInstance.get).toHaveBeenCalledTimes(1);
    });

    it('throws after MAX_RETRIES exhausted', async () => {
      const error500 = createAxiosError(500);
      mockInstance.get.mockRejectedValue(error500);

      // Mock setTimeout to resolve immediately to avoid real delays
      jest.spyOn(global, 'setTimeout').mockImplementation(((fn: () => void) => {
        fn();
        return 0 as unknown as NodeJS.Timeout;
      }) as typeof setTimeout);

      await expect(client.testGet('/test')).rejects.toThrow();
      expect(mockInstance.get).toHaveBeenCalledTimes(4);

      (global.setTimeout as unknown as jest.SpyInstance).mockRestore();
    });

    it('retries on network error (no response)', async () => {
      jest.useFakeTimers();

      const networkError = createNetworkError();
      mockInstance.get
        .mockRejectedValueOnce(networkError)
        .mockResolvedValueOnce({ data: 'ok' });

      const promise = client.testGet('/test');
      await jest.advanceTimersByTimeAsync(1000);
      const result = await promise;

      expect(result).toBe('ok');

      jest.useRealTimers();
    });
  });

  describe('post', () => {
    it('returns response.data on success', async () => {
      mockInstance.post.mockResolvedValue({ data: { id: 1 } });

      const result = await client.testPost('/test', { symbol: 'BTCUSDT' });

      expect(result).toEqual({ id: 1 });
    });

    it('does not retry on error', async () => {
      mockInstance.post.mockRejectedValue(createAxiosError(500));

      await expect(client.testPost('/test')).rejects.toThrow();
      expect(mockInstance.post).toHaveBeenCalledTimes(1);
    });
  });

  describe('postWithParams', () => {
    it('sends params as query, not body', async () => {
      mockInstance.post.mockResolvedValue({ data: 'ok' });

      await client.testPostWithParams('/test', { symbol: 'BTCUSDT' }, { 'X-Key': 'val' });

      expect(mockInstance.post).toHaveBeenCalledWith('/test', null, {
        params: { symbol: 'BTCUSDT' },
        headers: { 'X-Key': 'val' },
      });
    });

    it('does not retry on error', async () => {
      mockInstance.post.mockRejectedValue(createAxiosError(500));

      await expect(client.testPostWithParams('/test')).rejects.toThrow();
      expect(mockInstance.post).toHaveBeenCalledTimes(1);
    });
  });

  describe('put', () => {
    it('returns response.data on success', async () => {
      mockInstance.put.mockResolvedValue({ data: 'updated' });

      const result = await client.testPut('/test', { key: 'val' });

      expect(result).toBe('updated');
    });

    it('does not retry on error', async () => {
      mockInstance.put.mockRejectedValue(createAxiosError(500));

      await expect(client.testPut('/test')).rejects.toThrow();
      expect(mockInstance.put).toHaveBeenCalledTimes(1);
    });
  });

  describe('putWithParams', () => {
    it('sends params as query, not body', async () => {
      mockInstance.put.mockResolvedValue({ data: 'ok' });

      await client.testPutWithParams('/test', { symbol: 'BTCUSDT' }, { 'X-Key': 'val' });

      expect(mockInstance.put).toHaveBeenCalledWith('/test', null, {
        params: { symbol: 'BTCUSDT' },
        headers: { 'X-Key': 'val' },
      });
    });

    it('does not retry on error', async () => {
      mockInstance.put.mockRejectedValue(createAxiosError(500));

      await expect(client.testPutWithParams('/test')).rejects.toThrow();
      expect(mockInstance.put).toHaveBeenCalledTimes(1);
    });
  });

  describe('delete', () => {
    it('returns response.data on success', async () => {
      mockInstance.delete.mockResolvedValue({ data: 'deleted' });

      const result = await client.testDelete('/test', { id: 1 });

      expect(result).toBe('deleted');
    });

    it('does not retry on error', async () => {
      mockInstance.delete.mockRejectedValue(createAxiosError(500));

      await expect(client.testDelete('/test')).rejects.toThrow();
      expect(mockInstance.delete).toHaveBeenCalledTimes(1);
    });
  });

  describe('error logging', () => {
    it('logs HTTP status on response error', async () => {
      mockInstance.post.mockRejectedValue(createAxiosError(400));

      await expect(client.testPost('/test')).rejects.toThrow();
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('HTTP 400'));
    });

    it('logs "No response" on network error', async () => {
      const networkError = createNetworkError();
      mockInstance.post.mockRejectedValue(networkError);

      await expect(client.testPost('/test')).rejects.toThrow();
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('No response'));
    });

    it('logs "Request error" on setup error', async () => {
      const error = new AxiosError('Bad config', 'ERR_INVALID');
      mockInstance.post.mockRejectedValue(error);

      await expect(client.testPost('/test')).rejects.toThrow();
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Request error'));
    });
  });
});
