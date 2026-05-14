import { memo, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
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
      const lineIdx = findActiveLineIndex(pages[pageIdx]!.lines, tick);
      if (pageIdx !== lastPageIdx || lineIdx !== lastLineIdx) {
        lastPageIdx = pageIdx;
        lastLineIdx = lineIdx;
        setActiveState({ pageIdx, lineIdx });
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
        <KaraokePageView page={activePage} activeLineIndex={activeLineIndex} />
      </div>
    </div>
  );
});

function KaraokePageView({
  page,
  activeLineIndex,
}: {
  page: KaraokePage;
  activeLineIndex: number;
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
          <div key={i} className={className}>
            <span className="karaoke-line-base">{renderLineContent(line)}</span>
            {isActive && (
              <span className="karaoke-line-fill" style={{ width: 0 }}>
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
