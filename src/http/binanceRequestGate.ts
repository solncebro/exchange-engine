import { ExchangeError } from '../errors/ExchangeError';
import type { ExchangeLogger, ExchangeRateLimitState } from '../types/common';
import { sleep } from '../utils/sleep';
import {
  BINANCE_BAN_MAX_WAIT_MS,
  BINANCE_BAN_RELEASE_SPACING_MS,
  BINANCE_REQUEST_WEIGHT_LIMIT_PER_MIN,
  observeRateLimitResponse,
} from './binanceRateLimit';

/** Код биржи, которым она отвечает на перебор запросов; им же помечается наш отказ без отправки. */
const BINANCE_TOO_MANY_REQUESTS_CODE = -1003;
/** Чаще этого о подходе к потолку веса в журнал не пишем — иначе строка на каждый ответ. */
const THROTTLE_LOG_WINDOW_MS = 60_000;

export interface BinanceRequestGateObservation {
  status: number | undefined;
  headers: unknown;
  body: unknown;
  /** Журнал того клиента, который получил ответ: сторож общий, а голос у него не свой. */
  logger: ExchangeLogger;
}

/**
 * Общая на процесс память о том, закрыта ли дверь биржи и насколько израсходован вес.
 *
 * Общая — потому что счётчик веса и запрет биржа держит НА АДРЕС, а подключений в процессе больше
 * одного (рыночные данные и ордера — свои коннекторы). Пока память жила в экземпляре клиента,
 * запрет, увиденный одним, второго не останавливал.
 */
class BinanceRequestGate {
  private bannedUntilMs = 0;
  private throttledUntilMs = 0;
  private usedWeight: number | null = null;
  private observedAtMs: number | null = null;
  /** Цепочка ожидающих: пока дверь закрыта, наружу выпускают по одному, а не всех разом. */
  private releaseTail: Promise<void> = Promise.resolve();
  private lastReleaseAtMs = 0;
  private isBanAnnounced = false;
  private lastThrottleLogAtMs = 0;

  /**
   * Пропустить запрос. Открытая дверь не стоит ничего — ни очереди, ни задержки; закрытая ставит
   * вызывающего в цепочку и усыпляет до настоящего срока снятия. Срок дальше потолка ожидания —
   * отказ без отправки: спать полдня бессмысленно, а дата снятия нужна оператору, а не журналу.
   */
  async waitForTurn(logger: ExchangeLogger): Promise<void> {
    if (this.stoppedUntilMs() <= Date.now()) {
      this.announceBanLifted(logger);

      return;
    }

    const turn = this.releaseTail.then(() => this.waitOutStop(logger));
    this.releaseTail = turn.then(
      () => undefined,
      () => undefined,
    );

    await turn;
  }

  observe(observation: BinanceRequestGateObservation): void {
    const nowMs = Date.now();
    const { usedWeight, banUntilMs, throttleUntilMs } = observeRateLimitResponse({ ...observation, nowMs });

    if (usedWeight !== undefined) {
      this.usedWeight = usedWeight;
      this.observedAtMs = nowMs;
    }

    if (banUntilMs !== undefined && banUntilMs > this.bannedUntilMs) {
      this.bannedUntilMs = banUntilMs;
      this.announceBan(observation.logger, observation.status, banUntilMs - nowMs);
    }

    if (throttleUntilMs !== undefined && throttleUntilMs > this.throttledUntilMs) {
      this.throttledUntilMs = throttleUntilMs;

      if (nowMs - this.lastThrottleLogAtMs >= THROTTLE_LOG_WINDOW_MS) {
        this.lastThrottleLogAtMs = nowMs;
        observation.logger.warn(
          `Binance REQUEST_WEIGHT near cap (used ${usedWeight}/${BINANCE_REQUEST_WEIGHT_LIMIT_PER_MIN} per min) — pausing requests`,
        );
      }
    }
  }

  readState(): ExchangeRateLimitState {
    const nowMs = Date.now();

    return {
      usedWeight: this.usedWeight,
      weightLimit: BINANCE_REQUEST_WEIGHT_LIMIT_PER_MIN,
      observedAtMs: this.observedAtMs,
      bannedUntilMs: this.bannedUntilMs > nowMs ? this.bannedUntilMs : null,
    };
  }

  private stoppedUntilMs(): number {
    return Math.max(this.bannedUntilMs, this.throttledUntilMs);
  }

  private async waitOutStop(logger: ExchangeLogger): Promise<void> {
    const giveUpAtMs = Date.now() + BINANCE_BAN_MAX_WAIT_MS;

    for (;;) {
      const nowMs = Date.now();
      const untilMs = Math.max(this.stoppedUntilMs(), this.lastReleaseAtMs + BINANCE_BAN_RELEASE_SPACING_MS);

      if (untilMs <= nowMs) {
        this.lastReleaseAtMs = nowMs;
        this.announceBanLifted(logger);

        return;
      }

      if (untilMs > giveUpAtMs) {
        throw new ExchangeError(
          `Binance closed this address until ${new Date(this.bannedUntilMs).toISOString()} — the request was not sent`,
          BINANCE_TOO_MANY_REQUESTS_CODE,
          'binance',
        );
      }

      await sleep(untilMs - nowMs);
    }
  }

  /** О запрете говорим ровно один раз — со сроком, а не строкой на каждую попытку. */
  private announceBan(logger: ExchangeLogger, status: number | undefined, waitMs: number): void {
    this.isBanAnnounced = true;
    logger.error(
      `Binance refused the address (HTTP ${status ?? 'n/a'}) until ${new Date(this.bannedUntilMs).toISOString()} — holding every request for ${Math.round(waitMs / 1000)}s`,
    );
  }

  private announceBanLifted(logger: ExchangeLogger): void {
    if (!this.isBanAnnounced || this.bannedUntilMs > Date.now()) {
      return;
    }

    this.isBanAnnounced = false;
    logger.warn('Binance lifted the refusal — requests are going out again');
  }
}

const gateByHost = new Map<string, BinanceRequestGate>();

/**
 * Сторож на адрес биржи. Ключ — хост, потому что и вес, и запрет биржа считает по нему: у
 * фьючерсного и спотового входов свои потолки, а все подключения одного процесса к одному хосту
 * делят и счётчик, и закрытую дверь.
 */
export function getBinanceRequestGate(baseUrl: string): BinanceRequestGate {
  const host = ((): string => {
    try {
      return new URL(baseUrl).host;
    } catch {
      return baseUrl;
    }
  })();

  const existing = gateByHost.get(host);

  if (existing !== undefined) {
    return existing;
  }

  const created = new BinanceRequestGate();
  gateByHost.set(host, created);

  return created;
}

/** Только для тестов: сторож живёт весь процесс, а тестам нужна чистая память. */
export function resetBinanceRequestGateRegistry(): void {
  gateByHost.clear();
}

export type { BinanceRequestGate };
