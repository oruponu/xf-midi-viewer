import {
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode, RefObject } from 'react';
import type { PlaybackSequence } from '../lib/smf/playback.ts';
import { secondsToTick } from '../lib/smf/playback.ts';
import { buildKaraokePages } from '../lib/xf/karaokePages.ts';
import type { KaraokePage } from '../lib/xf/karaokePages.ts';
import type { LyricLine, LyricRun, ParsedKaraoke } from '../lib/xf/lyrics.ts';

interface KaraokeViewProps {
  parsed: ParsedKaraoke;
  sequence: PlaybackSequence | null;
  getPositionSeconds: (() => number) | null;
}

export const KaraokeView = memo(function KaraokeView({
  parsed,
  sequence,
  getPositionSeconds,
}: KaraokeViewProps) {
  const pages = useMemo(() => buildKaraokePages(parsed), [parsed]);

  const [activeState, setActiveState] = useState<{
    pageIdx: number;
    lineIdx: number;
  }>({ pageIdx: 0, lineIdx: 0 });

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
      lineEl.querySelectorAll<HTMLSpanElement>(
        '.karaoke-line-base .karaoke-syl',
      ),
    );
    lineMetricsRef.current = {
      width: lineEl.offsetWidth,
      syllableLefts: sylEls.map((el) => el.offsetLeft),
      syllableWidths: sylEls.map((el) => el.offsetWidth),
    };
  }, [activeState]);

  useEffect(() => {
    if (!sequence || !getPositionSeconds) {
      setActiveState({ pageIdx: 0, lineIdx: 0 });
      return;
    }
    if (pages.length === 0) return;

    let raf = 0;
    let cancelled = false;
    let lastPageIdx = -1;
    let lastLineIdx = -1;

    const loop = () => {
      if (cancelled) return;
      const tick = secondsToTick(getPositionSeconds(), sequence);
      const pageIdx = findActivePageIndex(pages, tick);
      const page = pages[pageIdx]!;
      const lineIdx = findActiveLineIndex(page.lines, tick);
      const switched = pageIdx !== lastPageIdx || lineIdx !== lastLineIdx;
      if (switched) {
        lastPageIdx = pageIdx;
        lastLineIdx = lineIdx;
        setActiveState({ pageIdx, lineIdx });
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
  }, [sequence, getPositionSeconds, pages]);

  if (pages.length === 0) return null;
  const activePage = pages[Math.min(activeState.pageIdx, pages.length - 1)]!;
  const activeLineIndex = Math.min(
    activeState.lineIdx,
    activePage.lines.length - 1,
  );

  return (
    <div className="card karaoke-view">
      <h3>カラオケ</h3>
      <div className="karaoke-stage">
        <KaraokePageView
          page={activePage}
          activeLineIndex={activeLineIndex}
          activeLineRef={activeLineRef}
          fillRef={fillRef}
        />
      </div>
    </div>
  );
});

function KaraokePageView({
  page,
  activeLineIndex,
  activeLineRef,
  fillRef,
}: {
  page: KaraokePage;
  activeLineIndex: number;
  activeLineRef: RefObject<HTMLDivElement | null>;
  fillRef: RefObject<HTMLSpanElement | null>;
}) {
  return (
    <>
      {page.lines.map((line, i) => {
        const isPast = i < activeLineIndex;
        const isActive = i === activeLineIndex;
        let className = 'karaoke-line';
        if (isPast) className += ' karaoke-line--past';
        if (isActive) className += ' karaoke-line--active';
        return (
          <div
            key={i}
            className={className}
            ref={isActive ? activeLineRef : undefined}
          >
            <span className="karaoke-line-base">{renderLineContent(line)}</span>
            {isActive && (
              <span
                className="karaoke-line-fill"
                ref={fillRef}
                style={{ width: 0 }}
              >
                {renderLineContent(line)}
              </span>
            )}
          </div>
        );
      })}
    </>
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

function findActivePageIndex(pages: KaraokePage[], tick: number): number {
  if (pages.length === 0) return 0;
  let lo = 0;
  let hi = pages.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (pages[mid]!.startTick <= tick) lo = mid + 1;
    else hi = mid;
  }
  return Math.max(0, lo - 1);
}

function findActiveLineIndex(lines: LyricLine[], tick: number): number {
  if (lines.length === 0) return 0;
  let lo = 0;
  let hi = lines.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (lines[mid]!.tick <= tick) lo = mid + 1;
    else hi = mid;
  }
  return Math.max(0, lo - 1);
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
  const endTick =
    activeSyl.endTick ??
    line.endTick ??
    page.endTick ??
    pages[pageIdx + 1]?.startTick ??
    null;

  let fraction: number;
  if (endTick === null) {
    fraction = 1;
  } else {
    const span = endTick - activeSyl.tick;
    fraction =
      span <= 0 ? 1 : Math.min(1, Math.max(0, (tick - activeSyl.tick) / span));
  }

  const left = metrics.syllableLefts[activeIdx] ?? 0;
  const width = metrics.syllableWidths[activeIdx] ?? 0;
  return left + fraction * width;
}
