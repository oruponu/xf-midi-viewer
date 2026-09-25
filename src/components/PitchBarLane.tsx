import { memo, useLayoutEffect, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import type { MidiScheduler } from '../lib/player/scheduler.ts';
import type { PlaybackSequence } from '../lib/smf/playback.ts';
import { secondsToTick } from '../lib/smf/playback.ts';
import type { PitchLane } from '../lib/xf/pitchBars.ts';

export const PitchBarLane = memo(function PitchBarLane({
  lane,
  sequence,
  scheduler,
}: {
  lane: PitchLane;
  sequence: PlaybackSequence;
  scheduler: MidiScheduler;
}) {
  const laneRef = useRef<HTMLDivElement | null>(null);
  const notes = useMemo(() => renderNotes(lane), [lane]);
  const trackWidth = `${(lane.endTick / lane.viewTicks) * 100}%`;

  useLayoutEffect(() => {
    const el = laneRef.current;
    if (!el) return;
    let raf = 0;
    const draw = () => {
      const tick = secondsToTick(scheduler.getPosition(), sequence);
      el.style.setProperty('--pitch-lane-progress', String(tick / lane.endTick));
    };
    const loop = () => {
      draw();
      raf = requestAnimationFrame(loop);
    };
    draw();
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [lane, sequence, scheduler]);

  return (
    <div className="pitch-lane" ref={laneRef} aria-hidden="true">
      <div className="pitch-lane-track" style={{ width: trackWidth }}>
        <svg className="pitch-lane-layer">
          {lane.barTicks.map((tick) => {
            const x = percent(tick / lane.endTick);
            return (
              <line key={tick} className="pitch-lane-bar-line" x1={x} x2={x} y1="0" y2="100%" />
            );
          })}
          {lane.rehearsals.map((r) => {
            const x = percent(r.tick / lane.endTick);
            return (
              <g key={r.tick} className="pitch-lane-rehearsal">
                <line x1={x} x2={x} y1="0" y2="100%" />
                <text x={x} y="0" dx="0.3em" dy="1.1em">
                  {r.label}
                </text>
              </g>
            );
          })}
          {notes}
        </svg>
      </div>
      <div className="pitch-lane-sung">
        <div className="pitch-lane-track" style={{ width: trackWidth }}>
          <svg className="pitch-lane-layer">{notes}</svg>
        </div>
      </div>
      <div className="pitch-lane-cursor" />
    </div>
  );
});

function renderNotes(lane: PitchLane): ReactNode[] {
  const rows = lane.highNote - lane.lowNote + 1;
  return lane.notes.map((n, i) => (
    <rect
      key={i}
      className="pitch-lane-note"
      x={percent(n.startTick / lane.endTick)}
      width={percent((n.endTick - n.startTick) / lane.endTick)}
      y={percent((lane.highNote - n.note) / rows)}
      height={percent(1 / rows)}
    />
  ));
}

function percent(fraction: number): string {
  return `${fraction * 100}%`;
}
