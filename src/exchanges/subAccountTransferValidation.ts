import { ExchangeError } from '../errors/ExchangeError';
import type { SubAccountTransferArgs } from '../types/exchange';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Проверка до сети: перевод денег с кривыми параметрами биржа может и принять. */
export function assertSubAccountTransferArgs(args: SubAccountTransferArgs, exchange: string): void {
  if (!Number.isFinite(args.amount) || args.amount <= 0) {
    throw new ExchangeError(`Sub-account transfer amount must be a positive number, got ${args.amount}`, 'INVALID_TRANSFER_AMOUNT', exchange);
  }

  if (args.transferId.trim() === '') {
    throw new ExchangeError('Sub-account transfer needs a caller-provided transferId', 'INVALID_TRANSFER_ID', exchange);
  }

  if (args.subAccountId.trim() === '') {
    throw new ExchangeError('Sub-account transfer needs a subAccountId', 'INVALID_SUB_ACCOUNT_ID', exchange);
  }
}

export function assertUuidTransferId(transferId: string, exchange: string): void {
  if (!UUID_PATTERN.test(transferId)) {
    throw new ExchangeError(`Transfer id must be a UUID, got "${transferId}"`, 'INVALID_TRANSFER_ID', exchange);
  }
}
