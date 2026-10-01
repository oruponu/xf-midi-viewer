import { XG_KITS } from '../xgDrumKits.ts';
import { XG_SFX_VOICES } from '../xgSfxVoices.ts';

export interface VoiceId {
  readonly bankMSB: number;
  readonly program: number;
}

export interface DrumProbe {
  readonly kit: number;
  readonly key: number;
  readonly velocity: number;
}

export interface VoiceProbe extends VoiceId {
  readonly note: number;
  readonly velocity: number;
}

export interface TimedMessage {
  readonly seconds: number;
  readonly data: number[];
}

export interface ScheduledProbe<P> {
  readonly probe: P;
  readonly seconds: number;
}

export interface TestMidi<P> {
  readonly messages: readonly TimedMessage[];
  readonly probes: readonly ScheduledProbe<P>[];
  readonly markerSeconds: number;
  readonly endSeconds: number;
}

export const TICKS_PER_QUARTER = 480;
const SECONDS_PER_TICK = 0.5 / TICKS_PER_QUARTER;

export const DRUM_CHANNEL = 9;
export const VOICE_CHANNEL = 0;
export const XG_DRUM_KITS: readonly number[] = XG_KITS.filter((kit) => kit.bankMSB === 127).map(
  (kit) => kit.program,
);
export const DRUM_KEYS: readonly number[] = Array.from({ length: 72 }, (_, i) => 13 + i);
export const DRUM_VELOCITIES: readonly number[] = [
  ...Array.from({ length: 15 }, (_, i) => 8 * (i + 1)),
  127,
];
export const VOICE_NOTES: readonly number[] = [36, 48, 60, 72, 84];
export const VOICE_VELOCITIES: readonly number[] = [40, 64, 100, 127];
export const CALIBRATION_VOICES: readonly VoiceId[] = [
  ...Array.from({ length: 128 }, (_, program) => ({ bankMSB: 0, program })),
  ...XG_SFX_VOICES.filter((voice) => voice.from !== null).map((voice) => ({
    bankMSB: 64,
    program: voice.program,
  })),
];

export const DRUM_INTERVAL_SECONDS = 1.5;
export const VOICE_NOTE_SECONDS = 1;
export const VOICE_INTERVAL_SECONDS = 2.5;
const SETUP_SECONDS = 0.5;
const SOUND_OFF_LEAD_SECONDS = 0.1;
const MARKER_SECONDS = 1.5;
const MARKER_KEY = 36;
const DRUM_NOTE_SECONDS = 10 * SECONDS_PER_TICK;
const XG_SYSTEM_ON = [0xf0, 0x43, 0x10, 0x4c, 0x00, 0x00, 0x7e, 0x00, 0xf7];

function setup(channel: number, bankMSB: number, program: number): number[][] {
  const cc = (controller: number, value: number) => [0xb0 | channel, controller, value];
  return [
    cc(0, bankMSB),
    cc(32, 0),
    [0xc0 | channel, program],
    cc(91, 0),
    cc(93, 0),
    cc(94, 0),
    cc(7, 100),
    cc(11, 127),
    cc(10, 64),
  ];
}

function hit(
  messages: TimedMessage[],
  channel: number,
  key: number,
  velocity: number,
  seconds: number,
  duration: number,
): void {
  messages.push({ seconds: seconds - SOUND_OFF_LEAD_SECONDS, data: [0xb0 | channel, 120, 0] });
  messages.push({ seconds, data: [0x90 | channel, key, velocity] });
  messages.push({ seconds: seconds + duration, data: [0x80 | channel, key, 0] });
}

function preamble(): TimedMessage[] {
  const messages: TimedMessage[] = [{ seconds: 0, data: XG_SYSTEM_ON }];
  for (const data of setup(DRUM_CHANNEL, 127, 0)) messages.push({ seconds: SETUP_SECONDS, data });
  hit(messages, DRUM_CHANNEL, MARKER_KEY, 127, MARKER_SECONDS, DRUM_NOTE_SECONDS);
  return messages;
}

function finish<P>(
  messages: TimedMessage[],
  probes: ScheduledProbe<P>[],
  endSeconds: number,
): TestMidi<P> {
  const sorted = messages.map((m, i) => ({ m, i }));
  sorted.sort((a, b) => a.m.seconds - b.m.seconds || a.i - b.i);
  return {
    messages: sorted.map(({ m }) => m),
    probes,
    markerSeconds: MARKER_SECONDS,
    endSeconds,
  };
}

export function drumTestMidi(
  kits: readonly number[],
  keys: readonly number[],
  velocities: readonly number[],
): TestMidi<DrumProbe> {
  const messages = preamble();
  const probes: ScheduledProbe<DrumProbe>[] = [];
  let t = MARKER_SECONDS + DRUM_INTERVAL_SECONDS;
  for (const kit of kits) {
    for (const data of setup(DRUM_CHANNEL, 127, kit)) messages.push({ seconds: t, data });
    t += SETUP_SECONDS;
    for (const key of keys) {
      for (const velocity of velocities) {
        hit(messages, DRUM_CHANNEL, key, velocity, t, DRUM_NOTE_SECONDS);
        probes.push({ probe: { kit, key, velocity }, seconds: t });
        t += DRUM_INTERVAL_SECONDS;
      }
    }
  }
  return finish(messages, probes, t);
}

export function voiceTestMidi(
  voices: readonly VoiceId[],
  notes: readonly number[],
  velocities: readonly number[],
): TestMidi<VoiceProbe> {
  const messages = preamble();
  const probes: ScheduledProbe<VoiceProbe>[] = [];
  let t = MARKER_SECONDS + DRUM_INTERVAL_SECONDS;
  for (const { bankMSB, program } of voices) {
    for (const data of setup(VOICE_CHANNEL, bankMSB, program)) messages.push({ seconds: t, data });
    t += SETUP_SECONDS;
    for (const note of notes) {
      for (const velocity of velocities) {
        hit(messages, VOICE_CHANNEL, note, velocity, t, VOICE_NOTE_SECONDS);
        probes.push({ probe: { bankMSB, program, note, velocity }, seconds: t });
        t += VOICE_INTERVAL_SECONDS;
      }
    }
  }
  return finish(messages, probes, t);
}

function variableLength(value: number): number[] {
  const bytes = [value & 0x7f];
  while ((value >>= 7) > 0) bytes.unshift((value & 0x7f) | 0x80);
  return bytes;
}

export function toSmf(midi: TestMidi<unknown>): Uint8Array {
  const toTick = (seconds: number) => Math.round(seconds / SECONDS_PER_TICK);
  const body: number[] = [0x00, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20];
  let last = 0;
  for (const { seconds, data } of midi.messages) {
    const tick = toTick(seconds);
    body.push(...variableLength(tick - last));
    last = tick;
    if (data[0] === 0xf0) body.push(0xf0, ...variableLength(data.length - 1), ...data.slice(1));
    else body.push(...data);
  }
  body.push(...variableLength(Math.max(0, toTick(midi.endSeconds) - last)), 0xff, 0x2f, 0x00);
  const length = body.length;
  return new Uint8Array([
    ...[0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1],
    TICKS_PER_QUARTER >> 8,
    TICKS_PER_QUARTER & 0xff,
    ...[0x4d, 0x54, 0x72, 0x6b],
    (length >>> 24) & 0xff,
    (length >>> 16) & 0xff,
    (length >>> 8) & 0xff,
    length & 0xff,
    ...body,
  ]);
}
