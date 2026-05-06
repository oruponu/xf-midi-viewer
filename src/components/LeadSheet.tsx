import { tickToBarBeat } from '../lib/smf/timing.ts';
import type {
  SmfTiming,
  TimeSignature,
  TimeSignatureChange,
} from '../lib/smf/timing.ts';
import { formatChord } from '../lib/xf/format.ts';
import type { StyleMessage } from '../lib/xf/types.ts';

const BARS_PER_ROW = 4;

type ChordMsg = Extract<StyleMessage, { kind: 'chord' }>;
type RehearsalMsg = Extract<StyleMessage, { kind: 'rehearsal' }>;

interface LyricItem {
  tick: number;
  text: string;
}

interface PlacedChord {
  msg: ChordMsg;
  xPercent: number;
}

interface PlacedRehearsal {
  msg: RehearsalMsg;
  xPercent: number;
}

interface PlacedLyric {
  item: LyricItem;
  xPercent: number;
}

export function LeadSheet({
  chords,
  rehearsals,
  lyrics,
  timing,
}: {
  chords: ChordMsg[];
  rehearsals: RehearsalMsg[];
  lyrics: LyricItem[];
  timing: SmfTiming;
}) {
  if (timing.ppq <= 0) return null;
  if (chords.length === 0 && rehearsals.length === 0 && lyrics.length === 0)
    return null;

  const allTicks = [
    ...chords.map((c) => c.tick),
    ...rehearsals.map((r) => r.tick),
    ...lyrics.map((l) => l.tick),
  ];
  const maxTick = Math.max(...allTicks);
  const maxBarBeat = tickToBarBeat(maxTick, timing);
  const totalBars = maxBarBeat ? maxBarBeat.bar : 1;

  const rows: { startBar: number; barCount: number }[] = [];
  for (let s = 1; s <= totalBars; s += BARS_PER_ROW) {
    const remaining = totalBars - s + 1;
    rows.push({ startBar: s, barCount: Math.min(BARS_PER_ROW, remaining) });
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
            lyrics={lyrics}
            timing={timing}
          />
        ))}
      </div>
    </div>
  );
}

function ScoreRow({
  startBar,
  barCount,
  chords,
  rehearsals,
  lyrics,
  timing,
}: {
  startBar: number;
  barCount: number;
  chords: ChordMsg[];
  rehearsals: RehearsalMsg[];
  lyrics: LyricItem[];
  timing: SmfTiming;
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

  const placedLyrics: PlacedLyric[] = [];
  for (const l of lyrics) {
    const x = placeIfInRow(l.tick);
    if (x !== null) placedLyrics.push({ item: l, xPercent: x });
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
        {bars.map((bar) => (
          <div key={bar} className="score-bar-cell">
            <span className="score-bar-num">{bar}</span>
          </div>
        ))}
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

      {placedLyrics.length > 0 && (
        <div className="score-lyrics">
          {placedLyrics.map((p, i) => (
            <span
              key={i}
              className="score-lyric"
              style={{ left: `${p.xPercent}%` }}
            >
              {p.item.text}
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
