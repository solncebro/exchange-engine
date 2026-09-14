import type { OkxInstrumentRaw } from '../../src/normalizers/okxNormalizer';

export interface FarOrderBasis {
  instrument: OkxInstrumentRaw;
  lastPrice: number;
  isHedgeMode: boolean;
}
