import type {
  BinanceExchangeInfoRaw,
  BinanceTicker24hrRaw,
  BinanceOrderResponseRaw,
  BinanceAccountRaw,
  BinanceOrderBookRaw,
  BinancePublicTradeRaw,
} from '../normalizers/binanceNormalizer';
import type { FetchPageWithLimitArgs } from '../types/exchange';
import { buildBinanceSignedParams, buildBinanceAuthHeaders } from '../auth/binanceAuth';
import { ExchangeError } from '../errors/ExchangeError';
import { applyTimeRangeOptions } from '../utils/httpParams';
import { BaseHttpClient } from './BaseHttpClient';
import { isBinanceStaleTimestampError } from './binanceTimestampError';
import { getBinanceRequestGate } from './binanceRequestGate';
import type { BinanceRequestGate } from './binanceRequestGate';
import type { ExchangeRateLimitState } from '../types/common';
import type {
  BinanceEndpoints,
  BinanceErrorResponse,
  BinanceHttpClientArgs,
  BinanceListenKeyResponse,
  SignRequestResult,
} from './BinanceBaseHttpClient.types';

/**
 * Сколько раз запрос собирается заново, если биржа отвергла отметку времени. Двух хватает: повтор
 * идёт с только что поставленной отметкой, и не пройти он может лишь если процесс снова встал на те
 * же секунды — тогда честнее отдать отказ вызывающему, чем молотить бесконечно.
 */
const STALE_TIMESTAMP_ATTEMPT_LIMIT = 2;

abstract class BinanceBaseHttpClient extends BaseHttpClient {
  protected readonly secret: string;
  protected abstract readonly endpoints: BinanceEndpoints;
  /** Память о лимитах — ОБЩАЯ на адрес, а не на экземпляр клиента: биржа считает их по адресу. */
  private readonly requestGate: BinanceRequestGate;

  constructor(args: BinanceHttpClientArgs, timeout: number) {
    super({ baseUrl: args.baseUrl, apiKey: args.apiKey, logger: args.logger, timeout, httpsAgent: args.httpsAgent });
    this.secret = args.secret;
    this.requestGate = getBinanceRequestGate(args.baseUrl);
  }

  protected override async beforeRequest(): Promise<void> {
    await this.requestGate.waitForTurn(this.logger);
  }

  protected override onResponse(status: number | undefined, headers: unknown, body?: unknown): void {
    this.requestGate.observe({ status, headers, body, logger: this.logger });
  }

  /** Сколько веса израсходовано на адресе и до какого момента дверь закрыта (для вызывающего). */
  getRateLimitState(): ExchangeRateLimitState {
    return this.requestGate.readState();
  }

  protected async signedGet<T>(
    path: string,
    params: Record<string, string | number | boolean> = {},
  ): Promise<T> {
    // Подпись едет фабрикой: транспорт строит её сам перед каждой отправкой, в том числе перед
    // повтором после паузы — старая отметка времени в повторе гарантированно не прошла бы.
    return this.signedRequest(() => this.get<T>(path, () => this.signRequest(params).signedParams, this.authHeaders()));
  }

  protected async signedPost<T>(
    path: string,
    params: Record<string, string | number | boolean> = {},
  ): Promise<T> {
    return this.signedSend(params, (signedParams, headers) => this.postWithParams<T>(path, signedParams, headers));
  }

  protected async signedPut<T>(
    path: string,
    params: Record<string, string | number | boolean> = {},
  ): Promise<T> {
    return this.signedSend(params, (signedParams, headers) => this.putWithParams<T>(path, signedParams, headers));
  }

  protected async signedDelete<T>(
    path: string,
    params: Record<string, string | number | boolean> = {},
  ): Promise<T> {
    return this.signedSend(params, (signedParams, headers) => this.delete<T>(path, signedParams, headers));
  }

  /** Пути без повторов внутри транспорта: подпись ставится здесь и тут же уходит в сеть. */
  private signedSend<T>(
    params: Record<string, string | number | boolean>,
    send: (
      signedParams: Record<string, string | number | boolean>,
      headers: Record<string, string>,
    ) => Promise<T>,
  ): Promise<T> {
    return this.signedRequest(() => {
      const { signedParams, headers } = this.signRequest(params);

      return send(signedParams, headers);
    });
  }

  /**
   * Подписанный запрос с одной пересдачей, если биржа отвергла отметку времени.
   *
   * Отметка стареет между сборкой запроса и его приёмом на бирже, а меряет биржа возраст именно на
   * приёме: на боевом сервере rubber это дало восемь отказов за журнал — три на чтении заявки
   * обратно после постановки (читалось как «заявка не встала») и один похоронил биржевую половину
   * суточного отчёта (18.08.2026). Повтор осмыслен только потому, что подпись строится заново; та же
   * подпись со старой отметкой была бы отвергнута снова.
   */
  private async signedRequest<T>(send: () => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        const response = await send();

        this.validateResponse(response);

        return response;
      } catch (error) {
        if (attempt >= STALE_TIMESTAMP_ATTEMPT_LIMIT || !isBinanceStaleTimestampError(error)) {
          throw error;
        }

        this.logger.warn(`Binance rejected a stale timestamp; re-signing and retrying (attempt ${attempt + 1}/${STALE_TIMESTAMP_ATTEMPT_LIMIT})`);
      }
    }
  }

  private validateResponse(response: unknown): void {
    if (response && typeof response === 'object' && 'code' in response) {
      const { code, msg } = response as BinanceErrorResponse;

      if (code < 0) {
        throw new ExchangeError(`Binance API error ${code}: ${msg}`, code, 'binance');
      }
    }
  }

  private signRequest(params: Record<string, string | number | boolean>): SignRequestResult {
    return {
      signedParams: buildBinanceSignedParams({ params, secret: this.secret }) as Record<string, string | number | boolean>,
      headers: buildBinanceAuthHeaders(this.apiKey),
    };
  }

  protected authHeaders(): Record<string, string> {
    return buildBinanceAuthHeaders(this.apiKey);
  }

  protected buildOptionalSymbolParams(
    symbol?: string,
  ): Record<string, string | number | boolean> {
    const params: Record<string, string | number | boolean> = {};

    if (symbol !== undefined) {
      params.symbol = symbol;
    }

    return params;
  }

  async fetchExchangeInfo(): Promise<BinanceExchangeInfoRaw> {
    return this.get<BinanceExchangeInfoRaw>(this.endpoints.exchangeInfo);
  }

  async fetchTickers(): Promise<BinanceTicker24hrRaw[]> {
    return this.get<BinanceTicker24hrRaw[]>(this.endpoints.ticker24hr);
  }

  async fetchOrderBook(symbol: string, limit?: number): Promise<BinanceOrderBookRaw> {
    const params: Record<string, string | number | boolean> = { symbol };

    if (limit !== undefined) {
      params.limit = limit;
    }

    return this.get<BinanceOrderBookRaw>(this.endpoints.depth, params);
  }

  async fetchKlines(
    symbol: string,
    interval: string,
    options?: FetchPageWithLimitArgs,
  ): Promise<unknown[][]> {
    const params: Record<string, string | number | boolean> = { symbol, interval };
    applyTimeRangeOptions(params, options);

    return this.get<unknown[][]>(this.endpoints.klines, params);
  }

  async fetchTrades(symbol: string, limit?: number): Promise<BinancePublicTradeRaw[]> {
    const params: Record<string, string | number | boolean> = { symbol };

    if (limit !== undefined) {
      params.limit = limit;
    }

    return this.get<BinancePublicTradeRaw[]>(this.endpoints.trades, params);
  }

  async createOrder(params: Record<string, unknown>): Promise<BinanceOrderResponseRaw> {
    return this.signedPost<BinanceOrderResponseRaw>(
      this.endpoints.order,
      params as Record<string, string | number | boolean>,
    );
  }

  async cancelOrder(symbol: string, orderId: string): Promise<BinanceOrderResponseRaw> {
    return this.signedDelete<BinanceOrderResponseRaw>(this.endpoints.order, { symbol, orderId });
  }

  async getOrder(symbol: string, orderId: string): Promise<BinanceOrderResponseRaw> {
    return this.signedGet<BinanceOrderResponseRaw>(this.endpoints.order, { symbol, orderId });
  }

  async getOrderByClientOrderId(symbol: string, clientOrderId: string): Promise<BinanceOrderResponseRaw> {
    return this.signedGet<BinanceOrderResponseRaw>(this.endpoints.order, { symbol, origClientOrderId: clientOrderId });
  }

  async getOpenOrders(symbol?: string): Promise<BinanceOrderResponseRaw[]> {
    return this.signedGet<BinanceOrderResponseRaw[]>(this.endpoints.openOrders, this.buildOptionalSymbolParams(symbol));
  }

  async getAllOrders(
    symbol: string,
    options?: FetchPageWithLimitArgs,
  ): Promise<BinanceOrderResponseRaw[]> {
    const params: Record<string, string | number | boolean> = { symbol };
    applyTimeRangeOptions(params, options);

    return this.signedGet<BinanceOrderResponseRaw[]>(this.endpoints.allOrders, params);
  }

  async fetchAccount(): Promise<BinanceAccountRaw> {
    return this.signedGet<BinanceAccountRaw>(this.endpoints.account);
  }

  async createListenKey(): Promise<BinanceListenKeyResponse> {
    return this.post<BinanceListenKeyResponse>(this.endpoints.listenKey, {}, this.authHeaders());
  }

  async keepAliveListenKey(listenKey: string): Promise<void> {
    await this.put<unknown>(this.endpoints.listenKey, { listenKey }, this.authHeaders());
  }

  async deleteListenKey(listenKey: string): Promise<void> {
    await this.delete<unknown>(
      this.endpoints.listenKey,
      { listenKey } as Record<string, string | number | boolean>,
      this.authHeaders(),
    );
  }
}

export { BinanceBaseHttpClient };
export type { BinanceHttpClientArgs, BinanceEndpoints, BinanceListenKeyResponse } from './BinanceBaseHttpClient.types';
