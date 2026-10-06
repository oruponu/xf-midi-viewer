import { labelSpan } from './spread.ts';

export interface MeasuredLabel {
  bar: number;
  left: number;
  right: number;
  fixed: number;
}

export interface BarDemand {
  scalable: number;
  fixed: number;
}

export interface LabelDemands {
  chords: ReadonlyMap<number, BarDemand>;
  lyrics: ReadonlyMap<number, BarDemand>;
}

export const MIN_LABEL_SCALE = 0.7;

export function barDemands(
  labels: readonly MeasuredLabel[],
  pad: number,
  gap: number,
): Map<number, BarDemand> {
  const groups = new Map<number, MeasuredLabel[]>();
  for (const label of labels) {
    const group = groups.get(label.bar);
    if (group) group.push(label);
    else groups.set(label.bar, [label]);
  }
  const demands = new Map<number, BarDemand>();
  for (const [bar, group] of groups) {
    const fixed = group.reduce((sum, label) => sum + label.fixed, 0);
    demands.set(bar, {
      scalable: labelSpan(group, 0) - fixed,
      fixed: fixed + gap * (group.length - 1) + pad * 2,
    });
  }
  return demands;
}

function demandFits(demand: BarDemand | undefined, width: number): boolean {
  return demand === undefined || demand.scalable + demand.fixed <= width;
}

export function barFits(demands: LabelDemands, bar: number, width: number): boolean {
  return demandFits(demands.chords.get(bar), width) && demandFits(demands.lyrics.get(bar), width);
}

export function labelScale(
  demands: ReadonlyMap<number, BarDemand>,
  startBar: number,
  barCount: number,
  width: number,
): number {
  let scale = 1;
  for (let bar = startBar; bar < startBar + barCount; bar += 1) {
    const demand = demands.get(bar);
    if (demand === undefined || demandFits(demand, width)) continue;
    // Leave 1px and round down: any overflow makes spreadLabels squeeze the whole row.
    const fitted =
      demand.scalable > 0
        ? Math.floor(((width - 1 - demand.fixed) / demand.scalable) * 100) / 100
        : MIN_LABEL_SCALE;
    scale = Math.min(scale, fitted);
  }
  return Math.max(MIN_LABEL_SCALE, scale);
}
