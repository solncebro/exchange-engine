import type {
  BybitAccountCoinsBalanceRaw,
  BybitApiKeyInfoRaw,
  BybitSubMemberListRaw,
  BybitUniversalTransferListRaw,
} from '../../src/normalizers/bybitSubAccountNormalizer.types';

// Примеры ответов дословно из документации Bybit v5 (исходники страниц — репозиторий
// github.com/bybit-exchange/docs, docs/v5/...):
// user/subuid-list, user/apikey-info (оставлены только читаемые библиотекой поля), asset/unitransfer,
// asset/unitransfer-list, asset/all-balance.

export const BYBIT_RAW_SUB_MEMBER_LIST_RESPONSE = {
  retCode: 0,
  retMsg: '',
  result: {
    subMembers: [
      { uid: '53888001', username: 'xxx001', memberType: 1, status: 1, remark: 'test', accountMode: 3 },
      { uid: '53888002', username: 'xxx002', memberType: 6, status: 1, remark: '', accountMode: 1 },
    ],
  } satisfies BybitSubMemberListRaw,
  retExtInfo: {},
  time: 1676430319452,
};

export const BYBIT_RAW_API_KEY_INFO_RESPONSE = {
  retCode: 0,
  retMsg: '',
  result: {
    userID: 24617703,
    isMaster: true,
    parentUid: '0',
  } satisfies BybitApiKeyInfoRaw,
  retExtInfo: {},
  time: 1697525990798,
};

export const BYBIT_RAW_UNIVERSAL_TRANSFER_RESPONSE = {
  retCode: 0,
  retMsg: 'success',
  result: {
    transferId: 'be7a2462-1138-4e27-80b1-62653f24925e',
  },
  retExtInfo: {},
  time: 1672189450195,
};

export const BYBIT_RAW_UNIVERSAL_TRANSFER_LIST_RESPONSE = {
  retCode: 0,
  retMsg: 'success',
  result: {
    list: [
      {
        transferId: 'universalTransfer_4c3cfe2f-85cb-11ed-ac09-9e37823c81cd_533285',
        coin: 'USDC',
        amount: '1000',
        timestamp: '1672134373000',
        status: 'SUCCESS',
        fromAccountType: 'UNIFIED',
        toAccountType: 'UNIFIED',
        fromMemberId: '533285',
        toMemberId: '592324',
      },
    ],
    nextPageCursor: 'eyJtaW5JRCI6MTc4OTYwNSwibWF4SUQiOjE3ODk2MDV9',
  } satisfies BybitUniversalTransferListRaw,
  retExtInfo: {},
  time: 1672190763079,
};

export const BYBIT_RAW_ACCOUNT_COINS_BALANCE_RESPONSE = {
  retCode: 0,
  retMsg: 'success',
  result: {
    memberId: 'XXXX',
    accountType: 'FUND',
    balance: [
      { coin: 'USDC', transferBalance: '0', walletBalance: '0', bonus: '' },
    ],
  } satisfies BybitAccountCoinsBalanceRaw,
  retExtInfo: {},
  time: 1675866354913,
};
