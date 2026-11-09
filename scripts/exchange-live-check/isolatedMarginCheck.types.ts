import type { MarginModeEnum, PositionModeEnum, PositionSideEnum } from '../../src/types/common';
import type { ExchangeClient } from '../../src/types/exchange';
import type { LiveCheckContext } from './liveCheck.types';

export interface ReadOpenSnapshotArgs {
  client: ExchangeClient;
  symbol: string;
  positionIdx: number | undefined;
}

export interface RunOpenPositionPhaseArgs {
  context: LiveCheckContext;
  signal: AbortSignal;
  amount: number;
  positionMode: PositionModeEnum | undefined;
  positionIdx: number | undefined;
  positionSide: PositionSideEnum;
  expectedMarginMode: MarginModeEnum;
  isMarginAdded: boolean;
  marginFieldName: string;
  violationList: string[];
}

export interface OpenPositionPhaseReport {
  text: string;
  isForeignPositionFound: boolean;
}

export interface MarginModeOriginRead {
  originalMarginMode: MarginModeEnum;
  originText: string;
}
