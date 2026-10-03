import type {
  BinanceSubAccountFuturesAccountRaw,
  BinanceSubAccountListRaw,
  BinanceSubAccountSpotAssetsRaw,
  BinanceUniversalTransferHistoryRaw,
  BinanceUniversalTransferResponseRaw,
} from '../../src/normalizers/binanceSubAccountNormalizer.types';

// Примеры ответов дословно из документации Binance (раздел VIP and institutional sub-account,
// https://developers.binance.com/en/docs/catalog/vip-and-institutional-sub-account/api/rest-api/asset-management
// и .../account-management); текст страниц получен через официальный клиент binance-connector-js
// (clients/sub-account/tests/unit/rest-api), который строится из той же спецификации.

export const BINANCE_RAW_SUB_ACCOUNT_LIST: BinanceSubAccountListRaw = {
  subAccounts: [
    {
      subUserId: 123456,
      email: 'testsub@gmail.com',
      remark: 'remark',
      isFreeze: false,
      createTime: 1544433328000,
      isManagedSubAccount: false,
      isAssetManagementSubAccount: false,
    },
  ],
};

export const BINANCE_RAW_UNIVERSAL_TRANSFER_RESPONSE: BinanceUniversalTransferResponseRaw = {
  tranId: 11945860693,
  clientTranId: 'test',
};

export const BINANCE_RAW_UNIVERSAL_TRANSFER_HISTORY: BinanceUniversalTransferHistoryRaw = {
  result: [
    {
      tranId: 92275823339,
      fromEmail: 'abctest@gmail.com',
      toEmail: 'deftest@gmail.com',
      asset: 'BNB',
      amount: '0.01',
      createTimeStamp: 1640317374000,
      fromAccountType: 'USDT_FUTURE',
      toAccountType: 'SPOT',
      status: 'SUCCESS',
      clientTranId: 'test',
    },
  ],
  totalCount: 1,
};

export const BINANCE_RAW_SUB_ACCOUNT_SPOT_ASSETS: BinanceSubAccountSpotAssetsRaw = {
  balances: [
    { freeze: '0', withdrawing: '0', asset: 'ADA', free: '10000', locked: '0' },
  ],
};

export const BINANCE_RAW_SUB_ACCOUNT_USDT_FUTURES_ACCOUNT: BinanceSubAccountFuturesAccountRaw = {
  futureAccountResp: {
    email: 'abc@test.com',
    assets: [
      {
        asset: 'USDT',
        initialMargin: '0.00000000',
        maintenanceMargin: '0.00000000',
        marginBalance: '0.88308000',
        maxWithdrawAmount: '0.88308000',
        openOrderInitialMargin: '0.00000000',
        positionInitialMargin: '0.00000000',
        unrealizedProfit: '0.00000000',
        walletBalance: '0.88308000',
      },
    ],
  },
};
