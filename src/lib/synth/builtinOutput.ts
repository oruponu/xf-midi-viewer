import type { MidiOutputLike } from '../player/messages.ts';

export const STALL_THRESHOLD_SECONDS = 0.25;

export interface SynthLike {
  sendMessage(
    message: Iterable<number>,
    channelOffset?: number,
    eventOptions?: { time: number },
  ): void;
}

export interface AudioClockLike {
  readonly currentTime: number;
  readonly state: string;
  readonly outputLatency?: number;
  readonly baseLatency?: number;
}

export interface GainParamLike {
  cancelScheduledValues(startTime: number): unknown;
  setValueAtTime(value: number, startTime: number): unknown;
}

export interface BuiltinSynthOutputOptions {
  synth: SynthLike;
  clock: AudioClockLike;
  gain: GainParamLike;
  now?: () => number;
  onStall?: (stalledAtMs: number) => void;
}

export function toContextTime(timestampMs: number, anchorSeconds: number): number {
  return timestampMs / 1000 + anchorSeconds;
}

export class BuiltinSynthOutput implements MidiOutputLike {
  private readonly synth: SynthLike;
  private readonly clock: AudioClockLike;
  private readonly gain: GainParamLike;
  private readonly now: () => number;
  private readonly onStall: (stalledAtMs: number) => void;
  private anchor = 0;
  private anchorLead = 0;
  private lastQueuedTime = 0;
  private active = false;

  constructor(options: BuiltinSynthOutputOptions) {
    this.synth = options.synth;
    this.clock = options.clock;
    this.gain = options.gain;
    this.now = options.now ?? (() => performance.now());
    this.onStall = options.onStall ?? (() => {});
  }

  get isActive(): boolean {
    return this.active;
  }

  send(data: number[], timestamp?: number): void {
    if (!this.active) return;
    const time = toContextTime(timestamp ?? this.now(), this.anchor);
    if (this.isClockStalled(time)) {
      this.stall();
      return;
    }
    this.synth.sendMessage(data, 0, { time });
    if (time > this.lastQueuedTime) this.lastQueuedTime = time;
  }

  latencyMs(): number {
    return (hardwareLatencySeconds(this.clock) + this.anchorLead) * 1000;
  }

  notifyStateChange(): void {
    if (this.active && this.clock.state !== 'running') this.stall();
  }

  checkClock(): void {
    if (this.active && this.isClockStalled(toContextTime(this.now(), this.anchor))) this.stall();
  }

  activate(): void {
    const current = this.clock.currentTime;
    const drainUntil = Math.max(current, this.lastQueuedTime);
    this.gain.cancelScheduledValues(current);
    if (drainUntil > current) this.gain.setValueAtTime(0, current);
    this.gain.setValueAtTime(1, drainUntil);
    for (let channel = 0; channel < 16; channel += 1) {
      this.synth.sendMessage([0xb0 | channel, 120, 0], 0, { time: drainUntil });
      this.synth.sendMessage([0xb0 | channel, 123, 0], 0, { time: drainUntil });
    }
    this.lastQueuedTime = drainUntil;
    this.anchor = drainUntil - this.now() / 1000;
    this.anchorLead = drainUntil - current;
    this.active = true;
  }

  private isClockStalled(time: number): boolean {
    return (
      this.clock.state !== 'running' || time - this.clock.currentTime >= STALL_THRESHOLD_SECONDS
    );
  }

  private stall(): void {
    this.active = false;
    const current = this.clock.currentTime;
    this.gain.cancelScheduledValues(current);
    this.gain.setValueAtTime(0, current);
    this.onStall((this.clock.currentTime - this.anchor) * 1000);
  }
}

function hardwareLatencySeconds(clock: AudioClockLike): number {
  if (typeof clock.outputLatency === 'number') return clock.outputLatency;
  if (typeof clock.baseLatency === 'number') return clock.baseLatency;
  return 0;
}
