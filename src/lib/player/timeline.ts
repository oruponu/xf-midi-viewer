export interface TimelineSegment {
  atMs: number;
  position: number;
  rate: number;
}

export const TIMELINE_RETENTION_MS = 2000;

export function positionAt(segments: readonly TimelineSegment[], timeMs: number): number {
  const first = segments[0];
  if (!first) return 0;
  if (timeMs <= first.atMs) return first.position;
  let current = first;
  for (let i = 1; i < segments.length; i += 1) {
    const segment = segments[i]!;
    if (segment.atMs > timeMs) break;
    current = segment;
  }
  return current.position + ((timeMs - current.atMs) / 1000) * current.rate;
}

export function timeAtPosition(segment: TimelineSegment, seconds: number): number {
  return segment.atMs + ((seconds - segment.position) / segment.rate) * 1000;
}

export function withRateChange(
  segments: readonly TimelineSegment[],
  atMs: number,
  rate: number,
): TimelineSegment[] {
  const position = positionAt(segments, atMs);
  const kept = segments.at(-1)?.atMs === atMs ? segments.slice(0, -1) : segments;
  return [...kept, { atMs, position, rate }];
}

export function pruneTimeline(
  segments: readonly TimelineSegment[],
  nowMs: number,
): TimelineSegment[] {
  let start = 0;
  while (
    start + 1 < segments.length &&
    segments[start + 1]!.atMs <= nowMs - TIMELINE_RETENTION_MS
  ) {
    start += 1;
  }
  return start === 0 ? [...segments] : segments.slice(start);
}
