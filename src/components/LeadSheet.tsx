import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useMediaQuery } from '../hooks/useMediaQuery.ts';
import { barDemands, barFits, labelScale } from '../lib/layout/barFit.ts';
import type { LabelDemands, MeasuredLabel } from '../lib/layout/barFit.ts';
import { barTempos } from '../lib/layout/barTempos.ts';
import { PANEL_INSET_CHANGE_EVENT } from '../lib/layout/panelCover.ts';
import { buildScoreRows, countScoreBars } from '../lib/layout/scoreRows.ts';
import type { ScoreRowSpec } from '../lib/layout/scoreRows.ts';
import { labelSpan, spreadLabels } from '../lib/layout/spread.ts';
import type { SpreadItem } from '../lib/layout/spread.ts';
import type { MidiScheduler } from '../lib/player/scheduler.ts';
import { keyShiftAt } from '../lib/smf/fixedKey.ts';
import type { KeyShiftChange } from '../lib/smf/fixedKey.ts';
import { secondsToTick } from '../lib/smf/playback.ts';
import type { PlaybackSequence } from '../lib/smf/playback.ts';
import { formatKeySignature, shiftKeySignature, tickToBarBeat } from '../lib/smf/timing.ts';
import type {
  KeySignature,
  KeySignatureChange,
  SmfTiming,
  TimeSignature,
  TimeSignatureChange,
} from '../lib/smf/timing.ts';
import { formatChord } from '../lib/xf/format.ts';
import type { LyricSyllable } from '../lib/xf/lyrics.ts';
import { transposeChord } from '../lib/xf/transpose.ts';
import type { ChordMessage, RehearsalMessage } from '../lib/xf/types.ts';
import { AccidentalText } from './AccidentalText.tsx';

const BARS_PER_ROW = 4;
const NARROW_BARS_PER_ROW = 2;

const CHORD_PAD = 2;
const CHORD_GAP = 8;
const LYRIC_PAD = 6;
const LYRIC_GAP = 2;

const STAFF_BORDER = 2;

interface LabelFit {
  demands: LabelDemands;
  width: number;
}

interface Placement {
  xPercent: number;
  barIndex: number;
}

interface PlacedChord extends Placement {
  msg: ChordMessage;
}

interface PlacedRehearsal extends Placement {
  msg: RehearsalMessage;
}

interface PlacedSyllable extends Placement {
  syllable: LyricSyllable;
}

interface LeadSheetProps {
  chords: ChordMessage[];
  rehearsals: RehearsalMessage[];
  syllables: LyricSyllable[];
  timing: SmfTiming;
  sequence: PlaybackSequence;
  scheduler: MidiScheduler;
  autoScroll: boolean;
  keyShifts: readonly KeyShiftChange[];
  playbackRate: number;
}

export const LeadSheet = memo(function LeadSheet({
  chords,
  rehearsals,
  syllables,
  timing,
  sequence,
  scheduler,
  autoScroll,
  keyShifts,
  playbackRate,
}: LeadSheetProps) {
  const renderable = useMemo(() => syllables.filter((s) => s.runs.length > 0), [syllables]);

  const totalBars = useMemo(
    () =>
      countScoreBars(
        [...chords, ...rehearsals, ...syllables].map((m) => m.tick),
        sequence.durationTicks,
        timing,
      ),
    [chords, rehearsals, syllables, sequence.durationTicks, timing],
  );

  const isNarrow = useMediaQuery('(max-width: 720px)');
  const barsPerRow = isNarrow ? NARROW_BARS_PER_ROW : BARS_PER_ROW;

  const scoreRef = useRef<HTMLDivElement | null>(null);
  const measureRef = useRef<HTMLDivElement | null>(null);
  const [labelFit, setLabelFit] = useState<LabelFit | null>(null);

  useLayoutEffect(() => {
    const score = scoreRef.current;
    const layer = measureRef.current;
    if (!score || !layer) return;
    let cancelled = false;
    let demands = measureDemands(layer);
    const update = () => {
      const width = score.clientWidth;
      setLabelFit((prev) =>
        prev?.demands === demands && prev.width === width ? prev : { demands, width },
      );
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(score);
    void document.fonts.ready.then(() => {
      if (cancelled) return;
      demands = measureDemands(layer);
      update();
    });
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [chords, renderable, timing, keyShifts, totalBars]);

  const rows = useMemo<ScoreRowSpec[]>(() => {
    const sectionStartBars = rehearsals.flatMap((r) => tickToBarBeat(r.tick, timing)?.bar ?? []);
    const fit = labelFit !== null && labelFit.width > 0 ? labelFit : null;
    const fits = fit
      ? (bar: number, rowBars: number) => barFits(fit.demands, bar, barWidth(fit.width, rowBars))
      : undefined;
    return buildScoreRows(totalBars, barsPerRow, sectionStartBars, fits);
  }, [rehearsals, timing, totalBars, barsPerRow, labelFit]);

  const barTimeSignatures = useMemo(() => {
    const map = new Map<number, TimeSignature>();
    let lastShown: TimeSignature | null = null;
    for (const change of timing.timeSignatures) {
      const bb = tickToBarBeat(change.tick, timing);
      if (!bb) continue;
      if (bb.bar > totalBars) break;
      if (lastShown && sameSignatureDisplay(lastShown, change.signature)) continue;
      map.set(bb.bar, change.signature);
      lastShown = change.signature;
    }
    return map;
  }, [timing, totalBars]);

  const barKeySignatures = useMemo(() => {
    const map = new Map<number, KeySignatureChange>();
    let lastKey: KeySignature | null = null;
    for (const change of timing.keySignatures) {
      const bb = tickToBarBeat(change.tick, timing);
      if (!bb) continue;
      if (bb.bar > totalBars) break;
      if (lastKey && sameKeyDisplay(lastKey, change.signature)) continue;
      map.set(bb.bar, change);
      lastKey = change.signature;
    }
    return map;
  }, [timing, totalBars]);

  const barTempoBpms = useMemo(
    () => barTempos(sequence.tempos, timing, totalBars, playbackRate),
    [sequence.tempos, timing, totalBars, playbackRate],
  );

  useEffect(() => {
    const container = scoreRef.current;
    if (!container) return;
    const rowEls = Array.from(container.querySelectorAll<HTMLElement>(':scope > .score-row'));
    const playheads = Array.from(
      container.querySelectorAll<HTMLSpanElement>(':scope > .score-row > .score-playhead'),
    );
    const chordEls = Array.from(container.querySelectorAll<HTMLElement>('.score-chord'));
    const lyricEls = Array.from(container.querySelectorAll<HTMLElement>('.score-lyric'));
    const chordTicks = chordEls.map((el) => Number(el.dataset.tick ?? '0'));
    const lyricTicks = lyricEls.map((el) => Number(el.dataset.tick ?? '0'));
    let raf = 0;
    let cancelled = false;
    let lastPos = NaN;
    let lastTick = NaN;
    let lastActiveRowIdx = -1;
    let scrolled = false;
    const tick = () => {
      if (cancelled) return;
      const seconds = scheduler.getPosition();
      const tickValue = secondsToTick(seconds, sequence);
      const pos = barPositionAt(tickValue, timing);
      if (pos !== lastPos) {
        lastPos = pos;
        let activeRowIdx = -1;
        for (let idx = 0; idx < rows.length; idx += 1) {
          const el = playheads[idx];
          if (!el) continue;
          const startPos = rows[idx]!.startBar - 1;
          const endPos = startPos + rows[idx]!.barCount;
          if (pos >= startPos && pos < endPos) {
            activeRowIdx = idx;
            el.style.opacity = '';
            el.style.left = `${((pos - startPos) / rows[idx]!.barCount) * 100}%`;
          } else if (el.style.opacity !== '0') {
            el.style.opacity = '0';
          }
        }
        if (activeRowIdx !== lastActiveRowIdx) {
          lastActiveRowIdx = activeRowIdx;
          if (autoScroll) {
            const activeRow = rowEls[activeRowIdx];
            if (activeRow) {
              activeRow.scrollIntoView({
                block: 'center',
                behavior: scrolled ? 'smooth' : 'instant',
              });
              scrolled = true;
            }
          }
        }
      }
      if (tickValue !== lastTick) {
        const initial = Number.isNaN(lastTick);
        lastTick = tickValue;
        markProgress(chordEls, chordTicks, tickValue, 'score-chord');
        markProgress(lyricEls, lyricTicks, tickValue, 'score-lyric');
        // Row layout has already resolved the unplayed colors, so the first marking would fade.
        if (initial) for (const a of container.getAnimations({ subtree: true })) a.finish();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const onInsetChange = () => {
      lastPos = NaN;
      lastActiveRowIdx = -2;
    };
    window.addEventListener(PANEL_INSET_CHANGE_EVENT, onInsetChange);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      window.removeEventListener(PANEL_INSET_CHANGE_EVENT, onInsetChange);
      markProgress(chordEls, chordTicks, -1, 'score-chord');
      markProgress(lyricEls, lyricTicks, -1, 'score-lyric');
    };
  }, [sequence, scheduler, rows, timing, autoScroll]);

  if (totalBars === 0) return null;
  if (timing.ppq <= 0) return null;

  return (
    <div className="card lead-sheet">
      <div className="score" ref={scoreRef}>
        {rows.map((row) => {
          const scales = rowScales(labelFit, row);
          return (
            <ScoreRow
              key={row.startBar}
              startBar={row.startBar}
              barCount={row.barCount}
              barsPerRow={row.barsPerRow}
              chordScale={scales.chord}
              lyricScale={scales.lyric}
              chords={chords}
              rehearsals={rehearsals}
              syllables={renderable}
              timing={timing}
              barTimeSignatures={barTimeSignatures}
              barKeySignatures={barKeySignatures}
              barTempoBpms={barTempoBpms}
              keyShifts={keyShifts}
            />
          );
        })}
      </div>
      <div className="score-measure" ref={measureRef} aria-hidden="true">
        <div className="score-measure-chords">
          {chords.map((c, i) => (
            <ChordLabel
              key={i}
              msg={c}
              bar={barNumberAt(c.tick, timing)}
              timing={timing}
              keyShifts={keyShifts}
            />
          ))}
        </div>
        <div className="score-measure-lyrics">
          {renderable.map((s, i) => (
            <LyricLabel key={i} syllable={s} bar={barNumberAt(s.tick, timing)} />
          ))}
        </div>
      </div>
    </div>
  );
});

function markProgress(els: HTMLElement[], ticks: number[], tick: number, block: string): void {
  let current = -1;
  for (let i = 0; i < ticks.length; i += 1) {
    if (ticks[i]! <= tick) current = i;
  }
  for (let i = 0; i < els.length; i += 1) {
    els[i]!.classList.toggle(`${block}--passed`, i < current);
    els[i]!.classList.toggle(`${block}--current`, i === current);
  }
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
  barsPerRow,
  chordScale,
  lyricScale,
  chords,
  rehearsals,
  syllables,
  timing,
  barTimeSignatures,
  barKeySignatures,
  barTempoBpms,
  keyShifts,
}: {
  startBar: number;
  barCount: number;
  barsPerRow: number;
  chordScale: number;
  lyricScale: number;
  chords: ChordMessage[];
  rehearsals: RehearsalMessage[];
  syllables: LyricSyllable[];
  timing: SmfTiming;
  barTimeSignatures: Map<number, TimeSignature>;
  barKeySignatures: Map<number, KeySignatureChange>;
  barTempoBpms: Map<number, number>;
  keyShifts: readonly KeyShiftChange[];
}) {
  const startPos = startBar - 1;
  const endPos = startPos + barCount;

  const placedChords = useMemo<PlacedChord[]>(() => {
    const out: PlacedChord[] = [];
    for (const c of chords) {
      const p = placeIfInRow(c.tick, timing, startPos, endPos, barCount);
      if (p !== null) out.push({ msg: c, ...p });
    }
    return out;
  }, [chords, timing, startPos, endPos, barCount]);

  const placedRehearsals = useMemo<PlacedRehearsal[]>(() => {
    const out: PlacedRehearsal[] = [];
    for (const r of rehearsals) {
      const p = placeIfInRow(r.tick, timing, startPos, endPos, barCount);
      if (p !== null) out.push({ msg: r, ...p });
    }
    return out;
  }, [rehearsals, timing, startPos, endPos, barCount]);

  const placedSyllables = useMemo<PlacedSyllable[]>(() => {
    const out: PlacedSyllable[] = [];
    for (const s of syllables) {
      const p = placeIfInRow(s.tick, timing, startPos, endPos, barCount);
      if (p !== null) out.push({ syllable: s, ...p });
    }
    return out;
  }, [syllables, timing, startPos, endPos, barCount]);

  const staffRef = useRef<HTMLDivElement | null>(null);
  const chordsRef = useRef<HTMLDivElement | null>(null);
  const lyricsRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const staff = staffRef.current;
    if (!staff) return;
    const layout = () => {
      spreadLayer(chordsRef.current, barCount, CHORD_PAD, CHORD_GAP);
      spreadLayer(lyricsRef.current, barCount, LYRIC_PAD, LYRIC_GAP);
    };
    layout();
    let cancelled = false;
    void document.fonts.ready.then(() => {
      if (!cancelled) layout();
    });
    const observer = new ResizeObserver(layout);
    observer.observe(staff);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [placedChords, placedSyllables, barCount, keyShifts, chordScale, lyricScale]);

  const bars = useMemo(
    () => Array.from({ length: barCount }, (_, i) => startBar + i),
    [barCount, startBar],
  );

  return (
    <div className="score-row" style={{ width: `${(barCount / barsPerRow) * 100}%` }}>
      <span className="score-playhead" aria-hidden="true" style={{ opacity: 0 }} />
      <div className="score-rehearsals">
        {placedRehearsals.map((p, i) => (
          <span
            key={i}
            className={
              p.xPercent === 0 ? 'score-rehearsal score-rehearsal--start' : 'score-rehearsal'
            }
            style={{ left: `${p.xPercent}%` }}
          >
            {p.msg.letter}
            {"'".repeat(p.msg.variation)}
          </span>
        ))}
      </div>

      <div className="score-staff" ref={staffRef}>
        <div className="score-bars">
          {bars.map((bar) => {
            const sig = barTimeSignatures.get(bar);
            const key = barKeySignatures.get(bar);
            const bpm = barTempoBpms.get(bar);
            return (
              <div key={bar} className="score-bar-cell">
                <div className="score-bar-head">
                  <span className="score-bar-num">{bar}</span>
                  {key &&
                    (() => {
                      const semitones = keyShiftAt(key.tick, keyShifts);
                      const shifted =
                        semitones === 0
                          ? key.signature
                          : shiftKeySignature(key.signature, semitones);
                      const label = formatKeySignature(shifted);
                      return (
                        <span className="score-key" aria-label={`Key ${label}`}>
                          <span className="score-key-label">KEY</span>
                          <span className="score-key-value">
                            <AccidentalText text={label} />
                          </span>
                        </span>
                      );
                    })()}
                  {sig && (
                    <span
                      className="score-timesig"
                      aria-label={`Time signature ${sig.numerator}/${sig.denominator}`}
                    >
                      {sig.numerator}/{sig.denominator}
                    </span>
                  )}
                  {bpm !== undefined && (
                    <span className="score-tempo" aria-label={`Tempo ${bpm} BPM`}>
                      <span className="score-tempo-note">♩</span>={bpm}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div
          className="score-chords"
          ref={chordsRef}
          style={scaleStyle('--score-chord-scale', chordScale)}
        >
          {placedChords.map((p, i) => (
            <ChordLabel
              key={i}
              msg={p.msg}
              bar={p.barIndex}
              left={p.xPercent}
              timing={timing}
              keyShifts={keyShifts}
            />
          ))}
        </div>

        {placedSyllables.length > 0 && (
          <div
            className="score-lyrics"
            ref={lyricsRef}
            style={scaleStyle('--score-lyric-scale', lyricScale)}
          >
            {placedSyllables.map((p, i) => (
              <LyricLabel key={i} syllable={p.syllable} bar={p.barIndex} left={p.xPercent} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ChordLabel({
  msg,
  bar,
  left,
  timing,
  keyShifts,
}: {
  msg: ChordMessage;
  bar: number;
  left?: number;
  timing: SmfTiming;
  keyShifts: readonly KeyShiftChange[];
}) {
  return (
    <span
      className="score-chord"
      data-tick={msg.tick}
      data-bar={bar}
      style={left === undefined ? undefined : { left: `${left}%` }}
    >
      <AccidentalText text={formatTransposedChord(msg, timing, keyShifts)} />
    </span>
  );
}

function LyricLabel({
  syllable,
  bar,
  left,
}: {
  syllable: LyricSyllable;
  bar: number;
  left?: number;
}) {
  return (
    <span
      className="score-lyric"
      data-tick={syllable.tick}
      data-bar={bar}
      style={left === undefined ? undefined : { left: `${left}%` }}
    >
      {syllable.runs.map((run, j) => {
        if (run.kind === 'text') {
          return <span key={j}>{run.text}</span>;
        }
        return (
          <ruby key={j}>
            <span>{run.base}</span>
            <rt>{run.reading}</rt>
          </ruby>
        );
      })}
    </span>
  );
}

function scaleStyle(name: string, scale: number): CSSProperties | undefined {
  return scale === 1 ? undefined : ({ [name]: scale } as CSSProperties);
}

function findSignatureAt(tick: number, signatures: TimeSignatureChange[]): TimeSignature {
  let result = signatures[0]!.signature;
  for (const s of signatures) {
    if (s.tick <= tick) result = s.signature;
    else break;
  }
  return result;
}

const C_MAJOR: KeySignature = { sharps: 0, mode: 'major' };

function findKeySignatureAt(tick: number, changes: KeySignatureChange[]): KeySignature {
  if (changes.length === 0) return C_MAJOR;
  let result = changes[0]!.signature;
  for (const c of changes) {
    if (c.tick <= tick) result = c.signature;
    else break;
  }
  return result;
}

function formatTransposedChord(
  chord: ChordMessage,
  timing: SmfTiming,
  keyShifts: readonly KeyShiftChange[],
): string {
  const keyShift = keyShiftAt(chord.tick, keyShifts);
  if (keyShift === 0) return formatChord(chord.root, chord.typeIndex, chord.bass);
  const key = shiftKeySignature(findKeySignatureAt(chord.tick, timing.keySignatures), keyShift);
  const { root, bass } = transposeChord(chord.root, chord.typeIndex, chord.bass, keyShift, key);
  return formatChord(root, chord.typeIndex, bass);
}

function barPositionAt(tick: number, timing: SmfTiming): number {
  const bb = tickToBarBeat(tick, timing);
  if (!bb) return 0;
  const sig = findSignatureAt(tick, timing.timeSignatures);
  const ticksPerBeat = Math.max(1, Math.round((timing.ppq * 4) / sig.denominator));
  const beatPos = bb.beat - 1 + bb.tickInBeat / ticksPerBeat;
  return bb.bar - 1 + beatPos / sig.numerator;
}

function placeIfInRow(
  tick: number,
  timing: SmfTiming,
  startPos: number,
  endPos: number,
  barCount: number,
): Placement | null {
  const pos = barPositionAt(tick, timing);
  if (pos < startPos || pos >= endPos) return null;
  return { xPercent: ((pos - startPos) / barCount) * 100, barIndex: Math.floor(pos - startPos) };
}

function spreadLayer(layer: HTMLElement | null, barCount: number, pad: number, gap: number): void {
  if (!layer) return;
  const els = Array.from(layer.children) as HTMLElement[];
  const anchors = els.map((el) => el.offsetLeft);
  const items = els.map((el, i) => measureLabel(el, anchors[i]! + pad));
  const width = layer.clientWidth;
  const barWidth = width / barCount;

  const order = els.map((_, i) => i).sort((a, b) => anchors[a]! - anchors[b]!);
  const bars = new Map<number, number[]>();
  for (const i of order) {
    const barIndex = Number(els[i]!.dataset.bar ?? '0');
    const group = bars.get(barIndex);
    if (group) group.push(i);
    else bars.set(barIndex, [i]);
  }

  const itemsOf = (indices: number[]) => indices.map((i) => items[i]!);
  const xs = new Array<number>(els.length);
  const place = (indices: number[], lo: number, hi: number) => {
    const placed = spreadLabels(itemsOf(indices), lo, hi, gap);
    indices.forEach((i, k) => (xs[i] = placed[k]!));
  };
  const barsFit = Array.from(bars.values()).every(
    (group) => labelSpan(itemsOf(group), gap) <= barWidth - pad * 2,
  );
  if (barsFit) {
    for (const [barIndex, group] of bars) {
      place(group, barIndex * barWidth + pad, (barIndex + 1) * barWidth - pad);
    }
  } else {
    place(order, pad, width - pad);
  }

  els.forEach((el, i) => (el.style.transform = `translateX(${xs[i]! - anchors[i]!}px)`));
}

function measureLabel(el: HTMLElement, x: number): SpreadItem {
  const rect = el.getBoundingClientRect();
  let left = 0;
  let right = rect.width;
  for (const rt of el.querySelectorAll('rt')) {
    const r = rt.getBoundingClientRect();
    left = Math.min(left, r.left - rect.left);
    right = Math.max(right, r.right - rect.left);
  }
  return { x, left, right };
}

function barNumberAt(tick: number, timing: SmfTiming): number {
  return Math.floor(barPositionAt(tick, timing)) + 1;
}

function barWidth(scoreWidth: number, barsPerRow: number): number {
  return scoreWidth / barsPerRow - STAFF_BORDER;
}

function rowScales(fit: LabelFit | null, row: ScoreRowSpec): { chord: number; lyric: number } {
  if (fit === null || fit.width <= 0) return { chord: 1, lyric: 1 };
  const width = barWidth(fit.width, row.barsPerRow);
  return {
    chord: labelScale(fit.demands.chords, row.startBar, row.barCount, width),
    lyric: labelScale(fit.demands.lyrics, row.startBar, row.barCount, width),
  };
}

function measureDemands(layer: HTMLElement): LabelDemands {
  return {
    chords: barDemands(
      measureLabels(layer.querySelector('.score-measure-chords')),
      CHORD_PAD,
      CHORD_GAP,
    ),
    lyrics: barDemands(
      measureLabels(layer.querySelector('.score-measure-lyrics')),
      LYRIC_PAD,
      LYRIC_GAP,
    ),
  };
}

function measureLabels(layer: Element | null): MeasuredLabel[] {
  if (!layer) return [];
  return Array.from(layer.children as HTMLCollectionOf<HTMLElement>, (el) => {
    const { left, right } = measureLabel(el, 0);
    const style = getComputedStyle(el);
    return {
      bar: Number(el.dataset.bar ?? '0'),
      left,
      right,
      fixed: parseFloat(style.paddingLeft) + parseFloat(style.paddingRight),
    };
  });
}
