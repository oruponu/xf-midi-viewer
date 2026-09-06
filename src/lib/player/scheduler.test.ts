import { describe, expect, test } from 'bun:test';
import {
  clampKeyShift,
  clampPlaybackRate,
  firstMidiMessageIndexAtOrAfter,
  MidiScheduler,
  scheduleDueMidiMessages,
} from './scheduler.ts';
import type { Timers } from './scheduler.ts';
import type { MidiOutputLike } from './messages.ts';
import type { PlaybackMidiMessage, PlaybackSequence } from '../smf/playback.ts';

function msg(seconds: number, data: number[] = [0xc0, 0]): PlaybackMidiMessage {
  return { tick: Math.round(seconds * 960), seconds, data };
}

describe('scheduleDueMidiMessages', () => {
  test('advances past a failed message so the same message is not retried forever', () => {
    const messages: PlaybackMidiMessage[] = [
      { tick: 480, seconds: 0.5, data: [0x90, 60, 100] },
      { tick: 960, seconds: 1, data: [0x80, 60, 0] },
    ];
    const attempts: PlaybackMidiMessage[] = [];

    const result = scheduleDueMidiMessages(messages, 0, 0.45, 0.55, (message) => {
      attempts.push(message);
      return false;
    });

    expect(attempts).toEqual([messages[0]]);
    expect(result).toEqual({ nextIndex: 1, failed: true });
  });

  test('skips live note-ons that are already in the past but keeps other messages', () => {
    const messages = [
      msg(0.1, [0x90, 60, 100]),
      msg(0.1, [0xb0, 7, 100]),
      msg(0.3, [0x90, 62, 100]),
      msg(0.5, [0x80, 62, 0]),
    ];
    const scheduled: number[][] = [];

    const result = scheduleDueMidiMessages(messages, 0, 0.2, 0.35, (m) => {
      scheduled.push(m.data);
      return true;
    });

    expect(scheduled).toEqual([
      [0xb0, 7, 100],
      [0x90, 62, 100],
    ]);
    expect(result).toEqual({ nextIndex: 3, failed: false });
  });
});

describe('clampPlaybackRate', () => {
  test('clamps to [0.5, 2.0], rounds to one decimal and falls back to 1 for NaN', () => {
    expect(clampPlaybackRate(3)).toBe(2);
    expect(clampPlaybackRate(0.1)).toBe(0.5);
    expect(clampPlaybackRate(1.26)).toBe(1.3);
    expect(clampPlaybackRate(Number.NaN)).toBe(1);
  });
});

describe('clampKeyShift', () => {
  test('clamps to [-6, 6], rounds to an integer and falls back to 0 for NaN', () => {
    expect(clampKeyShift(9)).toBe(6);
    expect(clampKeyShift(-7.6)).toBe(-6);
    expect(clampKeyShift(1.4)).toBe(1);
    expect(clampKeyShift(Number.NaN)).toBe(0);
  });
});

describe('firstMidiMessageIndexAtOrAfter', () => {
  const messages = [msg(0), msg(0.5), msg(0.5), msg(1)];

  test('returns the first index whose seconds is at or after the target', () => {
    expect(firstMidiMessageIndexAtOrAfter(messages, 0)).toBe(0);
    expect(firstMidiMessageIndexAtOrAfter(messages, 0.25)).toBe(1);
    expect(firstMidiMessageIndexAtOrAfter(messages, 0.5)).toBe(1);
    expect(firstMidiMessageIndexAtOrAfter(messages, 0.75)).toBe(3);
    expect(firstMidiMessageIndexAtOrAfter(messages, 2)).toBe(4);
  });
});

class FakeClock {
  now = 1000;
  private nextHandle = 1;
  private readonly intervals = new Map<number, { fn: () => void; ms: number; due: number }>();
  private readonly timeouts = new Map<number, { fn: () => void; due: number }>();

  readonly timers: Timers = {
    setInterval: (fn, ms) => {
      const handle = this.nextHandle;
      this.nextHandle += 1;
      this.intervals.set(handle, { fn, ms, due: this.now + ms });
      return handle;
    },
    clearInterval: (handle) => {
      this.intervals.delete(handle);
    },
    setTimeout: (fn, ms) => {
      const handle = this.nextHandle;
      this.nextHandle += 1;
      this.timeouts.set(handle, { fn, due: this.now + ms });
      return handle;
    },
    clearTimeout: (handle) => {
      this.timeouts.delete(handle);
    },
  };

  advance(ms: number): void {
    const target = this.now + ms;
    for (;;) {
      const next = this.earliest();
      if (!next || next.due > target) break;
      this.now = next.due;
      next.fire();
    }
    this.now = target;
  }

  private earliest(): { due: number; fire: () => void } | null {
    let best: { due: number; fire: () => void } | null = null;
    for (const [handle, t] of this.timeouts) {
      if (!best || t.due < best.due) {
        best = {
          due: t.due,
          fire: () => {
            this.timeouts.delete(handle);
            t.fn();
          },
        };
      }
    }
    for (const t of this.intervals.values()) {
      if (!best || t.due < best.due) {
        best = {
          due: t.due,
          fire: () => {
            t.due += t.ms;
            t.fn();
          },
        };
      }
    }
    return best;
  }
}

interface SentMessage {
  data: number[];
  timestamp: number;
}

function createOutput() {
  const sent: SentMessage[] = [];
  let failure: { error: unknown } | null = null;
  const output: MidiOutputLike = {
    send(data, timestamp) {
      if (failure) throw failure.error;
      sent.push({ data: Array.from(data), timestamp: timestamp ?? 0 });
    },
    clear() {},
  };
  return {
    output,
    sent,
    failWith(error: unknown) {
      failure = { error };
    },
    succeed() {
      failure = null;
    },
  };
}

function isPanic(m: SentMessage): boolean {
  return (m.data[0]! & 0xf0) === 0xb0 && (m.data[1] === 120 || m.data[1] === 123);
}

function nonPanic(sent: SentMessage[]): SentMessage[] {
  return sent.filter((m) => !isPanic(m));
}

function makeSequence(
  messages: PlaybackMidiMessage[],
  durationSeconds: number,
  drumChannels: number[] = [],
): PlaybackSequence {
  return {
    notes: [],
    midiMessages: messages,
    tempos: [{ tick: 0, seconds: 0, bpm: 120 }],
    durationSeconds,
    durationTicks: Math.round(durationSeconds * 960),
    ticksPerQuarter: 480,
    drumChannels: new Set(drumChannels),
  };
}

function setup(messages: PlaybackMidiMessage[], durationSeconds: number, driftPerReadMs = 0) {
  const clock = new FakeClock();
  const scheduler = new MidiScheduler({
    now: () => {
      clock.now += driftPerReadMs;
      return clock.now;
    },
    timers: clock.timers,
  });
  const out = createOutput();
  scheduler.setSequence(makeSequence(messages, durationSeconds));
  scheduler.setOutput(out.output);
  return { clock, scheduler, out };
}

describe('MidiScheduler playback', () => {
  test('play() sends messages inside the lookahead window with timestamps relative to now', () => {
    const { clock, scheduler, out } = setup(
      [msg(0, [0xc0, 5]), msg(0.02, [0x90, 60, 100]), msg(0.2, [0x80, 60, 0])],
      1,
    );

    scheduler.play();

    expect(scheduler.getState().isPlaying).toBe(true);
    expect(nonPanic(out.sent)).toEqual([
      { data: [0xc0, 5], timestamp: 1000 },
      { data: [0x90, 60, 100], timestamp: 1020 },
    ]);

    clock.advance(200);

    const noteOff = nonPanic(out.sent).at(-1)!;
    expect(noteOff.data).toEqual([0x80, 60, 0]);
    expect(noteOff.timestamp).toBeCloseTo(1200, 6);
  });

  test('play() sends a note-on that starts exactly at the start position even if the clock advances during play()', () => {
    const { scheduler, out } = setup([msg(0, [0x90, 60, 100])], 1, 0.01);

    scheduler.play();

    expect(nonPanic(out.sent).map((m) => m.data)).toEqual([[0x90, 60, 100]]);
  });

  test('play() does nothing without an output or without messages', () => {
    const clock = new FakeClock();
    const scheduler = new MidiScheduler({
      now: () => clock.now,
      timers: clock.timers,
    });
    scheduler.setSequence(makeSequence([msg(0, [0xc0, 1])], 1));

    scheduler.play();
    expect(scheduler.getState().isPlaying).toBe(false);

    const out = createOutput();
    scheduler.setOutput(out.output);
    scheduler.setSequence(makeSequence([], 1));

    scheduler.play();
    expect(scheduler.getState().isPlaying).toBe(false);
    expect(out.sent).toHaveLength(0);
  });

  test('pause() freezes the position, sends a panic and reports isPlaying=false', () => {
    const { clock, scheduler, out } = setup([msg(0, [0x90, 60, 100]), msg(0.9, [0x80, 60, 0])], 1);
    scheduler.play();
    clock.advance(250);
    const before = out.sent.length;

    scheduler.pause();

    expect(scheduler.getState().isPlaying).toBe(false);
    expect(scheduler.getPosition()).toBeCloseTo(0.25, 6);
    expect(out.sent.slice(before).filter(isPanic)).toHaveLength(32);

    clock.advance(500);

    expect(scheduler.getPosition()).toBeCloseTo(0.25, 6);
    expect(nonPanic(out.sent)).toHaveLength(1);
  });

  test('stop() rewinds to 0', () => {
    const { clock, scheduler } = setup([msg(0, [0xc0, 1])], 10);
    scheduler.play();
    clock.advance(300);

    scheduler.stop();

    expect(scheduler.getState().isPlaying).toBe(false);
    expect(scheduler.getPosition()).toBe(0);
    expect(scheduler.getPositionSnapshot()).toBe(0);
  });

  test('reaching the end stops playback and rewinds to 0', () => {
    const { clock, scheduler } = setup([msg(0, [0xc0, 1])], 0.5);
    scheduler.play();

    clock.advance(600);

    expect(scheduler.getState().isPlaying).toBe(false);
    expect(scheduler.getPosition()).toBe(0);
    expect(scheduler.getPositionSnapshot()).toBe(0);
  });

  test('setOutput(null) while playing pauses at the current position', () => {
    const { clock, scheduler } = setup([msg(0, [0xc0, 1])], 10);
    scheduler.play();
    clock.advance(100);

    scheduler.setOutput(null);

    expect(scheduler.getState().isPlaying).toBe(false);
    expect(scheduler.getPosition()).toBeCloseTo(0.1, 6);
  });

  test('setOutput(next) while playing panics the old output and keeps sending to the new one', () => {
    const { clock, scheduler, out } = setup([msg(0, [0xc0, 1]), msg(0.3, [0x90, 60, 100])], 10);
    scheduler.play();
    clock.advance(100);
    const next = createOutput();
    const oldCount = out.sent.length;
    out.failWith(new Error('disconnected'));

    scheduler.setOutput(next.output);
    clock.advance(300);

    expect(scheduler.getState().isPlaying).toBe(true);
    expect(scheduler.getState().sendError).toBeNull();
    expect(nonPanic(next.sent).map((m) => m.data)).toEqual([[0x90, 60, 100]]);
    expect(out.sent.length).toBe(oldCount);
  });

  test('setSequence() while playing stops and rewinds to 0', () => {
    const { clock, scheduler } = setup([msg(0, [0xc0, 1])], 10);
    scheduler.play();
    clock.advance(100);

    scheduler.setSequence(makeSequence([], 1));

    expect(scheduler.getState().isPlaying).toBe(false);
    expect(scheduler.getPosition()).toBe(0);
  });

  test('dispose() stops the timer and sends a panic without a follow-up', () => {
    const { clock, scheduler, out } = setup([msg(0, [0xc0, 1])], 10);
    scheduler.play();
    clock.advance(100);
    const before = out.sent.length;

    scheduler.dispose();

    expect(scheduler.getState().isPlaying).toBe(false);
    expect(out.sent.slice(before).filter(isPanic)).toHaveLength(32);

    clock.advance(1000);

    expect(out.sent.length).toBe(before + 32);
  });

  test('sendReset() sends GM and XG System On to the current output', () => {
    const { scheduler, out } = setup([], 1);

    scheduler.sendReset();

    expect(out.sent.map((m) => m.data)).toEqual([
      [0xf0, 0x7e, 0x7f, 0x09, 0x01, 0xf7],
      [0xf0, 0x43, 0x10, 0x4c, 0x00, 0x00, 0x7e, 0x00, 0xf7],
    ]);
  });
});

describe('MidiScheduler notifications', () => {
  test('getState() keeps the same reference while only the position changes', () => {
    const { clock, scheduler } = setup([msg(0, [0xc0, 1])], 10);
    scheduler.play();
    const playing = scheduler.getState();

    clock.advance(500);
    expect(scheduler.getState()).toBe(playing);

    scheduler.pause();
    expect(scheduler.getState()).not.toBe(playing);
  });

  test('getPositionSnapshot() advances only every 33ms while getPosition() is continuous', () => {
    const { clock, scheduler } = setup([msg(0, [0xc0, 1])], 10);
    scheduler.play();
    expect(scheduler.getPositionSnapshot()).toBe(0);

    clock.advance(20);
    expect(scheduler.getPosition()).toBeCloseTo(0.02, 6);
    expect(scheduler.getPositionSnapshot()).toBe(0);

    clock.advance(20);
    expect(scheduler.getPositionSnapshot()).toBeCloseTo(0.04, 6);
  });

  test('subscribe() notifies on state changes and position updates, and stops after unsubscribe', () => {
    const { clock, scheduler } = setup([msg(0, [0xc0, 1])], 10);
    let calls = 0;
    const unsubscribe = scheduler.subscribe(() => {
      calls += 1;
    });

    scheduler.play();
    expect(calls).toBe(1);

    clock.advance(40);
    expect(calls).toBe(2);

    unsubscribe();
    scheduler.pause();
    expect(calls).toBe(2);
  });
});

describe('MidiScheduler send failures', () => {
  test('records the first error, stops playback, ignores later errors and clears on the next play()', () => {
    const { clock, scheduler, out } = setup([msg(0, [0x90, 60, 100]), msg(0.5, [0x80, 60, 0])], 1);
    const boom = new Error('boom');
    out.failWith(boom);

    scheduler.play();

    expect(scheduler.getState().isPlaying).toBe(false);
    expect(scheduler.getState().sendError).toEqual({ error: boom });

    out.failWith(new Error('later'));
    clock.advance(200);
    expect(scheduler.getState().sendError).toEqual({ error: boom });

    out.succeed();
    scheduler.play();

    expect(scheduler.getState().sendError).toBeNull();
    expect(scheduler.getState().isPlaying).toBe(true);
  });
});

describe('MidiScheduler seek', () => {
  test('seek() while stopped moves the position and sends chase messages on the next play()', () => {
    const { scheduler, out } = setup(
      [
        msg(0, [0xc0, 7]),
        msg(0, [0xb0, 7, 100]),
        msg(0.1, [0x90, 60, 100]),
        msg(0.4, [0x80, 60, 0]),
        msg(0.6, [0x90, 62, 100]),
      ],
      2,
    );

    scheduler.seek(0.5);

    expect(scheduler.getPosition()).toBe(0.5);
    expect(scheduler.getPositionSnapshot()).toBe(0.5);

    scheduler.play();

    expect(nonPanic(out.sent).map((m) => m.data)).toEqual([
      [0xc0, 7],
      [0xb0, 7, 100],
    ]);
  });

  test('seek() while playing keeps playing from the new position', () => {
    const { clock, scheduler, out } = setup([msg(0, [0xc0, 7]), msg(1.0, [0x90, 60, 100])], 2);
    scheduler.play();
    clock.advance(100);

    scheduler.seek(0.98);

    expect(scheduler.getState().isPlaying).toBe(true);
    expect(scheduler.getPosition()).toBeCloseTo(0.98, 6);
    expect(nonPanic(out.sent).map((m) => m.data)).toEqual([
      [0xc0, 7],
      [0xc0, 7],
      [0x90, 60, 100],
    ]);
  });

  test('seek() clamps to [0, duration]', () => {
    const { scheduler } = setup([msg(0, [0xc0, 7])], 2);

    scheduler.seek(-1);
    expect(scheduler.getPosition()).toBe(0);

    scheduler.seek(5);
    expect(scheduler.getPosition()).toBe(2);
  });

  test('a note-on exactly at the seek position is sent on play() even if the clock advances during play()', () => {
    const { scheduler, out } = setup([msg(0, [0xc0, 7]), msg(0.5, [0x90, 60, 100])], 2, 0.01);

    scheduler.seek(0.5);
    scheduler.play();

    expect(nonPanic(out.sent).map((m) => m.data)).toEqual([
      [0xc0, 7],
      [0x90, 60, 100],
    ]);
  });
});

describe('MidiScheduler playback rate', () => {
  test('setPlaybackRate() while playing keeps the position continuous and rescales timestamps', () => {
    const { clock, scheduler, out } = setup([msg(0, [0xc0, 7]), msg(0.3, [0x90, 60, 100])], 10);
    scheduler.play();
    clock.advance(200);

    scheduler.setPlaybackRate(2);

    expect(scheduler.getState().playbackRate).toBe(2);
    expect(scheduler.getPosition()).toBeCloseTo(0.2, 6);

    clock.advance(50);

    expect(scheduler.getPosition()).toBeCloseTo(0.3, 6);
    const noteOn = nonPanic(out.sent).find((m) => m.data[0] === 0x90)!;
    expect(noteOn.timestamp).toBeCloseTo(1250, 6);
  });

  test('setPlaybackRate() applies the clamp and skips notification when unchanged', () => {
    const { scheduler } = setup([], 1);
    let calls = 0;
    scheduler.subscribe(() => {
      calls += 1;
    });

    scheduler.setPlaybackRate(3);
    expect(scheduler.getState().playbackRate).toBe(2);
    expect(calls).toBe(1);

    scheduler.setPlaybackRate(2);
    expect(calls).toBe(1);
  });
});

describe('MidiScheduler key shift', () => {
  test('setKeyShift() transposes scheduled notes and skips drum channels', () => {
    const clock = new FakeClock();
    const scheduler = new MidiScheduler({
      now: () => clock.now,
      timers: clock.timers,
    });
    const out = createOutput();
    scheduler.setSequence(makeSequence([msg(0, [0x90, 60, 100]), msg(0, [0x99, 36, 100])], 1, [9]));
    scheduler.setOutput(out.output);

    scheduler.setKeyShift(2);
    scheduler.play();

    expect(nonPanic(out.sent).map((m) => m.data)).toEqual([
      [0x90, 62, 100],
      [0x99, 36, 100],
    ]);
  });

  test('setKeyShift() while playing panics and reschedules from the current position', () => {
    const { clock, scheduler, out } = setup([msg(0, [0xc0, 7]), msg(0.5, [0x90, 60, 100])], 10);
    scheduler.play();
    clock.advance(100);
    const before = out.sent.length;

    scheduler.setKeyShift(-1);

    expect(out.sent.slice(before).filter(isPanic)).toHaveLength(32);
    expect(scheduler.getState().isPlaying).toBe(true);

    clock.advance(400);

    expect(nonPanic(out.sent).at(-1)!.data).toEqual([0x90, 59, 100]);
  });

  test('setKeyShift() applies the clamp and skips notification when unchanged', () => {
    const { scheduler } = setup([], 1);
    let calls = 0;
    scheduler.subscribe(() => {
      calls += 1;
    });

    scheduler.setKeyShift(9);
    expect(scheduler.getState().keyShift).toBe(6);
    expect(calls).toBe(1);

    scheduler.setKeyShift(6);
    expect(calls).toBe(1);
  });
});
