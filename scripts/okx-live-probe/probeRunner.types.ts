import type { OkxProbe, OkxProbeContext } from './probe.types';

export interface RunProbeArgs {
  probe: OkxProbe;
  context: OkxProbeContext;
  index: number;
}
