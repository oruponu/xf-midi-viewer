import { useEffect, useMemo, useRef, useState } from 'react';
import { Renderer } from 'vexflow/bravura';
import type { MidiScheduler } from '../lib/player/scheduler.ts';
import type { ChannelPart } from '../lib/smf/channelVoices.ts';
import type { KeyShiftChange } from '../lib/smf/fixedKey.ts';
import { secondsToTick } from '../lib/smf/playback.ts';
import type { PlaybackSequence } from '../lib/smf/playback.ts';
import type { SmfTiming } from '../lib/smf/timing.ts';
import type { RehearsalMessage } from '../lib/xf/types.ts';
import { buildGeometry, staffOverhang, tickToX } from '../lib/score/geometry.ts';
import { buildScoreModel } from '../lib/score/notation.ts';
import type { NamedTick, ScoreStaff } from '../lib/score/notation.ts';
import { drawCell, measurePrefix, SCALE, STAFF_CENTER, STAFF_GAP, TOP } from './scoreCell.ts';

const LABEL_WIDTH = 120;
const PLAYHEAD_RATIO = 0.25;
const FRAME_BUDGET_MS = 6;
const BOTTOM_ROOM = 30;
const HALF_STAFF = 20;
const NOTE_MARGIN = 10;
// Room the frame leaves above the first staff's top line and below the last staff's bottom line.
const ROOM_ABOVE = TOP + STAFF_CENTER - HALF_STAFF;
const ROOM_BELOW = STAFF_GAP - STAFF_CENTER - HALF_STAFF + BOTTOM_ROOM;
// Extra width rendered beyond the visible area on each side, in score units.
const RENDER_MARGIN = 200;
// Cells are keyed as bar * STAFF_KEY + staff.
const STAFF_KEY = 1000;

type ScoreViewProps = {
  sequence: PlaybackSequence;
  timing: SmfTiming;
  parts: readonly ChannelPart[];
  rehearsals: readonly RehearsalMessage[];
  keyShifts: readonly KeyShiftChange[];
  scheduler: MidiScheduler;
  title: string;
};

interface LabelPlacement {
  staff: ScoreStaff;
  first: number;
  count: number;
}

// The lower staff of a grand staff shares the label of the staff above it.
function labelPlacements(staves: readonly ScoreStaff[]): LabelPlacement[] {
  const out: LabelPlacement[] = [];
  staves.forEach((staff, si) => {
    const last = out.at(-1);
    if (staff.continuation && last) last.count += 1;
    else out.push({ staff, first: si, count: 1 });
  });
  return out;
}

function labelIndexAt(labels: readonly NamedTick[], tick: number): number {
  return labels.findLastIndex((l) => l.tick <= tick);
}

// Before a staff's first note: pitched and drum staves name the voice they will start with,
// percussion staves stay generic rather than naming an instrument that has not played yet.
function labelText(staff: ScoreStaff, index: number): string {
  const label = staff.labels[index] ?? (staff.kind === 'percussion' ? undefined : staff.labels[0]);
  return `${staff.channel + 1}: ${label?.name ?? 'Perc.'}`;
}

export function ScoreView({
  sequence,
  timing,
  parts,
  rehearsals,
  keyShifts,
  scheduler,
  title,
}: ScoreViewProps) {
  const model = useMemo(
    () =>
      buildScoreModel({
        sequence,
        timing,
        parts,
        sectionTicks: rehearsals.map((r) => r.tick),
        keyShifts,
      }),
    [sequence, timing, parts, rehearsals, keyShifts],
  );
  const geometry = useMemo(() => buildGeometry(model, (bi) => measurePrefix(model, bi)), [model]);
  const placements = useMemo(() => labelPlacements(model.staves), [model]);
  // The frame clips its content, so it grows to fit notes far above or below the outer staves.
  const pad = useMemo(() => {
    const first = model.staves[0];
    const last = model.staves.at(-1);
    return {
      top: first ? Math.max(0, staffOverhang(first).above + NOTE_MARGIN - ROOM_ABOVE) : 0,
      bottom: last ? Math.max(0, staffOverhang(last).below + NOTE_MARGIN - ROOM_BELOW) : 0,
    };
  }, [model]);
  const hostRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [labelKey, setLabelKey] = useState('');

  useEffect(() => {
    const host = hostRef.current;
    const viewport = viewportRef.current;
    if (!host || !viewport) return;
    host.replaceChildren();
    const rendered = new Map<number, HTMLElement>();
    let raf = 0;

    const renderCell = (bi: number, si: number) => {
      const div = document.createElement('div');
      const width = geometry.width[bi]!;
      const renderer = new Renderer(div, Renderer.Backends.SVG);
      renderer.resize(width * SCALE, STAFF_GAP * SCALE);
      const ctx = renderer.getContext();
      ctx.scale(SCALE, SCALE);
      div.className = 'score-view-cell';
      div.style.width = `${width * SCALE}px`;
      div.style.height = `${STAFF_GAP * SCALE}px`;
      div.style.left = `${geometry.x[bi]! * SCALE}px`;
      div.style.top = `${(pad.top + si * STAFF_GAP) * SCALE}px`;
      if (drawCell(ctx, model, bi, si, geometry)) div.classList.add('score-view-cell--mark');
      host.appendChild(div);
      rendered.set(bi * STAFF_KEY + si, div);
    };

    const loop = () => {
      const frameStart = performance.now();
      const tick = secondsToTick(scheduler.getPosition(), sequence);
      setLabelKey(placements.map((p) => labelIndexAt(p.staff.labels, tick)).join(','));

      const x = tickToX(geometry, model.bars, tick);
      const viewWidth = viewport.clientWidth / SCALE;
      host.style.transform = `translate3d(${viewport.clientWidth * PLAYHEAD_RATIO - x * SCALE}px, 0, 0)`;

      const top = viewport.getBoundingClientRect().top + pad.top * SCALE;
      const rowHeight = STAFF_GAP * SCALE;
      const firstRow = Math.max(0, Math.floor((-top - rowHeight) / rowHeight));
      const lastRow = Math.min(
        model.staves.length - 1,
        Math.floor((window.innerHeight - top + rowHeight) / rowHeight),
      );
      const from = x - viewWidth * PLAYHEAD_RATIO - RENDER_MARGIN;
      const to = x + viewWidth * (1 - PLAYHEAD_RATIO) + RENDER_MARGIN;

      for (const [key, el] of rendered) {
        const bi = Math.floor(key / STAFF_KEY);
        const si = key % STAFF_KEY;
        const bx = geometry.x[bi]!;
        const outside =
          bx + geometry.width[bi]! < from - viewWidth ||
          bx > to + viewWidth ||
          si < firstRow - 2 ||
          si > lastRow + 2;
        if (outside) {
          el.remove();
          rendered.delete(key);
        }
      }
      const wanted: [number, number][] = [];
      model.bars.forEach((_, bi) => {
        const bx = geometry.x[bi]!;
        if (bx + geometry.width[bi]! < from || bx > to) return;
        for (let si = firstRow; si <= lastRow; si += 1) {
          if (!rendered.has(bi * STAFF_KEY + si)) wanted.push([bi, si]);
        }
      });
      wanted.sort(
        (a, b) => Math.abs(geometry.x[a[0]]! - x) - Math.abs(geometry.x[b[0]]! - x) || a[1] - b[1],
      );
      for (const [bi, si] of wanted) {
        if (performance.now() - frameStart > FRAME_BUDGET_MS) break;
        renderCell(bi, si);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      host.replaceChildren();
    };
  }, [model, geometry, placements, pad, scheduler, sequence]);

  if (model.staves.length === 0) {
    return (
      <div className="card empty-view">
        <h3>譜面にできる音がありません</h3>
      </div>
    );
  }

  const labelIndexes = labelKey ? labelKey.split(',').map(Number) : [];
  const height =
    (pad.top + TOP + model.staves.length * STAFF_GAP + BOTTOM_ROOM + pad.bottom) * SCALE;
  return (
    <div className="card score-view">
      <div className="score-view-frame" style={{ height }}>
        <div className="score-view-labels" style={{ width: LABEL_WIDTH }}>
          {placements.map((p, i) => {
            const centre =
              pad.top + p.first * STAFF_GAP + TOP + STAFF_CENTER + ((p.count - 1) * STAFF_GAP) / 2;
            return (
              <div key={p.first} className="score-view-label" style={{ top: centre * SCALE }}>
                {labelText(p.staff, labelIndexes[i] ?? -1)}
              </div>
            );
          })}
        </div>
        <div
          className="score-view-viewport"
          ref={viewportRef}
          role="img"
          aria-label={title ? `${title} の譜面` : '譜面'}
          style={{ left: LABEL_WIDTH }}
        >
          <div
            className="score-view-svg"
            ref={hostRef}
            style={{ width: geometry.total * SCALE, height }}
          />
          <div className="score-view-playhead" style={{ left: `${PLAYHEAD_RATIO * 100}%` }} />
        </div>
      </div>
    </div>
  );
}
