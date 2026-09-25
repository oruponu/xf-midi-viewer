import { memo, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { MidiScheduler } from '../lib/player/scheduler.ts';
import type { PlaybackSequence } from '../lib/smf/playback.ts';
import { secondsToTick } from '../lib/smf/playback.ts';
import { findPitchBarSection } from '../lib/xf/pitchBars.ts';
import type { PitchBarSection, PitchLane } from '../lib/xf/pitchBars.ts';

export const PitchBarLane = memo(function PitchBarLane({
  lane,
  sequence,
  scheduler,
}: {
  lane: PitchLane;
  sequence: PlaybackSequence;
  scheduler: MidiScheduler;
}) {
  const [sectionIdx, setSectionIdx] = useState(() =>
    findPitchBarSection(lane.sections, secondsToTick(scheduler.getPosition(), sequence)),
  );
  const renderedIdxRef = useRef(-1);
  const cursorRef = useRef<SVGLineElement | null>(null);
  const clipRectRef = useRef<SVGRectElement | null>(null);
  const clipId = `pitch-lane-clip-${useId().replace(/[^\w-]/g, '')}`;
  const shownIdx = Math.min(sectionIdx, lane.sections.length - 1);
  const section = lane.sections[shownIdx]!;
  const notes = useMemo(() => renderNotes(section, lane), [section, lane]);

  useLayoutEffect(() => {
    renderedIdxRef.current = shownIdx;
    const tick = secondsToTick(scheduler.getPosition(), sequence);
    drawPosition(section, tick, cursorRef.current, clipRectRef.current);
  }, [shownIdx, section, sequence, scheduler]);

  useEffect(() => {
    let raf = 0;
    let cancelled = false;
    let last = -1;

    const loop = () => {
      if (cancelled) return;
      const tick = secondsToTick(scheduler.getPosition(), sequence);
      const idx = findPitchBarSection(lane.sections, tick);
      if (idx !== last) {
        last = idx;
        setSectionIdx(idx);
      }
      // Until React commits the new section, the layout effect draws the position.
      if (idx === renderedIdxRef.current) {
        drawPosition(lane.sections[idx]!, tick, cursorRef.current, clipRectRef.current);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [lane, sequence, scheduler]);

  return (
    <svg className="pitch-lane" aria-hidden="true">
      <defs>
        <clipPath id={clipId}>
          <rect ref={clipRectRef} x="0" y="0" width="0" height="100%" />
        </clipPath>
      </defs>
      {section.barTicks.map((tick) => {
        const x = percent(sectionOffset(section, tick));
        return <line key={tick} className="pitch-lane-bar-line" x1={x} x2={x} y1="0" y2="100%" />;
      })}
      <g className="pitch-lane-notes">{notes}</g>
      <g className="pitch-lane-notes pitch-lane-notes--sung" clipPath={`url(#${clipId})`}>
        {notes}
      </g>
      <line ref={cursorRef} className="pitch-lane-cursor" x1="0" x2="0" y1="0" y2="100%" />
    </svg>
  );
});

function renderNotes(section: PitchBarSection, lane: PitchLane): ReactNode[] {
  const rows = lane.highNote - lane.lowNote + 1;
  return section.notes.map((n, i) => {
    const left = sectionOffset(section, n.startTick);
    const right = sectionOffset(section, n.endTick);
    return (
      <rect
        key={i}
        className="pitch-lane-note"
        x={percent(left)}
        width={percent(right - left)}
        y={percent((lane.highNote - n.note) / rows)}
        height={percent(1 / rows)}
      />
    );
  });
}

function drawPosition(
  section: PitchBarSection,
  tick: number,
  cursor: SVGLineElement | null,
  clipRect: SVGRectElement | null,
): void {
  const x = percent(sectionOffset(section, tick));
  cursor?.setAttribute('x1', x);
  cursor?.setAttribute('x2', x);
  clipRect?.setAttribute('width', x);
}

function sectionOffset(section: PitchBarSection, tick: number): number {
  const fraction = (tick - section.startTick) / (section.endTick - section.startTick);
  return Math.min(1, Math.max(0, fraction));
}

function percent(fraction: number): string {
  return `${fraction * 100}%`;
}
