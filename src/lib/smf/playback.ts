import type { SmfFile, SmfTrack, TrackEvent } from './types.ts';

export interface PlaybackNote {
  channel: number;
  note: number;
  velocity: number;
  startTick: number;
  endTick: number;
  startSeconds: number;
  durationSeconds: number;
}

export interface PlaybackTempoChange {
  tick: number;
  seconds: number;
  bpm: number;
}

export interface PlaybackMidiMessage {
  tick: number;
  seconds: number;
  data: number[];
}

export interface PlaybackSequence {
  notes: PlaybackNote[];
  midiMessages: PlaybackMidiMessage[];
  tempos: PlaybackTempoChange[];
  durationSeconds: number;
  durationTicks: number;
  ticksPerQuarter: number;
  drumChannels: Set<number>;
}

interface RawTempoChange {
  tick: number;
  order: number;
  microsecondsPerQuarter: number;
}

interface TempoSegment {
  tick: number;
  seconds: number;
  microsecondsPerQuarter: number;
}

interface ActiveNote {
  channel: number;
  note: number;
  velocity: number;
  startTick: number;
}

const DEFAULT_MICROSECONDS_PER_QUARTER = 500_000;
const DEFAULT_NOTE_SECONDS = 0.12;

export function buildPlaybackSequence(smf: SmfFile): PlaybackSequence {
  const division = smf.header.division;
  const ticksPerQuarter =
    division.kind === 'tpqn' ? division.ticksPerQuarter : 0;
  const absoluteTracks = smf.tracks.map(toAbsoluteTrack);
  const durationTicks = absoluteTracks.reduce(
    (max, events) => Math.max(max, events.at(-1)?.tick ?? 0),
    0,
  );

  const tempoSegments =
    division.kind === 'tpqn'
      ? buildTempoSegments(collectTempoChanges(absoluteTracks), ticksPerQuarter)
      : [];

  const tickToSeconds =
    division.kind === 'tpqn'
      ? (tick: number): number =>
          tpqnTickToSeconds(tick, ticksPerQuarter, tempoSegments)
      : (tick: number): number =>
          smpteTickToSeconds(
            tick,
            division.framesPerSecond,
            division.ticksPerFrame,
          );

  const notes = absoluteTracks.flatMap((track) =>
    collectNotes(track, durationTicks, tickToSeconds),
  );
  const midiMessages = absoluteTracks.flatMap((track) =>
    collectMidiMessages(track, tickToSeconds),
  );
  notes.sort(
    (a, b) =>
      a.startSeconds - b.startSeconds ||
      a.channel - b.channel ||
      a.note - b.note,
  );
  midiMessages.sort(
    (a, b) =>
      a.seconds - b.seconds || a.tick - b.tick || a.data[0]! - b.data[0]!,
  );

  const durationSeconds = Math.max(
    tickToSeconds(durationTicks),
    ...notes.map((note) => note.startSeconds + note.durationSeconds),
    ...midiMessages.map((message) => message.seconds),
    0,
  );

  return {
    notes,
    midiMessages,
    tempos:
      division.kind === 'tpqn'
        ? tempoSegments.map((segment) => ({
            tick: segment.tick,
            seconds: segment.seconds,
            bpm: microsecondsToBpm(segment.microsecondsPerQuarter),
          }))
        : [],
    durationSeconds,
    durationTicks,
    ticksPerQuarter,
    drumChannels: detectDrumChannels(smf),
  };
}

const XG_DRUM_BANK_MSB = 127;

export function transposeMidiData(
  data: number[],
  semitones: number,
  drumChannels: ReadonlySet<number>,
): number[] | null {
  if (semitones === 0 || data.length < 2) return data;
  const status = data[0]! & 0xf0;
  if (status !== 0x80 && status !== 0x90 && status !== 0xa0) return data;
  const channel = data[0]! & 0x0f;
  if (drumChannels.has(channel)) return data;
  const newNote = data[1]! + semitones;
  if (newNote < 0 || newNote > 127) return null;
  return [data[0]!, newNote, data[2]!];
}

export function detectDrumChannels(smf: SmfFile): Set<number> {
  const drums = new Set<number>();
  for (const track of smf.tracks) {
    for (const tev of track.events) {
      const ev = tev.event;
      if (ev.kind === 'controlChange' && ev.controller === 0) {
        if (ev.value === XG_DRUM_BANK_MSB) drums.add(ev.channel);
      } else if (ev.kind === 'sysex') {
        const channel = xgPartModeDrumChannel(ev.data);
        if (channel !== null) drums.add(channel);
      }
    }
  }
  return drums;
}

function xgPartModeDrumChannel(data: Uint8Array): number | null {
  if (data.length < 8) return null;
  if (data[0] !== 0x43) return null;
  if ((data[1]! & 0xf0) !== 0x10) return null;
  if (data[2] !== 0x4c) return null;
  if (data[3] !== 0x08) return null;
  if (data[5] !== 0x07) return null;
  const mode = data[6]!;
  if (mode < 1 || mode > 3) return null;
  const part = data[4]!;
  return part <= 15 ? part : null;
}

export function secondsToTick(
  seconds: number,
  sequence: PlaybackSequence,
): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  const { tempos, ticksPerQuarter, durationSeconds, durationTicks } = sequence;
  if (ticksPerQuarter <= 0 || tempos.length === 0) {
    if (durationSeconds <= 0) return 0;
    const clamped = Math.min(seconds, durationSeconds);
    return Math.round((clamped / durationSeconds) * durationTicks);
  }
  let segment = tempos[0]!;
  for (const t of tempos) {
    if (t.seconds <= seconds) segment = t;
    else break;
  }
  const ticksPerSecond = (segment.bpm * ticksPerQuarter) / 60;
  return Math.round(
    segment.tick + (seconds - segment.seconds) * ticksPerSecond,
  );
}

function toAbsoluteTrack(
  track: SmfTrack,
): Array<TrackEvent & { tick: number }> {
  let tick = 0;
  return track.events.map((event) => {
    tick += event.deltaTime;
    return { ...event, tick };
  });
}

function collectTempoChanges(
  tracks: Array<Array<TrackEvent & { tick: number }>>,
): RawTempoChange[] {
  const changes: RawTempoChange[] = [
    {
      tick: 0,
      order: -1,
      microsecondsPerQuarter: DEFAULT_MICROSECONDS_PER_QUARTER,
    },
  ];
  let order = 0;

  for (const track of tracks) {
    for (const { tick, event } of track) {
      if (event.kind !== 'meta' || event.metaType !== 0x51) continue;
      if (event.data.length < 3) continue;
      changes.push({
        tick,
        order,
        microsecondsPerQuarter:
          (event.data[0]! << 16) | (event.data[1]! << 8) | event.data[2]!,
      });
      order += 1;
    }
  }

  changes.sort((a, b) => a.tick - b.tick || a.order - b.order);
  return changes;
}

function buildTempoSegments(
  changes: RawTempoChange[],
  ticksPerQuarter: number,
): TempoSegment[] {
  const segments: TempoSegment[] = [];
  let lastTick = 0;
  let seconds = 0;
  let microsecondsPerQuarter = DEFAULT_MICROSECONDS_PER_QUARTER;

  for (const change of changes) {
    if (change.tick > lastTick) {
      seconds +=
        ticksPerQuarter > 0
          ? ((change.tick - lastTick) * microsecondsPerQuarter) /
            ticksPerQuarter /
            1_000_000
          : 0;
    }
    lastTick = change.tick;
    microsecondsPerQuarter = change.microsecondsPerQuarter;

    const last = segments.at(-1);
    if (last && last.tick === change.tick) {
      last.microsecondsPerQuarter = microsecondsPerQuarter;
      last.seconds = seconds;
    } else {
      segments.push({
        tick: change.tick,
        seconds,
        microsecondsPerQuarter,
      });
    }
  }

  return segments.length > 0
    ? segments
    : [
        {
          tick: 0,
          seconds: 0,
          microsecondsPerQuarter: DEFAULT_MICROSECONDS_PER_QUARTER,
        },
      ];
}

function tpqnTickToSeconds(
  tick: number,
  ticksPerQuarter: number,
  segments: TempoSegment[],
): number {
  if (ticksPerQuarter <= 0 || tick <= 0) return 0;
  let segment = segments[0]!;
  for (const candidate of segments) {
    if (candidate.tick <= tick) segment = candidate;
    else break;
  }
  return (
    segment.seconds +
    ((tick - segment.tick) * segment.microsecondsPerQuarter) /
      ticksPerQuarter /
      1_000_000
  );
}

function smpteTickToSeconds(
  tick: number,
  framesPerSecond: number,
  ticksPerFrame: number,
): number {
  const ticksPerSecond = framesPerSecond * ticksPerFrame;
  return ticksPerSecond > 0 ? tick / ticksPerSecond : 0;
}

function collectNotes(
  track: Array<TrackEvent & { tick: number }>,
  durationTicks: number,
  tickToSeconds: (tick: number) => number,
): PlaybackNote[] {
  const notes: PlaybackNote[] = [];
  const active = new Map<string, ActiveNote[]>();

  for (const { tick, event } of track) {
    if (event.kind === 'noteOn' && event.velocity > 0) {
      const key = noteKey(event.channel, event.note);
      const list = active.get(key) ?? [];
      list.push({
        channel: event.channel,
        note: event.note,
        velocity: event.velocity,
        startTick: tick,
      });
      active.set(key, list);
      continue;
    }

    const isNoteOff =
      event.kind === 'noteOff' ||
      (event.kind === 'noteOn' && event.velocity === 0);
    if (!isNoteOff) continue;

    const key = noteKey(event.channel, event.note);
    const list = active.get(key);
    const started = list?.shift();
    if (!started) continue;
    if (list && list.length === 0) active.delete(key);
    pushNote(notes, started, tick, tickToSeconds);
  }

  for (const list of active.values()) {
    for (const started of list) {
      pushNote(notes, started, durationTicks, tickToSeconds);
    }
  }

  return notes;
}

function collectMidiMessages(
  track: Array<TrackEvent & { tick: number }>,
  tickToSeconds: (tick: number) => number,
): PlaybackMidiMessage[] {
  const messages: PlaybackMidiMessage[] = [];
  for (const { tick, event } of track) {
    const data = eventToMidiBytes(event);
    if (!data) continue;
    messages.push({ tick, seconds: tickToSeconds(tick), data });
  }
  return messages;
}

function eventToMidiBytes(
  event: TrackEvent['event'],
): PlaybackMidiMessage['data'] | null {
  switch (event.kind) {
    case 'noteOff':
      return [0x80 | event.channel, event.note, event.velocity];
    case 'noteOn':
      return [0x90 | event.channel, event.note, event.velocity];
    case 'polyAftertouch':
      return [0xa0 | event.channel, event.note, event.pressure];
    case 'controlChange':
      return [0xb0 | event.channel, event.controller, event.value];
    case 'programChange':
      return [0xc0 | event.channel, event.program];
    case 'channelAftertouch':
      return [0xd0 | event.channel, event.pressure];
    case 'pitchBend':
      return [
        0xe0 | event.channel,
        event.value & 0x7f,
        (event.value >> 7) & 0x7f,
      ];
    case 'sysex':
      return [0xf0, ...event.data];
    case 'sysexEscape':
      return [...event.data];
    case 'meta':
      return null;
  }
}

function pushNote(
  notes: PlaybackNote[],
  started: ActiveNote,
  endTick: number,
  tickToSeconds: (tick: number) => number,
): void {
  const startSeconds = tickToSeconds(started.startTick);
  const endSeconds = tickToSeconds(Math.max(started.startTick, endTick));
  notes.push({
    channel: started.channel,
    note: started.note,
    velocity: started.velocity,
    startTick: started.startTick,
    endTick,
    startSeconds,
    durationSeconds: Math.max(DEFAULT_NOTE_SECONDS, endSeconds - startSeconds),
  });
}

function noteKey(channel: number, note: number): string {
  return `${channel}:${note}`;
}

function microsecondsToBpm(microsecondsPerQuarter: number): number {
  return microsecondsPerQuarter > 0 ? 60_000_000 / microsecondsPerQuarter : 0;
}
