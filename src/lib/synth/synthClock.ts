import type { SynthLike } from './builtinOutput.ts';

export interface ClockOffsetLike {
  readonly seconds: number;
}

// Message delivery only adds to the lag, so the minimum is the closest estimate.
export class SynthClockOffset implements ClockOffsetLike {
  private minLag = Infinity;

  observe(contextTime: number, synthTime: number): void {
    const lag = contextTime - synthTime;
    if (lag < this.minLag) this.minLag = lag;
  }

  get seconds(): number {
    return Number.isFinite(this.minLag) ? Math.max(0, this.minLag) : 0;
  }
}

export function withClockOffset(synth: SynthLike, offset: ClockOffsetLike): SynthLike {
  return {
    sendMessage(message, channelOffset, eventOptions) {
      if (eventOptions === undefined) {
        synth.sendMessage(message, channelOffset);
        return;
      }
      synth.sendMessage(message, channelOffset, { time: eventOptions.time - offset.seconds });
    },
  };
}
