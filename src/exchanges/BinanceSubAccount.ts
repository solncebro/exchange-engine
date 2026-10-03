import type {
  ExchangeArgs,
  FetchSubAccountBalancesArgs,
  FetchSubAccountTransferArgs,
  SubAccountClient,
  SubAccountTransferArgs,
} from '../types/exchange';
import type {
  ExchangeLogger,
  SubAccount,
  SubAccountBalance,
  SubAccountTransfer,
  SubAccountTransferResult,
} from '../types/common';
import { SubAccountTransferDirectionEnum, WalletTypeEnum } from '../types/common';
import {
  BINANCE_SPOT_BASE_URL,
  BINANCE_SUB_ACCOUNT_LIST_MAX_PAGE_COUNT,
  BINANCE_SUB_ACCOUNT_LIST_PAGE_LIMIT,
} from '../constants/binance';
import { BINANCE_SUB_ACCOUNT_WALLET_TYPE } from '../constants/mappings';
import { ExchangeError } from '../errors/ExchangeError';
import { BinanceSubAccountHttpClient } from '../http/BinanceSubAccountHttpClient';
import {
  extractBinanceUniversalTransferRecordList,
  normalizeBinanceSubAccountFuturesAccount,
  normalizeBinanceSubAccountList,
  normalizeBinanceSubAccountSpotAssets,
  normalizeBinanceFuturesInternalTransfer,
  normalizeBinanceUniversalTransferRecord,
  normalizeBinanceUniversalTransferResponse,
} from '../normalizers/binanceSubAccountNormalizer';
import type { BinanceSubAccountRaw } from '../normalizers/binanceSubAccountNormalizer.types';
import { toDecimalNumberString } from '../utils/decimalString';
import { assertSubAccountTransferArgs } from './subAccountTransferValidation';

// Часы биржи и наши расходятся, а запись намерения делается до запроса: окно берётся с запасом назад.
const FUTURES_TRANSFER_LOOKBACK_MS = 60_000;
const FUTURES_TRANSFER_AMOUNT_EPSILON = 1e-8;

/**
 * Binance отклоняет UUID с дефисами: «-9000 Wrong clientTranId format» (живой ответ 26.09.2026); тот же
 * UUID без дефисов (32 знака) принимается. Номер вызывающего остаётся прежним, на бирже — без дефисов.
 */
function toBinanceClientTranId(transferId: string): string {
  return transferId.replace(/-/g, '');
}

/**
 * Подсчёты Binance ключом главного счёта. Ключу нужно право «внутренний перевод» (internal
 * transfer) — иначе перевод отвергается; чтение списка и остатков идёт и без него.
 */
class BinanceSubAccount implements SubAccountClient {
  private readonly httpClient: BinanceSubAccountHttpClient;
  private readonly logger: ExchangeLogger;

  constructor(args: ExchangeArgs) {
    this.logger = args.logger;
    this.httpClient = new BinanceSubAccountHttpClient({
      baseUrl: BINANCE_SPOT_BASE_URL,
      apiKey: args.config.apiKey,
      secret: args.config.secret,
      logger: args.logger,
      httpsAgent: args.config.httpsAgent,
    });
  }

  async fetchSubAccountList(): Promise<SubAccount[]> {
    const rawList: BinanceSubAccountRaw[] = [];

    for (let page = 1; page <= BINANCE_SUB_ACCOUNT_LIST_MAX_PAGE_COUNT; page++) {
      const response = await this.httpClient.fetchSubAccountListPage(page, BINANCE_SUB_ACCOUNT_LIST_PAGE_LIMIT);
      rawList.push(...response.subAccounts);

      if (response.subAccounts.length < BINANCE_SUB_ACCOUNT_LIST_PAGE_LIMIT) {
        return normalizeBinanceSubAccountList(rawList);
      }
    }

    this.logger.warn(
      `[Binance] Sub-account list reached the page count limit (${BINANCE_SUB_ACCOUNT_LIST_MAX_PAGE_COUNT}); returning a partial result`,
    );

    return normalizeBinanceSubAccountList(rawList);
  }

  async transferSubAccountAsset(args: SubAccountTransferArgs): Promise<SubAccountTransferResult> {
    assertSubAccountTransferArgs(args, 'binance');
    const isMasterToSub = args.direction === SubAccountTransferDirectionEnum.MasterToSub;
    const fromAccountType = this.resolveWalletType(args.fromWalletType);
    const toAccountType = this.resolveWalletType(args.toWalletType);

    this.logger.info(
      { transferId: args.transferId, direction: args.direction, asset: args.asset, amount: args.amount },
      `[Binance] Sub-account transfer ${args.direction} ${args.subAccountId}`,
    );

    const raw = await this.httpClient.createUniversalTransfer({
      fromEmail: isMasterToSub ? undefined : args.subAccountId,
      toEmail: isMasterToSub ? args.subAccountId : undefined,
      fromAccountType,
      toAccountType,
      asset: args.asset,
      amount: toDecimalNumberString(args.amount),
      clientTranId: toBinanceClientTranId(args.transferId),
    });

    return normalizeBinanceUniversalTransferResponse(raw, args.transferId);
  }

  async fetchSubAccountTransfer(args: FetchSubAccountTransferArgs): Promise<SubAccountTransfer | null> {
    const isMasterToSub = args.direction === SubAccountTransferDirectionEnum.MasterToSub;

    // Биржа не принимает оба адреса сразу, а без них отдаёт только переводы ИЗ главного счёта;
    // перевод обратно ищется по почте подсчёта-отправителя.
    const raw = await this.httpClient.fetchUniversalTransferHistory({
      fromEmail: isMasterToSub ? undefined : args.subAccountId,
      toEmail: isMasterToSub ? args.subAccountId : undefined,
      clientTranId: toBinanceClientTranId(args.transferId),
    });

    const record = extractBinanceUniversalTransferRecordList(raw).find((item) => item.clientTranId === toBinanceClientTranId(args.transferId));

    if (record !== undefined) {
      return normalizeBinanceUniversalTransferRecord(record);
    }

    return args.amount === undefined || args.sinceMs === undefined ? null : this.findFuturesInternalTransfer(args, args.amount, args.sinceMs);
  }

  /** Перевод фьючерсы → фьючерсы: в истории фьючерсных переводов по направлению, монете, сумме и времени. */
  private async findFuturesInternalTransfer(args: FetchSubAccountTransferArgs, amount: number, sinceMs: number): Promise<SubAccountTransfer | null> {
    const raw = await this.httpClient.fetchFuturesInternalTransferHistory({ email: args.subAccountId, startTime: sinceMs - FUTURES_TRANSFER_LOOKBACK_MS });
    const subAccountEmail = args.subAccountId.toLowerCase();
    const isMasterToSub = args.direction === SubAccountTransferDirectionEnum.MasterToSub;
    const asset = (args.asset ?? 'USDT').toUpperCase();
    const matchList = (raw.transfers ?? []).filter((item) =>
      (isMasterToSub ? item.to.toLowerCase() === subAccountEmail && item.from.toLowerCase() !== subAccountEmail : item.from.toLowerCase() === subAccountEmail && item.to.toLowerCase() !== subAccountEmail)
      && item.asset.toUpperCase() === asset
      && Math.abs(parseFloat(item.qty) - amount) < FUTURES_TRANSFER_AMOUNT_EPSILON
      && item.time >= sinceMs - FUTURES_TRANSFER_LOOKBACK_MS);

    if (matchList.length > 1) {
      throw new ExchangeError(`Binance futures transfer ${args.transferId}: ${matchList.length} transfers of ${amount} ${asset} in the window — cannot tell which is ours`, 'TRANSFER_MATCH_AMBIGUOUS', 'binance');
    }

    const match = matchList[0];

    return match === undefined ? null : normalizeBinanceFuturesInternalTransfer(match, args.transferId);
  }

  async fetchSubAccountBalances(args: FetchSubAccountBalancesArgs): Promise<SubAccountBalance[]> {
    if (args.walletType === WalletTypeEnum.Spot) {
      return normalizeBinanceSubAccountSpotAssets(await this.httpClient.fetchSubAccountSpotAssets(args.subAccountId));
    }

    if (args.walletType === WalletTypeEnum.UsdtFutures) {
      return normalizeBinanceSubAccountFuturesAccount(await this.httpClient.fetchSubAccountUsdtFuturesAccount(args.subAccountId));
    }

    throw this.buildUnsupportedWalletError(args.walletType);
  }

  private resolveWalletType(walletType: WalletTypeEnum): string {
    const binanceWalletType = BINANCE_SUB_ACCOUNT_WALLET_TYPE[walletType];

    if (binanceWalletType === undefined) {
      throw this.buildUnsupportedWalletError(walletType);
    }

    return binanceWalletType;
  }

  private buildUnsupportedWalletError(walletType: WalletTypeEnum): ExchangeError {
    return new ExchangeError(
      `Binance sub-account operations do not support the ${walletType} wallet`,
      'WALLET_TYPE_NOT_SUPPORTED',
      'binance',
    );
  }
}

export { BinanceSubAccount };
