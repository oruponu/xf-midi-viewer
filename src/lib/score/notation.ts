import type { ChannelPart, ChannelVoice } from '../smf/channelVoices.ts';
import { keyShiftAt } from '../smf/fixedKey.ts';
import type { KeyShiftChange } from '../smf/fixedKey.ts';
import type { PlaybackNote, PlaybackSequence } from '../smf/playback.ts';
import type { SmfTiming } from '../smf/timing.ts';
import { voiceName } from '../xg/voiceNames.ts';
import { assignKeys, buildBars, markSections } from './bars.ts';
import type { ScoreBar } from './bars.ts';
import { isDrumSetNote, isFootNote, percussionName } from './drums.ts';
import { layoutNotes } from './rhythm.ts';
import type { ScoreItem, TimedNote } from './rhythm.ts';

export type Clef = 'treble' | 'bass' | 'percussion';
export type StaffKind = 'pitched' | 'drumSet' | 'percussion';

export interface NamedTick {
  tick: number;
  name: string;
}

export interface ScoreStaff {
  channel: number;
  kind: StaffKind;
  clef: Clef;
  bars: ScoreItem[][];
  // Drum set only: the bass drum and pedal hi-hat, written stems down.
  lowerBars?: ScoreItem[][];
  // Lower staff of a grand staff, sharing the label of the staff above it.
  continuation: boolean;
  // Written above the staff: where a new voice or a new set of percussion instruments starts.
  marks: NamedTick[];
  // Names for the label column by tick; the view picks the one in effect at the playhead.
  labels: NamedTick[];
}

export interface ScoreInput {
  sequence: PlaybackSequence;
  timing: SmfTiming;
  parts: readonly ChannelPart[];
  sectionTicks: readonly number[];
  keyShifts: readonly KeyShiftChange[];
}

export interface ScoreModel {
  bars: ScoreBar[];
  staves: ScoreStaff[];
  gridTicks: number;
}

interface VoicedNote extends TimedNote {
  voice: ChannelVoice | undefined;
}

const XG_SFX_BANK_MSB = 64;
const MIDDLE_C = 60;

export function buildScoreModel(input: ScoreInput): ScoreModel {
  const { sequence, timing, parts, sectionTicks, keyShifts } = input;
  const ppq = sequence.ticksPerQuarter || 480;
  const gridTicks = ppq / 4;
  const bars = buildBars(timing, sequence.durationTicks, ppq);
  assignKeys(bars, timing, keyShifts);
  markSections(bars, sectionTicks);

  const staves: ScoreStaff[] = [];
  for (const part of parts) {
    const channelNotes = sequence.notes.filter((n) => n.channel === part.channel);
    const notes = channelNotes.flatMap((n) =>
      writtenNote(n, voiceAt(part, n.startTick), keyShifts),
    );
    const pitched = notes.filter((n) => !n.voice?.isDrum);
    const drums = notes.filter((n) => n.voice?.isDrum);
    if (pitched.length > 0) staves.push(...pitchedStaves(part, pitched, bars, gridTicks));
    if (drums.length > 0) staves.push(...drumStaves(part, drums, bars, gridTicks));
  }
  return { bars, staves, gridTicks };
}

// Before the first program change, use the first note's voice.
function voiceAt(part: ChannelPart, tick: number): ChannelVoice | undefined {
  let found = part.voices[part.firstNoteVoiceIndex];
  for (const v of part.voices) {
    if (v.tick > tick) break;
    found = v;
  }
  return found;
}

// Playback drops notes transposed out of the MIDI range, so the score does too.
function writtenNote(
  n: PlaybackNote,
  voice: ChannelVoice | undefined,
  keyShifts: readonly KeyShiftChange[],
): VoicedNote[] {
  const sounding = n.note + (voice?.isDrum ? 0 : keyShiftAt(n.startTick, keyShifts));
  if (sounding < 0 || sounding > 127) return [];
  const written = sounding + (voice && isBassVoice(voice) ? 12 : 0);
  return [{ startTick: n.startTick, endTick: n.endTick, note: written, voice }];
}

// Bass parts are written an octave above where they sound, as on a bass guitar score.
function isBassVoice(voice: ChannelVoice): boolean {
  return (
    !voice.isDrum && voice.bankMSB !== XG_SFX_BANK_MSB && voice.program >= 32 && voice.program <= 39
  );
}

function pitchedStaves(
  part: ChannelPart,
  notes: VoicedNote[],
  bars: ScoreBar[],
  gridTicks: number,
): ScoreStaff[] {
  const base = {
    channel: part.channel,
    kind: 'pitched' as const,
    continuation: false,
    marks: voiceMarks(notes, gridTicks),
    labels: voiceLabels(part, notes),
  };
  const bassVoiced = notes.filter((n) => n.voice && isBassVoice(n.voice)).length;
  if (bassVoiced * 2 > notes.length) {
    return [{ ...base, clef: 'bass', bars: layoutNotes(notes, bars, gridTicks, false) }];
  }
  const share = (test: (pitch: number) => boolean) =>
    notes.filter((n) => test(n.note)).length / notes.length;
  if (share((p) => p < 55) >= 0.15 && share((p) => p > 64) >= 0.15) {
    const upper = notes.filter((n) => n.note >= MIDDLE_C);
    const lower = notes.filter((n) => n.note < MIDDLE_C);
    return [
      { ...base, clef: 'treble', bars: layoutNotes(upper, bars, gridTicks, false) },
      {
        ...base,
        clef: 'bass',
        continuation: true,
        marks: [],
        bars: layoutNotes(lower, bars, gridTicks, false),
      },
    ];
  }
  const average = notes.reduce((sum, n) => sum + n.note, 0) / notes.length;
  const clef = average < 57 ? 'bass' : 'treble';
  return [{ ...base, clef, bars: layoutNotes(notes, bars, gridTicks, false) }];
}

function drumStaves(
  part: ChannelPart,
  notes: VoicedNote[],
  bars: ScoreBar[],
  gridTicks: number,
): ScoreStaff[] {
  const staves: ScoreStaff[] = [];
  const hands = notes.filter((n) => isDrumSetNote(n.note) && !isFootNote(n.note));
  const feet = notes.filter((n) => isFootNote(n.note));
  const percussion = notes.filter((n) => !isDrumSetNote(n.note));
  if (hands.length > 0 || feet.length > 0) {
    staves.push({
      channel: part.channel,
      kind: 'drumSet',
      clef: 'percussion',
      continuation: false,
      bars: layoutNotes(hands, bars, gridTicks, true),
      lowerBars: layoutNotes(feet, bars, gridTicks, true),
      marks: voiceMarks(notes, gridTicks),
      labels: voiceLabels(part, notes),
    });
  }
  if (percussion.length > 0) {
    const changes = percussionChanges(percussion, bars, gridTicks);
    staves.push({
      channel: part.channel,
      kind: 'percussion',
      clef: 'percussion',
      continuation: false,
      bars: layoutNotes(percussion, bars, gridTicks, true),
      marks: changes,
      labels: changes,
    });
  }
  return staves;
}

function nameOf(voice: ChannelVoice | undefined): string {
  return (voice && voiceName(voice)) ?? '?';
}

// Program changes with no note in between collapse into the one that is heard.
function voiceMarks(notes: readonly VoicedNote[], gridTicks: number): NamedTick[] {
  const marks: NamedTick[] = [];
  let prev: string | undefined;
  for (const n of notes) {
    const name = nameOf(n.voice);
    if (prev !== undefined && name !== prev) {
      marks.push({ tick: Math.round(n.startTick / gridTicks) * gridTicks, name });
    }
    prev = name;
  }
  return marks;
}

// Same rule as the part panel: start from the voice of the first note, here per kind of staff.
function voiceLabels(part: ChannelPart, notes: readonly VoicedNote[]): NamedTick[] {
  const first = notes[0]?.voice;
  if (!first) return [];
  const start = part.voices.indexOf(first);
  const labels: NamedTick[] = [];
  for (const v of part.voices.slice(Math.max(0, start))) {
    if (v.isDrum !== first.isDrum) continue;
    const name = nameOf(v);
    if (labels.at(-1)?.name !== name) labels.push({ tick: v.tick, name });
  }
  return labels;
}

// Several instruments share the percussion staff, so their names are written whenever the set changes.
function percussionChanges(
  notes: readonly VoicedNote[],
  bars: readonly ScoreBar[],
  gridTicks: number,
): NamedTick[] {
  const changes: NamedTick[] = [];
  let prev = '';
  let ni = 0;
  for (const bar of bars) {
    const end = bar.startTick + bar.ticks;
    const names = new Set<string>();
    let first: number | undefined;
    for (; ni < notes.length && notes[ni]!.startTick < end; ni += 1) {
      first ??= notes[ni]!.startTick;
      names.add(percussionName(notes[ni]!.note));
    }
    if (first === undefined) continue;
    const set = [...names].sort().join(' / ');
    if (set !== prev) {
      changes.push({
        tick: Math.max(bar.startTick, Math.round(first / gridTicks) * gridTicks),
        name: set,
      });
    }
    prev = set;
  }
  return changes;
}
