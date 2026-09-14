/**
 * Код отказа, пришедший с провода текстом, приводится к числу, если это число. Биржи отдают код
 * по-разному (Binance — числом, OKX — строкой), а сравнивают его вызывающие с числовой
 * константой; строка `'50102'`, положенная в `ExchangeError.code` как есть, такому сравнению
 * не отвечает, и отказ проходит мимо своей обработки.
 */
export function toWireErrorCode(code: string): number | string {
  if (code.trim() === '') {
    return code;
  }

  const numericCode = Number(code);

  if (Number.isFinite(numericCode)) {
    return numericCode;
  }

  return code;
}
