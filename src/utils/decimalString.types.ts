import type { StepRounding } from '../precision/precision';

export interface ConvertCoinsToContractsArgs {
  amount: number;
  contractValue: string;
  lotSize: string;
  /** "up" takes the next whole lot when there is a remainder; "nearest" and "down" keep the exchange's floor. */
  rounding?: StepRounding;
}
