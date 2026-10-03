import {
  BINANCE_SUB_ACCOUNT_FUTURES_ACCOUNT_PATH,
  BINANCE_SUB_ACCOUNT_FUTURES_INTERNAL_TRANSFER_PATH,
  BINANCE_SUB_ACCOUNT_LIST_PATH,
  BINANCE_SUB_ACCOUNT_SPOT_ASSETS_PATH,
  BINANCE_SUB_ACCOUNT_UNIVERSAL_TRANSFER_PATH,
  BINANCE_SUB_ACCOUNT_USDT_FUTURES_TYPE,
} from '../constants/binance';
import type {
  BinanceFuturesInternalTransferHistoryRaw,
  BinanceSubAccountFuturesAccountRaw,
  BinanceSubAccountListRaw,
  BinanceSubAccountSpotAssetsRaw,
  BinanceUniversalTransferHistoryRaw,
  BinanceUniversalTransferRecordRaw,
  BinanceUniversalTransferResponseRaw,
} from '../normalizers/binanceSubAccountNormalizer.types';
import { buildOptionalParams } from '../utils/httpParams';
import { BinanceSpotHttpClient } from './BinanceSpotHttpClient';
import type {
  BinanceFuturesInternalTransferHistoryParams,
  BinanceUniversalTransferHistoryParams,
  BinanceUniversalTransferParams,
} from './BinanceSubAccountHttpClient.types';

/**
 * Входы подсчётов живут на том же адресе api.binance.com, что и спот: подпись, пересдача при
 * протухшей отметке и общая на адрес память о запретах берутся оттуда без копий.
 */
class BinanceSubAccountHttpClient extends BinanceSpotHttpClient {
  async fetchSubAccountListPage(page: number, limit: number): Promise<BinanceSubAccountListRaw> {
    return this.signedGet<BinanceSubAccountListRaw>(BINANCE_SUB_ACCOUNT_LIST_PATH, { page, limit });
  }

  async createUniversalTransfer(params: BinanceUniversalTransferParams): Promise<BinanceUniversalTransferResponseRaw> {
    return this.signedPost<BinanceUniversalTransferResponseRaw>(BINANCE_SUB_ACCOUNT_UNIVERSAL_TRANSFER_PATH, {
      ...buildOptionalParams({ fromEmail: params.fromEmail, toEmail: params.toEmail }),
      fromAccountType: params.fromAccountType,
      toAccountType: params.toAccountType,
      asset: params.asset,
      amount: params.amount,
      clientTranId: params.clientTranId,
    });
  }

  async fetchUniversalTransferHistory(
    params: BinanceUniversalTransferHistoryParams,
  ): Promise<BinanceUniversalTransferHistoryRaw | BinanceUniversalTransferRecordRaw[]> {
    return this.signedGet<BinanceUniversalTransferHistoryRaw | BinanceUniversalTransferRecordRaw[]>(
      BINANCE_SUB_ACCOUNT_UNIVERSAL_TRANSFER_PATH,
      {
        ...buildOptionalParams({ fromEmail: params.fromEmail, toEmail: params.toEmail }),
        clientTranId: params.clientTranId,
      },
    );
  }

  async fetchFuturesInternalTransferHistory(params: BinanceFuturesInternalTransferHistoryParams): Promise<BinanceFuturesInternalTransferHistoryRaw> {
    return this.signedGet<BinanceFuturesInternalTransferHistoryRaw>(BINANCE_SUB_ACCOUNT_FUTURES_INTERNAL_TRANSFER_PATH, {
      email: params.email,
      futuresType: BINANCE_SUB_ACCOUNT_USDT_FUTURES_TYPE,
      startTime: params.startTime,
    });
  }

  async fetchSubAccountSpotAssets(email: string): Promise<BinanceSubAccountSpotAssetsRaw> {
    return this.signedGet<BinanceSubAccountSpotAssetsRaw>(BINANCE_SUB_ACCOUNT_SPOT_ASSETS_PATH, { email });
  }

  async fetchSubAccountUsdtFuturesAccount(email: string): Promise<BinanceSubAccountFuturesAccountRaw> {
    return this.signedGet<BinanceSubAccountFuturesAccountRaw>(BINANCE_SUB_ACCOUNT_FUTURES_ACCOUNT_PATH, {
      email,
      futuresType: BINANCE_SUB_ACCOUNT_USDT_FUTURES_TYPE,
    });
  }
}

export { BinanceSubAccountHttpClient };
