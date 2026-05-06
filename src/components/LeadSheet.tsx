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

export function LeadSheet({
  chords,
  rehearsals,
  syllables,
  timing,
}: {
  chords: ChordMsg[];
  rehearsals: RehearsalMsg[];
  syllables: LyricSyllable[];
  timing: SmfTiming;
}) {
  if (timing.ppq <= 0) return null;
  if (chords.length === 0 && rehearsals.length === 0 && syllables.length === 0)
    return null;

  const renderable = syllables.filter((s) => s.runs.length > 0);

  const allTicks = [
    ...chords.map((c) => c.tick),
    ...rehearsals.map((r) => r.tick),
    ...syllables.map((s) => s.tick),
  ];
  const maxTick = Math.max(...allTicks);
  const maxBarBeat = tickToBarBeat(maxTick, timing);
  const totalBars = maxBarBeat ? maxBarBeat.bar : 1;

  const rows: { startBar: number; barCount: number }[] = [];
  for (let s = 1; s <= totalBars; s += BARS_PER_ROW) {
    const remaining = totalBars - s + 1;
    rows.push({ startBar: s, barCount: Math.min(BARS_PER_ROW, remaining) });
  }

  const barTimeSignatures = new Map<number, TimeSignature>();
  let lastShown: TimeSignature | null = null;
  for (const change of timing.timeSignatures) {
    const bb = tickToBarBeat(change.tick, timing);
    if (!bb) continue;
    if (bb.bar > totalBars) break;
    if (lastShown && sameSignatureDisplay(lastShown, change.signature))
      continue;
    barTimeSignatures.set(bb.bar, change.signature);
    lastShown = change.signature;
  }

  const barKeySignatures = new Map<number, KeySignature>();
  let lastKey: KeySignature | null = null;
  for (const change of timing.keySignatures) {
    const bb = tickToBarBeat(change.tick, timing);
    if (!bb) continue;
    if (bb.bar > totalBars) break;
    if (lastKey && sameKeyDisplay(lastKey, change.signature)) continue;
    barKeySignatures.set(bb.bar, change.signature);
    lastKey = change.signature;
  }

  return (
    <div className="card lead-sheet">
      <h3>コード進行</h3>
      <div className="score">
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
}

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

  const placeIfInRow = (tick: number): number | null => {
    const pos = barPositionAt(tick, timing);
    if (pos < startPos || pos >= endPos) return null;
    return ((pos - startPos) / barCount) * 100;
  };

  const placedChords: PlacedChord[] = [];
  for (const c of chords) {
    const x = placeIfInRow(c.tick);
    if (x !== null) placedChords.push({ msg: c, xPercent: x });
  }

  const placedRehearsals: PlacedRehearsal[] = [];
  for (const r of rehearsals) {
    const x = placeIfInRow(r.tick);
    if (x !== null) placedRehearsals.push({ msg: r, xPercent: x });
  }

  const placedSyllables: PlacedSyllable[] = [];
  for (const s of syllables) {
    const x = placeIfInRow(s.tick);
    if (x !== null) placedSyllables.push({ syllable: s, xPercent: x });
  }

  const bars = Array.from({ length: barCount }, (_, i) => startBar + i);

  return (
    <div className="score-row">
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
