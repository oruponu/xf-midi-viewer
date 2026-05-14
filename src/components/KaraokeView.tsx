import { memo, useMemo } from 'react';
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

  const initialTick = useMemo(() => {
    if (!sequence || !getPositionSeconds) return 0;
    return secondsToTick(getPositionSeconds(), sequence);
  }, [sequence, getPositionSeconds]);

  const activePageIdx = useMemo(
    () => findActivePageIndex(pages, initialTick),
    [pages, initialTick],
  );

  if (pages.length === 0) return null;

  const activePage = pages[activePageIdx]!;

  return (
    <div className="card karaoke-view">
      <h3>カラオケ</h3>
      <div className="karaoke-stage">
        <KaraokePageView page={activePage} activeLineIndex={0} />
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
