import {
  Accidental,
  Articulation,
  BarlineType,
  Beam,
  Dot,
  Formatter,
  Fraction,
  Metrics,
  ModifierPosition,
  Stave,
  StaveConnector,
  StaveNote,
  StaveTie,
  SVGContext,
  Voice,
} from 'vexflow/bravura';
import type { RenderContext } from 'vexflow/bravura';
import { drumSetKey, OPEN_HI_HAT, percussionKey } from '../lib/score/drums.ts';
import { LEFT_PAD, offsetInBar } from '../lib/score/geometry.ts';
import type { BarGeometry } from '../lib/score/geometry.ts';
import type { ScoreModel, ScoreStaff } from '../lib/score/notation.ts';
import { beamGroups } from '../lib/score/rhythm.ts';
import type { ScoreItem } from '../lib/score/rhythm.ts';

export const SCALE = 0.6;
export const STAFF_GAP = 112;
export const TOP = 30;
// Middle staff line, measured from the stave's y (VexFlow leaves 4 spaces of 10 above the top line).
export const STAFF_CENTER = 60;

// Same on-screen size as the part names; VexFlow reads a bare number as pt.
const MARK_FONT_SIZE = `${12 / SCALE}px`;
const MARK_Y = TOP + 6;

const DURATIONS: Record<number, [string, number]> = {
  16: ['w', 0],
  12: ['h', 1],
  8: ['h', 0],
  6: ['q', 1],
  4: ['q', 0],
  3: ['8', 1],
  2: ['8', 0],
  1: ['16', 0],
};

const SHARP_NAMES = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b'];
const FLAT_NAMES = ['c', 'db', 'd', 'eb', 'e', 'f', 'gb', 'g', 'ab', 'a', 'bb', 'b'];
const MAJOR_KEYS: Record<number, string> = {
  [-7]: 'Cb',
  [-6]: 'Gb',
  [-5]: 'Db',
  [-4]: 'Ab',
  [-3]: 'Eb',
  [-2]: 'Bb',
  [-1]: 'F',
  0: 'C',
  1: 'G',
  2: 'D',
  3: 'A',
  4: 'E',
  5: 'B',
  6: 'F#',
  7: 'C#',
};

type DrumVoice = 'single' | 'hands' | 'feet';

const REST_KEYS: Record<DrumVoice, string> = { single: 'b/4', hands: 'e/5', feet: 'e/4' };

function keySpecOf(sharps: number): string {
  return MAJOR_KEYS[sharps] ?? 'C';
}

function pitchKey(midi: number, sharps: number): string {
  const names = sharps < 0 ? FLAT_NAMES : SHARP_NAMES;
  return `${names[midi % 12]}/${Math.floor(midi / 12) - 1}`;
}

// KeySignature is positioned by the stave's clef, which Stave only sets when it draws a clef.
class ScoreStave extends Stave {
  setClefWithoutSymbol(clef: string): this {
    this.clef = clef;
    return this;
  }
}

function addBarModifiers(
  stave: ScoreStave,
  model: ScoreModel,
  bi: number,
  staff: ScoreStaff | null,
): void {
  const bar = model.bars[bi]!;
  const clef = staff?.clef ?? 'treble';
  const keyed = clef !== 'percussion';
  if (bi === 0) {
    stave.addClef(clef);
    if (keyed) stave.addKeySignature(keySpecOf(bar.keySharps));
  } else if (bar.keyChanged && keyed) {
    stave.setClefWithoutSymbol(clef);
    stave.addKeySignature(keySpecOf(bar.keySharps), keySpecOf(model.bars[bi - 1]!.keySharps));
  }
  if (bar.timeChanged) stave.addTimeSignature(`${bar.numerator}/${bar.denominator}`);
}

// Width of the clef, key and time signatures at the start of a bar, shared by every staff.
export function measurePrefix(model: ScoreModel, bi: number): number {
  const bar = model.bars[bi]!;
  if (bi > 0 && !bar.keyChanged && !bar.timeChanged) return 0;
  const stave = new ScoreStave(0, 0, 1000);
  addBarModifiers(stave, model, bi, null);
  return stave.getNoteStartX();
}

function makeNotes(
  items: readonly ScoreItem[],
  staff: ScoreStaff,
  sharps: number,
  drumVoice: DrumVoice,
): StaveNote[] {
  const drums = staff.kind !== 'pitched';
  return items.map((item) => {
    const rest = item.keys.length === 0;
    const [duration, dots] = rest && items.length === 1 ? ['w', 0] : DURATIONS[item.lenGrid]!;
    let keys: string[];
    if (rest) keys = [staff.clef === 'bass' ? 'd/3' : REST_KEYS[drumVoice]];
    else if (staff.kind === 'drumSet') keys = [...new Set(item.keys.map(drumSetKey))];
    else if (staff.kind === 'percussion') keys = [...new Set(item.keys.map(percussionKey))];
    else keys = item.keys.map((k) => pitchKey(k, sharps));
    const note = new StaveNote({
      keys,
      duration: duration + (rest ? 'r' : ''),
      dots,
      clef: staff.clef,
      autoStem: !drums,
      stemDirection: drums ? (drumVoice === 'feet' ? -1 : 1) : undefined,
    });
    if (dots > 0) Dot.buildAndAttach([note], { all: true });
    if (staff.kind === 'drumSet' && item.keys.includes(OPEN_HI_HAT)) {
      note.addModifier(new Articulation('ah').setPosition(ModifierPosition.ABOVE), 0);
    }
    return note;
  });
}

function cellLayers(staff: ScoreStaff, bi: number): { items: ScoreItem[]; drumVoice: DrumVoice }[] {
  const items = staff.bars[bi] ?? [];
  const lower = staff.lowerBars?.[bi];
  if (!lower) return [{ items, drumVoice: 'single' }];
  const silent = (list: readonly ScoreItem[]) => list.every((it) => it.keys.length === 0);
  if (silent(items) && silent(lower)) return [{ items, drumVoice: 'single' }];
  if (silent(lower)) return [{ items, drumVoice: 'hands' }];
  if (silent(items)) return [{ items: lower, drumVoice: 'feet' }];
  return [
    { items, drumVoice: 'hands' },
    { items: lower, drumVoice: 'feet' },
  ];
}

// Each staff is its own SVG, so the upper staff of a grand staff extends its barlines down to the
// lower staff (copying their x and width, which covers double and final barlines) and draws the brace.
function connectGrandStaff(ctx: RenderContext, stave: Stave, bi: number, width: number): void {
  const top = stave.getYForLine(4);
  const lower = new Stave(0, stave.getY() + STAFF_GAP, width);
  const bottom = lower.getYForLine(0);
  if (ctx instanceof SVGContext) {
    ctx.openGroup('score-view-connector');
    for (const rect of ctx.svg.querySelectorAll('.vf-stavebarline rect')) {
      ctx.fillRect(
        Number(rect.getAttribute('x')),
        top,
        Number(rect.getAttribute('width')),
        bottom - top,
      );
    }
    ctx.closeGroup();
  }
  if (bi === 0) new StaveConnector(stave, lower).setType('brace').setContext(ctx).draw();
}

export function drawCell(
  ctx: RenderContext,
  model: ScoreModel,
  bi: number,
  si: number,
  geometry: BarGeometry,
): boolean {
  const bar = model.bars[bi]!;
  const staff = model.staves[si]!;
  const width = geometry.width[bi]!;
  const prefix = geometry.prefix[bi]!;
  const stave = new ScoreStave(0, TOP, width);
  addBarModifiers(stave, model, bi, staff);
  if (bi === model.bars.length - 1) stave.setEndBarType(BarlineType.END);
  else if (model.bars[bi + 1]!.sectionStart) stave.setEndBarType(BarlineType.DOUBLE);
  stave.setNoteStartX(prefix);
  stave.setContext(ctx).draw();
  if (model.staves[si + 1]?.continuation) connectGrandStaff(ctx, stave, bi, width);

  const layers = cellLayers(staff, bi).map(({ items, drumVoice }) => {
    const notes = makeNotes(items, staff, bar.keySharps, drumVoice);
    const voice = new Voice({ numBeats: bar.numerator, beatValue: bar.denominator }).setMode(
      Voice.Mode.SOFT,
    );
    voice.addTickables(notes);
    if (staff.kind === 'pitched') Accidental.applyAccidentals([voice], keySpecOf(bar.keySharps));
    const groups = beamGroups(bar, items);
    // Beams must exist before the voice is drawn, or beamed notes also get flags.
    const beams = Beam.generateBeams(notes, {
      groups: groups
        ? groups.map(([n, d]) => new Fraction(n, d))
        : Beam.getDefaultBeamGroups(`${bar.numerator}/${bar.denominator}`),
      maintainStemDirections: staff.kind !== 'pitched',
    });
    return { items, notes, voice, beams };
  });
  const voices = layers.map((l) => l.voice);
  new Formatter().joinVoices(voices).format(voices, Math.max(20, width - prefix - LEFT_PAD));
  const stavePadding = Metrics.get('Stave.padding', 0) as number;
  for (const { items, notes, voice, beams } of layers) {
    voice.setStave(stave);
    // A silent bar is one whole rest centred between the bar's signatures and its barline.
    const wholeBarRest = items.length === 1 && items[0]!.keys.length === 0;
    notes.forEach((n, ni) => {
      const x = wholeBarRest
        ? (width - prefix) / 2 - n.getWidth() / 2
        : LEFT_PAD + offsetInBar(geometry, bi, items[ni]!.startGrid * model.gridTicks);
      n.getTickContext().setX(x - stavePadding);
    });
    voice.draw(ctx, stave);
    beams.forEach((b) => b.setContext(ctx).draw());
  }
  if (staff.kind === 'pitched') drawTies(ctx, bi, staff, stave, layers[0]!, geometry);
  return drawMarks(ctx, bar, staff, bi, geometry);
}

function drawTies(
  ctx: RenderContext,
  bi: number,
  staff: ScoreStaff,
  stave: Stave,
  { items, notes }: { items: ScoreItem[]; notes: StaveNote[] },
  geometry: BarGeometry,
): void {
  const nextBarFirst = staff.bars[bi + 1]?.[0];
  notes.forEach((n, ni) => {
    const indices = n.getKeys().map((_, k) => k);
    if (items[ni]!.tieFromPrev && ni > 0 && !notes[ni - 1]!.isRest()) {
      new StaveTie({
        firstNote: notes[ni - 1]!,
        lastNote: n,
        firstIndexes: indices,
        lastIndexes: indices,
      })
        .setContext(ctx)
        .draw();
    }
    // A tie into the next bar is drawn whole from this cell, reaching past the barline.
    if (ni === notes.length - 1 && !n.isRest() && nextBarFirst?.tieFromPrev) {
      const nextNoteX = geometry.noteStart[bi + 1]! - geometry.x[bi]! - 2;
      const tie = new StaveTie({
        firstNote: n,
        lastNote: null,
        firstIndexes: indices,
        lastIndexes: indices,
      });
      tie.renderOptions.lastXShift = nextNoteX - stave.getTieEndX();
      tie.setContext(ctx).draw();
    }
  });
}

// Drawn last so the halo stays on top of this staff's notes.
function drawMarks(
  ctx: RenderContext,
  bar: ScoreModel['bars'][number],
  staff: ScoreStaff,
  bi: number,
  geometry: BarGeometry,
): boolean {
  const end = bar.startTick + bar.ticks;
  let drawn = false;
  for (const mark of staff.marks) {
    if (mark.tick < bar.startTick || mark.tick >= end) continue;
    drawn = true;
    const x =
      geometry.noteStart[bi]! -
      geometry.x[bi]! +
      offsetInBar(geometry, bi, mark.tick - bar.startTick);
    ctx.openGroup('score-view-mark');
    ctx.setFont('sans-serif', MARK_FONT_SIZE);
    ctx.fillText(staff.kind === 'percussion' ? mark.name : `→ ${mark.name}`, x, MARK_Y);
    ctx.closeGroup();
  }
  return drawn;
}
