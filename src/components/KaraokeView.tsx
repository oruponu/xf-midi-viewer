import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import type { MidiScheduler } from '../lib/player/scheduler.ts';
import type { PlaybackSequence } from '../lib/smf/playback.ts';
import { secondsToTick } from '../lib/smf/playback.ts';
import {
  buildKaraokeRows,
  chooseMergedPairs,
  mergeSingleRowPages,
  resolveKaraokeDisplay,
  splitLongPages,
} from '../lib/xf/karaokePages.ts';
import type {
  KaraokeDisplay,
  KaraokePage,
  KaraokeRow,
  LineAlignment,
} from '../lib/xf/karaokePages.ts';
import type { LyricLine, LyricRun, LyricSyllable } from '../lib/xf/lyrics.ts';
import type { PitchLane } from '../lib/xf/pitchBars.ts';
import type { VocalPart } from '../lib/xf/types.ts';
import { partColorOf } from '../lib/xf/vocalPart.ts';
import { PitchBarLane } from './PitchBarLane.tsx';

const PREVIEW_LEAD_SECONDS = 1;

type DurationLabels = ReadonlyMap<LyricSyllable, string>;

type LineStatus = 'past' | 'sung' | 'active' | 'upcoming';

interface MergeState {
  pages: KaraokePage[];
  pairs: boolean[][];
}

interface KaraokeViewProps {
  pages: KaraokePage[];
  pitchLane: PitchLane | null;
  nonLyricDurations: Map<LyricSyllable, number>;
  playbackRate: number;
  sequence: PlaybackSequence;
  scheduler: MidiScheduler;
}

export const KaraokeView = memo(function KaraokeView({
  pages,
  pitchLane,
  nonLyricDurations,
  playbackRate,
  sequence,
  scheduler,
}: KaraokeViewProps) {
  const durationLabels = useMemo(
    () =>
      new Map(
        Array.from(nonLyricDurations, ([syl, seconds]) => [
          syl,
          `約${Math.round(seconds / playbackRate)}秒`,
        ]),
      ),
    [nonLyricDurations, playbackRate],
  );

  const [activeState, setActiveState] = useState<KaraokeDisplay>(() => {
    if (pages.length === 0) return { pageIdx: 0, lineIdx: 0, preview: false, hidden: false };
    const { tick, lookaheadTick } = playbackTicks(sequence, scheduler);
    return resolveKaraokeDisplay(pages, tick, lookaheadTick);
  });
  const [mergeState, setMergeState] = useState<MergeState>({ pages: [], pairs: [] });

  const screenRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const measureLayerRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const screen = screenRef.current;
    if (!screen) return;
    const update = () => {
      const top = screen.getBoundingClientRect().top + window.scrollY;
      screen.style.setProperty('--karaoke-top', `${top}px`);
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  useLayoutEffect(() => {
    const stage = stageRef.current;
    const layer = measureLayerRef.current;
    if (!stage || !layer) return;
    let cancelled = false;
    const measure = () => {
      if (cancelled) return;
      const style = getComputedStyle(stage);
      const availableWidth =
        stage.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      const gapWidth =
        layer.querySelector<HTMLElement>('.karaoke-gap')?.getBoundingClientRect().width ?? 0;
      const pairs = Array.from(layer.querySelectorAll<HTMLElement>('[data-measure-page]'), (el) =>
        chooseMergedPairs(
          Array.from(el.children, (lineEl) => lineEl.getBoundingClientRect().width),
          gapWidth,
          availableWidth,
        ),
      );
      setMergeState((prev) =>
        prev.pages === pages && samePairs(prev.pairs, pairs) ? prev : { pages, pairs },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    void document.fonts.ready.then(measure);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [pages, durationLabels]);

  const layout = useMemo(() => {
    if (mergeState.pages !== pages) {
      return { pages, pairs: pages.map((page) => page.lines.map(() => false)) };
    }
    const merged = mergeSingleRowPages(pages, mergeState.pairs);
    return splitLongPages(merged.pages, merged.pairs);
  }, [pages, mergeState]);
  const displayPages = layout.pages;

  const activeLineRef = useRef<HTMLDivElement | null>(null);
  const lineMetricsRef = useRef<{
    width: number;
    syllableLefts: number[];
    syllableWidths: number[];
  } | null>(null);
  const fillRef = useRef<HTMLSpanElement | null>(null);

  useLayoutEffect(() => {
    const lineEl = activeLineRef.current;
    if (!lineEl) {
      lineMetricsRef.current = null;
      return;
    }
    const sylEls = Array.from(
      lineEl.querySelectorAll<HTMLSpanElement>('.karaoke-line-base .karaoke-syl'),
    );
    const measure = () => {
      lineMetricsRef.current = {
        width: lineEl.offsetWidth,
        syllableLefts: sylEls.map((el) => el.offsetLeft),
        syllableWidths: sylEls.map((el) => el.offsetWidth),
      };
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(lineEl);
    return () => observer.disconnect();
  }, [activeState, mergeState]);

  useEffect(() => {
    if (displayPages.length === 0) return;

    let raf = 0;
    let cancelled = false;
    let last: KaraokeDisplay | null = null;

    const loop = () => {
      if (cancelled) return;
      const { tick, lookaheadTick } = playbackTicks(sequence, scheduler);
      const display = resolveKaraokeDisplay(displayPages, tick, lookaheadTick);
      const { pageIdx, lineIdx } = display;
      const page = displayPages[pageIdx]!;
      const switched =
        last === null ||
        pageIdx !== last.pageIdx ||
        lineIdx !== last.lineIdx ||
        display.preview !== last.preview ||
        display.hidden !== last.hidden;
      if (switched) {
        last = display;
        setActiveState(display);
      }

      if (!switched) {
        const fillEl = fillRef.current;
        const metrics = lineMetricsRef.current;
        if (fillEl && metrics && page.lines[lineIdx]) {
          const widthPx = computeFillWidth(
            page.lines[lineIdx]!,
            page,
            displayPages,
            pageIdx,
            tick,
            metrics,
          );
          fillEl.style.width = `${widthPx}px`;
        }
      }

      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [sequence, scheduler, displayPages]);

  if (displayPages.length === 0) return null;
  const activePageIdx = Math.min(activeState.pageIdx, displayPages.length - 1);
  const activePage = displayPages[activePageIdx]!;
  const activeLineIndex = Math.min(activeState.lineIdx, activePage.lines.length - 1);
  const nextPage = activeState.preview ? displayPages[activePageIdx + 1] : undefined;
  const rowsOf = (pageIdx: number) => buildKaraokeRows(layout.pairs[pageIdx]!);

  return (
    <div className="card karaoke-view">
      <div className="karaoke-screen" ref={screenRef}>
        <div className="karaoke-stage" ref={stageRef}>
          <KaraokeMeasureLayer
            pages={pages}
            durationLabels={durationLabels}
            layerRef={measureLayerRef}
          />
          {pitchLane && <PitchBarLane lane={pitchLane} sequence={sequence} scheduler={scheduler} />}
          {nextPage &&
            rowsOf(activePageIdx + 1)
              .slice(0, -1)
              .map((row) => (
                <KaraokeRowView
                  key={`preview-${rowKey(row)}`}
                  row={row}
                  lines={nextPage.lines}
                  durationLabels={durationLabels}
                  statusOf={() => 'upcoming'}
                  activeLineRef={activeLineRef}
                  fillRef={fillRef}
                />
              ))}
          {!activeState.hidden &&
            rowsOf(activePageIdx).map((row) => (
              <KaraokeRowView
                key={rowKey(row)}
                row={row}
                lines={activePage.lines}
                durationLabels={durationLabels}
                statusOf={(i) =>
                  i < activeLineIndex ? 'past' : i === activeLineIndex ? 'active' : 'upcoming'
                }
                activeLineRef={activeLineRef}
                fillRef={fillRef}
              />
            ))}
        </div>
      </div>
    </div>
  );
});

const KaraokeMeasureLayer = memo(function KaraokeMeasureLayer({
  pages,
  durationLabels,
  layerRef,
}: {
  pages: KaraokePage[];
  durationLabels: DurationLabels;
  layerRef: RefObject<HTMLDivElement | null>;
}) {
  return (
    <div className="karaoke-measure" ref={layerRef} aria-hidden="true">
      <span className="karaoke-line karaoke-gap"> </span>
      {pages.map((page, p) => (
        <div key={p} data-measure-page="">
          {page.lines.map((line, i) => (
            <div key={i} className="karaoke-line">
              {renderLineContent(line, durationLabels)}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
});

function KaraokeRowView({
  row,
  lines,
  durationLabels,
  statusOf,
  activeLineRef,
  fillRef,
}: {
  row: KaraokeRow;
  lines: LyricLine[];
  durationLabels: DurationLabels;
  statusOf: (lineIndex: number) => LineStatus;
  activeLineRef: RefObject<HTMLDivElement | null>;
  fillRef: RefObject<HTMLSpanElement | null>;
}) {
  const [left, right] = row.lineIndices;
  if (right === undefined) {
    return (
      <KaraokeLineView
        line={lines[left]!}
        durationLabels={durationLabels}
        alignment={row.alignment}
        status={statusOf(left)}
        activeLineRef={activeLineRef}
        fillRef={fillRef}
      />
    );
  }
  const leftStatus = statusOf(left);
  const rightStatus = statusOf(right);
  let className = `karaoke-row karaoke-row--${row.alignment}`;
  if (rightStatus === 'past') className += ' karaoke-row--past';
  return (
    <div className={className}>
      <KaraokeLineView
        line={lines[left]!}
        durationLabels={durationLabels}
        status={leftStatus === 'past' ? 'sung' : leftStatus}
        activeLineRef={activeLineRef}
        fillRef={fillRef}
      />
      <span className="karaoke-line karaoke-gap"> </span>
      <KaraokeLineView
        line={lines[right]!}
        durationLabels={durationLabels}
        status={rightStatus}
        activeLineRef={activeLineRef}
        fillRef={fillRef}
      />
    </div>
  );
}

function KaraokeLineView({
  line,
  durationLabels,
  alignment,
  status,
  activeLineRef,
  fillRef,
}: {
  line: LyricLine;
  durationLabels: DurationLabels;
  alignment?: LineAlignment;
  status: LineStatus;
  activeLineRef: RefObject<HTMLDivElement | null>;
  fillRef: RefObject<HTMLSpanElement | null>;
}) {
  const isActive = status === 'active';
  let className = 'karaoke-line';
  if (alignment) className += ` karaoke-line--${alignment}`;
  if (status === 'past') className += ' karaoke-line--past';
  if (isActive) className += ' karaoke-line--active';
  return (
    <div className={className} ref={isActive ? activeLineRef : undefined}>
      <span className="karaoke-line-base">{renderLineContent(line, durationLabels)}</span>
      {isActive && (
        <span className="karaoke-line-fill" ref={fillRef} style={{ width: 0 }}>
          {renderLineContent(line, durationLabels)}
        </span>
      )}
      {status === 'sung' && (
        <span className="karaoke-line-fill" style={{ width: '100%' }}>
          {renderLineContent(line, durationLabels)}
        </span>
      )}
    </div>
  );
}

function playbackTicks(
  sequence: PlaybackSequence,
  scheduler: MidiScheduler,
): { tick: number; lookaheadTick: number } {
  const position = scheduler.getPosition();
  return {
    tick: secondsToTick(position, sequence),
    lookaheadTick: secondsToTick(
      position + PREVIEW_LEAD_SECONDS * scheduler.getState().playbackRate,
      sequence,
    ),
  };
}

function rowKey(row: KaraokeRow): number {
  return row.lineIndices[0];
}

function samePairs(a: boolean[][], b: boolean[][]): boolean {
  return (
    a.length === b.length &&
    a.every((row, i) => row.length === b[i]!.length && row.every((v, j) => v === b[i]![j]))
  );
}

function renderLineContent(line: LyricLine, durationLabels: DurationLabels): ReactNode {
  return line.syllables.map((syl, i) => (
    <span key={i} className={syllableClassName(syl.vocalPart)} data-syl-idx={i}>
      {syl.runs.map((run, j) => renderRun(run, j))}
      {durationLabels.has(syl) && (
        <>
          {' '}
          <span className="karaoke-syl-duration">{durationLabels.get(syl)}</span>
        </>
      )}
    </span>
  ));
}

function syllableClassName(vocalPart: VocalPart | null): string {
  const className = `karaoke-syl karaoke-syl--part-${partColorOf(vocalPart)}`;
  if (vocalPart === 'speech') return `${className} karaoke-syl--speech`;
  if (vocalPart === 'nonLyric') return `${className} karaoke-syl--non-lyric`;
  return className;
}

function renderRun(run: LyricRun, index: number): ReactNode {
  if (run.kind === 'text') {
    return <span key={index}>{run.text}</span>;
  }
  return (
    <ruby key={index}>
      <span>{run.base}</span>
      <rt>{run.reading}</rt>
    </ruby>
  );
}

function computeFillWidth(
  line: LyricLine,
  page: KaraokePage,
  pages: KaraokePage[],
  pageIdx: number,
  tick: number,
  metrics: {
    width: number;
    syllableLefts: number[];
    syllableWidths: number[];
  },
): number {
  const syls = line.syllables;
  if (syls.length === 0) return 0;

  let activeIdx = -1;
  for (let i = syls.length - 1; i >= 0; i -= 1) {
    if (syls[i]!.tick <= tick) {
      activeIdx = i;
      break;
    }
  }
  if (activeIdx < 0) return 0;

  const activeSyl = syls[activeIdx]!;
  if (activeSyl.vocalPart === 'nonLyric') {
    return metrics.syllableLefts[activeIdx] ?? 0;
  }

  const endTick =
    activeSyl.endTick ?? line.endTick ?? page.endTick ?? pages[pageIdx + 1]?.startTick ?? null;

  let fraction: number;
  if (endTick === null) {
    fraction = 1;
  } else {
    const span = endTick - activeSyl.tick;
    fraction = span <= 0 ? 1 : Math.min(1, Math.max(0, (tick - activeSyl.tick) / span));
  }

  const left = metrics.syllableLefts[activeIdx] ?? 0;
  const width = metrics.syllableWidths[activeIdx] ?? 0;
  return left + fraction * width;
}
