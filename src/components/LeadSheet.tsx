import { memo, useEffect, useMemo, useRef } from 'react';
import { secondsToTick } from '../lib/smf/playback.ts';
import type { PlaybackSequence } from '../lib/smf/playback.ts';
import { formatKeySignature, tickToBarBeat } from '../lib/smf/timing.ts';
import type {
  KeySignature,
  SmfTiming,
  TimeSignature,
  TimeSignatureChange,
} from '../lib/smf/timing.ts';
import { formatChord } from '../lib/xf/format.ts';
import type { LyricSyllable } from '../lib/xf/lyrics.ts';
import type { StyleMessage } from '../lib/xf/types.ts';

const BARS_PER_ROW = 4;

type ChordMsg = Extract<StyleMessage, { kind: 'chord' }>;
type RehearsalMsg = Extract<StyleMessage, { kind: 'rehearsal' }>;

interface PlacedChord {
  msg: ChordMsg;
  xPercent: number;
}

interface PlacedRehearsal {
  msg: RehearsalMsg;
  xPercent: number;
}

interface PlacedSyllable {
  syllable: LyricSyllable;
  xPercent: number;
}

interface RowSpec {
  startBar: number;
  barCount: number;
}

interface LeadSheetProps {
  chords: ChordMsg[];
  rehearsals: RehearsalMsg[];
  syllables: LyricSyllable[];
  timing: SmfTiming;
  sequence: PlaybackSequence | null;
  getPositionSeconds: (() => number) | null;
}

export const LeadSheet = memo(function LeadSheet({
  chords,
  rehearsals,
  syllables,
  timing,
  sequence,
  getPositionSeconds,
}: LeadSheetProps) {
  const renderable = useMemo(
    () => syllables.filter((s) => s.runs.length > 0),
    [syllables],
  );

  const totalBars = useMemo(() => {
    if (
      chords.length === 0 &&
      rehearsals.length === 0 &&
      syllables.length === 0
    )
      return 0;
    let maxTick = 0;
    for (const c of chords) if (c.tick > maxTick) maxTick = c.tick;
    for (const r of rehearsals) if (r.tick > maxTick) maxTick = r.tick;
    for (const s of syllables) if (s.tick > maxTick) maxTick = s.tick;
    const bb = tickToBarBeat(maxTick, timing);
    return bb ? bb.bar : 1;
  }, [chords, rehearsals, syllables, timing]);

  const rows = useMemo<RowSpec[]>(() => {
    const out: RowSpec[] = [];
    for (let s = 1; s <= totalBars; s += BARS_PER_ROW) {
      const remaining = totalBars - s + 1;
      out.push({ startBar: s, barCount: Math.min(BARS_PER_ROW, remaining) });
    }
    return out;
  }, [totalBars]);

  const barTimeSignatures = useMemo(() => {
    const map = new Map<number, TimeSignature>();
    let lastShown: TimeSignature | null = null;
    for (const change of timing.timeSignatures) {
      const bb = tickToBarBeat(change.tick, timing);
      if (!bb) continue;
      if (bb.bar > totalBars) break;
      if (lastShown && sameSignatureDisplay(lastShown, change.signature))
        continue;
      map.set(bb.bar, change.signature);
      lastShown = change.signature;
    }
    return map;
  }, [timing, totalBars]);

  const barKeySignatures = useMemo(() => {
    const map = new Map<number, KeySignature>();
    let lastKey: KeySignature | null = null;
    for (const change of timing.keySignatures) {
      const bb = tickToBarBeat(change.tick, timing);
      if (!bb) continue;
      if (bb.bar > totalBars) break;
      if (lastKey && sameKeyDisplay(lastKey, change.signature)) continue;
      map.set(bb.bar, change.signature);
      lastKey = change.signature;
    }
    return map;
  }, [timing, totalBars]);

  const scoreRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!sequence || !getPositionSeconds) return;
    const container = scoreRef.current;
    if (!container) return;
    const playheads = Array.from(
      container.querySelectorAll<HTMLSpanElement>(
        ':scope > .score-row > .score-playhead',
      ),
    );
    let raf = 0;
    let cancelled = false;
    let lastPos = NaN;
    const tick = () => {
      if (cancelled) return;
      const seconds = getPositionSeconds();
      const tickValue = secondsToTick(seconds, sequence);
      const pos = barPositionAt(tickValue, timing);
      if (pos !== lastPos) {
        lastPos = pos;
        for (let idx = 0; idx < rows.length; idx += 1) {
          const el = playheads[idx];
          if (!el) continue;
          const startPos = rows[idx]!.startBar - 1;
          const endPos = startPos + rows[idx]!.barCount;
          if (pos >= startPos && pos < endPos) {
            el.style.opacity = '';
            el.style.left = `${((pos - startPos) / rows[idx]!.barCount) * 100}%`;
          } else if (el.style.opacity !== '0') {
            el.style.opacity = '0';
          }
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [sequence, getPositionSeconds, rows, timing]);

  if (totalBars === 0) return null;
  if (timing.ppq <= 0) return null;

  return (
    <div className="card lead-sheet">
      <h3>コード進行</h3>
      <div className="score" ref={scoreRef}>
        {rows.map((row) => (
          <ScoreRow
            key={row.startBar}
            startBar={row.startBar}
            barCount={row.barCount}
            chords={chords}
            rehearsals={rehearsals}
            syllables={renderable}
            timing={timing}
            barTimeSignatures={barTimeSignatures}
            barKeySignatures={barKeySignatures}
          />
        ))}
      </div>
    </div>
  );
});

function sameSignatureDisplay(a: TimeSignature, b: TimeSignature): boolean {
  return a.numerator === b.numerator && a.denominator === b.denominator;
}

function sameKeyDisplay(a: KeySignature, b: KeySignature): boolean {
  return a.sharps === b.sharps && a.mode === b.mode;
}

function ScoreRow({
  startBar,
  barCount,
  chords,
  rehearsals,
  syllables,
  timing,
  barTimeSignatures,
  barKeySignatures,
}: {
  startBar: number;
  barCount: number;
  chords: ChordMsg[];
  rehearsals: RehearsalMsg[];
  syllables: LyricSyllable[];
  timing: SmfTiming;
  barTimeSignatures: Map<number, TimeSignature>;
  barKeySignatures: Map<number, KeySignature>;
}) {
  const startPos = startBar - 1;
  const endPos = startPos + barCount;

  const placedChords = useMemo<PlacedChord[]>(() => {
    const out: PlacedChord[] = [];
    for (const c of chords) {
      const x = placeIfInRow(c.tick, timing, startPos, endPos, barCount);
      if (x !== null) out.push({ msg: c, xPercent: x });
    }
    return out;
  }, [chords, timing, startPos, endPos, barCount]);

  const placedRehearsals = useMemo<PlacedRehearsal[]>(() => {
    const out: PlacedRehearsal[] = [];
    for (const r of rehearsals) {
      const x = placeIfInRow(r.tick, timing, startPos, endPos, barCount);
      if (x !== null) out.push({ msg: r, xPercent: x });
    }
    return out;
  }, [rehearsals, timing, startPos, endPos, barCount]);

  const placedSyllables = useMemo<PlacedSyllable[]>(() => {
    const out: PlacedSyllable[] = [];
    for (const s of syllables) {
      const x = placeIfInRow(s.tick, timing, startPos, endPos, barCount);
      if (x !== null) out.push({ syllable: s, xPercent: x });
    }
    return out;
  }, [syllables, timing, startPos, endPos, barCount]);

  const bars = useMemo(
    () => Array.from({ length: barCount }, (_, i) => startBar + i),
    [barCount, startBar],
  );

  return (
    <div className="score-row">
      <span
        className="score-playhead"
        aria-hidden="true"
        style={{ opacity: 0 }}
      />
      <div className="score-rehearsals">
        {placedRehearsals.map((p, i) => (
          <span
            key={i}
            className="score-rehearsal"
            style={{ left: `${p.xPercent}%` }}
          >
            {p.msg.letter}
            {"'".repeat(p.msg.variation)}
          </span>
        ))}
      </div>

      <div className="score-bars">
        {bars.map((bar) => {
          const sig = barTimeSignatures.get(bar);
          const key = barKeySignatures.get(bar);
          const hasMeta = sig !== undefined || key !== undefined;
          return (
            <div key={bar} className="score-bar-cell">
              <span className="score-bar-num">{bar}</span>
              {hasMeta && (
                <div className="score-bar-meta">
                  {key && (
                    <span
                      className="score-key"
                      aria-label={`Key ${formatKeySignature(key)}`}
                    >
                      <span className="score-key-label">KEY</span>
                      <span className="score-key-value">
                        {formatKeySignature(key)}
                      </span>
                    </span>
                  )}
                  {sig && (
                    <span
                      className="score-timesig"
                      aria-label={`Time signature ${sig.numerator}/${sig.denominator}`}
                    >
                      <span className="score-timesig-num">{sig.numerator}</span>
                      <span className="score-timesig-den">
                        {sig.denominator}
                      </span>
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="score-chords">
        {placedChords.map((p, i) => (
          <span
            key={i}
            className="score-chord"
            style={{ left: `${p.xPercent}%` }}
          >
            {formatChord(p.msg.root, p.msg.type, p.msg.bass)}
          </span>
        ))}
      </div>

      {placedSyllables.length > 0 && (
        <div className="score-lyrics">
          {placedSyllables.map((p, i) => (
            <span
              key={i}
              className="score-lyric"
              style={{ left: `${p.xPercent}%` }}
            >
              {p.syllable.runs.map((run, j) => {
                if (run.kind === 'text') {
                  return <span key={j}>{run.text}</span>;
                }
                return (
                  <ruby key={j}>
                    {run.base}
                    <rt>{run.reading}</rt>
                  </ruby>
                );
              })}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function findSignatureAt(
  tick: number,
  signatures: TimeSignatureChange[],
): TimeSignature {
  let result = signatures[0]!.signature;
  for (const s of signatures) {
    if (s.tick <= tick) result = s.signature;
    else break;
  }
  return result;
}

function barPositionAt(tick: number, timing: SmfTiming): number {
  const bb = tickToBarBeat(tick, timing);
  if (!bb) return 0;
  const sig = findSignatureAt(tick, timing.timeSignatures);
  const ticksPerBeat = Math.max(
    1,
    Math.round((timing.ppq * 4) / sig.denominator),
  );
  const beatPos = bb.beat - 1 + bb.tickInBeat / ticksPerBeat;
  return bb.bar - 1 + beatPos / sig.numerator;
}

function placeIfInRow(
  tick: number,
  timing: SmfTiming,
  startPos: number,
  endPos: number,
  barCount: number,
): number | null {
  const pos = barPositionAt(tick, timing);
  if (pos < startPos || pos >= endPos) return null;
  return ((pos - startPos) / barCount) * 100;
}
