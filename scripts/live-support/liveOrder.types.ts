import type { Order, OrderSideEnum, PositionModeEnum, PositionSideEnum } from '../../src/types/common';
import type { ExchangeClient } from '../../src/types/exchange';
import type { OwnPositionLedger } from './liveOrder';

export interface ResolveMinimalOrderAmountArgs {
  client: ExchangeClient;
  symbol: string;
  notionalPrice: number;
}

export interface BuildMarketOrderArgs {
  symbol: string;
  side: OrderSideEnum;
  amount: number;
  clientOrderId: string;
  positionSide: PositionSideEnum;
  isReducing: boolean;
}

export interface OwnPositionEntry {
  positionSide: PositionSideEnum;
  signedAmount: number;
}

export interface ReadOrderFilledAmountArgs {
  client: ExchangeClient;
  symbol: string;
  readOrder: (client: ExchangeClient, symbol: string) => Promise<Order>;
}

export interface OpenOwnMarketPositionArgs {
  client: ExchangeClient;
  ledger: OwnPositionLedger;
  side: OrderSideEnum;
  amount: number;
  positionMode: PositionModeEnum | undefined;
  clientOrderId: string;
}

export interface OwnMarketOpening {
  order: Order;
  positionSide: PositionSideEnum;
  filledAmount: number;
  isFillConfirmed: boolean;
}

export interface CloseOwnPositionArgs {
  client: ExchangeClient;
  ledger: OwnPositionLedger;
  buildClientOrderId: () => string;
}

export interface CloseOwnPositionReport {
  closingOrderList: Order[];
  failureList: string[];
  remainingOwnText: string;
  hasOwnRemainder: boolean;
}
