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
  buildScorePages,
  createWheelPager,
  dragTurn,
  pageIndexAt,
  pageStartTick,
  pageViewStart,
  turnPage,
  wheelTurn,
} from '../lib/score/pages.ts';
import type { ScorePage } from '../lib/score/pages.ts';
import { buildStaffRows, rowRange } from '../lib/score/rows.ts';
import {
  momentumOffset,
  momentumSpeed,
  releaseVelocity,
  SAMPLE_WINDOW_MS,
} from '../lib/momentum.ts';
import type { MotionSample } from '../lib/momentum.ts';
import {
  drawCell,
  drawSignature,
  measureKeyChange,
  measurePrefix,
  measureSignature,
  SCALE,
  STAFF_CENTER,
  STAFF_GAP,
  TOP,
} from './scoreCell.ts';

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
// How far before the barline the end of a tie into the next page starts, in score units.
const TIE_IN_LENGTH = 12;
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
  paged: boolean;
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

// A tie into the next bar is one path from the cell of the bar it starts in. Its thin end is all
// that reaches past the barline, so a page that starts with the next bar shows a short copy instead.
function addTieEnds(cell: HTMLElement, width: number, nextKeyChange: number): void {
  for (const tie of cell.querySelectorAll<SVGPathElement>('.vf-stavetie path')) {
    const n = tie
      .getAttribute('d')
      ?.match(/-?\d+(\.\d+)?/g)
      ?.map(Number);
    if (!n || n.length < 8) continue;
    const [x1, y, over, x2, under] = [n[0]!, n[1]!, n[3]!, n[4]!, n[7]!];
    if (x2 <= width + 1) continue;
    const from = Math.max(x1, width + nextKeyChange - TIE_IN_LENGTH);
    const mid = (from + x2) / 2;
    const bend = (to: number) => y + (to - y) * 0.6;
    const end = tie.cloneNode() as SVGPathElement;
    end.setAttribute(
      'd',
      `M${from} ${y}Q${mid} ${bend(over)},${x2} ${y}Q${mid} ${bend(under)},${from} ${y}Z`,
    );
    end.classList.add('score-view-tie-in');
    tie.after(end);
  }
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
  paged,
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
  const rows = useMemo(() => buildStaffRows(model.staves, STAFF_GAP, null), [model]);
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
  const pageEndRef = useRef<HTMLDivElement>(null);
  const signatureRef = useRef<HTMLDivElement>(null);
  // Where a page starts, in CSS pixels: right of the clef and key signature column, whose cells
  // sit HOST_PAD inside it.
  const signaturePx = useMemo(() => HOST_PAD + measureSignature(model) * SCALE, [model]);
  const keyChangeWidths = useMemo(
    () => model.bars.map((_, bi) => measureKeyChange(model, bi)),
    [model],
  );
  const [labelKey, setLabelKey] = useState('');

  useEffect(() => {
    const host = hostRef.current;
    const viewport = viewportRef.current;
    const playhead = playheadRef.current;
    const pageEnd = pageEndRef.current;
    const signature = signatureRef.current;
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
    let pages: ScorePage[] = [];
    let pagesWidth = -1;
    let signatureKey: number | null = null;
    const drawSignatures = (keySharps: number) => {
      if (!signature) return;
      signature.replaceChildren();
      const width = (signaturePx - HOST_PAD) / SCALE;
      model.staves.forEach((staff, si) => {
        const div = document.createElement('div');
        const renderer = new Renderer(div, Renderer.Backends.SVG);
        renderer.resize(width * SCALE, STAFF_GAP * SCALE);
        const ctx = renderer.getContext();
        ctx.scale(SCALE, SCALE);
        div.className = 'score-view-cell';
        div.style.left = `${HOST_PAD}px`;
        div.style.top = `${(pad.top + rows.tops[si]!) * SCALE}px`;
        drawSignature(ctx, staff, keySharps, width);
        signature.appendChild(div);
      });
    };
    const offsets = new Map<HTMLElement, number>();
    // A paged score stands still between page turns, so its transforms are only written on change.
    const moveTo = (el: HTMLElement, px: number) => {
      if (offsets.get(el) === px) return;
      offsets.set(el, px);
      el.style.transform = `translate3d(${px}px, 0, 0)`;
    };
    // The page shown while paged through by hand; null follows playback.
    let viewPage: number | null = null;
    const wheelPager = createWheelPager();
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

    const playheadPage = () =>
      pageIndexAt(pages, geometry, model.bars, secondsToTick(scheduler.getPosition(), sequence));
    const turn = (direction: 1 | -1) => {
      viewPage = turnPage(pages, viewPage ?? playheadPage(), direction);
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
      if (paged) {
        const direction = wheelTurn(e.deltaX, e.deltaY, e.shiftKey);
        if (direction === 0) return;
        e.preventDefault();
        const delta = wheelPixels(e, e.deltaX !== 0 ? e.deltaX : e.deltaY, viewport.clientWidth);
        // Shift and line or page deltas come from a mouse wheel, which turns in notches.
        const stepped = e.shiftKey || e.deltaMode !== WheelEvent.DOM_DELTA_PIXEL;
        const step = wheelPager(delta, stepped, e.timeStamp);
        if (step !== 0) turn(step);
        return;
      }
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
      if (isPlaying() || paged) return;
      scrollTo(drag.startX - dx / SCALE);
    };

    const startCoast = (samples: readonly MotionSample[], source: DragSource) => {
      if (reducedMotion()) return;
      const now = performance.now();
      const v = releaseVelocity(samples, now);
      const vx = isPlaying() || paged ? 0 : v.vx;
      const vy = source === 'mouse' ? v.vy : 0;
      if (Math.hypot(vx, vy) < COAST_START_SPEED) return;
      coast = { startMs: now, vx, vy, fromX: viewX ?? shownX, scrolledY: 0 };
    };

    const finishDrag = (clientX: number, clientY: number) => {
      if (!drag) return;
      const { moved, clickable, samples, source, startClientX, startClientY } = drag;
      endDrag();
      if (moved) {
        const direction = dragTurn(clientX - startClientX, clientY - startClientY);
        if (paged && !isPlaying() && direction !== 0) turn(direction);
        startCoast(samples, source);
        return;
      }
      if (!clickable || isPlaying()) return;
      const offset = clientX - viewport.getBoundingClientRect().left;
      let x: number;
      if (paged) {
        const page = pages[viewPage ?? playheadPage()];
        const start = page ? pageViewStart(page, geometry, keyChangeWidths) : 0;
        x = start + (offset - signaturePx) / SCALE;
        if (!page || x < start || x >= page.end) return;
      } else {
        x = shownX + (offset - viewport.clientWidth * PLAYHEAD_RATIO) / SCALE;
      }
      const bar = model.bars[barAtX(geometry, x)];
      if (!bar) return;
      const from = shownX;
      scheduler.seek(tickToSeconds(bar.startTick, sequence));
      lastPosition = scheduler.getPosition();
      viewX = null;
      viewPage = null;
      glide = paged || reducedMotion() ? null : { from, startMs: performance.now() };
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
      if (isPointerDrag(e)) finishDrag(e.clientX, e.clientY);
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
      if (t) finishDrag(t.clientX, t.clientY);
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
      div.style.top = `${(pad.top + rows.tops[si]!) * SCALE}px`;
      if (drawCell(ctx, model, bi, si, geometry)) div.classList.add('score-view-cell--mark');
      if (paged) {
        addTieEnds(div, width, keyChangeWidths[bi + 1] ?? 0);
        const keyChange = keyChangeWidths[bi]!;
        const barline = keyChange > 0 ? div.querySelector<SVGElement>('.vf-stavebarline') : null;
        if (barline) {
          barline.classList.add('score-view-lead-barline');
          barline.style.setProperty('--key-change', `${keyChange}px`);
        }
      }
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
        viewPage = null;
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
      const viewWidth = viewport.clientWidth / SCALE;
      // Cells are made from `from` to `to`, nearest to `near` first, and dropped outside
      // `keepFrom` to `keepTo`.
      let from: number;
      let to: number;
      let keepFrom: number;
      let keepTo: number;
      let near: number;
      let labelTick: number;
      let shown: ScorePage | null = null;
      let shownTailBar = -1;
      let shownLeadBar = -1;
      if (paged) {
        if (viewport.clientWidth !== pagesWidth) {
          pagesWidth = viewport.clientWidth;
          pages = buildScorePages(geometry, (pagesWidth - signaturePx) / SCALE);
          viewPage = null;
        }
        const playIndex = pageIndexAt(pages, geometry, model.bars, tick);
        const index = viewPage ?? playIndex;
        const following = index === playIndex;
        const page = pages[index];
        if (!page || !pageEnd || !signature) {
          raf = requestAnimationFrame(loop);
          return;
        }
        const next = pages[index + 1] ?? page;
        const lineX = Math.min(playheadX, page.end);
        const start = pageViewStart(page, geometry, keyChangeWidths);
        shownX = start;
        moveTo(host, signaturePx - start * SCALE - HOST_PAD);
        moveTo(playhead, signaturePx + (lineX - start) * SCALE);
        if (playhead.hidden === following) playhead.hidden = !following;
        // The first bar of the song draws its own clef and key signature.
        const firstPage = page.start === 0;
        if (signature.hidden !== firstPage) signature.hidden = firstPage;
        // Accidentals of the page's first notes reach over the column, which lies under the cells.
        // A page that starts inside a bar has the column cover the part before it instead.
        const zIndex = page.start > geometry.x[page.firstBar]! ? '1' : '';
        if (signature.style.zIndex !== zIndex) signature.style.zIndex = zIndex;
        shown = page;
        const keySharps = model.bars[page.firstBar]!.keySharps;
        if (!firstPage && signatureKey !== keySharps) {
          signatureKey = keySharps;
          drawSignatures(keySharps);
        }
        // Only a page that ends inside a bar has cells to cut off.
        const barEnd = geometry.x[page.lastBar]! + geometry.width[page.lastBar]!;
        const endLeft =
          page.end < barEnd ? `${signaturePx + (page.end - start) * SCALE}px` : '100%';
        if (pageEnd.style.left !== endLeft) pageEnd.style.left = endLeft;
        // Half a unit keeps out the bars that only touch the range.
        // The bar before the page stays for the ties it draws into the page.
        const tailBar = page.start === geometry.x[page.firstBar]! ? page.firstBar - 1 : -1;
        from = keepFrom = (tailBar < 0 ? page.start : geometry.x[tailBar]!) + 0.5;
        shownTailBar = tailBar;
        shownLeadBar = start > page.start ? page.firstBar : -1;
        to = keepTo = next.end - 0.5;
        near = following ? lineX : page.start;
        labelTick = following ? tick : pageStartTick(page, geometry, model.bars);
      } else {
        let x = viewX ?? playheadX;
        if (glide) {
          const t = (frameStart - glide.startMs) / GLIDE_MS;
          if (t >= 1) glide = null;
          else x = glide.from + (playheadX - glide.from) * (1 - (1 - t) ** 3);
        }
        shownX = x;
        host.style.transform = `translate3d(${viewport.clientWidth * PLAYHEAD_RATIO - x * SCALE - HOST_PAD}px, 0, 0)`;
        playhead.style.transform = `translate3d(${(playheadX - x) * SCALE}px, 0, 0)`;
        from = x - viewWidth * PLAYHEAD_RATIO - RENDER_MARGIN;
        to = x + viewWidth * (1 - PLAYHEAD_RATIO) + RENDER_MARGIN;
        keepFrom = from - viewWidth;
        keepTo = to + viewWidth;
        near = x;
        labelTick = x === playheadX ? tick : xToTick(geometry, model.bars, x);
      }
      setLabelKey(placements.map((p) => labelIndexAt(p.staff.labels, labelTick)).join(','));

      const top = viewport.getBoundingClientRect().top + pad.top * SCALE;
      const [firstRow, lastRow] = rowRange(
        rows,
        -top / SCALE,
        (window.innerHeight - top) / SCALE,
        1,
      );

      for (const [key, el] of rendered) {
        const bi = Math.floor(key / STAFF_KEY);
        const si = key % STAFF_KEY;
        const bx = geometry.x[bi]!;
        const outside =
          bx + geometry.width[bi]! < keepFrom ||
          bx > keepTo ||
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
        (a, b) =>
          Math.abs(geometry.x[a[0]]! - near) - Math.abs(geometry.x[b[0]]! - near) || a[1] - b[1],
      );
      for (const [bi, si] of wanted) {
        if (performance.now() - frameStart > FRAME_BUDGET_MS) break;
        renderCell(bi, si);
      }
      if (shown) {
        // Hidden rather than covered: a cell paints its accidentals and ties outside its box.
        for (const [key, el] of rendered) {
          const bi = Math.floor(key / STAFF_KEY);
          const tail = bi === shownTailBar;
          const visibility = bi < shown.firstBar || bi > shown.lastBar ? 'hidden' : '';
          if (el.style.visibility !== visibility) el.style.visibility = visibility;
          el.classList.toggle('score-view-cell--tail', tail);
          el.classList.toggle('score-view-cell--lead', bi === shownLeadBar);
        }
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
      playhead.hidden = false;
      host.replaceChildren();
      signature?.replaceChildren();
    };
  }, [
    model,
    geometry,
    placements,
    rows,
    pad,
    scheduler,
    sequence,
    paged,
    signaturePx,
    keyChangeWidths,
  ]);

  if (model.staves.length === 0) {
    return (
      <div className="card empty-view">
        <h3>譜面にできる音がありません</h3>
      </div>
    );
  }

  const labelIndexes = labelKey ? labelKey.split(',').map(Number) : [];
  const height = (pad.top + TOP + rows.height + BOTTOM_ROOM + pad.bottom) * SCALE;
  return (
    <div className="card score-view">
      <div className="score-view-frame" style={{ height }}>
        <div className="score-view-labels" style={{ width: LABEL_WIDTH }}>
          {placements.map((p, i) => {
            const first = rows.tops[p.first]!;
            const last = rows.tops[p.first + p.count - 1]!;
            const centre = pad.top + (first + last) / 2 + TOP + STAFF_CENTER;
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
          {paged && (
            <div
              className="score-view-signature"
              ref={signatureRef}
              style={{ width: signaturePx }}
            />
          )}
          <div
            className="score-view-svg"
            ref={hostRef}
            // A label in the last bar can run any distance past the end of the score, so the host
            // reaches as far beyond it as the viewport can show.
            style={{ width: `calc(${geometry.total * SCALE + HOST_PAD}px + 100vw)`, height }}
          />
          {paged && <div className="score-view-page-end" ref={pageEndRef} />}
          <div
            className="score-view-playhead"
            ref={playheadRef}
            style={{ left: paged ? 0 : `${PLAYHEAD_RATIO * 100}%` }}
          />
        </div>
      </div>
    </div>
  );
}
