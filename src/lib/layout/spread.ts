export interface SpreadItem {
  x: number;
  left: number;
  right: number;
}

export function labelSpan(items: SpreadItem[], gap: number): number {
  let span = 0;
  items.forEach((item, i) => {
    span += item.right - item.left + (i > 0 ? gap : 0);
  });
  return span;
}

// With offset_i = anchor of item i when packed with `gap`, "at least gap apart" means
// y_i = x_i - offset_i is non-decreasing, so PAVA gives the least-squares fit; then clamp.
// If the items don't fit, ignore x and pack from lo, shrinking gap-free offsets by one factor.
export function spreadLabels(items: SpreadItem[], lo: number, hi: number, gap: number): number[] {
  const n = items.length;
  if (n === 0) return [];
  if (labelSpan(items, gap) > hi - lo) return squeezeLabels(items, lo, hi);

  const offsets = labelOffsets(items, gap);
  const means: number[] = [];
  const counts: number[] = [];
  for (let i = 0; i < n; i += 1) {
    let mean = items[i]!.x - offsets[i]!;
    let count = 1;
    while (means.length > 0 && means[means.length - 1]! > mean) {
      const prevCount = counts.pop()!;
      const prevMean = means.pop()!;
      mean = (prevMean * prevCount + mean * count) / (prevCount + count);
      count += prevCount;
    }
    means.push(mean);
    counts.push(count);
  }

  const minY = lo - items[0]!.left;
  const maxY = hi - items[n - 1]!.right - offsets[n - 1]!;
  const out = new Array<number>(n);
  let i = 0;
  for (let p = 0; p < means.length; p += 1) {
    const y = Math.min(Math.max(means[p]!, minY), maxY);
    for (let k = 0; k < counts[p]!; k += 1) {
      out[i] = y + offsets[i]!;
      i += 1;
    }
  }
  return out;
}

function squeezeLabels(items: SpreadItem[], lo: number, hi: number): number[] {
  const offsets = labelOffsets(items, 0);
  const origin = lo - items[0]!.left;
  let scale = Infinity;
  for (let i = 1; i < items.length; i += 1) {
    scale = Math.min(scale, (hi - origin - items[i]!.right) / offsets[i]!);
  }
  scale = Number.isFinite(scale) ? Math.max(0, scale) : 0;
  return items.map((item, i) =>
    Math.max(lo - item.left, Math.min(origin + offsets[i]! * scale, hi - item.right)),
  );
}

function labelOffsets(items: SpreadItem[], gap: number): number[] {
  const offsets = [0];
  for (let i = 1; i < items.length; i += 1) {
    offsets.push(offsets[i - 1]! + items[i - 1]!.right + gap - items[i]!.left);
  }
  return offsets;
}
