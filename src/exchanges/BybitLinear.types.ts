import type { BybitAccountInfoRaw, BybitPositionRaw } from '../normalizers/bybitNormalizer';

export interface BybitPositionListWithAccountInfo<AccountInfo extends BybitAccountInfoRaw | null = BybitAccountInfoRaw | null> {
  accountInfo: AccountInfo;
  positionList: BybitPositionRaw[];
}

export interface BybitRememberedAccountInfo {
  accountInfo: BybitAccountInfoRaw;
  readSequence: number;
  rememberedAtMs: number;
}
