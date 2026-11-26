import { staffOverhang } from './geometry.ts';
import type { ScoreStaff } from './notation.ts';

// All lengths are in VexFlow units, before the view scales them down.
export interface LyricBand {
  // The staves a band follows, by index, with how far their stems reach below the bottom line.
  stems: ReadonlyMap<number, number>;
  height: number;
  // Bottom staff line, measured from the top of a staff's row.
  staffBottom: number;
  // Room kept between the lowest note and the band.
  margin: number;
}

export interface StaffRows {
  // Top of each staff's row, on the axis `top` is given on.
  tops: number[];
  // Top of the lyric band below each staff, or null without one.
  lyricTops: (number | null)[];
  height: number;
}

// A band sits below the lowest note or stem of its staff anywhere in the song, so it never
// moves. `top` is where the first staff's row starts, below anything drawn above the staves.
export function buildStaffRows(
  staves: readonly ScoreStaff[],
  staffGap: number,
  band: LyricBand | null,
  top = 0,
): StaffRows {
  const tops: number[] = [];
  const lyricTops: (number | null)[] = [];
  let cursor = top;
  staves.forEach((staff, si) => {
    tops.push(cursor);
    cursor += staffGap;
    const stems = band?.stems.get(si);
    if (!band || stems === undefined) {
      lyricTops.push(null);
      return;
    }
    const below = Math.max(staffOverhang(staff).below, stems);
    const noteRoom = band.staffBottom + below + band.margin;
    const lyricTop = tops[si]! + Math.max(staffGap, noteRoom);
    lyricTops.push(lyricTop);
    cursor = lyricTop + band.height;
  });
  return { tops, lyricTops, height: cursor };
}

// First and last staff whose row overlaps the range from..to (same axis as tops), widened by
// `extra` rows on each side. The lyric band counts as part of the staff above it.
export function rowRange(
  rows: StaffRows,
  from: number,
  to: number,
  extra: number,
): [first: number, last: number] {
  // A position above the first staff counts as the first staff.
  const at = (y: number) =>
    Math.max(
      0,
      rows.tops.findLastIndex((top) => top <= y),
    );
  return [Math.max(0, at(from) - extra), Math.min(rows.tops.length - 1, at(to) + extra)];
}
