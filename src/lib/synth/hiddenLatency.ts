export interface HiddenLatencyLike {
  readonly seconds: number;
}

// Above the jitter of a clock that advances in steps of about 10 ms.
export const BURST_THRESHOLD_SECONDS = 0.05;

// WebKit renders the audio it missed during a freeze in one burst and queues it behind the
// output's read position, which never catches up. The burst stays as latency that
// outputLatency does not report, until the AudioContext is replaced.
// The queued audio keeps the output fed during a later freeze, so only the largest burst counts.
export class HiddenLatencyMeter implements HiddenLatencyLike {
  private largest = 0;
  private burst = 0;
  private last: { wall: number; clock: number } | null = null;

  observe(wallSeconds: number, clockSeconds: number, running: boolean): void {
    if (!running) {
      this.last = null;
      this.burst = 0;
      return;
    }
    if (this.last) {
      const excess = clockSeconds - this.last.clock - (wallSeconds - this.last.wall);
      if (excess >= BURST_THRESHOLD_SECONDS) {
        this.burst += excess;
        if (this.burst > this.largest) this.largest = this.burst;
      } else {
        this.burst = 0;
      }
    }
    this.last = { wall: wallSeconds, clock: clockSeconds };
  }

  get seconds(): number {
    return this.largest;
  }
}
