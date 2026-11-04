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

  // spessasynth_lib posts the messages of each audio block as one array.
  observeWorkletMessages(contextTime: number, messages: unknown): void {
    if (!Array.isArray(messages)) return;
    for (const message of messages) {
      if (typeof message !== 'object' || message === null || !('currentTime' in message)) continue;
      if (typeof message.currentTime === 'number') this.observe(contextTime, message.currentTime);
    }
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
