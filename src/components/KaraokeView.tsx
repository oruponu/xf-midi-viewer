import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import type { MidiScheduler } from '../lib/player/scheduler.ts';
import type { PlaybackSequence } from '../lib/smf/playback.ts';
import { secondsToTick } from '../lib/smf/playback.ts';
import {
  buildKaraokeRows,
  chooseMergedPairs,
  resolveKaraokeDisplay,
} from '../lib/xf/karaokePages.ts';
import type {
  KaraokeDisplay,
  KaraokePage,
  KaraokeRow,
  LineAlignment,
} from '../lib/xf/karaokePages.ts';
import type { LyricLine, LyricRun } from '../lib/xf/lyrics.ts';

const PREVIEW_LEAD_SECONDS = 1;

type LineStatus = 'past' | 'sung' | 'active' | 'upcoming';

interface MergeState {
  pages: KaraokePage[];
  pairs: boolean[][];
}

interface KaraokeViewProps {
  pages: KaraokePage[];
  sequence: PlaybackSequence;
  scheduler: MidiScheduler;
}

export const KaraokeView = memo(function KaraokeView({
  pages,
  sequence,
  scheduler,
}: KaraokeViewProps) {
  const [activeState, setActiveState] = useState<KaraokeDisplay>({
    pageIdx: 0,
    lineIdx: 0,
    preview: false,
  });
  const [mergeState, setMergeState] = useState<MergeState>({ pages: [], pairs: [] });

  const stageRef = useRef<HTMLDivElement | null>(null);
  const measureLayerRef = useRef<HTMLDivElement | null>(null);

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
  }, [pages]);

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
    if (pages.length === 0) return;

    let raf = 0;
    let cancelled = false;
    let last: KaraokeDisplay | null = null;

    const loop = () => {
      if (cancelled) return;
      const position = scheduler.getPosition();
      const tick = secondsToTick(position, sequence);
      const lookaheadTick = secondsToTick(
        position + PREVIEW_LEAD_SECONDS * scheduler.getState().playbackRate,
        sequence,
      );
      const display = resolveKaraokeDisplay(pages, tick, lookaheadTick);
      const { pageIdx, lineIdx } = display;
      const page = pages[pageIdx]!;
      const switched =
        last === null ||
        pageIdx !== last.pageIdx ||
        lineIdx !== last.lineIdx ||
        display.preview !== last.preview;
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
            pages,
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
  }, [sequence, scheduler, pages]);

  if (pages.length === 0) return null;
  const activePage = pages[Math.min(activeState.pageIdx, pages.length - 1)]!;
  const activeLineIndex = Math.min(activeState.lineIdx, activePage.lines.length - 1);
  const nextPage = activeState.preview ? pages[activeState.pageIdx + 1] : undefined;
  const rowsOf = (pageIdx: number) => {
    const pairs = mergeState.pages === pages ? mergeState.pairs[pageIdx] : undefined;
    return buildKaraokeRows(pairs ?? pages[pageIdx]!.lines.map(() => false));
  };

  return (
    <div className="card karaoke-view">
      <h3>カラオケ</h3>
      <div className="karaoke-stage" ref={stageRef}>
        <KaraokeMeasureLayer pages={pages} layerRef={measureLayerRef} />
        {nextPage &&
          rowsOf(activeState.pageIdx + 1)
            .slice(0, -1)
            .map((row) => (
              <KaraokeRowView
                key={`preview-${rowKey(row)}`}
                row={row}
                lines={nextPage.lines}
                statusOf={() => 'upcoming'}
                activeLineRef={activeLineRef}
                fillRef={fillRef}
              />
            ))}
        {rowsOf(activeState.pageIdx).map((row) => (
          <KaraokeRowView
            key={rowKey(row)}
            row={row}
            lines={activePage.lines}
            statusOf={(i) =>
              i < activeLineIndex ? 'past' : i === activeLineIndex ? 'active' : 'upcoming'
            }
            activeLineRef={activeLineRef}
            fillRef={fillRef}
          />
        ))}
      </div>
    </div>
  );
});

const KaraokeMeasureLayer = memo(function KaraokeMeasureLayer({
  pages,
  layerRef,
}: {
  pages: KaraokePage[];
  layerRef: RefObject<HTMLDivElement | null>;
}) {
  return (
    <div className="karaoke-measure" ref={layerRef} aria-hidden="true">
      <span className="karaoke-line karaoke-gap"> </span>
      {pages.map((page, p) => (
        <div key={p} data-measure-page="">
          {page.lines.map((line, i) => (
            <div key={i} className="karaoke-line">
              {renderLineContent(line)}
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
  statusOf,
  activeLineRef,
  fillRef,
}: {
  row: KaraokeRow;
  lines: LyricLine[];
  statusOf: (lineIndex: number) => LineStatus;
  activeLineRef: RefObject<HTMLDivElement | null>;
  fillRef: RefObject<HTMLSpanElement | null>;
}) {
  const [left, right] = row.lineIndices;
  if (right === undefined) {
    return (
      <KaraokeLineView
        line={lines[left]!}
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
        status={leftStatus === 'past' ? 'sung' : leftStatus}
        activeLineRef={activeLineRef}
        fillRef={fillRef}
      />
      <span className="karaoke-line karaoke-gap"> </span>
      <KaraokeLineView
        line={lines[right]!}
        status={rightStatus}
        activeLineRef={activeLineRef}
        fillRef={fillRef}
      />
    </div>
  );
}

function KaraokeLineView({
  line,
  alignment,
  status,
  activeLineRef,
  fillRef,
}: {
  line: LyricLine;
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
      <span className="karaoke-line-base">{renderLineContent(line)}</span>
      {isActive && (
        <span className="karaoke-line-fill" ref={fillRef} style={{ width: 0 }}>
          {renderLineContent(line)}
        </span>
      )}
      {status === 'sung' && (
        <span className="karaoke-line-fill" style={{ width: '100%' }}>
          {renderLineContent(line)}
        </span>
      )}
    </div>
  );
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

function renderLineContent(line: LyricLine): ReactNode {
  return line.syllables.map((syl, i) => (
    <span key={i} className="karaoke-syl" data-syl-idx={i}>
      {syl.runs.map((run, j) => renderRun(run, j))}
    </span>
  ));
}

function renderRun(run: LyricRun, index: number): ReactNode {
  if (run.kind === 'text') {
    return <span key={index}>{run.text}</span>;
  }
  return (
    <ruby key={index}>
      {run.base}
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
  if (activeSyl.vocalPart === 'speech' || activeSyl.vocalPart === 'nonLyric') {
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
