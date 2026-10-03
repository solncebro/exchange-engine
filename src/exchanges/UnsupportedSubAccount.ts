import type {
  FetchSubAccountBalancesArgs,
  FetchSubAccountTransferArgs,
  SubAccountClient,
  SubAccountTransferArgs,
} from '../types/exchange';
import type {
  SubAccount,
  SubAccountBalance,
  SubAccountTransfer,
  SubAccountTransferResult,
} from '../types/common';
import { ExchangeError } from '../errors/ExchangeError';
import type { UnsupportedSubAccountArgs } from './UnsupportedSubAccount.types';

/** Биржа или режим без подсчётов: отказ с объяснением вместо похода туда, где входа нет. */
class UnsupportedSubAccount implements SubAccountClient {
  private readonly exchange: string;
  private readonly reason: string;

  constructor(args: UnsupportedSubAccountArgs) {
    this.exchange = args.exchange;
    this.reason = args.reason;
  }

  async fetchSubAccountList(): Promise<SubAccount[]> {
    throw this.buildError();
  }

  async transferSubAccountAsset(_args: SubAccountTransferArgs): Promise<SubAccountTransferResult> {
    throw this.buildError();
  }

  async fetchSubAccountTransfer(_args: FetchSubAccountTransferArgs): Promise<SubAccountTransfer | null> {
    throw this.buildError();
  }

  async fetchSubAccountBalances(_args: FetchSubAccountBalancesArgs): Promise<SubAccountBalance[]> {
    throw this.buildError();
  }

  private buildError(): ExchangeError {
    return new ExchangeError(`Sub-account operations are not supported: ${this.reason}`, 'SUB_ACCOUNT_NOT_SUPPORTED', this.exchange);
  }
}

export { UnsupportedSubAccount };
