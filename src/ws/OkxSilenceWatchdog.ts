import { OKX_STALE_CHECK_INTERVAL_MS } from '../constants/okx';
import type { OkxSilenceWatchdogArgs } from './OkxSilenceWatchdog.types';

/**
 * Сторож тишины ПО ДАННЫМ, а не по сокету. Молчание самого сокета — дело движка: он шлёт проверку
 * живости и рвёт соединение, когда не приходит ни одного кадра, включая ответ на проверку. Здесь
 * отслеживается другое: соединение отвечает, служебные кадры идут, а рыночных данных по подпискам
 * нет. Лечится это переподпиской на живом сокете, а не разрывом, — и порог у отметки данных свой:
 * биржа сама подпирает молчащую подписку служебным обновлением примерно раз в минуту, поэтому на
 * пороге «сокет не отвечает» здоровое соединение переподписывалось бы каждую минуту без повода.
 *
 * Нужен только публичному потоку: торговый канал и канал заявок данных по договору не шлют, и
 * молчание там нарушением не является.
 */
class OkxSilenceWatchdog {
  private readonly silentThresholdMs: number;
  private readonly onSilent: () => void;
  private lastContentMessageTimestamp = Date.now();
  private checkTimerId: ReturnType<typeof setInterval> | undefined;

  constructor(args: OkxSilenceWatchdogArgs) {
    this.silentThresholdMs = args.silentThresholdMs;
    this.onSilent = args.onSilent;
  }

  start(): void {
    this.stop();

    this.lastContentMessageTimestamp = Date.now();
    this.checkTimerId = setInterval(() => this.checkSilence(), OKX_STALE_CHECK_INTERVAL_MS);
    this.checkTimerId.unref?.();
  }

  noteContentMessage(): void {
    this.lastContentMessageTimestamp = Date.now();
  }

  stop(): void {
    if (this.checkTimerId !== undefined) {
      clearInterval(this.checkTimerId);
      this.checkTimerId = undefined;
    }
  }

  private checkSilence(): void {
    const now = Date.now();
    const contentIdleMs = now - this.lastContentMessageTimestamp;

    if (contentIdleMs <= this.silentThresholdMs) {
      return;
    }

    this.lastContentMessageTimestamp = now;
    this.onSilent();
  }
}

export { OkxSilenceWatchdog };
