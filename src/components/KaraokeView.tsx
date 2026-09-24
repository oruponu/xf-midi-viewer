import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import type { MidiScheduler } from '../lib/player/scheduler.ts';
import type { PlaybackSequence } from '../lib/smf/playback.ts';
import { secondsToTick } from '../lib/smf/playback.ts';
import { lineAlignment, resolveKaraokeDisplay } from '../lib/xf/karaokePages.ts';
import type { KaraokeDisplay, KaraokePage } from '../lib/xf/karaokePages.ts';
import type { LyricLine, LyricRun } from '../lib/xf/lyrics.ts';

const PREVIEW_LEAD_SECONDS = 1;

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
    lineMetricsRef.current = {
      width: lineEl.offsetWidth,
      syllableLefts: sylEls.map((el) => el.offsetLeft),
      syllableWidths: sylEls.map((el) => el.offsetWidth),
    };
  }, [activeState]);

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
  const previewLines = nextPage ? nextPage.lines.slice(0, -1) : [];

  return (
    <div className="card karaoke-view">
      <h3>カラオケ</h3>
      <div className="karaoke-stage">
        <KaraokePageView
          page={activePage}
          previewLines={previewLines}
          previewLineCount={nextPage?.lines.length ?? 0}
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
  previewLines,
  previewLineCount,
  activeLineIndex,
  activeLineRef,
  fillRef,
}: {
  page: KaraokePage;
  previewLines: LyricLine[];
  previewLineCount: number;
  activeLineIndex: number;
  activeLineRef: RefObject<HTMLDivElement | null>;
  fillRef: RefObject<HTMLSpanElement | null>;
}) {
  return (
    <>
      {previewLines.map((line, i) => (
        <div
          key={`preview-${i}`}
          className={`karaoke-line karaoke-line--${lineAlignment(i, previewLineCount)}`}
        >
          <span className="karaoke-line-base">{renderLineContent(line)}</span>
        </div>
      ))}
      {page.lines.map((line, i) => {
        const isPast = i < activeLineIndex;
        const isActive = i === activeLineIndex;
        let className = `karaoke-line karaoke-line--${lineAlignment(i, page.lines.length)}`;
        if (isPast) className += ' karaoke-line--past';
        if (isActive) className += ' karaoke-line--active';
        return (
          <div key={i} className={className} ref={isActive ? activeLineRef : undefined}>
            <span className="karaoke-line-base">{renderLineContent(line)}</span>
            {isActive && (
              <span className="karaoke-line-fill" ref={fillRef} style={{ width: 0 }}>
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
