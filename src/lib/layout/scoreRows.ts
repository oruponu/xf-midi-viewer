export interface ScoreRowSpec {
  startBar: number;
  barCount: number;
}

export function buildScoreRows(
  totalBars: number,
  barsPerRow: number,
  sectionStartBars: Iterable<number>,
): ScoreRowSpec[] {
  const breaks = [...new Set(sectionStartBars)]
    .filter((bar) => bar > 1 && bar <= totalBars)
    .sort((a, b) => a - b);
  breaks.push(totalBars + 1);
  const rows: ScoreRowSpec[] = [];
  let start = 1;
  for (const end of breaks) {
    for (let s = start; s < end; s += barsPerRow) {
      rows.push({ startBar: s, barCount: Math.min(barsPerRow, end - s) });
    }
    start = end;
  }
  return rows;
}
