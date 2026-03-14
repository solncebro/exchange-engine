export class ExchangeError extends Error {
  readonly code: number | string;
  readonly exchange: string;

  constructor(message: string, code: number | string, exchange: string) {
    super(message);
    this.name = 'ExchangeError';
    this.code = code;
    this.exchange = exchange;
  }
}
