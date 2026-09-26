import { transposeMidiData } from '../smf/playback.ts';
import type { PlaybackMidiMessage, PlaybackSequence } from '../smf/playback.ts';
import { collectChaseMessages } from './chase.ts';
import { isLiveNoteOn, sendMidiPanic, sendMidiReset, trySendMidiMessage } from './messages.ts';
import type { MidiOutputLike, MidiSendFailure } from './messages.ts';
import { positionAt, pruneTimeline, timeAtPosition, withRateChange } from './timeline.ts';
import type { TimelineSegment } from './timeline.ts';

export const LOOKAHEAD_SECONDS = 0.05;
export const SCHEDULER_MS = 10;
export const UI_UPDATE_INTERVAL_MS = 33;
export const PLAYBACK_RATE_MIN = 0.5;
export const PLAYBACK_RATE_MAX = 2.0;
export const PLAYBACK_RATE_STEP = 0.1;
export const KEY_SHIFT_MIN = -6;
export const KEY_SHIFT_MAX = 6;
export const KEY_SHIFT_STEP = 1;

const LOOKAHEAD_MS = LOOKAHEAD_SECONDS * 1000;

export interface MidiScheduleWindowResult {
  nextIndex: number;
  failed: boolean;
}

export function scheduleDueMidiMessages(
  messages: readonly PlaybackMidiMessage[],
  startIndex: number,
  position: number,
  until: number,
  scheduleMessage: (message: PlaybackMidiMessage) => boolean,
): MidiScheduleWindowResult {
  let i = startIndex;
  while (i < messages.length) {
    const message = messages[i]!;
    if (message.seconds > until) break;
    if (message.seconds >= position || !isLiveNoteOn(message.data)) {
      const sent = scheduleMessage(message);
      i += 1;
      if (!sent) return { nextIndex: i, failed: true };
      continue;
    }
    i += 1;
  }
  return { nextIndex: i, failed: false };
}

export function clampPlaybackRate(rate: number): number {
  if (!Number.isFinite(rate)) return 1;
  const clamped = Math.max(PLAYBACK_RATE_MIN, Math.min(PLAYBACK_RATE_MAX, rate));
  return Math.round(clamped * 10) / 10;
}

export function clampKeyShift(semitones: number): number {
  if (!Number.isFinite(semitones)) return 0;
  return Math.max(KEY_SHIFT_MIN, Math.min(KEY_SHIFT_MAX, Math.round(semitones)));
}

export function firstMidiMessageIndexAtOrAfter(
  messages: readonly PlaybackMidiMessage[],
  seconds: number,
): number {
  let lo = 0;
  let hi = messages.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (messages[mid]!.seconds < seconds) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export type TimerHandle = number;

export interface Timers {
  setInterval(fn: () => void, ms: number): TimerHandle;
  clearInterval(handle: TimerHandle): void;
}

export interface SchedulerState {
  isPlaying: boolean;
  playbackRate: number;
  keyShift: number;
  sendError: MidiSendFailure | null;
}

export interface SchedulerOptions {
  now?: () => number;
  timers?: Timers;
}

const windowTimers: Timers = {
  setInterval: (fn, ms) => window.setInterval(fn, ms),
  clearInterval: (handle) => window.clearInterval(handle),
};

const INITIAL_STATE: SchedulerState = {
  isPlaying: false,
  playbackRate: 1,
  keyShift: 0,
  sendError: null,
};

export class MidiScheduler {
  private readonly now: () => number;
  private readonly timers: Timers;
  private readonly listeners = new Set<() => void>();
  private readonly fences = new WeakMap<MidiOutputLike, number>();
  private sequence: PlaybackSequence | null = null;
  private output: MidiOutputLike | null = null;
  private drumChannels: ReadonlySet<number> = new Set();
  private nextMessageIndex = 0;
  private intervalHandle: TimerHandle | null = null;
  private timeline: TimelineSegment[] = [];
  private displayFloor = 0;
  private position = 0;
  private positionSnapshot = 0;
  private lastNotifyAtMs = 0;
  private state: SchedulerState = INITIAL_STATE;

  constructor(options: SchedulerOptions = {}) {
    this.now = options.now ?? (() => performance.now());
    this.timers = options.timers ?? windowTimers;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getState = (): SchedulerState => this.state;

  getPositionSnapshot = (): number => this.positionSnapshot;

  getPosition = (): number =>
    this.intervalHandle === null ? this.position : this.audiblePosition(this.now());

  setSequence(sequence: PlaybackSequence | null): void {
    if (this.intervalHandle !== null) {
      this.stopInternal(true);
    } else {
      this.position = 0;
      this.positionSnapshot = 0;
    }
    this.sequence = sequence;
    this.drumChannels = sequence?.drumChannels ?? new Set();
    this.notify();
  }

  setOutput(output: MidiOutputLike | null): void {
    if (output === this.output) return;
    if (output === null && this.intervalHandle !== null) {
      this.stopInternal(false);
      this.output = null;
      return;
    }
    const previous = this.output;
    const isPlaying = this.intervalHandle !== null;
    const position = this.getPosition();
    if (previous) this.silence(previous);
    this.output = output;
    if (isPlaying && output !== null) this.restart(position);
  }

  play(): void {
    const { sequence, output } = this;
    if (this.intervalHandle !== null) return;
    if (!sequence || sequence.durationSeconds <= 0) return;
    if (!output || sequence.midiMessages.length === 0) return;

    this.setState({ sendError: null });
    this.intervalHandle = this.timers.setInterval(() => this.tick(), SCHEDULER_MS);
    this.setState({ isPlaying: true });
    this.restart(this.position >= sequence.durationSeconds ? 0 : this.position);
  }

  pause(): void {
    this.stopInternal(false);
  }

  pauseAt(timeMs: number): void {
    if (this.intervalHandle === null) return;
    this.stopInternal(false, Math.min(this.getPosition(), this.playingPosition(timeMs)));
  }

  stop(): void {
    this.stopInternal(true);
  }

  seek(seconds: number): void {
    const clamped = Math.max(0, Math.min(seconds, this.sequence?.durationSeconds ?? 0));
    if (this.intervalHandle !== null) {
      this.restart(clamped);
      return;
    }
    this.position = clamped;
    this.positionSnapshot = clamped;
    this.notify();
  }

  setPlaybackRate(rate: number): void {
    const clamped = clampPlaybackRate(rate);
    if (clamped === this.state.playbackRate) return;
    if (this.intervalHandle !== null) {
      const nowMs = this.now();
      const fence = this.output ? (this.fences.get(this.output) ?? 0) : 0;
      const switchAtMs = Math.max(nowMs, fence, this.timeline.at(-1)?.atMs ?? nowMs);
      this.timeline = pruneTimeline(withRateChange(this.timeline, switchAtMs, clamped), nowMs);
      this.position = this.playingPosition(nowMs);
    }
    this.setState({ playbackRate: clamped });
    this.notify();
  }

  setKeyShift(semitones: number): void {
    const clamped = clampKeyShift(semitones);
    if (clamped === this.state.keyShift) return;
    const isPlaying = this.intervalHandle !== null;
    const position = this.getPosition();
    this.setState({ keyShift: clamped });
    if (isPlaying) this.restart(position);
    else this.notify();
  }

  sendReset(): void {
    const output = this.output;
    if (!output) return;
    const nowMs = this.now();
    sendMidiReset(output, nowMs, this.reportSendFailure);
    this.extendFence(output, nowMs);
  }

  dispose(): void {
    this.stopInternal(false);
  }

  private restart(position: number): void {
    const { sequence, output } = this;
    if (!sequence || !output) return;
    const resumeAtMs = this.silence(output, this.reportSendFailure);
    const startOffset = Math.min(position, Math.max(0, sequence.durationSeconds - 0.01));
    this.timeline = [{ atMs: resumeAtMs, position: startOffset, rate: this.state.playbackRate }];
    this.displayFloor = startOffset;
    this.nextMessageIndex = firstMidiMessageIndexAtOrAfter(sequence.midiMessages, startOffset);
    for (const message of collectChaseMessages(sequence.midiMessages, this.nextMessageIndex)) {
      this.scheduleMessage(output, message);
    }
    if (this.state.sendError !== null) {
      this.stopInternal(false);
      return;
    }
    const nowMs = this.now();
    this.position = startOffset;
    this.positionSnapshot = startOffset;
    this.lastNotifyAtMs = nowMs;
    this.notify();
    this.scheduleWindow(startOffset, nowMs);
  }

  private silence(output: MidiOutputLike, onFailure?: (failure: MidiSendFailure) => void): number {
    const nowMs = this.now();
    const pendingUntil = this.fences.get(output) ?? 0;
    sendMidiPanic(output, nowMs, onFailure);
    this.extendFence(output, nowMs);
    if (pendingUntil <= nowMs) return nowMs;
    for (let channel = 0; channel < 16; channel += 1) {
      this.send(output, [0xb0 | channel, 120, 0], pendingUntil, onFailure);
      this.send(output, [0xb0 | channel, 123, 0], pendingUntil, onFailure);
    }
    return pendingUntil;
  }

  private stopInternal(resetPosition: boolean, at?: number): void {
    const position = resetPosition ? 0 : (at ?? this.getPosition());
    this.clearTimer();
    if (this.output) this.silence(this.output, this.reportSendFailure);
    this.position = position;
    this.positionSnapshot = position;
    this.setState({ isPlaying: false });
    this.notify();
  }

  private tick(): void {
    const nowMs = this.now();
    this.timeline = pruneTimeline(this.timeline, nowMs);
    this.scheduleWindow(this.playingPosition(nowMs), nowMs);
  }

  private scheduleWindow(position: number, nowMs: number): void {
    const { sequence, output } = this;
    if (!sequence) return;
    if (!output) {
      this.stopInternal(false);
      return;
    }
    const result = scheduleDueMidiMessages(
      sequence.midiMessages,
      this.nextMessageIndex,
      position,
      this.playingPosition(nowMs + LOOKAHEAD_MS),
      (message) => this.scheduleMessage(output, message),
    );
    this.nextMessageIndex = result.nextIndex;
    if (result.failed) {
      this.stopInternal(false);
      return;
    }
    const audible = this.audiblePosition(nowMs);
    this.position = audible;
    if (nowMs - this.lastNotifyAtMs >= UI_UPDATE_INTERVAL_MS) {
      this.lastNotifyAtMs = nowMs;
      this.positionSnapshot = audible;
      this.notify();
    }
    if (audible >= sequence.durationSeconds) this.stopInternal(false, sequence.durationSeconds);
  }

  private scheduleMessage(output: MidiOutputLike, message: PlaybackMidiMessage): boolean {
    const data = transposeMidiData(message.data, this.state.keyShift, this.drumChannels);
    if (!data) return true;
    const segment = this.timeline.at(-1)!;
    const scheduledAt = timeAtPosition(segment, Math.max(message.seconds, segment.position));
    const sendAt = Math.max(scheduledAt, this.fences.get(output) ?? 0);
    return this.send(output, data, sendAt, this.reportSendFailure);
  }

  private send(
    output: MidiOutputLike,
    data: number[],
    timestamp: number,
    onFailure?: (failure: MidiSendFailure) => void,
  ): boolean {
    this.extendFence(output, timestamp);
    return trySendMidiMessage(output, data, timestamp, onFailure);
  }

  private extendFence(output: MidiOutputLike, timestamp: number): void {
    const current = this.fences.get(output) ?? 0;
    if (timestamp > current) this.fences.set(output, timestamp);
  }

  private reportSendFailure = (failure: MidiSendFailure): void => {
    if (this.state.sendError !== null) return;
    this.setState({ sendError: failure });
    this.notify();
  };

  private clearTimer(): void {
    if (this.intervalHandle === null) return;
    this.timers.clearInterval(this.intervalHandle);
    this.intervalHandle = null;
  }

  private playingPosition(nowMs: number): number {
    return Math.min(this.sequence?.durationSeconds ?? 0, positionAt(this.timeline, nowMs));
  }

  private audiblePosition(nowMs: number): number {
    const latencyMs = Math.max(0, this.output?.latencyMs?.() ?? 0);
    const position = Math.min(
      this.sequence?.durationSeconds ?? 0,
      positionAt(this.timeline, nowMs - latencyMs),
    );
    this.displayFloor = Math.max(this.displayFloor, position);
    return this.displayFloor;
  }

  private setState(patch: Partial<SchedulerState>): void {
    const next = { ...this.state, ...patch };
    if (
      next.isPlaying === this.state.isPlaying &&
      next.playbackRate === this.state.playbackRate &&
      next.keyShift === this.state.keyShift &&
      next.sendError === this.state.sendError
    ) {
      return;
    }
    this.state = next;
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
