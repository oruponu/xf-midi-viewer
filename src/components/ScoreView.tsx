import { useEffect, useMemo, useRef, useState } from 'react';
import { Renderer } from 'vexflow/bravura';
import type { MidiScheduler } from '../lib/player/scheduler.ts';
import type { ChannelPart } from '../lib/smf/channelVoices.ts';
import type { KeyShiftChange } from '../lib/smf/fixedKey.ts';
import { secondsToTick, tickToSeconds } from '../lib/smf/playback.ts';
import type { PlaybackSequence } from '../lib/smf/playback.ts';
import type { SmfTiming } from '../lib/smf/timing.ts';
import type { RehearsalMessage } from '../lib/xf/types.ts';
import { barAtX, buildGeometry, staffOverhang, tickToX, xToTick } from '../lib/score/geometry.ts';
import { buildScoreModel } from '../lib/score/notation.ts';
import type { NamedTick, ScoreStaff } from '../lib/score/notation.ts';
import {
  momentumOffset,
  momentumSpeed,
  releaseVelocity,
  SAMPLE_WINDOW_MS,
} from '../lib/momentum.ts';
import type { MotionSample } from '../lib/momentum.ts';
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
// The brace of a grand staff reaches about 8px left of the first cell. The host clips what it
// paints, so the cells start this far inside it, in CSS pixels.
const HOST_PAD = 12;
// Cells are keyed as bar * STAFF_KEY + staff.
const STAFF_KEY = 1000;
const DRAG_THRESHOLD_PX = 5;
const WHEEL_LINE_PX = 16;
const GLIDE_MS = 250;
// In client pixels per millisecond.
const COAST_START_SPEED = 0.1;
const COAST_STOP_SPEED = 0.02;

type DragSource = 'mouse' | 'pen' | 'touch';

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
  const playheadRef = useRef<HTMLDivElement>(null);
  const [labelKey, setLabelKey] = useState('');

  useEffect(() => {
    const host = hostRef.current;
    const viewport = viewportRef.current;
    const playhead = playheadRef.current;
    if (!host || !viewport || !playhead) return;
    host.replaceChildren();
    const rendered = new Map<number, HTMLElement>();
    let raf = 0;
    const minX = tickToX(geometry, model.bars, 0);
    const maxX = tickToX(geometry, model.bars, Infinity);
    const clampX = (x: number) => Math.min(maxX, Math.max(minX, x));
    // The score x shown at the playhead line while scrolled by hand; null follows playback.
    let viewX: number | null = null;
    let shownX = minX;
    let lastPosition = scheduler.getPosition();
    let glide: { from: number; startMs: number } | null = null;
    let drag: {
      id: number;
      source: DragSource;
      startClientX: number;
      startClientY: number;
      lastClientY: number;
      startX: number;
      moved: boolean;
      // A press that stops a coast only stops it.
      clickable: boolean;
      samples: MotionSample[];
    } | null = null;
    // Velocities are in client pixels per millisecond; vy scrolls the page.
    let coast: {
      startMs: number;
      vx: number;
      vy: number;
      fromX: number;
      scrolledY: number;
    } | null = null;

    const isPlaying = () => scheduler.getState().isPlaying;
    const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const scrollTo = (x: number) => {
      viewX = clampX(x);
      glide = null;
    };

    const wheelPixels = (e: WheelEvent, delta: number, page: number) =>
      delta *
      (e.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? WHEEL_LINE_PX
        : e.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? page
          : 1);

    const onWheel = (e: WheelEvent) => {
      coast = null;
      if (isPlaying()) return;
      const horizontal = e.deltaX !== 0 ? e.deltaX : e.shiftKey ? e.deltaY : 0;
      if (horizontal === 0) return;
      e.preventDefault();
      scrollTo((viewX ?? shownX) + wheelPixels(e, horizontal, viewport.clientWidth) / SCALE);
      // Cancelling the wheel also stops the page's vertical scroll.
      if (e.deltaX !== 0 && e.deltaY !== 0) {
        window.scrollBy(0, wheelPixels(e, e.deltaY, window.innerHeight));
      }
    };

    const endDrag = () => {
      drag = null;
      delete viewport.dataset.dragging;
    };

    const startDrag = (
      id: number,
      source: DragSource,
      clientX: number,
      clientY: number,
      clickable = coast === null,
    ) => {
      drag = {
        id,
        source,
        startClientX: clientX,
        startClientY: clientY,
        lastClientY: clientY,
        startX: viewX ?? shownX,
        moved: false,
        clickable,
        samples: [],
      };
      coast = null;
    };

    const moveDrag = (clientX: number, clientY: number) => {
      if (!drag) return;
      const now = performance.now();
      drag.samples.push({ t: now, x: clientX, y: clientY });
      while (now - drag.samples[0]!.t > SAMPLE_WINDOW_MS) drag.samples.shift();
      const dx = clientX - drag.startClientX;
      if (!drag.moved && Math.hypot(dx, clientY - drag.startClientY) < DRAG_THRESHOLD_PX) return;
      drag.moved = true;
      viewport.dataset.dragging = '';
      // The browser already pans the page for touch and pen.
      if (drag.source === 'mouse') {
        window.scrollBy(0, drag.lastClientY - clientY);
        drag.lastClientY = clientY;
      }
      if (isPlaying()) return;
      scrollTo(drag.startX - dx / SCALE);
    };

    const startCoast = (samples: readonly MotionSample[], source: DragSource) => {
      if (reducedMotion()) return;
      const now = performance.now();
      const v = releaseVelocity(samples, now);
      const vx = isPlaying() ? 0 : v.vx;
      const vy = source === 'mouse' ? v.vy : 0;
      if (Math.hypot(vx, vy) < COAST_START_SPEED) return;
      coast = { startMs: now, vx, vy, fromX: viewX ?? shownX, scrolledY: 0 };
    };

    const finishDrag = (clientX: number) => {
      if (!drag) return;
      const { moved, clickable, samples, source } = drag;
      endDrag();
      if (moved) {
        startCoast(samples, source);
        return;
      }
      if (!clickable || isPlaying()) return;
      const offset = clientX - viewport.getBoundingClientRect().left;
      const x = shownX + (offset - viewport.clientWidth * PLAYHEAD_RATIO) / SCALE;
      const bar = model.bars[barAtX(geometry, x)];
      if (!bar) return;
      const from = shownX;
      scheduler.seek(tickToSeconds(bar.startTick, sequence));
      lastPosition = scheduler.getPosition();
      viewX = null;
      glide = reducedMotion() ? null : { from, startMs: performance.now() };
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === 'touch' || e.button !== 0 || drag) return;
      startDrag(e.pointerId, e.pointerType === 'pen' ? 'pen' : 'mouse', e.clientX, e.clientY);
      viewport.setPointerCapture(e.pointerId);
    };
    const isPointerDrag = (e: PointerEvent) =>
      drag !== null && drag.source !== 'touch' && drag.id === e.pointerId;
    const onPointerMove = (e: PointerEvent) => {
      if (isPointerDrag(e)) moveDrag(e.clientX, e.clientY);
    };
    const onPointerUp = (e: PointerEvent) => {
      if (isPointerDrag(e)) finishDrag(e.clientX);
    };
    const onPointerCancel = (e: PointerEvent) => {
      if (isPointerDrag(e)) endDrag();
    };

    // Touch leaves the vertical pan to the browser and reads touch events, which keep coming while
    // the page scrolls. Scrolling the page from script mid-touch makes iOS report touches off by the
    // scroll offset.
    const draggedTouch = (list: TouchList) =>
      drag?.source === 'touch'
        ? Array.from(list).find((t) => t.identifier === drag?.id)
        : undefined;
    const onTouchStart = (e: TouchEvent) => {
      // A second finger is a pinch, which the browser handles.
      if (e.touches.length > 1) {
        if (drag?.source === 'touch') endDrag();
        return;
      }
      const t = e.changedTouches[0];
      if (!t) return;
      if (!drag) {
        startDrag(t.identifier, 'touch', t.clientX, t.clientY);
      } else if (drag.source === 'pen' && !drag.moved) {
        // iOS also sends touch events for a pencil, which keep coming while the page scrolls.
        startDrag(t.identifier, 'touch', t.clientX, t.clientY, drag.clickable);
      }
    };
    const onTouchMove = (e: TouchEvent) => {
      const t = draggedTouch(e.touches);
      if (t) moveDrag(t.clientX, t.clientY);
    };
    const onTouchEnd = (e: TouchEvent) => {
      const t = draggedTouch(e.changedTouches);
      if (t) finishDrag(t.clientX);
    };
    const onTouchCancel = (e: TouchEvent) => {
      if (draggedTouch(e.changedTouches)) endDrag();
    };

    viewport.addEventListener('wheel', onWheel, { passive: false });
    viewport.addEventListener('pointerdown', onPointerDown);
    viewport.addEventListener('pointermove', onPointerMove);
    viewport.addEventListener('pointerup', onPointerUp);
    viewport.addEventListener('pointercancel', onPointerCancel);
    viewport.addEventListener('touchstart', onTouchStart, { passive: true });
    viewport.addEventListener('touchmove', onTouchMove, { passive: true });
    viewport.addEventListener('touchend', onTouchEnd);
    viewport.addEventListener('touchcancel', onTouchCancel);

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
      div.style.left = `${geometry.x[bi]! * SCALE + HOST_PAD}px`;
      div.style.top = `${(pad.top + si * STAFF_GAP) * SCALE}px`;
      if (drawCell(ctx, model, bi, si, geometry)) div.classList.add('score-view-cell--mark');
      host.appendChild(div);
      rendered.set(bi * STAFF_KEY + si, div);
    };

    const loop = () => {
      const frameStart = performance.now();
      const position = scheduler.getPosition();
      const playing = isPlaying();
      // Playing, or a seek from elsewhere, brings the view back to the playhead.
      if (position !== lastPosition || playing) {
        lastPosition = position;
        viewX = null;
        glide = null;
        if (coast?.vx) coast = null;
      }
      if (coast) {
        const t = frameStart - coast.startMs;
        // A coast that reaches an edge stops there, so the next press can click.
        if (coast.vx) {
          const x = coast.fromX - momentumOffset(coast.vx, t) / SCALE;
          viewX = clampX(x);
          if (viewX !== x) coast.vx = 0;
        }
        if (coast.vy) {
          const y = momentumOffset(coast.vy, t);
          const by = coast.scrolledY - y;
          const maxY = document.documentElement.scrollHeight - window.innerHeight;
          if ((by < 0 && window.scrollY <= 0) || (by > 0 && window.scrollY >= maxY)) coast.vy = 0;
          else window.scrollBy(0, by);
          coast.scrolledY = y;
        }
        const speed = Math.hypot(momentumSpeed(coast.vx, t), momentumSpeed(coast.vy, t));
        if (speed < COAST_STOP_SPEED) coast = null;
      }
      if (playing !== 'playing' in viewport.dataset) {
        if (playing) viewport.dataset.playing = '';
        else delete viewport.dataset.playing;
      }

      const tick = secondsToTick(position, sequence);
      const playheadX = tickToX(geometry, model.bars, tick);
      let x = viewX ?? playheadX;
      if (glide) {
        const t = (frameStart - glide.startMs) / GLIDE_MS;
        if (t >= 1) glide = null;
        else x = glide.from + (playheadX - glide.from) * (1 - (1 - t) ** 3);
      }
      shownX = x;
      const labelTick = x === playheadX ? tick : xToTick(geometry, model.bars, x);
      setLabelKey(placements.map((p) => labelIndexAt(p.staff.labels, labelTick)).join(','));

      const viewWidth = viewport.clientWidth / SCALE;
      host.style.transform = `translate3d(${viewport.clientWidth * PLAYHEAD_RATIO - x * SCALE - HOST_PAD}px, 0, 0)`;
      playhead.style.transform = `translate3d(${(playheadX - x) * SCALE}px, 0, 0)`;

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
      viewport.removeEventListener('wheel', onWheel);
      viewport.removeEventListener('pointerdown', onPointerDown);
      viewport.removeEventListener('pointermove', onPointerMove);
      viewport.removeEventListener('pointerup', onPointerUp);
      viewport.removeEventListener('pointercancel', onPointerCancel);
      viewport.removeEventListener('touchstart', onTouchStart);
      viewport.removeEventListener('touchmove', onTouchMove);
      viewport.removeEventListener('touchend', onTouchEnd);
      viewport.removeEventListener('touchcancel', onTouchCancel);
      delete viewport.dataset.dragging;
      delete viewport.dataset.playing;
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
            // A label in the last bar can run any distance past the end of the score, so the host
            // reaches as far beyond it as the viewport can show.
            style={{ width: `calc(${geometry.total * SCALE + HOST_PAD}px + 100vw)`, height }}
          />
          <div
            className="score-view-playhead"
            ref={playheadRef}
            style={{ left: `${PLAYHEAD_RATIO * 100}%` }}
          />
        </div>
      </div>
    </div>
  );
}
