export const BINANCE_REQUEST_WEIGHT_LIMIT_PER_MIN = 2400;
export const BINANCE_WEIGHT_THROTTLE_RATIO = 0.8;
export const BINANCE_WEIGHT_NEAR_CAP_COOLDOWN_MS = 2000;
/** Сколько ждать, когда биржа закрыла доступ, но срока не назвала ни заголовком, ни текстом. */
export const BINANCE_BAN_DEFAULT_COOLDOWN_MS = 30000;
/**
 * Дольше этого запрос не спит. Настоящие запреты биржи держатся минуты (06.09.2026 — восемь), и
 * потолок в четверть часа покрывает их с запасом; названный срок сверх него означает наказание на
 * часы или сутки — там честнее сразу отдать отказ с датой снятия, чем молча спать полдня.
 *
 * Прежняя обрезка ЛЮБОГО срока до минуты (BINANCE_BAN_MAX_COOLDOWN_MS) стоила инцидента: биржа
 * просила ждать восемь минут, клиент ждал одну и стучался снова — 252 попытки в закрытую дверь,
 * а такие попытки запрет по правилам биржи продлевают.
 */
export const BINANCE_BAN_MAX_WAIT_MS = 15 * 60 * 1000;
/**
 * Шаг, с которым накопившиеся за время запрета ожидания выпускаются наружу. За восемь минут их
 * набираются десятки (одни только сверки идут раз в 15 секунд), и выпуск разом дал бы в первый же
 * миг после снятия ровно тот залп, за который запрет и выдали.
 */
export const BINANCE_BAN_RELEASE_SPACING_MS = 250;

const USED_WEIGHT_HEADER = 'x-mbx-used-weight-1m';
const RETRY_AFTER_HEADER = 'retry-after';
const HTTP_STATUS_TOO_MANY_REQUESTS = 429;
const HTTP_STATUS_IP_BANNED = 418;
/** «Way too many requests; … IP banned until 1757280000000.» — биржа называет срок прямо в тексте. */
const BAN_UNTIL_PATTERN = /banned until (\d{10,})/i;

function readHeader(headers: unknown, name: string): string | undefined {
  if (!headers || typeof headers !== 'object') {
    return undefined;
  }

  const value = (headers as Record<string, unknown>)[name];

  if (value === undefined || value === null) {
    return undefined;
  }

  return String(value);
}

export function parseUsedWeight1m(headers: unknown): number | undefined {
  const raw = readHeader(headers, USED_WEIGHT_HEADER);

  if (raw === undefined) {
    return undefined;
  }

  const value = Number(raw);

  return Number.isFinite(value) ? value : undefined;
}

export function parseRetryAfterMs(headers: unknown): number | undefined {
  const raw = readHeader(headers, RETRY_AFTER_HEADER);

  if (raw === undefined) {
    return undefined;
  }

  const seconds = Number(raw);

  return Number.isFinite(seconds) ? seconds * 1000 : undefined;
}

/**
 * Настоящий срок снятия запрета из ТЕЛА ответа. Заголовок «повторить через N секунд» биржа шлёт не
 * всегда, а вот текст ошибки −1003 несёт точный момент — и до 07.09.2026 он не разбирался вовсе:
 * ответ проходил как рядовая ошибка, и о запрете знали только по статусу 418.
 */
export function parseBinanceBanUntilMs(body: unknown): number | undefined {
  if (!body || typeof body !== 'object') {
    return undefined;
  }

  const message = (body as Record<string, unknown>).msg;

  if (typeof message !== 'string') {
    return undefined;
  }

  const match = BAN_UNTIL_PATTERN.exec(message);

  if (match === null) {
    return undefined;
  }

  const value = Number(match[1]);

  return Number.isFinite(value) ? value : undefined;
}

export interface RateLimitObservationArgs {
  status: number | undefined;
  headers: unknown;
  body: unknown;
  nowMs: number;
}

export interface RateLimitObservation {
  usedWeight: number | undefined;
  /** Момент, до которого биржа закрыла доступ адресу; `undefined` — не закрывала. */
  banUntilMs: number | undefined;
  /** Момент, до которого стоит притормозить: расход веса подошёл к потолку. */
  throttleUntilMs: number | undefined;
}

/**
 * Что ответ говорит о лимитах: сколько веса израсходовано и до какого момента дверь закрыта.
 *
 * Срок берётся ПОЗДНИЙ из двух названных — заголовка и текста ошибки: они приходят вместе не всегда,
 * а верить надо тому, который дальше, иначе стук возобновится раньше времени. Отказ 429 тоже считается
 * закрытой дверью: он предупреждение перед 418, и продолжать в него ломиться — прямой путь к запрету.
 */
export function observeRateLimitResponse(args: RateLimitObservationArgs): RateLimitObservation {
  const usedWeight = parseUsedWeight1m(args.headers);
  const banUntilFromBody = parseBinanceBanUntilMs(args.body);
  const isRefusedByLimit = args.status === HTTP_STATUS_IP_BANNED || args.status === HTTP_STATUS_TOO_MANY_REQUESTS;

  const banUntilMs = ((): number | undefined => {
    if (!isRefusedByLimit && banUntilFromBody === undefined) {
      return undefined;
    }

    const retryAfterMs = parseRetryAfterMs(args.headers);
    const banUntilFromHeader = retryAfterMs === undefined ? undefined : args.nowMs + retryAfterMs;
    const namedUntilMs = Math.max(banUntilFromHeader ?? 0, banUntilFromBody ?? 0);

    return namedUntilMs > 0 ? namedUntilMs : args.nowMs + BINANCE_BAN_DEFAULT_COOLDOWN_MS;
  })();

  const throttleThreshold = BINANCE_REQUEST_WEIGHT_LIMIT_PER_MIN * BINANCE_WEIGHT_THROTTLE_RATIO;
  const throttleUntilMs =
    usedWeight !== undefined && usedWeight >= throttleThreshold ? args.nowMs + BINANCE_WEIGHT_NEAR_CAP_COOLDOWN_MS : undefined;

  return { usedWeight, banUntilMs, throttleUntilMs };
}
